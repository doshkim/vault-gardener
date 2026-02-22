import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseRunReport, detectStaleFeatures } from '../parser.js';
import { DEFAULT_FEATURES } from '../../config/schema.js';
import type { ParsedReport, RunReport } from '../schema.js';

let tmpDir: string;
let gardenerDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'vg-parser-'));
  gardenerDir = join(tmpDir, '.gardener');
  await mkdir(gardenerDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function makeReport(overrides: Partial<RunReport> = {}): RunReport {
  return {
    version: 1,
    timestamp: '2026-02-22T09:15:00.000Z',
    phases: [{
      phase: 'seed',
      started: true,
      features: [
        { feature: 'memory', status: 'executed', counts: { read: 1, updated: 1 } },
        { feature: 'changelog', status: 'executed', counts: { entries_written: 1 } },
        { feature: 'persona', status: 'executed', counts: { applied: 1 } },
        { feature: 'this_time_last_year', status: 'executed', counts: { lookbacks_added: 1 } },
        { feature: 'meeting_enhancement', status: 'skipped', reason: 'no meetings found', counts: {} },
        { feature: 'question_tracker', status: 'executed', counts: { questions_extracted: 3 } },
        { feature: 'commitment_tracker', status: 'executed', counts: { commitments_tracked: 2 } },
      ],
    }],
    summary: 'Processed 5 inbox items',
    ...overrides,
  };
}

describe('parseRunReport', () => {
  test('returns null when report file does not exist', async () => {
    const result = await parseRunReport(tmpDir, DEFAULT_FEATURES);
    expect(result).toBeNull();
  });

  test('parses valid report', async () => {
    const report = makeReport();
    await writeFile(join(gardenerDir, 'run-report.json'), JSON.stringify(report));

    const result = await parseRunReport(tmpDir, DEFAULT_FEATURES);
    expect(result).not.toBeNull();
    expect(result!.version).toBe(1);
    expect(result!.phases).toHaveLength(1);
    expect(result!.phases[0].phase).toBe('seed');
    expect(result!._parsed.parseErrors).toHaveLength(0);
  });

  test('handles malformed JSON gracefully', async () => {
    await writeFile(join(gardenerDir, 'run-report.json'), '{ broken json');

    const result = await parseRunReport(tmpDir, DEFAULT_FEATURES);
    expect(result).not.toBeNull();
    expect(result!._parsed.parseErrors.length).toBeGreaterThan(0);
    expect(result!._parsed.parseErrors[0]).toContain('Invalid JSON');
    expect(result!.phases).toHaveLength(0);
  });

  test('detects missing features', async () => {
    const report = makeReport({
      phases: [{
        phase: 'seed',
        started: true,
        features: [
          { feature: 'memory', status: 'executed', counts: { read: 1 } },
          // Missing: changelog, persona, this_time_last_year, etc.
        ],
      }],
    });
    await writeFile(join(gardenerDir, 'run-report.json'), JSON.stringify(report));

    const result = await parseRunReport(tmpDir, DEFAULT_FEATURES);
    expect(result!._parsed.missingFeatures.length).toBeGreaterThan(0);
    expect(result!._parsed.missingFeatures).toContain('seed/changelog');
  });

  test('detects unexpected features', async () => {
    // Disable memory but report it
    const features = { ...DEFAULT_FEATURES, memory: false };
    const report = makeReport();
    await writeFile(join(gardenerDir, 'run-report.json'), JSON.stringify(report));

    const result = await parseRunReport(tmpDir, features);
    expect(result!._parsed.unexpectedFeatures).toContain('seed/memory');
  });

  test('warns on error status features', async () => {
    const report = makeReport({
      phases: [{
        phase: 'seed',
        started: true,
        features: [
          { feature: 'memory', status: 'error', reason: 'file locked', counts: {} },
          { feature: 'changelog', status: 'executed', counts: { entries_written: 1 } },
          { feature: 'persona', status: 'executed', counts: { applied: 1 } },
          { feature: 'this_time_last_year', status: 'executed', counts: { lookbacks_added: 0 } },
          { feature: 'meeting_enhancement', status: 'skipped', reason: 'none', counts: {} },
          { feature: 'question_tracker', status: 'executed', counts: { questions_extracted: 0 } },
          { feature: 'commitment_tracker', status: 'executed', counts: { commitments_tracked: 0 } },
        ],
      }],
    });
    await writeFile(join(gardenerDir, 'run-report.json'), JSON.stringify(report));

    const result = await parseRunReport(tmpDir, DEFAULT_FEATURES);
    const errorWarnings = result!._parsed.validationWarnings.filter((w) => w.includes('error'));
    expect(errorWarnings.length).toBeGreaterThan(0);
  });

  test('warns on unknown phase', async () => {
    const report = makeReport({
      phases: [{ phase: 'unknown' as any, started: true, features: [] }],
    });
    await writeFile(join(gardenerDir, 'run-report.json'), JSON.stringify(report));

    const result = await parseRunReport(tmpDir, DEFAULT_FEATURES);
    expect(result!._parsed.validationWarnings.some((w) => w.includes('Unknown phase'))).toBe(true);
  });

  test('warns on wrong version', async () => {
    const report = makeReport({ version: 2 as any });
    await writeFile(join(gardenerDir, 'run-report.json'), JSON.stringify(report));

    const result = await parseRunReport(tmpDir, DEFAULT_FEATURES);
    expect(result!._parsed.validationWarnings.some((w) => w.includes('version'))).toBe(true);
  });

  test('handles multi-phase report', async () => {
    const report = makeReport({
      phases: [
        {
          phase: 'seed', started: true,
          features: [
            { feature: 'memory', status: 'executed', counts: { read: 1 } },
            { feature: 'changelog', status: 'executed', counts: {} },
            { feature: 'persona', status: 'executed', counts: {} },
            { feature: 'this_time_last_year', status: 'executed', counts: {} },
            { feature: 'meeting_enhancement', status: 'skipped', counts: {} },
            { feature: 'question_tracker', status: 'executed', counts: {} },
            { feature: 'commitment_tracker', status: 'executed', counts: {} },
          ],
        },
        {
          phase: 'nurture', started: true,
          features: [
            { feature: 'memory', status: 'executed', counts: {} },
            { feature: 'changelog', status: 'executed', counts: {} },
            { feature: 'persona', status: 'executed', counts: {} },
            { feature: 'tag_normalization', status: 'executed', counts: {} },
            { feature: 'co_mention_network', status: 'executed', counts: {} },
            { feature: 'knowledge_gaps', status: 'executed', counts: {} },
            { feature: 'entity_auto_linking', status: 'executed', counts: {} },
            { feature: 'backlink_context', status: 'executed', counts: {} },
            { feature: 'transitive_links', status: 'executed', counts: {} },
            { feature: 'commitment_tracker', status: 'executed', counts: {} },
          ],
        },
      ],
    });
    await writeFile(join(gardenerDir, 'run-report.json'), JSON.stringify(report));

    const result = await parseRunReport(tmpDir, DEFAULT_FEATURES);
    expect(result!.phases).toHaveLength(2);
    expect(result!._parsed.parseErrors).toHaveLength(0);
  });
});

describe('detectStaleFeatures', () => {
  function makeParsedReport(features: { feature: string; status: string }[]): ParsedReport {
    return {
      version: 1,
      timestamp: new Date().toISOString(),
      phases: [{
        phase: 'seed',
        started: true,
        features: features.map((f) => ({ ...f, counts: {} } as any)),
      }],
      _parsed: {
        reportPath: '',
        parseErrors: [],
        validationWarnings: [],
        missingFeatures: [],
        unexpectedFeatures: [],
      },
    };
  }

  test('returns empty when fewer reports than threshold', () => {
    const reports = [makeParsedReport([{ feature: 'memory', status: 'skipped' }])];
    expect(detectStaleFeatures(reports, 3)).toHaveLength(0);
  });

  test('detects features skipped 3+ consecutive times', () => {
    const reports = Array.from({ length: 3 }, () =>
      makeParsedReport([{ feature: 'memory', status: 'skipped' }])
    );
    const stale = detectStaleFeatures(reports, 3);
    expect(stale).toContain('seed/memory');
  });

  test('does not flag executed features', () => {
    const reports = Array.from({ length: 3 }, () =>
      makeParsedReport([{ feature: 'memory', status: 'executed' }])
    );
    expect(detectStaleFeatures(reports, 3)).toHaveLength(0);
  });

  test('does not flag mixed status features', () => {
    const reports = [
      makeParsedReport([{ feature: 'memory', status: 'skipped' }]),
      makeParsedReport([{ feature: 'memory', status: 'executed' }]),
      makeParsedReport([{ feature: 'memory', status: 'skipped' }]),
    ];
    expect(detectStaleFeatures(reports, 3)).toHaveLength(0);
  });
});
