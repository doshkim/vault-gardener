import { describe, expect, test } from 'bun:test';
import { getPreset, listPresets } from '../presets.js';

describe('getPreset', () => {
  test('returns para-plus preset with correct folders', () => {
    const preset = getPreset('para-plus');
    expect(preset.name).toBe('para-plus');
    expect(preset.folders.inbox).toBe('00-inbox');
    expect(preset.folders.journal).toBe('01-journal');
    expect(preset.folders.projects).toBe('02-projects');
  });

  test('returns zettelkasten preset', () => {
    const preset = getPreset('zettelkasten');
    expect(preset.name).toBe('zettelkasten');
    expect(preset.folders.inbox).toBe('inbox');
    expect(preset.folders.resources).toBe('zettelkasten');
  });

  test('returns flat preset', () => {
    const preset = getPreset('flat');
    expect(preset.name).toBe('flat');
    expect(preset.folders.inbox).toBe('inbox');
    expect(preset.folders.archive).toBe('archive');
  });

  test('throws on unknown preset with helpful message', () => {
    expect(() => getPreset('unknown-preset')).toThrow('Unknown preset "unknown-preset"');
    expect(() => getPreset('unknown-preset')).toThrow('Available:');
  });
});

describe('listPresets', () => {
  test('returns all 3 preset names', () => {
    const names = listPresets();
    expect(names).toHaveLength(3);
    expect(names).toContain('para-plus');
    expect(names).toContain('zettelkasten');
    expect(names).toContain('flat');
  });
});

describe('preset structure validation', () => {
  const presetNames = listPresets();

  for (const name of presetNames) {
    test(`${name} has folders.inbox`, () => {
      const preset = getPreset(name);
      expect(preset.folders.inbox).toBeDefined();
      expect(typeof preset.folders.inbox).toBe('string');
    });

    test(`${name} has frontmatter.required`, () => {
      const preset = getPreset(name);
      expect(Array.isArray(preset.frontmatter.required)).toBe(true);
      expect(preset.frontmatter.required.length).toBeGreaterThan(0);
    });

    test(`${name} has topics`, () => {
      const preset = getPreset(name);
      expect(typeof preset.topics).toBe('object');
      expect(Object.keys(preset.topics).length).toBeGreaterThan(0);
    });

    test(`${name} has statuses and types`, () => {
      const preset = getPreset(name);
      expect(preset.frontmatter.statuses.length).toBeGreaterThan(0);
      expect(preset.frontmatter.types.length).toBeGreaterThan(0);
    });
  }
});
