import { readFile, writeFile, rename, stat, mkdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';
import { walkMarkdownFiles } from '../utils/fs.js';
import type { IndexConfig } from '../config/schema.js';
import type { VaultIndex, FileEntry } from './schema.js';

const execFileAsync = promisify(execFile);

const MAX_FILE_SIZE = 1_048_576; // 1 MB
const BATCH_SIZE = 100;
const WIKILINK_PATTERN = /\[\[/g;

/** Load the existing vault index from .gardener/index.json. */
export async function loadIndex(gardenerDir: string): Promise<VaultIndex | null> {
  try {
    const raw = await readFile(join(gardenerDir, 'index.json'), 'utf-8');
    const parsed = JSON.parse(raw) as VaultIndex;
    if (parsed.version === 1 && parsed.files) return parsed;
    return null;
  } catch {
    return null;
  }
}

/** Atomically write the vault index to .gardener/index.json. */
export async function saveIndex(gardenerDir: string, index: VaultIndex): Promise<void> {
  await mkdir(gardenerDir, { recursive: true });
  const filePath = join(gardenerDir, 'index.json');
  const tmpPath = filePath + '.tmp';
  await writeFile(tmpPath, JSON.stringify(index, null, 2), 'utf-8');
  await rename(tmpPath, filePath);
}

/** Parse frontmatter status from the first N lines of file content. */
function parseStatus(content: string): string | null {
  const lines = content.split('\n', 15);
  if (lines[0]?.trim() !== '---') return null;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === '---') break;
    const match = lines[i]?.match(/^status:\s*(.+)/);
    if (match) return match[1].trim();
  }
  return null;
}

/** Scan a single file and produce a FileEntry. */
async function scanFile(
  filePath: string,
  mtime: string,
  existing?: FileEntry,
): Promise<FileEntry> {
  const content = await readFile(filePath, 'utf-8');
  const wikilinkMatches = content.match(WIKILINK_PATTERN);
  const wikilinkCount = wikilinkMatches ? wikilinkMatches.length : 0;
  const wordCount = content.split(/\s+/).filter(Boolean).length;
  const status = parseStatus(content);

  return {
    status,
    wikilinkCount,
    wordCount,
    enrichmentCount: existing?.enrichmentCount ?? 0,
    lastGardened: existing?.lastGardened ?? null,
    mtime,
  };
}

/**
 * Build or incrementally update the vault index.
 * If an existing index is provided, files whose mtime hasn't changed are skipped.
 */
export async function buildIndex(
  vaultPath: string,
  config: IndexConfig,
  existing?: VaultIndex | null,
): Promise<VaultIndex> {
  const timeoutMs = config.scan_timeout_seconds * 1000;
  const startTime = performance.now();

  const walkResult = await walkMarkdownFiles(vaultPath, {
    maxFiles: config.max_scan_files,
    timeout: timeoutMs,
  });

  const files: Record<string, FileEntry> = {};
  const seenPaths = new Set<string>();

  for (let i = 0; i < walkResult.files.length; i += BATCH_SIZE) {
    if (performance.now() - startTime > timeoutMs) break;

    const batch = walkResult.files.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (absPath) => {
        const relPath = relative(vaultPath, absPath);
        seenPaths.add(relPath);

        try {
          const info = await stat(absPath);
          if (info.size > MAX_FILE_SIZE) return;

          const mtime = info.mtime.toISOString();
          const existingEntry = existing?.files[relPath];

          // Incremental: skip if mtime unchanged
          if (existingEntry && existingEntry.mtime === mtime) {
            files[relPath] = existingEntry;
            return;
          }

          files[relPath] = await scanFile(absPath, mtime, existingEntry);
        } catch {
          // Skip unreadable files
        }
      }),
    );
  }

  return {
    version: 1,
    lastBuilt: new Date().toISOString(),
    files,
  };
}

/**
 * Post-run update: detect files touched by the gardener via git diff,
 * increment their enrichmentCount, and re-scan for updated metrics.
 */
export async function updateIndexPostRun(
  vaultPath: string,
  gardenerDir: string,
  index: VaultIndex,
  preRunCommit: string | null,
): Promise<VaultIndex> {
  let changedFiles: string[] = [];

  try {
    if (preRunCommit) {
      // Diff against pre-run commit
      const { stdout } = await execFileAsync(
        'git',
        ['diff', '--name-only', preRunCommit, 'HEAD', '--', '*.md'],
        { cwd: vaultPath, timeout: 10_000 },
      );
      changedFiles = stdout.trim().split('\n').filter(Boolean);
    }

    // Also catch uncommitted changes (LLM may not have committed)
    const { stdout: unstaged } = await execFileAsync(
      'git',
      ['diff', '--name-only', '--', '*.md'],
      { cwd: vaultPath, timeout: 10_000 },
    );
    const unstagedFiles = unstaged.trim().split('\n').filter(Boolean);
    changedFiles = [...new Set([...changedFiles, ...unstagedFiles])];
  } catch {
    // Non-git vault or git failure — fall back to mtime comparison
    const today = new Date().toISOString().split('T')[0];
    for (const [path, entry] of Object.entries(index.files)) {
      try {
        const info = await stat(join(vaultPath, path));
        const currentMtime = info.mtime.toISOString();
        if (currentMtime !== entry.mtime) {
          changedFiles.push(path);
        }
      } catch {
        // File may have been deleted
      }
    }
  }

  if (changedFiles.length === 0) return index;

  const today = new Date().toISOString().split('T')[0];
  const updated = { ...index, files: { ...index.files } };

  for (const relPath of changedFiles) {
    const absPath = join(vaultPath, relPath);
    const existingEntry = updated.files[relPath];

    try {
      const info = await stat(absPath);
      if (info.size > MAX_FILE_SIZE) continue;

      const mtime = info.mtime.toISOString();
      const entry = await scanFile(absPath, mtime, existingEntry);

      // Increment enrichment tracking
      entry.enrichmentCount = (existingEntry?.enrichmentCount ?? 0) + 1;
      entry.lastGardened = today;

      updated.files[relPath] = entry;
    } catch {
      // File deleted during run — remove from index
      delete updated.files[relPath];
    }
  }

  return updated;
}
