import { readFile, writeFile, readdir, mkdir, stat, rename } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';

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

export interface WalkOptions {
  maxFiles?: number;
  timeout?: number;
}

export interface WalkResult {
  files: string[];
  approximate: boolean;
  timedOut: boolean;
}

const SKIP_DIRS = new Set(['.git', '.obsidian', '.gardener', 'node_modules', '.trash']);
const DEFAULT_MAX_FILES = 50_000;
const MAX_FILE_SIZE = 1_048_576; // 1 MB
const COUNT_LINKS_TIMEOUT_MS = 30_000; // 30 seconds
const BATCH_SIZE = 100;
const SEED_DETECTION_TIMEOUT_MS = 30_000; // 30 seconds

/** Recursively walk a directory and collect .md file paths. */
async function walkMd(dir: string, opts?: WalkOptions): Promise<WalkResult> {
  const maxFiles = opts?.maxFiles ?? DEFAULT_MAX_FILES;
  const timeoutMs = opts?.timeout;
  const startTime = timeoutMs != null ? performance.now() : 0;
  const results: string[] = [];
  let approximate = false;
  let timedOut = false;

  async function walk(d: string): Promise<void> {
    if (approximate || timedOut) return;

    if (timeoutMs != null && performance.now() - startTime > timeoutMs) {
      timedOut = true;
      approximate = true;
      return;
    }

    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return; // individual dir failure doesn't kill walk
    }

    for (const entry of entries) {
      if (approximate || timedOut) return;

      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;

      // Skip symlinks
      if (entry.isSymbolicLink()) continue;

      const full = join(d, entry.name);

      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && extname(entry.name) === '.md') {
        results.push(full);
        if (results.length >= maxFiles) {
          approximate = true;
          return;
        }
      }
    }
  }

  await walk(dir);
  return { files: results, approximate, timedOut };
}

/** Count .md files in a single directory (non-recursive). */
export async function countInbox(dir: string): Promise<number> {
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
    const info = await stat(filePath);
    if (info.size > MAX_FILE_SIZE) return false;

    const content = await readFile(filePath, 'utf-8');
    const head = content.split('\n').slice(0, lines).join('\n');
    return head.includes(pattern);
  } catch {
    return false;
  }
}

/** Count WikiLink occurrences across all .md files. */
async function countLinks(files: string[], timeout?: number): Promise<number> {
  const timeoutMs = timeout ?? COUNT_LINKS_TIMEOUT_MS;
  const startTime = performance.now();
  let total = 0;
  const linkPattern = /\[\[/g;

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    if (performance.now() - startTime > timeoutMs) break;

    const batch = files.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (file) => {
        try {
          const info = await stat(file);
          if (info.size > MAX_FILE_SIZE) return 0;

          const content = await readFile(file, 'utf-8');
          const matches = content.match(linkPattern);
          return matches ? matches.length : 0;
        } catch {
          return 0;
        }
      }),
    );
    for (const count of batchResults) total += count;
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

/** Count seed notes in batches with a timeout. */
async function countSeeds(files: string[], timeout?: number): Promise<number> {
  const timeoutMs = timeout ?? SEED_DETECTION_TIMEOUT_MS;
  const startTime = performance.now();
  let total = 0;

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    if (performance.now() - startTime > timeoutMs) break;

    const batch = files.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map((f) => matchesInHead(f, 'status: seed', 10)),
    );
    total += results.filter(Boolean).length;
  }

  return total;
}

export async function collectPreMetrics(
  vaultPath: string,
  config: { folders: Record<string, string> },
  opts?: WalkOptions,
): Promise<PreMetrics> {
  const inboxDir = join(vaultPath, config.folders.inbox ?? '00-inbox');
  const walkResult = await walkMd(vaultPath, opts);

  const seedCount = await countSeeds(walkResult.files);
  const linkCount = await countLinks(walkResult.files);

  return {
    timestamp: new Date().toISOString(),
    inboxItems: await countInbox(inboxDir),
    totalNotes: walkResult.files.length,
    seedNotes: seedCount,
    totalLinks: linkCount,
  };
}

export async function collectPostMetrics(
  vaultPath: string,
  config: { folders: Record<string, string> },
  pre: PreMetrics,
  opts?: WalkOptions,
): Promise<PostMetrics> {
  const inboxDir = join(vaultPath, config.folders.inbox ?? '00-inbox');
  const walkResult = await walkMd(vaultPath, opts);

  const seedCount = await countSeeds(walkResult.files);
  const linkCount = await countLinks(walkResult.files);
  const inboxItems = await countInbox(inboxDir);
  const notesMoved = await countMoved(vaultPath);

  return {
    timestamp: new Date().toISOString(),
    inboxItems,
    totalNotes: walkResult.files.length,
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
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      runs = parsed as RunMetrics[];
    }
  } catch {
    // file doesn't exist or corrupt JSON — start fresh
  }

  runs.push(metrics);

  // Atomic write: write to tmp, then rename
  const tmpFile = filePath + '.tmp';
  await writeFile(tmpFile, JSON.stringify(runs, null, 2), 'utf-8');
  await rename(tmpFile, filePath);
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
