import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { VaultDigest } from './digest.js';
import chalk from 'chalk';
import { getGardenerDir, loadConfig } from './config.js';
import { readMetrics } from '../metrics/collector.js';
import { isLocked } from '../lock/index.js';

interface StatusOptions {
  json?: boolean;
}

export async function statusCommand(options: StatusOptions): Promise<void> {
  const cwd = process.cwd();
  const gardenerDir = getGardenerDir(cwd);

  let config;
  try {
    config = await loadConfig(cwd);
  } catch {
    console.error(chalk.red('No .gardener/config.yaml found. Run `vault-gardener init` first.'));
    process.exit(1);
  }

  const metrics = await readMetrics(gardenerDir, 30);
  const locked = await isLocked(gardenerDir);

  // Check daemon
  let daemonPid: number | null = null;
  try {
    const pidFile = join(gardenerDir, '.daemon-pid');
    const pid = parseInt(await readFile(pidFile, 'utf-8'), 10);
    process.kill(pid, 0);
    daemonPid = pid;
  } catch {
    // Not running
  }

  if (options.json) {
    // Compute vault health for JSON output
    let vaultHealth = null;
    if (metrics.length > 0) {
      const latest = metrics[0];
      // Try to read suggestions from digest.json
      let suggestions: string[] = [];
      let lastDigest: string | null = null;
      try {
        const digestPath = join(gardenerDir, 'digest.json');
        const digestRaw = await readFile(digestPath, 'utf-8');
        const digest = JSON.parse(digestRaw) as VaultDigest;
        suggestions = digest.suggestions ?? [];
        lastDigest = digest.generated ?? null;
      } catch { /* no digest yet */ }

      vaultHealth = {
        totalNotes: latest.vault_health.total_notes,
        inboxItems: latest.vault_health.inbox_items,
        seedNotes: latest.vault_health.seed_notes,
        suggestions,
        lastDigest,
      };
    }

    console.log(
      JSON.stringify(
        {
          config: {
            provider: config.provider,
            tier: config.tier,
            schedule: config.schedule,
          },
          daemon: daemonPid ? { pid: daemonPid, running: true } : { running: false },
          locked,
          recentRuns: metrics.slice(0, 10),
          vaultHealth,
        },
        null,
        2
      )
    );
    return;
  }

  // TUI-lite output (non-interactive for now)
  console.log(chalk.bold('\nvault-gardener status\n'));

  // Config
  console.log(chalk.cyan('Configuration'));
  console.log(`  Provider: ${config.provider} / ${config.tier}`);
  console.log(`  Schedule: ${config.schedule.enabled ? config.schedule.cron : 'disabled'}`);
  console.log(`  Daemon: ${daemonPid ? chalk.green(`running (PID: ${daemonPid})`) : chalk.dim('stopped')}`);
  console.log(`  Lock: ${locked ? chalk.yellow('active') : chalk.dim('free')}`);

  // Recent runs
  if (metrics.length === 0) {
    console.log(chalk.dim('\nNo runs yet. Run `vault-gardener run` to start.\n'));
    return;
  }

  console.log(chalk.cyan('\nRecent Runs'));
  console.log(
    chalk.dim(
      '  Date                Phase     Duration  Inbox  Links  Status'
    )
  );

  for (const m of metrics.slice(0, 10)) {
    const date = m.timestamp.slice(0, 16).replace('T', ' ');
    const phase = m.phase.padEnd(9);
    const duration = `${m.duration_seconds}s`.padStart(8);
    const inbox = `${m.metrics.inbox_processed}`.padStart(5);
    const links = `${m.metrics.links_added}`.padStart(5);
    const status = m.exitCode === 0 ? chalk.green('ok') : chalk.red('fail');

    console.log(`  ${date}  ${phase}  ${duration}  ${inbox}  ${links}  ${status}`);
  }

  // Vault health from most recent run
  const latest = metrics[0];
  if (latest) {
    console.log(chalk.cyan('\nVault Health'));
    console.log(`  Total notes: ${latest.vault_health.total_notes}`);
    console.log(`  Inbox items: ${latest.vault_health.inbox_items}`);
    console.log(`  Seed notes: ${latest.vault_health.seed_notes}`);

    // Sparkline of inbox over last 7 runs
    const inboxHistory = metrics
      .slice(0, 7)
      .reverse()
      .map((m) => m.vault_health.inbox_items);

    if (inboxHistory.length > 1) {
      const sparkChars = '▁▂▃▄▅▆▇█';
      const max = Math.max(...inboxHistory, 1);
      const spark = inboxHistory
        .map((v) => sparkChars[Math.min(Math.floor((v / max) * 8), 7)])
        .join('');
      console.log(`  Inbox trend: ${spark} (last ${inboxHistory.length} runs)`);
    }
  }

  console.log('');
}
