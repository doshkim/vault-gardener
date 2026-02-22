import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import chalk from 'chalk';
import { getGardenerDir, loadConfig } from './config.js';
import { startDaemon } from '../scheduler/daemon.js';
import { generateLaunchdPlist } from '../scheduler/launchd.js';
import { generateSystemdUnit } from '../scheduler/systemd.js';

interface StartOptions {
  install?: boolean;
}

export async function startCommand(options: StartOptions): Promise<void> {
  const cwd = process.cwd();
  const gardenerDir = getGardenerDir(cwd);

  let config;
  try {
    config = await loadConfig(cwd);
  } catch {
    console.error(chalk.red('No .gardener/config.yaml found. Run `vault-gardener init` first.'));
    process.exit(1);
  }

  if (!config.schedule.enabled) {
    console.log(chalk.yellow('Schedule is disabled in config. Enabling...'));
    config.schedule.enabled = true;
  }

  if (options.install) {
    const platform = process.platform;
    if (platform === 'darwin') {
      const plistPath = await generateLaunchdPlist(cwd, config.schedule.cron);
      console.log(chalk.green(`Installed launchd plist: ${plistPath}`));
      console.log(chalk.dim('Run: launchctl load ' + plistPath));
    } else if (platform === 'linux') {
      const unitPath = await generateSystemdUnit(cwd, config.schedule.cron);
      console.log(chalk.green(`Generated systemd unit: ${unitPath}`));
      const unitName = unitPath.split('/').pop()!.replace('.service', '');
      console.log(chalk.dim(`Run: systemctl --user enable ${unitName} && systemctl --user start ${unitName}`));
    } else {
      console.error(chalk.red(`Platform ${platform} not supported for --install. Use the daemon instead.`));
      process.exit(1);
    }
    return;
  }

  // Check if daemon is already running
  const pidFile = join(gardenerDir, '.daemon-pid');
  try {
    const pid = parseInt(await readFile(pidFile, 'utf-8'), 10);
    process.kill(pid, 0); // Check if alive
    console.log(chalk.yellow(`Daemon already running (PID: ${pid})`));
    return;
  } catch {
    // Not running, start it
  }

  const pid = await startDaemon(cwd, config.schedule.cron);
  console.log(
    chalk.green(`Gardener started. Cron: ${config.schedule.cron}. PID: ${pid}`)
  );
}
