/**
 * Daemon worker — spawned as a detached child process.
 * Runs vault-gardener on a cron schedule using node-cron.
 */
import cron from 'node-cron';
import { execFile } from 'node:child_process';
import { join, resolve, isAbsolute } from 'node:path';
import { access } from 'node:fs/promises';
import { writeDaemonHealth } from './daemon.js';
import { createLogger } from '../logging/index.js';
import type { DaemonHealth } from './daemon.js';
import type { Logger } from '../logging/index.js';

const [, , rawVaultPath, cronExpression] = process.argv;

if (!rawVaultPath || !cronExpression) {
  console.error('Usage: daemon-worker <vaultPath> <cronExpression>');
  process.exit(1);
}

// Validate cron expression
if (!cron.validate(cronExpression)) {
  console.error(`Invalid cron expression: "${cronExpression}"`);
  process.exit(1);
}

// Normalize and validate vault path
const vaultPath = isAbsolute(rawVaultPath) ? rawVaultPath : resolve(rawVaultPath);
await access(vaultPath).catch(() => {
  console.error(`Vault path inaccessible: "${vaultPath}"`);
  process.exit(1);
});

const gardenerDir = join(vaultPath, '.gardener');

// Find the vault-gardener binary
const bin = join(
  new URL('.', import.meta.url).pathname,
  '..',
  '..',
  'bin',
  'vault-gardener.js'
);

let consecutiveFailures = 0;
let lastFailureTime = 0;
let isRunning = false;
let shuttingDown = false;
let logger: Logger;

const MAX_CONSECUTIVE_FAILURES = 5;
const BACKOFF_BASE_MS = 60_000; // 1 minute
const MAX_BACKOFF_EXPONENT = 6; // cap at ~64 minutes
const HEALTH_INTERVAL_MS = 60_000; // 60 seconds

function currentHealth(): DaemonHealth {
  return {
    pid: process.pid,
    lastCheck: new Date().toISOString(),
    lastRun: lastRunTimestamp,
    status: shuttingDown ? 'shutdown' : isRunning ? 'running' : consecutiveFailures > 0 ? 'errored' : 'idle',
    consecutiveFailures,
  };
}

let lastRunTimestamp: string | null = null;

async function writeHealth(): Promise<void> {
  await writeDaemonHealth(gardenerDir, currentHealth()).catch(() => {});
}

// Initialize logger and start
(async () => {
  logger = await createLogger(gardenerDir);
  logger.info('daemon_start', { context: { vault: vaultPath, cron: cronExpression } });

  // Write health periodically
  const healthTimer = setInterval(() => {
    writeHealth();
  }, HEALTH_INTERVAL_MS);
  healthTimer.unref();

  // Initial health write
  await writeHealth();

  cron.schedule(cronExpression, () => {
    if (shuttingDown) return;
    if (isRunning) {
      logger.warn('daemon_skip', { context: { reason: 'previous run still active' } });
      return;
    }

    // Backoff on consecutive failures — allow retry after backoff elapses
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      const exponent = Math.min(consecutiveFailures - MAX_CONSECUTIVE_FAILURES, MAX_BACKOFF_EXPONENT);
      const backoff = BACKOFF_BASE_MS * Math.pow(2, exponent);
      const elapsed = Date.now() - lastFailureTime;
      if (elapsed < backoff) {
        logger.warn('daemon_backoff', {
          context: { consecutiveFailures, backoffMs: backoff, remainingMs: backoff - elapsed },
        });
        return;
      }
      // Backoff elapsed — allow retry
    }

    isRunning = true;
    lastRunTimestamp = new Date().toISOString();
    writeHealth();

    logger.info('daemon_run_start');

    execFile('node', [bin, 'run', 'all'], { cwd: vaultPath }, (err, stdout, stderr) => {
      isRunning = false;

      if (err) {
        consecutiveFailures++;
        lastFailureTime = Date.now();
        logger.error('daemon_run_failed', {
          error: { message: err.message },
          context: { consecutiveFailures },
        });
        if (stderr) logger.error('daemon_stderr', { context: { output: stderr.slice(-500) } });
      } else {
        consecutiveFailures = 0;
        logger.info('daemon_run_complete');
      }

      writeHealth();
    });
  });

  // Graceful shutdown handlers
  function shutdown(signal: string): void {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('daemon_shutdown', { context: { signal } });

    // Wait for current run to finish (max 30s)
    const deadline = Date.now() + 30_000;
    const check = setInterval(async () => {
      if (!isRunning || Date.now() > deadline) {
        clearInterval(check);
        clearInterval(healthTimer);
        await writeDaemonHealth(gardenerDir, {
          pid: process.pid,
          lastCheck: new Date().toISOString(),
          lastRun: lastRunTimestamp,
          status: 'shutdown',
          consecutiveFailures,
        });
        process.exit(0);
      }
    }, 500);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
})();
