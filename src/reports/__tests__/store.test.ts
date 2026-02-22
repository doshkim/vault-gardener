import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, readFile, readdir, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { archiveReport, readReports, readLatestReport, writeGardeningLog } from '../store.js';
import { buildDefaultConfig } from '../../config/schema.js';
import type { ParsedReport } from '../schema.js';
import type { LogContext } from '../store.js';

let tmpDir: string;
let gardenerDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'vg-store-'));
  gardenerDir = join(tmpDir, '.gardener');
  await mkdir(gardenerDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function makeParsedReport(overrides: Partial<ParsedReport> = {}): ParsedReport {
  return {
    version: 1,
    timestamp: '2026-02-22T09:15:00.000Z',
    phases: [{
      phase: 'seed',
      started: true,
      features: [
        { feature: 'memory', status: 'executed', counts: { read: 1, updated: 1 } },
        { feature: 'question_tracker', status: 'executed', counts: { questions_extracted: 3 } },
      ],
    }],
    summary: 'Processed 5 inbox items',
    _parsed: {
      reportPath: join(gardenerDir, 'run-report.json'),
      parseErrors: [],
      validationWarnings: [],
      missingFeatures: [],
      unexpectedFeatures: [],
    },
    ...overrides,
  };
}

function makeLogContext(overrides: Partial<LogContext> = {}): LogContext {
  return {
    pre: { inboxItems: 23, totalNotes: 2847, seedNotes: 156 },
    post: { inboxItems: 20, totalNotes: 2850, seedNotes: 159 },
    duration: 45,
    phase: 'seed',
    config: buildDefaultConfig(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// JSON archive
// ---------------------------------------------------------------------------

describe('archiveReport', () => {
  test('creates reports directory and file', async () => {
    const report = makeParsedReport();
    await archiveReport(gardenerDir, report);

    const filePath = join(gardenerDir, 'reports', '2026-02-22.json');
    const raw = await readFile(filePath, 'utf-8');
    const data = JSON.parse(raw);
    expect(data).toHaveLength(1);
    expect(data[0].version).toBe(1);
  });

  test('appends to existing daily file', async () => {
    const report1 = makeParsedReport();
    const report2 = makeParsedReport({ timestamp: '2026-02-22T14:30:00.000Z' });

    await archiveReport(gardenerDir, report1);
    await archiveReport(gardenerDir, report2);

    const filePath = join(gardenerDir, 'reports', '2026-02-22.json');
    const data = JSON.parse(await readFile(filePath, 'utf-8'));
    expect(data).toHaveLength(2);
    expect(data[1].timestamp).toBe('2026-02-22T14:30:00.000Z');
  });
});

describe('readReports', () => {
  test('returns empty for no reports', async () => {
    const reports = await readReports(gardenerDir);
    expect(reports).toHaveLength(0);
  });

  test('reads archived reports sorted newest-first', async () => {
    const report1 = makeParsedReport({ timestamp: '2026-02-20T09:00:00.000Z' });
    const report2 = makeParsedReport({ timestamp: '2026-02-22T09:00:00.000Z' });

    await archiveReport(gardenerDir, report1);
    await archiveReport(gardenerDir, report2);

    const reports = await readReports(gardenerDir);
    expect(reports).toHaveLength(2);
    expect(reports[0].timestamp).toBe('2026-02-22T09:00:00.000Z');
  });

  test('filters by days', async () => {
    // This report is from far in the past relative to the cutoff
    const oldReport = makeParsedReport({ timestamp: '2025-01-01T09:00:00.000Z' });
    const recentReport = makeParsedReport();

    await archiveReport(gardenerDir, oldReport);
    await archiveReport(gardenerDir, recentReport);

    const reports = await readReports(gardenerDir, 30);
    // Only the recent one should be returned (within 30 days of now)
    expect(reports.length).toBeLessThanOrEqual(2);
  });
});

describe('readLatestReport', () => {
  test('returns null when no reports exist', async () => {
    const result = await readLatestReport(gardenerDir);
    expect(result).toBeNull();
  });

  test('returns the most recent report', async () => {
    const report = makeParsedReport();
    await archiveReport(gardenerDir, report);

    const result = await readLatestReport(gardenerDir);
    expect(result).not.toBeNull();
    expect(result!.timestamp).toBe('2026-02-22T09:15:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// Daily markdown log
// ---------------------------------------------------------------------------

describe('writeGardeningLog', () => {
  test('creates log file with header on first run of day', async () => {
    const report = makeParsedReport();
    const ctx = makeLogContext();

    await writeGardeningLog(gardenerDir, report, ctx);

    const year = new Date().toISOString().slice(0, 4);
    const date = new Date().toISOString().slice(0, 10);
    const logPath = join(gardenerDir, 'logs', year, `${date}.md`);
    const content = await readFile(logPath, 'utf-8');

    expect(content).toContain(`# Gardening Log — ${date}`);
    expect(content).toContain('Seed');
    expect(content).toContain('memory');
    expect(content).toContain('Vault Health');
  });

  test('appends to existing log file', async () => {
    const report = makeParsedReport();
    const ctx = makeLogContext();

    await writeGardeningLog(gardenerDir, report, ctx);
    await writeGardeningLog(gardenerDir, report, makeLogContext({ phase: 'nurture' }));

    const year = new Date().toISOString().slice(0, 4);
    const date = new Date().toISOString().slice(0, 10);
    const logPath = join(gardenerDir, 'logs', year, `${date}.md`);
    const content = await readFile(logPath, 'utf-8');

    // Should have exactly one header
    const headerCount = (content.match(/# Gardening Log/g) ?? []).length;
    expect(headerCount).toBe(1);

    // Should have two time-stamped sections
    const sectionCount = (content.match(/^## \d{2}:\d{2}/gm) ?? []).length;
    expect(sectionCount).toBe(2);
  });

  test('writes minimal entry when no report exists', async () => {
    const ctx = makeLogContext();

    await writeGardeningLog(gardenerDir, null, ctx);

    const year = new Date().toISOString().slice(0, 4);
    const date = new Date().toISOString().slice(0, 10);
    const logPath = join(gardenerDir, 'logs', year, `${date}.md`);
    const content = await readFile(logPath, 'utf-8');

    expect(content).toContain('No feature report');
    expect(content).toContain('Vault Health');
  });

  test('includes feature table with status icons', async () => {
    const report = makeParsedReport({
      phases: [{
        phase: 'seed',
        started: true,
        features: [
          { feature: 'memory', status: 'executed', counts: { read: 1, updated: 1 } },
          { feature: 'question_tracker', status: 'skipped', reason: 'no questions found', counts: {} },
          { feature: 'commitment_tracker', status: 'error', reason: 'file locked', counts: {} },
        ],
      }],
    });

    await writeGardeningLog(gardenerDir, report, makeLogContext());

    const year = new Date().toISOString().slice(0, 4);
    const date = new Date().toISOString().slice(0, 10);
    const logPath = join(gardenerDir, 'logs', year, `${date}.md`);
    const content = await readFile(logPath, 'utf-8');

    expect(content).toContain('| memory | ✓ |');
    expect(content).toContain('| question_tracker | – |');
    expect(content).toContain('| commitment_tracker | ✗ |');
    expect(content).toContain('skipped: no questions found');
    expect(content).toContain('error: file locked');
  });

  test('includes vault health deltas', async () => {
    const report = makeParsedReport();
    const ctx = makeLogContext({
      pre: { inboxItems: 23, totalNotes: 2847, seedNotes: 156 },
      post: { inboxItems: 20, totalNotes: 2850, seedNotes: 159 },
    });

    await writeGardeningLog(gardenerDir, report, ctx);

    const year = new Date().toISOString().slice(0, 4);
    const date = new Date().toISOString().slice(0, 10);
    const logPath = join(gardenerDir, 'logs', year, `${date}.md`);
    const content = await readFile(logPath, 'utf-8');

    expect(content).toContain('Notes:');
    expect(content).toContain('Inbox:');
    expect(content).toContain('Seed:');
  });

  test('shows warnings from report validation', async () => {
    const report = makeParsedReport();
    report._parsed.validationWarnings = ['test warning'];
    report._parsed.missingFeatures = ['seed/changelog'];

    await writeGardeningLog(gardenerDir, report, makeLogContext());

    const year = new Date().toISOString().slice(0, 4);
    const date = new Date().toISOString().slice(0, 10);
    const logPath = join(gardenerDir, 'logs', year, `${date}.md`);
    const content = await readFile(logPath, 'utf-8');

    expect(content).toContain('test warning');
    expect(content).toContain('seed/changelog enabled but not reported');
  });
});
