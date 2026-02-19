import { writeFile, readFile, unlink, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export interface DaemonHealth {
  pid: number;
  lastCheck: string;
  lastRun: string | null;
  status: 'running' | 'idle' | 'errored' | 'shutdown';
  consecutiveFailures: number;
}

const HEALTH_FILE = '.daemon-health';
const HEALTH_STALE_MS = 5 * 60 * 1000; // 5 minutes

function healthPath(gardenerDir: string): string {
  return join(gardenerDir, HEALTH_FILE);
}

export async function writeDaemonHealth(
  gardenerDir: string,
  health: DaemonHealth,
): Promise<void> {
  const tmpFile = healthPath(gardenerDir) + '.tmp';
  await writeFile(tmpFile, JSON.stringify(health, null, 2), 'utf-8');
  await rename(tmpFile, healthPath(gardenerDir));
}

export async function readDaemonHealth(
  gardenerDir: string,
): Promise<DaemonHealth | null> {
  try {
    const raw = await readFile(healthPath(gardenerDir), 'utf-8');
    return JSON.parse(raw) as DaemonHealth;
  } catch {
    return null;
  }
}

export async function isDaemonHealthy(gardenerDir: string): Promise<boolean> {
  const health = await readDaemonHealth(gardenerDir);
  if (!health) return false;

  const age = Date.now() - new Date(health.lastCheck).getTime();
  return age < HEALTH_STALE_MS;
}

/**
 * Start a detached daemon that runs vault-gardener on a cron schedule.
 * Returns the PID of the daemon process.
 */
export async function startDaemon(
  vaultPath: string,
  cronExpression: string
): Promise<number> {
  const daemonScript = join(
    fileURLToPath(import.meta.url),
    '..',
    '..',
    '..',
    'dist',
    'src',
    'scheduler',
    'daemon-worker.js'
  );

  // Fork a detached worker process
  const child = fork(daemonScript, [vaultPath, cronExpression], {
    detached: true,
    stdio: 'ignore',
    cwd: vaultPath,
  });

  child.unref();

  const pid = child.pid!;
  const gardenerDir = join(vaultPath, '.gardener');
  const pidFile = join(gardenerDir, '.daemon-pid');
  await writeFile(pidFile, String(pid), 'utf-8');

  // Write initial health
  await writeDaemonHealth(gardenerDir, {
    pid,
    lastCheck: new Date().toISOString(),
    lastRun: null,
    status: 'idle',
    consecutiveFailures: 0,
  });

  return pid;
}

/**
 * Check if the daemon is running.
 */
export async function isDaemonRunning(vaultPath: string): Promise<boolean> {
  const pidFile = join(vaultPath, '.gardener', '.daemon-pid');
  try {
    const pid = parseInt(await readFile(pidFile, 'utf-8'), 10);
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Stop the daemon. Validates health file matches PID to avoid killing unrelated processes.
 */
export async function stopDaemon(vaultPath: string): Promise<void> {
  const gardenerDir = join(vaultPath, '.gardener');
  const pidFile = join(gardenerDir, '.daemon-pid');
  try {
    const pid = parseInt(await readFile(pidFile, 'utf-8'), 10);
    // Verify this PID is actually our daemon by checking health file
    const health = await readDaemonHealth(gardenerDir);
    if (health && health.pid === pid && health.status !== 'shutdown') {
      process.kill(pid, 'SIGTERM');
    }
  } catch {
    // Already dead or PID mismatch
  }
  await unlink(pidFile).catch(() => {});
}
