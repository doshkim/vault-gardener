import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderAll } from '../render.js';
import { buildDefaultConfig } from '../../config/schema.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'vg-render-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('renderAll', () => {
  test('renders all 5 files (context + 4 prompts)', async () => {
    const config = buildDefaultConfig();
    await renderAll(tmpDir, config);

    const context = await readFile(join(tmpDir, 'context.md'), 'utf-8');
    const garden = await readFile(join(tmpDir, 'prompts', 'garden.md'), 'utf-8');
    const seed = await readFile(join(tmpDir, 'prompts', 'seed.md'), 'utf-8');
    const nurture = await readFile(join(tmpDir, 'prompts', 'nurture.md'), 'utf-8');
    const tend = await readFile(join(tmpDir, 'prompts', 'tend.md'), 'utf-8');

    expect(context.length).toBeGreaterThan(0);
    expect(garden.length).toBeGreaterThan(0);
    expect(seed.length).toBeGreaterThan(0);
    expect(nurture.length).toBeGreaterThan(0);
    expect(tend.length).toBeGreaterThan(0);
  });

  test('context contains interpolated folder names', async () => {
    const config = buildDefaultConfig();
    await renderAll(tmpDir, config);

    const context = await readFile(join(tmpDir, 'context.md'), 'utf-8');
    expect(context).toContain('00-inbox');
    expect(context).toContain('01-journal');
    expect(context).toContain('02-projects');
    expect(context).toContain('09-mocs');
  });

  test('context contains interpolated topics', async () => {
    const config = buildDefaultConfig();
    await renderAll(tmpDir, config);

    const context = await readFile(join(tmpDir, 'context.md'), 'utf-8');
    expect(context).toContain('ideas');
    expect(context).toContain('finance');
  });

  test('context contains interpolated limits', async () => {
    const config = buildDefaultConfig();
    await renderAll(tmpDir, config);

    const context = await readFile(join(tmpDir, 'context.md'), 'utf-8');
    expect(context).toContain('beliefs_per_run');
    expect(context).toContain('10');
  });

  test('seed prompt contains inbox folder reference', async () => {
    const config = buildDefaultConfig();
    await renderAll(tmpDir, config);

    const seed = await readFile(join(tmpDir, 'prompts', 'seed.md'), 'utf-8');
    expect(seed).toContain('00-inbox');
  });

  test('uses custom config values in output', async () => {
    const config = buildDefaultConfig({
      folders: {
        inbox: 'my-inbox',
        journal: 'my-journal',
        projects: 'my-projects',
        roles: 'my-roles',
        resources: 'my-resources',
        people: 'my-people',
        orgs: 'my-orgs',
        playbooks: 'my-playbooks',
        sources: 'my-sources',
        mocs: 'my-mocs',
        archive: 'my-archive',
        templates: 'my-templates',
      },
    });
    await renderAll(tmpDir, config);

    const context = await readFile(join(tmpDir, 'context.md'), 'utf-8');
    expect(context).toContain('my-inbox');
    expect(context).toContain('my-journal');
  });

  test('template compilation does not throw', async () => {
    const config = buildDefaultConfig();
    // Should not throw
    await renderAll(tmpDir, config);
  });
});
