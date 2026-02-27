import { readFile, writeFile, readdir, mkdir, rename, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { SKIP_DIRS } from '../constants.js';

// ---------------------------------------------------------------------------
// Walk markdown files
// ---------------------------------------------------------------------------

export interface WalkOptions {
  maxFiles?: number;
  timeout?: number;
}

export interface WalkResult {
  files: string[];
  approximate: boolean;
  timedOut: boolean;
}

const DEFAULT_MAX_FILES = 50_000;

/** Recursively walk a directory and collect .md file paths. */
export async function walkMarkdownFiles(dir: string, opts?: WalkOptions): Promise<WalkResult> {
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
      return;
    }

    for (const entry of entries) {
      if (approximate || timedOut) return;

      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
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

// ---------------------------------------------------------------------------
// Atomic JSON array append
// ---------------------------------------------------------------------------

/**
 * Append an item to a date-keyed JSON array file using atomic write.
 * Creates the parent directory if it doesn't exist.
 */
export async function appendJsonArrayFile<T>(filePath: string, item: T): Promise<void> {
  const dir = join(filePath, '..');
  await mkdir(dir, { recursive: true });

  let existing: T[] = [];
  try {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) existing = parsed;
  } catch {
    // file doesn't exist or corrupt JSON — start fresh
  }

  existing.push(item);

  const tmpFile = filePath + '.tmp';
  await writeFile(tmpFile, JSON.stringify(existing, null, 2), 'utf-8');
  await rename(tmpFile, filePath);
}

// ---------------------------------------------------------------------------
// Read JSON directory with date filtering
// ---------------------------------------------------------------------------

/**
 * Read all JSON array files from a directory, optionally filtered by date.
 * Files are expected to be named YYYY-MM-DD.json.
 */
export async function readJsonArrayDir<T>(
  dir: string,
  days?: number,
): Promise<T[]> {
  let files: string[];

  try {
    const entries = await readdir(dir);
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

  const all: T[] = [];
  for (const file of files) {
    try {
      const raw = await readFile(join(dir, file), 'utf-8');
      const items = JSON.parse(raw) as T[];
      all.push(...items);
    } catch {
      // skip corrupted files
    }
  }

  return all;
}

// ---------------------------------------------------------------------------
// Date formatting
// ---------------------------------------------------------------------------

/** Format date as YYYY-MM-DD in local timezone. */
export function localDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Format time as HH:MM in local timezone. */
export function localTime(d: Date): string {
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${min}`;
}

// ---------------------------------------------------------------------------
// File content helpers
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE = 1_048_576; // 1 MB

/** Check if the first N lines of a file contain a pattern. */
export async function matchesInHead(filePath: string, pattern: string, lines: number): Promise<boolean> {
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
