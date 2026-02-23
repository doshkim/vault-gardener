import { readFile, writeFile, readdir, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import type { ParsedReport, FeatureReport } from './schema.js';
import type { RunMetrics } from '../metrics/collector.js';
import type { GardenerConfig } from '../config/schema.js';

// ---------------------------------------------------------------------------
// JSON archive
// ---------------------------------------------------------------------------

/** Archive a parsed report to .gardener/reports/YYYY-MM-DD.json (append). */
export async function archiveReport(
  gardenerDir: string,
  report: ParsedReport,
): Promise<void> {
  const date = report.timestamp.slice(0, 10);
  const reportsDir = join(gardenerDir, 'reports');
  await mkdir(reportsDir, { recursive: true });

  const filePath = join(reportsDir, `${date}.json`);
  let existing: ParsedReport[] = [];

  try {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) existing = parsed;
  } catch {
    // file doesn't exist or corrupt — start fresh
  }

  existing.push(report);

  const tmpFile = filePath + '.tmp';
  await writeFile(tmpFile, JSON.stringify(existing, null, 2), 'utf-8');
  await rename(tmpFile, filePath);
}

/** Read archived reports from the last N days. */
export async function readReports(
  gardenerDir: string,
  days = 30,
): Promise<ParsedReport[]> {
  const reportsDir = join(gardenerDir, 'reports');
  let files: string[];

  try {
    const entries = await readdir(reportsDir);
    files = entries.filter((f) => f.endsWith('.json')).sort();
  } catch {
    return [];
  }

  if (days > 0) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    files = files.filter((f) => f.replace('.json', '') >= cutoffStr);
  }

  const all: ParsedReport[] = [];
  for (const file of files) {
    try {
      const raw = await readFile(join(reportsDir, file), 'utf-8');
      const reports = JSON.parse(raw) as ParsedReport[];
      all.push(...reports);
    } catch {
      // skip corrupted files
    }
  }

  return all.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

/** Read the latest report (newest first). */
export async function readLatestReport(
  gardenerDir: string,
): Promise<ParsedReport | null> {
  const reports = await readReports(gardenerDir, 7);
  return reports[0] ?? null;
}

// ---------------------------------------------------------------------------
// Markdown daily log
// ---------------------------------------------------------------------------

export interface LogContext {
  pre: { inboxItems: number; totalNotes: number; seedNotes: number };
  post: { inboxItems: number; totalNotes: number; seedNotes: number };
  duration: number;
  phase: string;
  config: GardenerConfig;
}

/**
 * Write/append a gardening log entry to .gardener/logs/YYYY/YYYY-MM-DD.md
 * Works with or without an LLM report.
 */
export async function writeGardeningLog(
  gardenerDir: string,
  report: ParsedReport | null,
  ctx: LogContext,
): Promise<void> {
  const now = new Date();
  const date = localDate(now);
  const year = date.slice(0, 4);
  const time = localTime(now);

  const logsDir = join(gardenerDir, 'logs', year);
  await mkdir(logsDir, { recursive: true });

  const logPath = join(logsDir, `${date}.md`);

  let existing = '';
  try {
    existing = await readFile(logPath, 'utf-8');
  } catch {
    // First run of the day — create header
  }

  const entry = renderLogEntry(report, ctx, time);

  const content = existing
    ? `${existing}\n${entry}`
    : `# Gardening Log — ${date}\n\n${entry}`;

  await writeFile(logPath, content, 'utf-8');
}

function renderLogEntry(
  report: ParsedReport | null,
  ctx: LogContext,
  time: string,
): string {
  const { phase, duration, config, pre, post } = ctx;
  const model = resolveModelName(config);
  const lines: string[] = [];

  if (!report) {
    // Minimal entry when no LLM report exists
    lines.push(`## ${time} — ${capitalize(phase)} (${config.provider}/${model}, ${duration}s)`);
    lines.push('');
    lines.push('> No feature report — LLM did not write run-report.json');
    lines.push('');
    lines.push('### Vault Health');
    lines.push(renderVaultHealth(pre, post));
    lines.push('');
    lines.push('---');
    return lines.join('\n');
  }

  // Full entry with report data
  const hasErrors = report._parsed.parseErrors.length > 0;
  const marker = hasErrors ? '⚠' : '✓';

  lines.push(`## ${time} — ${capitalize(phase)} (${config.provider}/${model}, ${duration}s) ${marker}`);
  lines.push('');

  // Features table per phase
  for (const phaseReport of report.phases) {
    if (report.phases.length > 1) {
      lines.push(`### ${capitalize(phaseReport.phase)} Phase`);
      lines.push('');
    }

    if (phaseReport.features.length > 0) {
      lines.push('### Features');
      lines.push('| Feature | Status | Details |');
      lines.push('|---------|--------|---------|');

      for (const f of phaseReport.features) {
        const statusIcon = featureStatusIcon(f.status);
        const details = formatFeatureDetails(f);
        lines.push(`| ${f.feature} | ${statusIcon} | ${details} |`);
      }
      lines.push('');
    }
  }

  // Vault Health
  lines.push('### Vault Health');
  lines.push(renderVaultHealth(pre, post));
  lines.push('');

  // Warnings
  const allWarnings = [
    ...report._parsed.validationWarnings,
    ...report._parsed.missingFeatures.map((f) => `${f} enabled but not reported`),
  ];
  if (allWarnings.length > 0) {
    lines.push('### Warnings');
    for (const w of allWarnings) {
      lines.push(`- ⚠ ${w}`);
    }
    lines.push('');
  }

  // Summary
  if (report.summary) {
    lines.push(`> ${report.summary}`);
    lines.push('');
  }

  lines.push('---');
  return lines.join('\n');
}

function renderVaultHealth(
  pre: { inboxItems: number; totalNotes: number; seedNotes: number },
  post: { inboxItems: number; totalNotes: number; seedNotes: number },
): string {
  const lines: string[] = [];
  lines.push(formatDelta('Notes', pre.totalNotes, post.totalNotes));
  lines.push(formatDelta('Inbox', pre.inboxItems, post.inboxItems));
  lines.push(formatDelta('Seed', pre.seedNotes, post.seedNotes));
  return lines.join('\n');
}

function formatDelta(label: string, before: number, after: number): string {
  const diff = after - before;
  const sign = diff >= 0 ? '+' : '';
  return `- ${label}: ${before.toLocaleString()} → ${after.toLocaleString()} (${sign}${diff})`;
}

function featureStatusIcon(status: string): string {
  switch (status) {
    case 'executed': return '✓';
    case 'skipped': return '–';
    case 'error': return '✗';
    default: return '?';
  }
}

function formatFeatureDetails(f: FeatureReport): string {
  if (f.status === 'skipped' && f.reason) return `skipped: ${f.reason}`;
  if (f.status === 'error' && f.reason) return `error: ${f.reason}`;
  if (f.notes) return f.notes;

  // Format counts
  const entries = Object.entries(f.counts ?? {});
  if (entries.length === 0) return f.status;
  return entries.map(([k, v]) => `${v} ${k.replace(/_/g, ' ')}`).join(', ');
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function resolveModelName(config: GardenerConfig): string {
  const providerConfig = config[config.provider] as Record<string, unknown>;
  const key = config.tier === 'power' ? 'power_model' : 'fast_model';
  return (providerConfig?.[key] as string) ?? config.tier;
}

/** Format date as YYYY-MM-DD in local timezone. */
function localDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Format time as HH:MM in local timezone. */
function localTime(d: Date): string {
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${min}`;
}
