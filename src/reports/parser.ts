import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunReport, ParsedReport, PhaseReport, FeatureReport } from './schema.js';
import { featuresForPhase } from './features.js';
import type { FeaturesConfig } from '../config/schema.js';

const REPORT_FILENAME = 'run-report.json';

/**
 * Parse and validate the LLM-written run-report.json.
 * Returns null if the file doesn't exist.
 */
export async function parseRunReport(
  cwd: string,
  enabledFeatures: FeaturesConfig,
): Promise<ParsedReport | null> {
  const gardenerDir = join(cwd, '.gardener');
  const reportPath = join(gardenerDir, REPORT_FILENAME);

  let raw: string;
  try {
    raw = await readFile(reportPath, 'utf-8');
  } catch {
    return null;
  }

  const parseErrors: string[] = [];
  const validationWarnings: string[] = [];
  const missingFeatures: string[] = [];
  const unexpectedFeatures: string[] = [];

  let report: RunReport;
  try {
    report = JSON.parse(raw) as RunReport;
  } catch (err) {
    parseErrors.push(`Invalid JSON: ${(err as Error).message}`);
    // Return a minimal parsed report with errors
    return {
      version: 1,
      timestamp: new Date().toISOString(),
      phases: [],
      _parsed: {
        reportPath,
        parseErrors,
        validationWarnings,
        missingFeatures,
        unexpectedFeatures,
      },
    };
  }

  // Validate top-level fields
  if (report.version !== 1) {
    validationWarnings.push(`Unexpected version: ${report.version}`);
  }
  if (!report.timestamp) {
    validationWarnings.push('Missing timestamp');
  }
  if (!Array.isArray(report.phases)) {
    parseErrors.push('phases must be an array');
    report.phases = [];
  }

  // Validate each phase and cross-reference features
  for (const phase of report.phases) {
    validatePhase(phase, enabledFeatures, validationWarnings, missingFeatures, unexpectedFeatures);
  }

  return {
    ...report,
    _parsed: {
      reportPath,
      parseErrors,
      validationWarnings,
      missingFeatures,
      unexpectedFeatures,
    },
  };
}

function validatePhase(
  phase: PhaseReport,
  enabledFeatures: FeaturesConfig,
  validationWarnings: string[],
  missingFeatures: string[],
  unexpectedFeatures: string[],
): void {
  if (!['seed', 'nurture', 'tend'].includes(phase.phase)) {
    validationWarnings.push(`Unknown phase: ${phase.phase}`);
    return;
  }

  if (!Array.isArray(phase.features)) {
    validationWarnings.push(`${phase.phase}: features must be an array`);
    phase.features = [];
    return;
  }

  // Validate individual features
  for (const f of phase.features) {
    validateFeatureReport(f, phase.phase, validationWarnings);
  }

  // Cross-reference with enabled features for this phase
  const expected = new Set(featuresForPhase(phase.phase, enabledFeatures));
  const reported = new Set(phase.features.map((f) => f.feature));

  for (const key of expected) {
    if (!reported.has(key)) {
      missingFeatures.push(`${phase.phase}/${key}`);
    }
  }

  for (const key of reported) {
    if (!expected.has(key)) {
      unexpectedFeatures.push(`${phase.phase}/${key}`);
    }
  }
}

function validateFeatureReport(
  f: FeatureReport,
  phase: string,
  warnings: string[],
): void {
  if (!f.feature) {
    warnings.push(`${phase}: feature report missing 'feature' key`);
  }
  if (!['executed', 'skipped', 'error'].includes(f.status)) {
    warnings.push(`${phase}/${f.feature}: invalid status "${f.status}"`);
  }
  if (f.status === 'error') {
    warnings.push(`${phase}/${f.feature}: reported error — ${f.reason ?? 'no reason given'}`);
  }
  if (f.counts == null || typeof f.counts !== 'object') {
    warnings.push(`${phase}/${f.feature}: missing or invalid counts`);
  }
}

/**
 * Detect features that have been skipped in N+ consecutive reports.
 */
export function detectStaleFeatures(
  reports: ParsedReport[],
  threshold = 3,
): string[] {
  if (reports.length < threshold) return [];

  // Collect all reported features and their recent statuses
  const featureHistory = new Map<string, string[]>();

  // Reports should be sorted newest-first; take the last `threshold`
  const recent = reports.slice(0, threshold);

  for (const report of recent) {
    for (const phase of report.phases) {
      for (const f of phase.features) {
        const key = `${phase.phase}/${f.feature}`;
        const history = featureHistory.get(key) ?? [];
        history.push(f.status);
        featureHistory.set(key, history);
      }
    }
  }

  const stale: string[] = [];
  for (const [key, statuses] of featureHistory) {
    if (statuses.length >= threshold && statuses.every((s) => s === 'skipped')) {
      stale.push(key);
    }
  }

  return stale;
}
