import chalk from 'chalk';
import type { RunMetrics } from './collector.js';

export function formatSummary(metrics: RunMetrics): string {
  const phase = chalk.cyan(metrics.phase.charAt(0).toUpperCase() + metrics.phase.slice(1));
  const inbox = metrics.metrics.inbox_processed;
  const links = metrics.metrics.links_added;
  const moved = metrics.metrics.notes_moved;
  const duration = metrics.duration_seconds;
  const exit = metrics.exitCode;

  const parts: string[] = [];

  if (exit === 0) {
    parts.push(`${phase} complete.`);
  } else {
    parts.push(`${phase} ${chalk.red('failed')} (exit ${exit}).`);
  }

  const details: string[] = [];
  if (inbox > 0) details.push(`${chalk.green(String(inbox))} inbox items processed`);
  if (links > 0) details.push(`${chalk.green(String(links))} links added`);
  if (moved > 0) details.push(`${chalk.green(String(moved))} notes moved`);

  if (details.length > 0) {
    parts.push(details.join(', ') + '.');
  }

  parts.push(chalk.dim(`(${duration}s)`));

  return parts.join(' ');
}

export function formatMarkdownReport(metrics: RunMetrics[]): string {
  if (metrics.length === 0) return '_No runs recorded._';

  const lines: string[] = [
    '| Date | Phase | Duration | Inbox Processed | Links Added | Notes |',
    '|------|-------|----------|-----------------|-------------|-------|',
  ];

  for (const m of metrics) {
    const date = m.date;
    const phase = m.phase;
    const duration = `${m.duration_seconds}s`;
    const inbox = String(m.metrics.inbox_processed);
    const links = String(m.metrics.links_added);
    const notes = String(m.vault_health.total_notes);

    lines.push(`| ${date} | ${phase} | ${duration} | ${inbox} | ${links} | ${notes} |`);
  }

  return lines.join('\n');
}
