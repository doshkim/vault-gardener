/**
 * Daemon worker — spawned as a detached child process.
 * Runs vault-gardener on a cron schedule using node-cron.
 */
import cron from 'node-cron';
import { execFile } from 'node:child_process';
import { join } from 'node:path';

const [, , vaultPath, cronExpression] = process.argv;

if (!vaultPath || !cronExpression) {
  console.error('Usage: daemon-worker <vaultPath> <cronExpression>');
  process.exit(1);
}

// Find the vault-gardener binary
const bin = join(
  new URL('.', import.meta.url).pathname,
  '..',
  '..',
  'bin',
  'vault-gardener.js'
);

console.log(`Daemon started. Vault: ${vaultPath}, Cron: ${cronExpression}`);

cron.schedule(cronExpression, () => {
  console.log(`[${new Date().toISOString()}] Running gardener...`);

  execFile('node', [bin, 'run', 'all'], { cwd: vaultPath }, (err, stdout, stderr) => {
    if (err) {
      console.error(`[${new Date().toISOString()}] Error:`, err.message);
      if (stderr) console.error(stderr);
    }
    if (stdout) console.log(stdout);
  });
});

// Keep alive
process.on('SIGTERM', () => {
  console.log('Daemon shutting down...');
  process.exit(0);
});
