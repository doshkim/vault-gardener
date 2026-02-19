import { readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export interface LockInfo {
  pid: number;
  startedAt: string;
}

const LOCK_FILE = '.lock';
const STALE_THRESHOLD_MS = 300_000; // 5 minutes

function lockPath(gardenerDir: string): string {
  return join(gardenerDir, LOCK_FILE);
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isStale(info: LockInfo): boolean {
  const age = Date.now() - new Date(info.startedAt).getTime();
  return age > STALE_THRESHOLD_MS;
}

export async function acquireLock(gardenerDir: string): Promise<void> {
  const existing = await getLockInfo(gardenerDir);

  if (existing) {
    if (!isPidAlive(existing.pid) || isStale(existing)) {
      await unlink(lockPath(gardenerDir));
    } else {
      throw new Error(`Gardener is already running (PID: ${existing.pid})`);
    }
  }

  const info: LockInfo = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };

  await writeFile(lockPath(gardenerDir), JSON.stringify(info, null, 2), 'utf-8');
}

export async function releaseLock(gardenerDir: string): Promise<void> {
  const info = await getLockInfo(gardenerDir);
  if (!info) return;

  if (info.pid === process.pid) {
    await unlink(lockPath(gardenerDir));
  }
}

export async function isLocked(gardenerDir: string): Promise<boolean> {
  const info = await getLockInfo(gardenerDir);
  if (!info) return false;

  return isPidAlive(info.pid);
}

export async function getLockInfo(gardenerDir: string): Promise<LockInfo | null> {
  try {
    const raw = await readFile(lockPath(gardenerDir), 'utf-8');
    return JSON.parse(raw) as LockInfo;
  } catch {
    return null;
  }
}
