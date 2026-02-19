import { writeFile, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
  const pidFile = join(vaultPath, '.gardener', '.daemon-pid');
  await writeFile(pidFile, String(pid), 'utf-8');

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
 * Stop the daemon.
 */
export async function stopDaemon(vaultPath: string): Promise<void> {
  const pidFile = join(vaultPath, '.gardener', '.daemon-pid');
  try {
    const pid = parseInt(await readFile(pidFile, 'utf-8'), 10);
    process.kill(pid, 'SIGTERM');
  } catch {
    // Already dead
  }
  await unlink(pidFile).catch(() => {});
}
