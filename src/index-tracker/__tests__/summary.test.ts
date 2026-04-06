import { describe, expect, test } from 'bun:test';
import { generateIndexSummary } from '../summary.js';
import { DEFAULT_INDEX } from '../../config/schema.js';
import type { VaultIndex, FileEntry } from '../schema.js';

function makeEntry(overrides: Partial<FileEntry> = {}): FileEntry {
  return {
    status: 'seed',
    wikilinkCount: 2,
    wordCount: 500,
    enrichmentCount: 0,
    lastGardened: null,
    mtime: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeIndex(files: Record<string, FileEntry>): VaultIndex {
  return { version: 1, lastBuilt: new Date().toISOString(), files };
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

describe('generateIndexSummary stats', () => {
  test('calculates totals correctly', () => {
    const index = makeIndex({
      'a.md': makeEntry({ wikilinkCount: 4 }),
      'b.md': makeEntry({ wikilinkCount: 6 }),
      'c.md': makeEntry({ wikilinkCount: 2, lastGardened: '2026-01-01' }),
    });

    const summary = generateIndexSummary(index, DEFAULT_INDEX);

    expect(summary.stats.totalIndexed).toBe(3);
    expect(summary.stats.avgWikilinkCount).toBe(4); // (4+6+2)/3 = 4
    expect(summary.stats.neverGardened).toBe(2);
  });

  test('handles empty index', () => {
    const summary = generateIndexSummary(makeIndex({}), DEFAULT_INDEX);

    expect(summary.stats.totalIndexed).toBe(0);
    expect(summary.stats.avgWikilinkCount).toBe(0);
    expect(summary.stats.neverGardened).toBe(0);
    expect(summary.cooldownNotes).toEqual([]);
    expect(summary.maxEnrichmentNotes).toEqual([]);
    expect(summary.highDensityNotes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Cooldown
// ---------------------------------------------------------------------------

describe('cooldown detection', () => {
  test('detects recently gardened notes', () => {
    const today = new Date().toISOString().split('T')[0];
    const index = makeIndex({
      'recent.md': makeEntry({ lastGardened: today }),
      'old.md': makeEntry({ lastGardened: '2020-01-01' }),
      'never.md': makeEntry({ lastGardened: null }),
    });

    const summary = generateIndexSummary(index, { ...DEFAULT_INDEX, cooldown_days: 3 });

    expect(summary.cooldownNotes).toContain('recent.md');
    expect(summary.cooldownNotes).not.toContain('old.md');
    expect(summary.cooldownNotes).not.toContain('never.md');
    expect(summary.stats.onCooldown).toBe(1);
  });

  test('respects cooldown_days config', () => {
    // Gardened 2 days ago
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    const dateStr = twoDaysAgo.toISOString().split('T')[0];

    const index = makeIndex({
      'note.md': makeEntry({ lastGardened: dateStr }),
    });

    // With 1-day cooldown, it should NOT be on cooldown
    const short = generateIndexSummary(index, { ...DEFAULT_INDEX, cooldown_days: 1 });
    expect(short.cooldownNotes).not.toContain('note.md');

    // With 7-day cooldown, it SHOULD be on cooldown
    const long = generateIndexSummary(index, { ...DEFAULT_INDEX, cooldown_days: 7 });
    expect(long.cooldownNotes).toContain('note.md');
  });
});

// ---------------------------------------------------------------------------
// Max enrichment
// ---------------------------------------------------------------------------

describe('max enrichment detection', () => {
  test('flags notes at max enrichment', () => {
    const index = makeIndex({
      'enriched.md': makeEntry({ enrichmentCount: 5 }),
      'fresh.md': makeEntry({ enrichmentCount: 1 }),
      'over.md': makeEntry({ enrichmentCount: 10 }),
    });

    const summary = generateIndexSummary(index, { ...DEFAULT_INDEX, max_enrichments: 5 });

    expect(summary.maxEnrichmentNotes).toContain('enriched.md');
    expect(summary.maxEnrichmentNotes).toContain('over.md');
    expect(summary.maxEnrichmentNotes).not.toContain('fresh.md');
    expect(summary.stats.atMaxEnrichment).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// High density
// ---------------------------------------------------------------------------

describe('high wikilink density detection', () => {
  test('flags notes with excessive link density', () => {
    // 20 links in 500 words = 40 per 1000 words (over default 15)
    const index = makeIndex({
      'dense.md': makeEntry({ wikilinkCount: 20, wordCount: 500 }),
      'sparse.md': makeEntry({ wikilinkCount: 2, wordCount: 500 }),
    });

    const summary = generateIndexSummary(index, DEFAULT_INDEX);

    expect(summary.highDensityNotes).toContain('dense.md');
    expect(summary.highDensityNotes).not.toContain('sparse.md');
  });

  test('skips zero-word files', () => {
    const index = makeIndex({
      'empty.md': makeEntry({ wikilinkCount: 5, wordCount: 0 }),
    });

    const summary = generateIndexSummary(index, DEFAULT_INDEX);
    expect(summary.highDensityNotes).not.toContain('empty.md');
  });
});

// ---------------------------------------------------------------------------
// List caps
// ---------------------------------------------------------------------------

describe('list caps', () => {
  test('caps lists at 50 entries', () => {
    const files: Record<string, FileEntry> = {};
    const today = new Date().toISOString().split('T')[0];

    for (let i = 0; i < 60; i++) {
      files[`note-${i}.md`] = makeEntry({
        lastGardened: today,
        enrichmentCount: 10,
        wikilinkCount: 100,
        wordCount: 100,
      });
    }

    const summary = generateIndexSummary(makeIndex(files), DEFAULT_INDEX);

    expect(summary.cooldownNotes.length).toBeLessThanOrEqual(50);
    expect(summary.maxEnrichmentNotes.length).toBeLessThanOrEqual(50);
    expect(summary.highDensityNotes.length).toBeLessThanOrEqual(50);
  });
});
