import { readdir, stat, access } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import type { Logger } from '../logging/index.js';
import type { GardenerConfig } from '../config/index.js';
import { SKIP_DIRS } from '../constants.js';

export interface PreflightResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

const SYNC_CONFLICT_MAX_FILES = 10_000;
const SYNC_CONFLICT_TIMEOUT_MS = 5_000;

function result(): PreflightResult {
  return { ok: true, errors: [], warnings: [] };
}

async function checkVaultAccessibility(
  vaultPath: string,
  r: PreflightResult,
  timeout = 5000,
): Promise<void> {
  try {
    await Promise.race([
      readdir(vaultPath),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Vault access timed out')), timeout),
      ),
    ]);
  } catch (err) {
    r.ok = false;
    r.errors.push(`Vault inaccessible: ${(err as Error).message}`);
  }
}

async function checkVaultQuiet(
  vaultPath: string,
  config: GardenerConfig,
  r: PreflightResult,
): Promise<void> {
  const quietSeconds = config.resilience?.vault_quiet_seconds ?? 30;
  const inboxDir = join(vaultPath, config.folders?.inbox ?? '00-inbox');
  const dirsToCheck = [vaultPath, inboxDir];

  try {
    const now = Date.now();
    const threshold = quietSeconds * 1000;

    for (const dir of dirsToCheck) {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
        const info = await stat(join(dir, entry.name));
        if (now - info.mtimeMs < threshold) {
          r.warnings.push(`Vault has recent edits (${entry.name} modified <${quietSeconds}s ago)`);
          return;
        }
      }
    }
  } catch {
    // If we can't check, skip this warning
  }
}

async function detectSyncConflicts(vaultPath: string, r: PreflightResult): Promise<void> {
  const conflictPatterns = ['sync-conflict', '(conflict)', '.icloud'];
  const startTime = performance.now();
  let filesChecked = 0;

  async function walk(dir: string): Promise<void> {
    if (filesChecked >= SYNC_CONFLICT_MAX_FILES) return;
    if (performance.now() - startTime > SYNC_CONFLICT_TIMEOUT_MS) return;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (filesChecked >= SYNC_CONFLICT_MAX_FILES) return;
      if (performance.now() - startTime > SYNC_CONFLICT_TIMEOUT_MS) return;

      const name = entry.name;
      if (name.startsWith('.') && name !== '.icloud') continue;
      if (SKIP_DIRS.has(name)) continue;

      const full = join(dir, name);

      if (entry.isDirectory()) {
        await walk(full);
      } else {
        filesChecked++;
        for (const pattern of conflictPatterns) {
          if (name.includes(pattern)) {
            r.warnings.push(`Sync conflict detected: ${full}`);
          }
        }
      }
    }
  }

  await walk(vaultPath);
}

function validateGitState(vaultPath: string, r: PreflightResult): void {
  try {
    // Check for detached HEAD
    const headRef = execFileSync('git', ['symbolic-ref', '-q', 'HEAD'], {
      cwd: vaultPath,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (!headRef.trim()) {
      r.warnings.push('Git is in detached HEAD state');
    }
  } catch {
    r.warnings.push('Git is in detached HEAD state or not a git repo');
  }

  try {
    // Check for merge conflicts
    const mergeHead = execFileSync('git', ['rev-parse', '--verify', 'MERGE_HEAD'], {
      cwd: vaultPath,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (mergeHead.trim()) {
      r.ok = false;
      r.errors.push('Git has unresolved merge conflicts');
    }
  } catch {
    // No MERGE_HEAD means no merge in progress — good
  }

  try {
    // Check for staged but uncommitted changes
    const staged = execFileSync('git', ['diff', '--cached', '--name-only'], {
      cwd: vaultPath,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (staged.trim()) {
      r.warnings.push('Git has staged but uncommitted changes');
    }
  } catch {
    // Not a git repo or git not available
  }
}

function checkDiskSpace(vaultPath: string, r: PreflightResult, minMB = 100): void {
  try {
    // Use -Pk for POSIX format (prevents line wrapping on long filesystem names)
    const output = execFileSync('df', ['-Pk', vaultPath], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const lines = output.trim().split('\n');
    if (lines.length < 2) return;

    // df -Pk output: Filesystem 1024-blocks Used Available Capacity Mounted
    const parts = lines[1].split(/\s+/);
    const availableKB = parseInt(parts[3], 10);
    if (isNaN(availableKB)) return;

    const availableMB = availableKB / 1024;
    if (availableMB < minMB) {
      r.ok = false;
      r.errors.push(`Low disk space: ${Math.round(availableMB)}MB available (minimum: ${minMB}MB)`);
    }
  } catch {
    r.warnings.push('Could not check disk space');
  }
}

async function checkPreviousRunDirty(gardenerDir: string, r: PreflightResult): Promise<void> {
  try {
    const entries = await readdir(gardenerDir);
    for (const name of entries) {
      if (name === '.lock' || name.endsWith('.gardener.tmp')) {
        r.warnings.push(`Stale artifact from previous run: ${name}`);
      }
    }
  } catch {
    // gardener dir may not exist yet
  }
}

function checkProviderCli(provider: string, r: PreflightResult): void {
  try {
    execFileSync('which', [provider], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    r.ok = false;
    r.errors.push(`Provider CLI not found: ${provider}`);
  }
}

async function checkContextFiles(gardenerDir: string, r: PreflightResult): Promise<void> {
  const promptsDir = join(gardenerDir, 'prompts');
  try {
    await access(promptsDir);
  } catch {
    r.ok = false;
    r.errors.push('Missing prompts/ directory in gardener dir. Run `vault-gardener init` first.');
  }
}

export async function runPreflight(
  vaultPath: string,
  gardenerDir: string,
  config: GardenerConfig,
  logger: Logger,
): Promise<PreflightResult> {
  const r = result();

  logger.info('preflight_start', { phase: 'preflight' });

  await checkVaultAccessibility(vaultPath, r);
  if (!r.ok) {
    logger.error('preflight_fail', { phase: 'preflight', context: { errors: r.errors } });
    return r;
  }

  await checkVaultQuiet(vaultPath, config, r);
  await detectSyncConflicts(vaultPath, r);
  validateGitState(vaultPath, r);
  checkDiskSpace(vaultPath, r);
  await checkPreviousRunDirty(gardenerDir, r);
  checkProviderCli(config.provider, r);
  await checkContextFiles(gardenerDir, r);

  if (r.warnings.length > 0) {
    logger.warn('preflight_warnings', {
      phase: 'preflight',
      context: { warnings: r.warnings },
    });
  }

  if (!r.ok) {
    logger.error('preflight_fail', { phase: 'preflight', context: { errors: r.errors } });
  } else {
    logger.info('preflight_pass', { phase: 'preflight' });
  }

  return r;
}
