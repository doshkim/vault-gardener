import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface PreMetrics {
  timestamp: string;
  inboxItems: number;
  totalNotes: number;
  seedNotes: number;
  totalLinks: number;
}

export interface PostMetrics extends PreMetrics {
  inboxProcessed: number;
  linksAdded: number;
  notesMoved: number;
}

export interface RunMetrics {
  date: string;
  timestamp: string;
  phase: string;
  provider: string;
  tier: string;
  model: string;
  duration_seconds: number;
  exitCode: number;
  metrics: {
    inbox_before: number;
    inbox_after: number;
    inbox_processed: number;
    links_added: number;
    notes_moved: number;
  };
  vault_health: {
    total_notes: number;
    inbox_items: number;
    seed_notes: number;
  };
}

const SKIP_DIRS = new Set(['.git', '.obsidian', '.gardener', 'node_modules', '.trash']);

/** Recursively walk a directory and collect .md file paths. */
async function walkMd(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;

    const full = join(dir, entry.name);

    if (entry.isDirectory()) {
      const nested = await walkMd(full);
      results.push(...nested);
    } else if (entry.isFile() && extname(entry.name) === '.md') {
      results.push(full);
    }
  }

  return results;
}

/** Count .md files in a single directory (non-recursive). */
async function countInbox(dir: string): Promise<number> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && extname(e.name) === '.md').length;
  } catch {
    return 0;
  }
}

/** Check if the first N lines of a file contain a pattern. */
async function matchesInHead(filePath: string, pattern: string, lines: number): Promise<boolean> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const head = content.split('\n').slice(0, lines).join('\n');
    return head.includes(pattern);
  } catch {
    return false;
  }
}

/** Count WikiLink occurrences across all .md files. */
async function countLinks(files: string[]): Promise<number> {
  let total = 0;
  const linkPattern = /\[\[/g;

  for (const file of files) {
    try {
      const content = await readFile(file, 'utf-8');
      const matches = content.match(linkPattern);
      if (matches) total += matches.length;
    } catch {
      // skip unreadable files
    }
  }

  return total;
}

/** Count notes moved via git rename detection. */
async function countMoved(cwd: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync('git', ['diff', '--name-only', '--diff-filter=R'], {
      cwd,
    });
    return stdout.trim().split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}

export async function collectPreMetrics(
  vaultPath: string,
  config: { folders: Record<string, string> },
): Promise<PreMetrics> {
  const inboxDir = join(vaultPath, config.folders.inbox ?? '00-inbox');
  const allFiles = await walkMd(vaultPath);

  let seedCount = 0;
  for (const file of allFiles) {
    if (await matchesInHead(file, 'status: seed', 10)) {
      seedCount++;
    }
  }

  const linkCount = await countLinks(allFiles);

  return {
    timestamp: new Date().toISOString(),
    inboxItems: await countInbox(inboxDir),
    totalNotes: allFiles.length,
    seedNotes: seedCount,
    totalLinks: linkCount,
  };
}

export async function collectPostMetrics(
  vaultPath: string,
  config: { folders: Record<string, string> },
  pre: PreMetrics,
): Promise<PostMetrics> {
  const inboxDir = join(vaultPath, config.folders.inbox ?? '00-inbox');
  const allFiles = await walkMd(vaultPath);

  let seedCount = 0;
  for (const file of allFiles) {
    if (await matchesInHead(file, 'status: seed', 10)) {
      seedCount++;
    }
  }

  const linkCount = await countLinks(allFiles);
  const inboxItems = await countInbox(inboxDir);
  const notesMoved = await countMoved(vaultPath);

  return {
    timestamp: new Date().toISOString(),
    inboxItems,
    totalNotes: allFiles.length,
    seedNotes: seedCount,
    totalLinks: linkCount,
    inboxProcessed: pre.inboxItems - inboxItems,
    linksAdded: linkCount - pre.totalLinks,
    notesMoved,
  };
}

export async function writeMetrics(gardenerDir: string, metrics: RunMetrics): Promise<void> {
  const metricsDir = join(gardenerDir, 'metrics');
  await mkdir(metricsDir, { recursive: true });

  const filename = `${metrics.date}.json`;
  const filePath = join(metricsDir, filename);

  let runs: RunMetrics[] = [];

  try {
    const raw = await readFile(filePath, 'utf-8');
    runs = JSON.parse(raw) as RunMetrics[];
  } catch {
    // file doesn't exist yet
  }

  runs.push(metrics);
  await writeFile(filePath, JSON.stringify(runs, null, 2), 'utf-8');
}

export async function readMetrics(gardenerDir: string, days?: number): Promise<RunMetrics[]> {
  const metricsDir = join(gardenerDir, 'metrics');
  let files: string[];

  try {
    const entries = await readdir(metricsDir);
    files = entries.filter((f) => f.endsWith('.json')).sort();
  } catch {
    return [];
  }

  if (days && days > 0) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    files = files.filter((f) => f.replace('.json', '') >= cutoffStr);
  }

  const allRuns: RunMetrics[] = [];

  for (const file of files) {
    try {
      const raw = await readFile(join(metricsDir, file), 'utf-8');
      const runs = JSON.parse(raw) as RunMetrics[];
      allRuns.push(...runs);
    } catch {
      // skip corrupted files
    }
  }

  return allRuns.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}
