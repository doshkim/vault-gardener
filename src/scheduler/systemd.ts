import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Generate a Linux systemd unit + timer for vault-gardener.
 * Returns the path to the generated service file.
 */
export async function generateSystemdUnit(
  vaultPath: string,
  cronExpression: string
): Promise<string> {
  const interval = parseCronToOnCalendar(cronExpression);
  const unitDir = join(homedir(), '.config', 'systemd', 'user');
  await mkdir(unitDir, { recursive: true });

  const service = `[Unit]
Description=Vault Gardener — AI-powered vault maintenance
After=network.target

[Service]
Type=oneshot
WorkingDirectory=${vaultPath}
ExecStart=npx vault-gardener run all
StandardOutput=append:${join(vaultPath, '.gardener', 'logs', 'systemd.log')}
StandardError=append:${join(vaultPath, '.gardener', 'logs', 'systemd-error.log')}

[Install]
WantedBy=default.target
`;

  const timer = `[Unit]
Description=Vault Gardener Timer

[Timer]
OnCalendar=${interval}
Persistent=true

[Install]
WantedBy=timers.target
`;

  const servicePath = join(unitDir, 'vault-gardener.service');
  const timerPath = join(unitDir, 'vault-gardener.timer');

  await writeFile(servicePath, service, 'utf-8');
  await writeFile(timerPath, timer, 'utf-8');

  return servicePath;
}

function parseCronToOnCalendar(cron: string): string {
  // Simple parser: "0 */4 * * *" → "*-*-* 0/4:00:00"
  const parts = cron.split(' ');
  if (parts.length >= 2) {
    const minutePart = parts[0];
    const hourPart = parts[1];
    const match = hourPart.match(/\*\/(\d+)/);
    if (match) {
      return `*-*-* 0/${match[1]}:${minutePart.padStart(2, '0')}:00`;
    }
  }
  // Default: every 4 hours
  return '*-*-* 0/4:00:00';
}
