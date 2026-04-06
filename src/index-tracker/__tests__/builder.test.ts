import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildIndex, loadIndex, saveIndex } from '../builder.js';
import { DEFAULT_INDEX } from '../../config/schema.js';
import type { VaultIndex } from '../schema.js';

let tmpDir: string;
let vaultDir: string;
let gardenerDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'vg-index-'));
  vaultDir = tmpDir;
  gardenerDir = join(tmpDir, '.gardener');
  await mkdir(gardenerDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function createNote(relPath: string, content: string): Promise<void> {
  const absPath = join(vaultDir, relPath);
  await mkdir(join(absPath, '..'), { recursive: true });
  await writeFile(absPath, content, 'utf-8');
}

// ---------------------------------------------------------------------------
// loadIndex / saveIndex
// ---------------------------------------------------------------------------

describe('loadIndex', () => {
  test('returns null when no index exists', async () => {
    const result = await loadIndex(gardenerDir);
    expect(result).toBeNull();
  });

  test('returns null for corrupt JSON', async () => {
    await writeFile(join(gardenerDir, 'index.json'), 'not json', 'utf-8');
    const result = await loadIndex(gardenerDir);
    expect(result).toBeNull();
  });

  test('returns null for wrong version', async () => {
    await writeFile(
      join(gardenerDir, 'index.json'),
      JSON.stringify({ version: 99, files: {} }),
      'utf-8',
    );
    const result = await loadIndex(gardenerDir);
    expect(result).toBeNull();
  });
});

describe('saveIndex + loadIndex roundtrip', () => {
  test('saves and loads index correctly', async () => {
    const index: VaultIndex = {
      version: 1,
      lastBuilt: '2026-01-01T00:00:00.000Z',
      files: {
        'test.md': {
          status: 'seed',
          wikilinkCount: 3,
          wordCount: 100,
          enrichmentCount: 1,
          lastGardened: '2026-01-01',
          mtime: '2026-01-01T00:00:00.000Z',
        },
      },
    };

    await saveIndex(gardenerDir, index);
    const loaded = await loadIndex(gardenerDir);
    expect(loaded).toEqual(index);
  });
});

// ---------------------------------------------------------------------------
// buildIndex
// ---------------------------------------------------------------------------

describe('buildIndex', () => {
  test('builds index from vault files', async () => {
    await createNote('note-a.md', '---\nstatus: seed\n---\nHello [[World]] and [[Foo]]');
    await createNote('note-b.md', 'No frontmatter, just text with one [[link]]');

    const index = await buildIndex(vaultDir, DEFAULT_INDEX);

    expect(Object.keys(index.files)).toHaveLength(2);
    expect(index.files['note-a.md']).toBeDefined();
    expect(index.files['note-a.md'].status).toBe('seed');
    expect(index.files['note-a.md'].wikilinkCount).toBe(2);
    expect(index.files['note-a.md'].enrichmentCount).toBe(0);
    expect(index.files['note-a.md'].lastGardened).toBeNull();

    expect(index.files['note-b.md'].status).toBeNull();
    expect(index.files['note-b.md'].wikilinkCount).toBe(1);
  });

  test('skips non-markdown files', async () => {
    await createNote('note.md', 'Hello');
    await writeFile(join(vaultDir, 'image.png'), 'binary', 'utf-8');

    const index = await buildIndex(vaultDir, DEFAULT_INDEX);
    expect(Object.keys(index.files)).toHaveLength(1);
    expect(index.files['note.md']).toBeDefined();
  });

  test('handles nested directories', async () => {
    await createNote('04-resources/topic/deep-note.md', 'Some [[link]] here');

    const index = await buildIndex(vaultDir, DEFAULT_INDEX);
    expect(index.files['04-resources/topic/deep-note.md']).toBeDefined();
    expect(index.files['04-resources/topic/deep-note.md'].wikilinkCount).toBe(1);
  });

  test('incremental: skips unchanged files', async () => {
    await createNote('stable.md', 'Hello [[World]]');
    const first = await buildIndex(vaultDir, DEFAULT_INDEX);

    // Modify the entry to have enrichmentCount=5 — simulating post-run update
    first.files['stable.md'].enrichmentCount = 5;

    // Build again — mtime should match, so it reuses the existing entry
    const second = await buildIndex(vaultDir, DEFAULT_INDEX, first);
    expect(second.files['stable.md'].enrichmentCount).toBe(5);
  });

  test('removes deleted files from index', async () => {
    await createNote('keep.md', 'stays');
    await createNote('remove.md', 'goes away');

    const first = await buildIndex(vaultDir, DEFAULT_INDEX);
    expect(Object.keys(first.files)).toHaveLength(2);

    // Delete the file
    await rm(join(vaultDir, 'remove.md'));

    const second = await buildIndex(vaultDir, DEFAULT_INDEX, first);
    expect(Object.keys(second.files)).toHaveLength(1);
    expect(second.files['remove.md']).toBeUndefined();
    expect(second.files['keep.md']).toBeDefined();
  });

  test('respects max_scan_files limit', async () => {
    // Create 5 files but limit to 3
    for (let i = 0; i < 5; i++) {
      await createNote(`note-${i}.md`, `content ${i}`);
    }

    const config = { ...DEFAULT_INDEX, max_scan_files: 3 };
    const index = await buildIndex(vaultDir, config);
    expect(Object.keys(index.files).length).toBeLessThanOrEqual(3);
  });

  test('parses various frontmatter statuses', async () => {
    await createNote('growing.md', '---\nstatus: growing\ntags: []\n---\ncontent');
    await createNote('evergreen.md', '---\nstatus: evergreen\n---\ncontent');

    const index = await buildIndex(vaultDir, DEFAULT_INDEX);
    expect(index.files['growing.md'].status).toBe('growing');
    expect(index.files['evergreen.md'].status).toBe('evergreen');
  });

  test('counts words correctly', async () => {
    await createNote('words.md', 'one two three four five');
    const index = await buildIndex(vaultDir, DEFAULT_INDEX);
    expect(index.files['words.md'].wordCount).toBe(5);
  });
});
