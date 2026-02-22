import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

/**
 * Generate a macOS launchd plist for vault-gardener.
 * Returns the path to the generated plist file.
 */
export async function generateLaunchdPlist(
  vaultPath: string,
  cronExpression: string
): Promise<string> {
  // Parse cron to launchd interval (simplified: extract hour interval)
  const interval = parseCronToSeconds(cronExpression);

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.vault-gardener.${vaultHash(vaultPath)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>npx</string>
    <string>vault-gardener</string>
    <string>run</string>
    <string>all</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${vaultPath}</string>
  <key>StartInterval</key>
  <integer>${interval}</integer>
  <key>StandardOutPath</key>
  <string>${join(vaultPath, '.gardener', 'logs', 'launchd-stdout.log')}</string>
  <key>StandardErrorPath</key>
  <string>${join(vaultPath, '.gardener', 'logs', 'launchd-stderr.log')}</string>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>`;

  const plistPath = join(
    homedir(),
    'Library',
    'LaunchAgents',
    `com.vault-gardener.${vaultHash(vaultPath)}.plist`
  );

  await writeFile(plistPath, plist, 'utf-8');
  return plistPath;
}

/** Short hash of vault path to make service names unique per vault. */
function vaultHash(vaultPath: string): string {
  return createHash('sha256').update(vaultPath).digest('hex').slice(0, 8);
}

function parseCronToSeconds(cron: string): number {
  // Simple parser: "0 */4 * * *" → 4 hours = 14400s
  const parts = cron.split(' ');
  if (parts.length >= 2) {
    const hourPart = parts[1];
    const match = hourPart.match(/\*\/(\d+)/);
    if (match) return parseInt(match[1], 10) * 3600;
  }
  // Default: 4 hours
  return 14400;
}
