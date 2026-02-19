import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import chalk from 'chalk';
import { readMetrics } from '../metrics/collector.js';
import { isLocked } from '../lock/index.js';
import type { RunMetrics } from '../metrics/collector.js';

/**
 * Render the TUI dashboard. This is a static render (not ink-based)
 * that prints a formatted overview and exits. For live updates,
 * use `vault-gardener status` in a watch loop.
 */
export async function renderDashboard(gardenerDir: string): Promise<string> {
  const metrics = await readMetrics(gardenerDir, 30);
  const locked = await isLocked(gardenerDir);

  // Daemon status
  let daemonStatus = 'stopped';
  try {
    const pidFile = join(gardenerDir, '.daemon-pid');
    const pid = parseInt(await readFile(pidFile, 'utf-8'), 10);
    process.kill(pid, 0);
    daemonStatus = `running (PID: ${pid})`;
  } catch {
    // Not running
  }

  const lines: string[] = [];

  lines.push(chalk.bold.green('┌─────────────────────────────────────────┐'));
  lines.push(chalk.bold.green('│          vault-gardener status           │'));
  lines.push(chalk.bold.green('└─────────────────────────────────────────┘'));
  lines.push('');

  // Status bar
  lines.push(
    `  Daemon: ${daemonStatus === 'stopped' ? chalk.dim(daemonStatus) : chalk.green(daemonStatus)}` +
      `  |  Lock: ${locked ? chalk.yellow('active') : chalk.dim('free')}`
  );
  lines.push('');

  // Recent runs table
  if (metrics.length === 0) {
    lines.push(chalk.dim('  No runs yet. Run `vault-gardener run` to start.'));
    return lines.join('\n');
  }

  lines.push(chalk.cyan('  Recent Runs'));
  lines.push(
    chalk.dim('  ─────────────────────────────────────────────────────────────')
  );
  lines.push(
    chalk.dim('  Date              Phase     Duration  Inbox  Links  Status')
  );

  for (const m of metrics.slice(0, 10)) {
    const date = m.timestamp.slice(0, 16).replace('T', ' ');
    const phase = m.phase.padEnd(9);
    const duration = `${m.duration_seconds}s`.padStart(8);
    const inbox = `${m.metrics.inbox_processed}`.padStart(5);
    const links = `${m.metrics.links_added}`.padStart(5);
    const status = m.exitCode === 0 ? chalk.green('  ok') : chalk.red('fail');

    lines.push(`  ${date}  ${phase}  ${duration}  ${inbox}  ${links}  ${status}`);
  }

  // Vault health
  const latest = metrics[0];
  lines.push('');
  lines.push(chalk.cyan('  Vault Health'));
  lines.push(
    chalk.dim('  ─────────────────────────────────────────────────────────────')
  );
  lines.push(`  Total notes: ${latest.vault_health.total_notes}`);
  lines.push(`  Inbox items: ${latest.vault_health.inbox_items}`);
  lines.push(`  Seed notes:  ${latest.vault_health.seed_notes}`);

  // Sparkline
  const inboxHistory = metrics
    .slice(0, 14)
    .reverse()
    .map((m) => m.vault_health.inbox_items);

  if (inboxHistory.length > 1) {
    const sparkChars = '▁▂▃▄▅▆▇█';
    const max = Math.max(...inboxHistory, 1);
    const spark = inboxHistory
      .map((v) => sparkChars[Math.min(Math.floor((v / max) * 8), 7)])
      .join('');
    lines.push(`  Inbox trend: ${spark}`);
  }

  return lines.join('\n');
}
