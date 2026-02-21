import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deepMerge, resolveModel, resolveTimeout, getGardenerDir, getConfigPath, loadConfig, saveConfig } from '../loader.js';
import { buildDefaultConfig } from '../schema.js';
import type { GardenerConfig } from '../schema.js';

describe('deepMerge', () => {
  test('merges nested objects', () => {
    const defaults = { a: { b: 1, c: 2 }, d: 3 };
    const user = { a: { c: 99 } };
    const result = deepMerge(defaults, user);
    expect(result).toEqual({ a: { b: 1, c: 99 }, d: 3 });
  });

  test('replaces arrays instead of merging', () => {
    const defaults = { tags: ['a', 'b', 'c'] };
    const user = { tags: ['x'] };
    const result = deepMerge(defaults, user);
    expect(result.tags).toEqual(['x']);
  });

  test('user overrides scalar values', () => {
    const defaults = { provider: 'claude', tier: 'fast' };
    const user = { provider: 'gemini' };
    const result = deepMerge(defaults, user);
    expect(result.provider).toBe('gemini');
    expect(result.tier).toBe('fast');
  });

  test('handles null user values', () => {
    const defaults = { a: 1, b: { c: 2 } };
    const user = { a: null };
    const result = deepMerge(defaults, user);
    expect(result.a).toBeNull();
  });

  test('adds keys not present in defaults', () => {
    const defaults = { a: 1 };
    const user = { b: 2 };
    const result = deepMerge(defaults, user);
    expect(result).toEqual({ a: 1, b: 2 });
  });
});

describe('resolveModel', () => {
  test('returns power_model when tier=power for claude', () => {
    const config = buildDefaultConfig({ tier: 'power', provider: 'claude' });
    expect(resolveModel(config)).toBe('opus');
  });

  test('returns fast_model when tier=fast for claude', () => {
    const config = buildDefaultConfig({ tier: 'fast', provider: 'claude' });
    expect(resolveModel(config)).toBe('sonnet');
  });

  test('returns correct model for codex provider', () => {
    const config = buildDefaultConfig({ tier: 'power', provider: 'codex' });
    expect(resolveModel(config)).toBe('gpt-5.3-codex');
  });

  test('returns correct model for gemini provider', () => {
    const config = buildDefaultConfig({ tier: 'fast', provider: 'gemini' });
    expect(resolveModel(config)).toBe('gemini-3-flash-preview');
  });
});

describe('resolveTimeout', () => {
  test('returns claude timeout', () => {
    const config = buildDefaultConfig({ provider: 'claude' });
    expect(resolveTimeout(config)).toBe(1500);
  });

  test('returns codex timeout', () => {
    const config = buildDefaultConfig({ provider: 'codex' });
    expect(resolveTimeout(config)).toBe(1500);
  });

  test('returns gemini timeout', () => {
    const config = buildDefaultConfig({ provider: 'gemini' });
    expect(resolveTimeout(config)).toBe(1500);
  });
});

describe('getGardenerDir / getConfigPath', () => {
  test('constructs path with cwd argument', () => {
    const dir = getGardenerDir('/my/vault');
    expect(dir).toBe('/my/vault/.gardener');
  });

  test('constructs config path with cwd argument', () => {
    const path = getConfigPath('/my/vault');
    expect(path).toBe('/my/vault/.gardener/config.yaml');
  });

  test('uses process.cwd() when no cwd given', () => {
    const dir = getGardenerDir();
    expect(dir).toBe(join(process.cwd(), '.gardener'));
  });
});

describe('loadConfig / saveConfig round-trip', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'vg-loader-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test('saves and loads config via YAML', async () => {
    const original = buildDefaultConfig({ provider: 'gemini', tier: 'power' });
    await saveConfig(original, tmpDir);
    const loaded = await loadConfig(tmpDir);

    expect(loaded.provider).toBe('gemini');
    expect(loaded.tier).toBe('power');
    expect(loaded.folders.inbox).toBe('00-inbox');
    expect(loaded.resilience.queue_enabled).toBe(true);
  });

  test('throws when no config exists', async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), 'vg-empty-'));
    try {
      await expect(loadConfig(emptyDir)).rejects.toThrow('No config.yaml found');
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });

  test('creates .gardener directory on save', async () => {
    const config = buildDefaultConfig();
    await saveConfig(config, tmpDir);

    const { stat } = await import('node:fs/promises');
    const info = await stat(join(tmpDir, '.gardener'));
    expect(info.isDirectory()).toBe(true);
  });
});
