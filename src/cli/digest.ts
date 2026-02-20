import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import chalk from 'chalk';
import { loadConfig, getGardenerDir } from './config.js';
import { readMetrics, countInbox } from '../metrics/collector.js';
import { generateSuggestions } from '../analysis/suggestions.js';
import { generateWeeklyBrief } from '../analysis/weekly-brief.js';
import { analyzeActivity } from '../analysis/activity.js';
import type { WeeklyBrief } from '../analysis/weekly-brief.js';
import type { ActivityData, EnrichedNote, MovedNote } from '../analysis/activity.js';

export interface VaultDigest {
  generated: string;
  summary: string;
  lastRun: {
    timestamp: string;
    status: 'completed' | 'error' | 'skipped';
    phase: string;
    duration: number;
    provider: string;
  } | null;
  activity: {
    inboxProcessed: number;
    linksCreated: number;
    notesEnriched: EnrichedNote[];
    notesMoved: MovedNote[];
  };
  suggestions: string[];
  weeklyBrief?: WeeklyBrief;
}

interface DigestOptions {
  json?: boolean;
  weekly?: boolean;
}

export async function digestCommand(options: DigestOptions): Promise<void> {
  const cwd = process.cwd();
  const digest = await generateDigest(cwd, { ...options, writeToDisk: true });

  if (options.json) {
    console.log(JSON.stringify(digest, null, 2));
  } else {
    printDigest(digest);
  }
}

export async function generateDigest(
  vaultPath: string,
  options: { weekly?: boolean; writeToDisk?: boolean } = {},
): Promise<VaultDigest> {
  const gardenerDir = getGardenerDir(vaultPath);

  let config;
  try {
    config = await loadConfig(vaultPath);
  } catch {
    // No config -- use defaults
    config = { folders: { inbox: '00-inbox', projects: '02-projects', roles: '03-roles', resources: '04-resources' } };
  }

  // Read latest metrics
  const metrics = await readMetrics(gardenerDir, 7);
  const latest = metrics[0] ?? null;

  // Build lastRun from metrics
  const lastRun = latest
    ? {
        timestamp: latest.timestamp,
        status: (latest.exitCode === 0 ? 'completed' : 'error') as 'completed' | 'error' | 'skipped',
        phase: latest.phase,
        duration: latest.duration_seconds,
        provider: latest.provider,
      }
    : null;

  // Analyze recent activity from git
  const activity = await analyzeActivity(vaultPath);
  if (latest) {
    activity.inboxProcessed = latest.metrics.inbox_processed;
  }

  // Generate suggestions
  const suggestions = await generateSuggestions({
    vaultPath,
    folders: config.folders as Record<string, string>,
  });

  // Build summary
  const summaryParts: string[] = [];
  if (activity.inboxProcessed > 0) summaryParts.push(`${activity.inboxProcessed} inbox items processed`);
  if (activity.linksCreated > 0) summaryParts.push(`${activity.linksCreated} WikiLinks created`);
  if (activity.notesEnriched.length > 0) summaryParts.push(`${activity.notesEnriched.length} notes enriched`);

  const inboxCount = await countInbox(join(vaultPath, config.folders.inbox ?? '00-inbox'));
  if (inboxCount > 0) summaryParts.push(`${inboxCount} item${inboxCount !== 1 ? 's' : ''} in inbox`);

  const summary = summaryParts.length > 0 ? summaryParts.join(', ') : 'No recent gardener activity';

  const digest: VaultDigest = {
    generated: new Date().toISOString(),
    summary,
    lastRun,
    activity,
    suggestions,
  };

  // Include weekly brief if requested or if it's Sunday
  const includeWeekly = options.weekly ?? new Date().getDay() === 0;
  if (includeWeekly) {
    digest.weeklyBrief = await generateWeeklyBrief({
      vaultPath,
      folders: config.folders as Record<string, string>,
    });
  }

  // Write digest.json (only when explicitly requested or from post-run hook)
  if (options.writeToDisk !== false) {
    const digestPath = join(gardenerDir, 'digest.json');
    await mkdir(gardenerDir, { recursive: true });
    await writeFile(digestPath, JSON.stringify(digest, null, 2), 'utf-8');
  }

  return digest;
}

function printDigest(digest: VaultDigest): void {
  console.log(chalk.bold('\nvault-gardener digest\n'));
  console.log(chalk.cyan('Summary'));
  console.log(`  ${digest.summary}`);

  if (digest.lastRun) {
    console.log(chalk.cyan('\nLast Run'));
    console.log(`  Phase: ${digest.lastRun.phase}`);
    console.log(`  Status: ${digest.lastRun.status === 'completed' ? chalk.green('completed') : chalk.red(digest.lastRun.status)}`);
    console.log(`  Duration: ${digest.lastRun.duration}s`);
    console.log(`  Provider: ${digest.lastRun.provider}`);
    console.log(`  Time: ${digest.lastRun.timestamp}`);
  }

  if (digest.suggestions.length > 0) {
    console.log(chalk.cyan('\nSuggestions'));
    for (const s of digest.suggestions) {
      console.log(`  ${chalk.yellow('!')} ${s}`);
    }
  }

  if (digest.weeklyBrief) {
    const wb = digest.weeklyBrief;
    console.log(chalk.cyan('\nWeekly Brief'));
    console.log(`  New notes: ${wb.vaultGrowth}`);
    if (wb.mostActiveAreas.length > 0) console.log(`  Active areas: ${wb.mostActiveAreas.join(', ')}`);
    if (wb.approachingDeadlines.length > 0) {
      console.log(`  Deadlines:`);
      for (const d of wb.approachingDeadlines) {
        console.log(`    ${d.title} -- ${d.daysLeft}d left`);
      }
    }
    if (wb.archiveSuggestions.length > 0) {
      console.log(`  Consider archiving: ${wb.archiveSuggestions.join(', ')}`);
    }
  }

  console.log('');
}
