import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanVault } from '../detect.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'vg-detect-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function createDirs(base: string, dirs: string[]) {
  for (const dir of dirs) {
    await mkdir(join(base, dir), { recursive: true });
  }
}

async function createFiles(base: string, files: string[]) {
  for (const file of files) {
    const fullPath = join(base, file);
    const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
    await mkdir(dir, { recursive: true });
    await writeFile(fullPath, `# ${file}\n\nSome content here.\n`, 'utf-8');
  }
}

describe('scanVault', () => {
  test('detects PARA+ numbered folder layout', async () => {
    await createDirs(tmpDir, [
      '00-inbox',
      '01-journal',
      '02-projects',
      '03-roles',
      '04-resources',
      '05-people',
      '06-orgs',
      '07-playbooks',
      '08-sources',
      '09-mocs',
      '99-archive',
    ]);
    await createFiles(tmpDir, ['00-inbox/note1.md', '04-resources/note2.md']);

    const result = await scanVault(tmpDir);
    expect(result.preset).toBe('para-plus');
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    expect(result.detected.inbox).toBe('00-inbox');
    expect(result.detected.journal).toBe('01-journal');
  });

  test('detects zettelkasten layout', async () => {
    await createDirs(tmpDir, ['inbox', 'zettelkasten', 'references', 'templates']);
    await createFiles(tmpDir, ['inbox/fleeting.md', 'zettelkasten/permanent.md']);

    const result = await scanVault(tmpDir);
    expect(result.preset).toBe('zettelkasten');
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    expect(result.detected.inbox).toBe('inbox');
  });

  test('detects flat layout', async () => {
    await createDirs(tmpDir, ['inbox', 'notes', 'archive']);
    await createFiles(tmpDir, ['inbox/thought.md']);

    const result = await scanVault(tmpDir);
    expect(result.preset).toBe('flat');
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
  });

  test('returns null preset and 0 confidence for empty vault', async () => {
    const result = await scanVault(tmpDir);
    expect(result.preset).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.totalNotes).toBe(0);
  });

  test('detects .obsidian as obsidian tool', async () => {
    await mkdir(join(tmpDir, '.obsidian'), { recursive: true });
    await createDirs(tmpDir, ['inbox']);

    const result = await scanVault(tmpDir);
    expect(result.tool).toBe('obsidian');
  });

  test('detects .logseq as logseq tool', async () => {
    await mkdir(join(tmpDir, '.logseq'), { recursive: true });
    await createDirs(tmpDir, ['inbox']);

    const result = await scanVault(tmpDir);
    expect(result.tool).toBe('logseq');
  });

  test('returns null tool when no tool dirs present', async () => {
    await createDirs(tmpDir, ['inbox']);
    const result = await scanVault(tmpDir);
    expect(result.tool).toBeNull();
  });

  test('counts markdown files correctly', async () => {
    await createFiles(tmpDir, [
      'inbox/note1.md',
      'inbox/note2.md',
      'docs/readme.md',
      'docs/nested/deep.md',
    ]);
    // Non-md files should not be counted
    await writeFile(join(tmpDir, 'config.yaml'), 'key: val', 'utf-8');

    const result = await scanVault(tmpDir);
    expect(result.totalNotes).toBe(4);
  });
});
