import { describe, expect, test } from 'bun:test';
import { FEATURE_PHASE_MAP, featuresForPhase } from '../features.js';
import { DEFAULT_FEATURES } from '../../config/schema.js';
import type { FeaturesConfig } from '../../config/schema.js';

describe('FEATURE_PHASE_MAP', () => {
  test('covers all 23 features from DEFAULT_FEATURES', () => {
    const mapped = new Set(Object.keys(FEATURE_PHASE_MAP));
    const expected = new Set(Object.keys(DEFAULT_FEATURES));
    expect(mapped).toEqual(expected);
  });

  test('every feature maps to at least one valid phase', () => {
    const validPhases = new Set(['seed', 'nurture', 'tend']);
    for (const [key, phases] of Object.entries(FEATURE_PHASE_MAP)) {
      expect(phases.length).toBeGreaterThan(0);
      for (const p of phases) {
        expect(validPhases.has(p)).toBe(true);
      }
    }
  });

  test('cross-phase features appear in all 3 phases', () => {
    for (const key of ['memory', 'changelog', 'persona']) {
      expect(FEATURE_PHASE_MAP[key]).toEqual(['seed', 'nurture', 'tend']);
    }
  });

  test('seed-only features appear only in seed', () => {
    expect(FEATURE_PHASE_MAP.this_time_last_year).toEqual(['seed']);
    expect(FEATURE_PHASE_MAP.meeting_enhancement).toEqual(['seed']);
  });
});

describe('featuresForPhase', () => {
  test('returns all seed features when all enabled', () => {
    const result = featuresForPhase('seed', DEFAULT_FEATURES);
    expect(result).toContain('memory');
    expect(result).toContain('this_time_last_year');
    expect(result).toContain('meeting_enhancement');
    expect(result).toContain('question_tracker');
    expect(result).toContain('commitment_tracker');
    expect(result).not.toContain('tag_normalization'); // nurture only
    expect(result).not.toContain('social_content'); // tend only
  });

  test('returns empty when all features disabled', () => {
    const disabled = { ...DEFAULT_FEATURES } as FeaturesConfig;
    for (const key of Object.keys(disabled) as (keyof FeaturesConfig)[]) {
      disabled[key] = false;
    }
    expect(featuresForPhase('seed', disabled)).toHaveLength(0);
    expect(featuresForPhase('nurture', disabled)).toHaveLength(0);
    expect(featuresForPhase('tend', disabled)).toHaveLength(0);
  });

  test('respects individual feature toggles', () => {
    const features = { ...DEFAULT_FEATURES, memory: false, question_tracker: false };
    const result = featuresForPhase('seed', features);
    expect(result).not.toContain('memory');
    expect(result).not.toContain('question_tracker');
    expect(result).toContain('this_time_last_year');
  });

  test('returns features for nurture phase', () => {
    const result = featuresForPhase('nurture', DEFAULT_FEATURES);
    expect(result).toContain('tag_normalization');
    expect(result).toContain('co_mention_network');
    expect(result).toContain('knowledge_gaps');
    expect(result).toContain('entity_auto_linking');
    expect(result).not.toContain('social_content');
  });

  test('returns features for tend phase', () => {
    const result = featuresForPhase('tend', DEFAULT_FEATURES);
    expect(result).toContain('social_content');
    expect(result).toContain('belief_trajectory');
    expect(result).toContain('auto_summary');
    expect(result).not.toContain('tag_normalization');
  });

  test('returns empty for unknown phase', () => {
    expect(featuresForPhase('unknown', DEFAULT_FEATURES)).toHaveLength(0);
  });
});
