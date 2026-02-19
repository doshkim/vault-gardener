import { join } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import {
  loadConfig,
  getGardenerDir,
  resolveModel,
  resolveTimeout,
} from './config.js';
import { acquireLock, releaseLock } from '../lock/index.js';
import { collectPreMetrics, collectPostMetrics, writeMetrics } from '../metrics/collector.js';
import { formatSummary } from '../metrics/format.js';
import type { ProviderName, Tier, RunOptions } from '../providers/types.js';
import type { RunMetrics } from '../metrics/collector.js';

type Phase = 'seed' | 'nurture' | 'tend' | 'all';

interface RunCommandOptions {
  provider?: string;
  tier?: string;
  dryRun?: boolean;
  verbose?: boolean;
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

  // Acquire lock
  try {
    await acquireLock(gardenerDir);
  } catch (err) {
    console.error(chalk.red(`${(err as Error).message}`));
    process.exit(1);
  }

  const startTime = Date.now();
  let exitCode = 0;

  try {
    // Pre-metrics
    const pre = await collectPreMetrics(cwd, config);

    // Load provider
    const provider = await loadProvider(config.provider);

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
  } finally {
    await releaseLock(gardenerDir);
  }

  if (exitCode !== 0) process.exit(1);
}

async function loadProvider(name: ProviderName) {
  switch (name) {
    case 'claude': {
      const { createClaudeProvider } = await import('../providers/claude.js');
      return createClaudeProvider();
    }
    case 'codex': {
      const { createCodexProvider } = await import('../providers/codex.js');
      return createCodexProvider();
    }
    case 'gemini': {
      const { createGeminiProvider } = await import('../providers/gemini.js');
      return createGeminiProvider();
    }
    default:
      throw new Error(`Unknown provider: ${name}`);
  }
}
