import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import chalk from 'chalk';
import { getGardenerDir } from './config.js';

export async function stopCommand(): Promise<void> {
  const gardenerDir = getGardenerDir();
  const pidFile = join(gardenerDir, '.daemon-pid');

  try {
    const pid = parseInt(await readFile(pidFile, 'utf-8'), 10);

    try {
      process.kill(pid, 'SIGTERM');
      console.log(chalk.green(`Gardener stopped (PID: ${pid})`));
    } catch {
      console.log(chalk.yellow(`Process ${pid} not found. Cleaning up stale PID file.`));
    }

    await unlink(pidFile).catch(() => {});
  } catch {
    console.log(chalk.yellow('No daemon running.'));
  }
}
