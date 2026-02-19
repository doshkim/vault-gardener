import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export interface QueueEntry {
  phase: string;
  provider: string;
  tier: string;
  queuedAt: string;
  reason: string;
}

export interface QueueConfig {
  maxSize?: number;
  maxAgeHours?: number;
}

const QUEUE_FILE = 'queue.json';
const DEFAULT_MAX_SIZE = 10;
const DEFAULT_MAX_AGE_HOURS = 24;

function queuePath(gardenerDir: string): string {
  return join(gardenerDir, QUEUE_FILE);
}

function tmpPath(gardenerDir: string): string {
  return join(gardenerDir, QUEUE_FILE + '.tmp');
}

async function readQueue(gardenerDir: string): Promise<QueueEntry[]> {
  try {
    const raw = await readFile(queuePath(gardenerDir), 'utf-8');
    return JSON.parse(raw) as QueueEntry[];
  } catch {
    return [];
  }
}

async function writeQueue(gardenerDir: string, entries: QueueEntry[]): Promise<void> {
  const tmp = tmpPath(gardenerDir);
  await writeFile(tmp, JSON.stringify(entries, null, 2), 'utf-8');
  await rename(tmp, queuePath(gardenerDir));
}

function isStale(entry: QueueEntry, maxAgeHours: number): boolean {
  const age = Date.now() - new Date(entry.queuedAt).getTime();
  return age > maxAgeHours * 60 * 60 * 1000;
}

export async function enqueue(
  gardenerDir: string,
  entry: QueueEntry,
  config?: QueueConfig,
): Promise<void> {
  const maxSize = config?.maxSize ?? DEFAULT_MAX_SIZE;
  const maxAgeHours = config?.maxAgeHours ?? DEFAULT_MAX_AGE_HOURS;

  let entries = await readQueue(gardenerDir);

  // Purge stale entries
  entries = entries.filter((e) => !isStale(e, maxAgeHours));

  entries.push(entry);

  // Drop oldest if over max size
  while (entries.length > maxSize) {
    entries.shift();
  }

  await writeQueue(gardenerDir, entries);
}

export async function dequeue(gardenerDir: string): Promise<QueueEntry | null> {
  const entries = await readQueue(gardenerDir);
  if (entries.length === 0) return null;

  const first = entries.shift()!;
  await writeQueue(gardenerDir, entries);
  return first;
}

export async function peekQueue(gardenerDir: string): Promise<QueueEntry | null> {
  const entries = await readQueue(gardenerDir);
  return entries[0] ?? null;
}

export async function drainQueue(
  gardenerDir: string,
  runFn: (entry: QueueEntry) => Promise<void>,
): Promise<void> {
  let entry = await dequeue(gardenerDir);
  while (entry) {
    await runFn(entry);
    entry = await dequeue(gardenerDir);
  }
}

export async function getQueueDepth(gardenerDir: string): Promise<number> {
  const entries = await readQueue(gardenerDir);
  return entries.length;
}

export async function purgeStale(
  gardenerDir: string,
  maxAgeHours: number = DEFAULT_MAX_AGE_HOURS,
): Promise<number> {
  const entries = await readQueue(gardenerDir);
  const fresh = entries.filter((e) => !isStale(e, maxAgeHours));
  const purged = entries.length - fresh.length;

  if (purged > 0) {
    await writeQueue(gardenerDir, fresh);
  }

  return purged;
}
