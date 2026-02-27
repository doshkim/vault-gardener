import { readFile, readdir, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';
import {
  walkMarkdownFiles,
  appendJsonArrayFile,
  readJsonArrayDir,
  matchesInHead,
} from '../utils/fs.js';
import type { WalkOptions } from '../utils/fs.js';

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

export type { WalkOptions, WalkResult } from '../utils/fs.js';

const MAX_FILE_SIZE = 1_048_576; // 1 MB
const COUNT_LINKS_TIMEOUT_MS = 30_000;
const BATCH_SIZE = 100;
const SEED_DETECTION_TIMEOUT_MS = 30_000;

/** Count .md files in a single directory (non-recursive). */
export async function countInbox(dir: string): Promise<number> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && extname(e.name) === '.md').length;
  } catch {
    return 0;
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
  const walkResult = await walkMarkdownFiles(vaultPath, opts);

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
  const walkResult = await walkMarkdownFiles(vaultPath, opts);

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
  const filePath = join(gardenerDir, 'metrics', `${metrics.date}.json`);
  await appendJsonArrayFile(filePath, metrics);
}

export async function readMetrics(gardenerDir: string, days?: number): Promise<RunMetrics[]> {
  const metricsDir = join(gardenerDir, 'metrics');
  const runs = await readJsonArrayDir<RunMetrics>(metricsDir, days);
  return runs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}
