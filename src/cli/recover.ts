import { readFile, readdir, rename, rm, stat, unlink, access } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import chalk from 'chalk';
import { createLogger } from '../logging/index.js';
import { purgeStale } from '../queue/index.js';
import { isPidAlive } from '../lock/index.js';
import { getGardenerDir } from './config.js';

export async function recoverCommand(): Promise<void> {
  const cwd = process.cwd();
  const gardenerDir = getGardenerDir(cwd);
  const logger = await createLogger(gardenerDir);

  let fixed = 0;
  let reported = 0;

  console.log(chalk.bold('\nvault-gardener recover\n'));

  // 1. Stale .lock file
  const lockFile = join(gardenerDir, '.lock');
  try {
    const raw = await readFile(lockFile, 'utf-8');
    let lockData: { pid?: number };
    try {
      lockData = JSON.parse(raw);
    } catch {
      // Orphan .lock with no valid JSON
      await unlink(lockFile);
      console.log(chalk.green('  [FIXED] Removed orphan .lock (invalid JSON)'));
      logger.info('recover.orphan_lock_removed');
      fixed++;
      lockData = {};
    }

    if (lockData.pid != null) {
      if (!isPidAlive(lockData.pid)) {
        await unlink(lockFile);
        console.log(chalk.green(`  [FIXED] Removed stale .lock (PID ${lockData.pid} dead)`));
        logger.info('recover.stale_lock_removed', { context: { pid: lockData.pid } });
        fixed++;
      } else {
        console.log(chalk.yellow(`  [REPORT] .lock held by PID ${lockData.pid} (alive)`));
        reported++;
      }
    }
  } catch {
    // No lock file — fine
  }

  // 2. Stale .lock-heartbeat
  const heartbeatFile = join(gardenerDir, '.lock-heartbeat');
  try {
    await access(heartbeatFile);
    // If no lock exists, heartbeat is orphan
    try {
      await access(lockFile);
    } catch {
      await unlink(heartbeatFile);
      console.log(chalk.green('  [FIXED] Removed orphan .lock-heartbeat'));
      logger.info('recover.orphan_heartbeat_removed');
      fixed++;
    }
  } catch {
    // No heartbeat file — fine
  }

  // 3. Staged-but-uncommitted git changes
  try {
    const staged = execFileSync('git', ['diff', '--cached', '--name-only'], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (staged.trim()) {
      const files = staged.trim().split('\n');
      console.log(chalk.yellow(`  [REPORT] ${files.length} staged-but-uncommitted file(s)`));
      for (const f of files.slice(0, 5)) {
        console.log(chalk.dim(`           ${f}`));
      }
      if (files.length > 5) console.log(chalk.dim(`           ... and ${files.length - 5} more`));
      reported++;
    }
  } catch {
    // Not a git repo or git unavailable
  }

  // 4. Orphan .gardener.tmp/
  const tmpDir = join(gardenerDir, '.gardener.tmp');
  try {
    const info = await stat(tmpDir);
    if (info.isDirectory()) {
      await rm(tmpDir, { recursive: true, force: true });
      console.log(chalk.green('  [FIXED] Removed orphan .gardener.tmp/'));
      logger.info('recover.orphan_tmp_removed');
      fixed++;
    }
  } catch {
    // No tmp dir — fine
  }

  // 5. Stale queue entries > 24h
  try {
    const purged = await purgeStale(gardenerDir, 24);
    if (purged > 0) {
      console.log(chalk.green(`  [FIXED] Purged ${purged} stale queue entry(ies) (>24h)`));
      logger.info('recover.stale_queue_purged', { context: { purged } });
      fixed++;
    }
  } catch {
    // Queue file may not exist
  }

  // 6. Corrupted metrics JSON
  const metricsDir = join(gardenerDir, 'metrics');
  try {
    const files = await readdir(metricsDir);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const filePath = join(metricsDir, file);
      try {
        const raw = await readFile(filePath, 'utf-8');
        JSON.parse(raw);
      } catch {
        const corruptPath = filePath + '.corrupt';
        await rename(filePath, corruptPath);
        console.log(chalk.green(`  [FIXED] Renamed corrupted metrics: ${file} → ${file}.corrupt`));
        logger.info('recover.corrupt_metrics', { context: { file } });
        fixed++;
      }
    }
  } catch {
    // No metrics dir
  }

  // Summary
  console.log('');
  if (fixed === 0 && reported === 0) {
    console.log(chalk.green('All clear — no issues found.'));
  } else {
    console.log(chalk.dim(`Fixed: ${fixed}  Reported: ${reported}`));
  }
}
