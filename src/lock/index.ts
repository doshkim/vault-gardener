import { readFile, writeFile, unlink, rename, open, constants } from 'node:fs/promises';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { enqueue } from '../queue/index.js';
import type { QueueEntry } from '../queue/index.js';
import type { Logger } from '../logging/index.js';

export interface LockInfo {
  pid: number;
  startedAt: string;
  hostname: string;
}

export interface LockHandle {
  release(): Promise<void>;
  startHeartbeat(): void;
  stopHeartbeat(): void;
}

const LOCK_FILE = '.lock';
const HEARTBEAT_FILE = '.lock-heartbeat';
const STALE_THRESHOLD_MS = 300_000; // 5 minutes
const HEARTBEAT_INTERVAL_MS = 30_000; // 30 seconds
const HEARTBEAT_STALE_MS = 90_000; // 90 seconds

function lockPath(gardenerDir: string): string {
  return join(gardenerDir, LOCK_FILE);
}

function heartbeatPath(gardenerDir: string): string {
  return join(gardenerDir, HEARTBEAT_FILE);
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function getHeartbeat(gardenerDir: string): Promise<{ pid: number; timestamp: string } | null> {
  try {
    const raw = await readFile(heartbeatPath(gardenerDir), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isStale(info: LockInfo): boolean {
  const age = Date.now() - new Date(info.startedAt).getTime();
  return age > STALE_THRESHOLD_MS;
}

async function isStaleWithHeartbeat(info: LockInfo, gardenerDir: string): Promise<boolean> {
  if (!isPidAlive(info.pid)) return true;

  const hb = await getHeartbeat(gardenerDir);
  if (hb) {
    const hbAge = Date.now() - new Date(hb.timestamp).getTime();
    if (hbAge > HEARTBEAT_STALE_MS) return true;
  }

  // PID is alive — trust it even if heartbeat is missing or lock is old
  return false;
}

async function writeHeartbeat(gardenerDir: string): Promise<void> {
  const data = JSON.stringify({ pid: process.pid, timestamp: new Date().toISOString() });
  const tmpFile = heartbeatPath(gardenerDir) + '.tmp';
  await writeFile(tmpFile, data, 'utf-8');
  await rename(tmpFile, heartbeatPath(gardenerDir));
}

async function removeFiles(gardenerDir: string): Promise<void> {
  await unlink(lockPath(gardenerDir)).catch(() => {});
  await unlink(heartbeatPath(gardenerDir)).catch(() => {});
}

export async function acquireLock(gardenerDir: string, logger?: Logger): Promise<LockHandle> {
  const path = lockPath(gardenerDir);
  const info: LockInfo = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    hostname: hostname(),
  };

  try {
    // O_CREAT | O_EXCL = atomic create-if-not-exists (kernel-level)
    const fd = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
    await fd.writeFile(JSON.stringify(info, null, 2), 'utf-8');
    await fd.close();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      // Lock file exists — check staleness
      const existing = await getLockInfo(gardenerDir);
      if (existing && await isStaleWithHeartbeat(existing, gardenerDir)) {
        logger?.warn('lock.stale_removed', { context: { stalePid: existing.pid, staleHost: existing.hostname } });
        await removeFiles(gardenerDir);
        // Retry with exclusive create
        return acquireLock(gardenerDir, logger);
      }
      throw new Error(`Gardener is already running (PID: ${existing?.pid})`);
    }
    throw err;
  }

  // Write initial heartbeat
  await writeHeartbeat(gardenerDir);

  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  const handle: LockHandle = {
    startHeartbeat() {
      if (heartbeatTimer) return;
      heartbeatTimer = setInterval(() => {
        writeHeartbeat(gardenerDir).catch(() => {});
      }, HEARTBEAT_INTERVAL_MS);
      heartbeatTimer.unref();
    },

    stopHeartbeat() {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    },

    async release() {
      handle.stopHeartbeat();
      await removeFiles(gardenerDir);
    },
  };

  return handle;
}

export async function acquireOrQueue(
  gardenerDir: string,
  queueEntry: QueueEntry,
  logger?: Logger,
): Promise<LockHandle | null> {
  try {
    return await acquireLock(gardenerDir, logger);
  } catch (err) {
    if ((err as Error).message.startsWith('Gardener is already running')) {
      logger?.info('lock.queued', { context: { phase: queueEntry.phase } });
      await enqueue(gardenerDir, queueEntry);
      return null;
    }
    throw err;
  }
}

export async function forceRelease(gardenerDir: string, logger?: Logger): Promise<void> {
  logger?.warn('lock.force_release');
  await removeFiles(gardenerDir);
}

/** @deprecated Use acquireLock() which returns a LockHandle */
export async function releaseLock(gardenerDir: string): Promise<void> {
  const info = await getLockInfo(gardenerDir);
  if (!info) return;

  if (info.pid === process.pid) {
    await removeFiles(gardenerDir);
  }
}

export async function isLocked(gardenerDir: string): Promise<boolean> {
  const info = await getLockInfo(gardenerDir);
  if (!info) return false;

  return !(await isStaleWithHeartbeat(info, gardenerDir));
}

export async function getLockInfo(gardenerDir: string): Promise<LockInfo | null> {
  try {
    const raw = await readFile(lockPath(gardenerDir), 'utf-8');
    return JSON.parse(raw) as LockInfo;
  } catch {
    return null;
  }
}
