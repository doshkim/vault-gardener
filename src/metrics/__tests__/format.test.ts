import { describe, expect, test } from 'bun:test';
import { formatSummary, formatMarkdownReport } from '../format.js';
import type { RunMetrics } from '../collector.js';

function makeMetrics(overrides: Partial<RunMetrics> = {}): RunMetrics {
  return {
    date: '2026-02-20',
    timestamp: '2026-02-20T10:00:00Z',
    phase: 'seed',
    provider: 'claude',
    tier: 'fast',
    model: 'sonnet',
    duration_seconds: 42,
    exitCode: 0,
    metrics: {
      inbox_before: 10,
      inbox_after: 5,
      inbox_processed: 5,
      links_added: 3,
      notes_moved: 2,
    },
    vault_health: {
      total_notes: 100,
      inbox_items: 5,
      seed_notes: 10,
    },
    ...overrides,
  };
}

describe('formatSummary', () => {
  test('includes phase name for success (exit 0)', () => {
    const output = formatSummary(makeMetrics());
    expect(output).toContain('complete');
    // Phase name should be capitalized
    expect(output).toMatch(/Seed/i);
  });

  test('includes "failed" for non-zero exit', () => {
    const output = formatSummary(makeMetrics({ exitCode: 1 }));
    expect(output).toContain('failed');
    expect(output).toContain('exit 1');
  });

  test('shows details when counts > 0', () => {
    const output = formatSummary(makeMetrics());
    expect(output).toContain('5');
    expect(output).toContain('3');
    expect(output).toContain('2');
  });

  test('omits details when all counts are zero', () => {
    const m = makeMetrics({
      metrics: {
        inbox_before: 0,
        inbox_after: 0,
        inbox_processed: 0,
        links_added: 0,
        notes_moved: 0,
      },
    });
    const output = formatSummary(m);
    expect(output).not.toContain('inbox items');
    expect(output).not.toContain('links added');
    expect(output).not.toContain('notes moved');
  });

  test('includes duration', () => {
    const output = formatSummary(makeMetrics({ duration_seconds: 99 }));
    expect(output).toContain('99s');
  });
});

describe('formatMarkdownReport', () => {
  test('returns "No runs recorded" for empty array', () => {
    expect(formatMarkdownReport([])).toBe('_No runs recorded._');
  });

  test('produces correct table format', () => {
    const report = formatMarkdownReport([makeMetrics()]);
    expect(report).toContain('| Date |');
    expect(report).toContain('|------|');
    expect(report).toContain('| 2026-02-20 |');
    expect(report).toContain('seed');
    expect(report).toContain('42s');
    expect(report).toContain('| 5 |');
    expect(report).toContain('| 3 |');
    expect(report).toContain('| 100 |');
  });

  test('includes multiple rows for multiple metrics', () => {
    const m1 = makeMetrics({ phase: 'seed' });
    const m2 = makeMetrics({ phase: 'nurture', duration_seconds: 60 });
    const report = formatMarkdownReport([m1, m2]);
    expect(report).toContain('seed');
    expect(report).toContain('nurture');
    expect(report).toContain('60s');
  });
});
