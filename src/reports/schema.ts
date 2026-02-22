export interface FeatureReport {
  feature: string;
  status: 'executed' | 'skipped' | 'error';
  reason?: string;
  counts: Record<string, number>;
  notes?: string;
}

export interface PhaseReport {
  phase: 'seed' | 'nurture' | 'tend';
  started: boolean;
  features: FeatureReport[];
}

export interface RunReport {
  version: 1;
  timestamp: string;
  phases: PhaseReport[];
  summary?: string;
  warnings?: string[];
}

export interface ParsedReport extends RunReport {
  _parsed: {
    reportPath: string;
    parseErrors: string[];
    validationWarnings: string[];
    missingFeatures: string[];
    unexpectedFeatures: string[];
  };
}
