import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import chalk from 'chalk';
import ora from 'ora';
import {
  loadConfig,
  getGardenerDir,
  resolveModel,
  resolveTimeout,
} from './config.js';
import { renderAll } from '../prompts/render.js';
import { acquireLock, acquireOrQueue, forceRelease } from '../lock/index.js';
import type { LockHandle } from '../lock/index.js';
import type { QueueEntry } from '../queue/index.js';
import { createLogger } from '../logging/index.js';
import { runPreflight } from '../preflight/index.js';
import { notifyFailure } from '../notify/index.js';
import { collectPreMetrics, collectPostMetrics, writeMetrics } from '../metrics/collector.js';
import { formatSummary } from '../metrics/format.js';
import { parseRunReport, archiveReport, writeGardeningLog } from '../reports/index.js';
import type { ParsedReport } from '../reports/index.js';
import type { ProviderName, Tier, RunOptions } from '../providers/types.js';
import type { GardenerConfig } from '../config/index.js';
import type { RunMetrics } from '../metrics/collector.js';

type Phase = 'seed' | 'nurture' | 'tend' | 'all';

interface RunCommandOptions {
  provider?: string;
  tier?: string;
  dryRun?: boolean;
  verbose?: boolean;
  forceUnlock?: boolean;
  noQueue?: boolean;
  force?: boolean;
  validate?: boolean;
}

const PHASE_PROMPTS: Record<string, string> = {
  seed: 'seed.md',
  nurture: 'nurture.md',
  tend: 'tend.md',
  all: 'garden.md',
};

export async function runCommand(
  phase: string | undefined,
  options: RunCommandOptions
): Promise<void> {
  const cwd = process.cwd();
  const gardenerDir = getGardenerDir(cwd);
  const resolvedPhase: Phase = (phase as Phase) ?? 'all';

  if (!['seed', 'nurture', 'tend', 'all'].includes(resolvedPhase)) {
    console.error(
      chalk.red(`Invalid phase "${resolvedPhase}". Use: seed, nurture, tend, or all`)
    );
    process.exit(1);
  }

  // Load config
  let config;
  try {
    config = await loadConfig(cwd);
  } catch {
    console.error(
      chalk.red('No .gardener/config.yaml found. Run `vault-gardener init` first.')
    );
    process.exit(1);
  }

  // Apply overrides
  if (options.provider) config.provider = options.provider as ProviderName;
  if (options.tier) config.tier = options.tier as Tier;

  const model = resolveModel(config);
  const timeout = resolveTimeout(config);
  const promptFile = join(gardenerDir, 'prompts', PHASE_PROMPTS[resolvedPhase]);
  const contextFile = join(gardenerDir, 'context.md');

  // Create logger
  const logger = await createLogger(gardenerDir, { verbose: options.verbose });
  logger.info('run_start', { phase: resolvedPhase, provider: config.provider, model });

  // Preflight checks — always run in validate mode, skip only with --force (non-validate)
  if (options.validate || !options.force) {
    const preflight = await runPreflight(cwd, gardenerDir, config, logger);

    if (preflight.warnings.length > 0) {
      for (const w of preflight.warnings) {
        console.log(chalk.yellow(`  [warn] ${w}`));
      }
    }

    if (!preflight.ok) {
      for (const e of preflight.errors) {
        console.error(chalk.red(`  [error] ${e}`));
      }
      process.exit(1);
    }
  }

  // Validate-only mode
  if (options.validate) {
    console.log(chalk.green('Preflight checks passed.'));
    process.exit(0);
  }

  console.log(
    chalk.dim(
      `\nvault-gardener run ${resolvedPhase} — ${config.provider}/${model}\n`
    )
  );

  if (options.dryRun) {
    console.log(chalk.yellow('Dry run — would execute:'));
    console.log(chalk.dim(`  Provider: ${config.provider}`));
    console.log(chalk.dim(`  Model: ${model}`));
    console.log(chalk.dim(`  Prompt: ${promptFile}`));
    console.log(chalk.dim(`  Context: ${contextFile}`));
    console.log(chalk.dim(`  Timeout: ${timeout}s`));
    console.log(chalk.dim(`  CWD: ${cwd}`));
    return;
  }

  // Force-unlock if requested
  if (options.forceUnlock) {
    await forceRelease(gardenerDir, logger);
  }

  // Acquire lock (or queue)
  let lockHandle: LockHandle;
  try {
    if (options.noQueue) {
      lockHandle = await acquireLock(gardenerDir, logger);
    } else {
      const queueEntry: QueueEntry = {
        phase: resolvedPhase,
        provider: config.provider,
        tier: config.tier,
        queuedAt: new Date().toISOString(),
        reason: 'lock_busy',
      };
      const handle = await acquireOrQueue(gardenerDir, queueEntry, logger);
      if (!handle) {
        console.log(chalk.yellow('Gardener busy — run queued for next invocation.'));
        process.exit(0);
      }
      lockHandle = handle;
    }
  } catch (err) {
    console.error(chalk.red(`${(err as Error).message}`));
    process.exit(1);
  }

  lockHandle.startHeartbeat();

  const startTime = Date.now();
  let exitCode = 0;

  try {
    // Re-render prompts from config before each run
    await renderAll(gardenerDir, config);

    // Pre-metrics
    const pre = await collectPreMetrics(cwd, config);

    // Load provider
    const provider = await loadProvider(config.provider, config);

    const spinner = options.verbose
      ? null
      : ora({
          text: `Running ${resolvedPhase} phase...`,
          color: 'green',
        }).start();

    const runOpts: RunOptions = {
      prompt: `Read ${contextFile} for vault context, then read ${promptFile} and execute all steps.`,
      contextFile,
      promptFile,
      cwd,
      timeout,
      model,
      verbose: options.verbose,
      gardenerDir,
    };

    const result = await provider.run(runOpts);
    exitCode = result.exitCode;

    if (spinner) spinner.stop();

    if (result.exitCode !== 0) {
      console.error(chalk.red(`\nProvider exited with code ${result.exitCode}`));
      if (result.output) {
        console.error(chalk.dim(result.output.slice(-500)));
      }
    }

    // Post-metrics
    const post = await collectPostMetrics(cwd, config, pre);
    const duration = Math.round((Date.now() - startTime) / 1000);

    // Parse LLM feature report + write gardening log
    let report: ParsedReport | null = null;
    try {
      report = await parseRunReport(cwd, config.features);
      if (report) {
        for (const w of report._parsed.validationWarnings) {
          logger.warn('report_validation', { context: { warning: w } });
        }
        if (report._parsed.missingFeatures.length > 0) {
          logger.warn('report_missing_features', { context: { features: report._parsed.missingFeatures } });
        }
        await archiveReport(gardenerDir, report);
      } else {
        logger.warn('report_not_found');
      }
    } catch {
      logger.warn('report_parse_failed');
    }

    // Write daily gardening log (works with or without LLM report)
    try {
      await writeGardeningLog(gardenerDir, report, {
        pre,
        post,
        duration,
        phase: resolvedPhase,
        config,
      });
    } catch {
      // Non-critical — don't fail the run
    }

    const metrics: RunMetrics = {
      date: new Date().toISOString().split('T')[0],
      timestamp: new Date().toISOString(),
      phase: resolvedPhase,
      provider: config.provider,
      tier: config.tier,
      model,
      duration_seconds: duration,
      exitCode,
      metrics: {
        inbox_before: pre.inboxItems,
        inbox_after: post.inboxItems,
        inbox_processed: post.inboxProcessed,
        links_added: post.linksAdded,
        notes_moved: post.notesMoved,
      },
      vault_health: {
        total_notes: post.totalNotes,
        inbox_items: post.inboxItems,
        seed_notes: post.seedNotes,
      },
    };

    await writeMetrics(gardenerDir, metrics);
    console.log('\n' + formatSummary(metrics));

    // Post-run digest generation
    try {
      const { generateDigest } = await import('./digest.js');
      await generateDigest(cwd, { weekly: new Date().getDay() === 0 });
    } catch {
      // Digest generation is non-critical -- don't fail the run
    }

    // Write last-run marker
    const lastRunPath = join(gardenerDir, 'last-run.md');
    const lastRunContent = `---\ndate: ${metrics.date}\ntimestamp: ${metrics.timestamp}\nphase: ${resolvedPhase}\nprovider: ${config.provider}\nmodel: ${model}\nduration: ${duration}s\nexitCode: ${exitCode}\n---\n`;
    await writeFile(lastRunPath, lastRunContent, 'utf-8').catch(() => {});
  } finally {
    lockHandle.stopHeartbeat();
    await lockHandle.release();
  }

  // Notify on failure (exclude vault_path to avoid leaking local paths)
  if (exitCode !== 0) {
    const duration = Math.round((Date.now() - startTime) / 1000);
    await notifyFailure(
      {
        phase: resolvedPhase,
        duration_seconds: duration,
        exit_code: exitCode,
        reason: `Provider exited with code ${exitCode}`,
        timestamp: new Date().toISOString(),
      },
      logger,
    );
    logger.error('run_failed', { phase: resolvedPhase, exitCode });
  } else {
    logger.info('run_complete', { phase: resolvedPhase });
  }

  // Queue entries are left for the next cron tick or manual run to pick up.
  // Consuming them here without actually re-executing would silently discard work.

  if (exitCode !== 0) process.exit(1);
}

async function loadProvider(name: ProviderName, config: GardenerConfig) {
  const providerConfig = config[name] as Record<string, unknown>;
  switch (name) {
    case 'claude': {
      const { createClaudeProvider } = await import('../providers/claude.js');
      return createClaudeProvider(providerConfig);
    }
    case 'codex': {
      const { createCodexProvider } = await import('../providers/codex.js');
      return createCodexProvider(providerConfig);
    }
    case 'gemini': {
      const { createGeminiProvider } = await import('../providers/gemini.js');
      return createGeminiProvider(providerConfig);
    }
    default:
      throw new Error(`Unknown provider: ${name}`);
  }
}
