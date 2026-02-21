import { describe, expect, test } from 'bun:test';
import { validateConfig, buildDefaultConfig, DEFAULT_RESILIENCE, DEFAULT_FEATURES } from '../schema.js';
import type { GardenerConfig, FeaturesConfig } from '../schema.js';

describe('validateConfig', () => {
  test('reports missing required keys', () => {
    const result = validateConfig({});
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing required key: version');
    expect(result.errors).toContain('Missing required key: provider');
    expect(result.errors).toContain('Missing required key: tier');
    expect(result.errors).toContain('Missing required key: folders');
  });

  test('rejects invalid provider', () => {
    const result = validateConfig({ provider: 'openai' as any });
    expect(result.errors.some((e) => e.includes('Invalid provider'))).toBe(true);
  });

  test('rejects invalid tier', () => {
    const result = validateConfig({ tier: 'turbo' as any });
    expect(result.errors.some((e) => e.includes('Invalid tier'))).toBe(true);
  });

  test('rejects invalid persona', () => {
    const result = validateConfig({ persona: 'zen' as any });
    expect(result.errors.some((e) => e.includes('Invalid persona'))).toBe(true);
  });

  test('accepts valid persona values', () => {
    for (const persona of ['analytical', 'reflective', 'coach'] as const) {
      const result = validateConfig({ persona });
      expect(result.errors.filter((e) => e.includes('persona'))).toHaveLength(0);
    }
  });

  test('rejects invalid cron expression', () => {
    const result = validateConfig({ schedule: { enabled: true, cron: 'not-a-cron' } });
    expect(result.errors.some((e) => e.includes('Invalid cron'))).toBe(true);
  });

  test('warns on non-integer limits', () => {
    const result = validateConfig({ limits: { beliefs_per_run: 1.5 } } as any);
    expect(result.warnings.some((w) => w.includes('beliefs_per_run'))).toBe(true);
  });

  test('warns on negative limits', () => {
    const result = validateConfig({ limits: { links_per_run: -1 } } as any);
    expect(result.warnings.some((w) => w.includes('links_per_run'))).toBe(true);
  });

  test('requires inbox in folders', () => {
    const result = validateConfig({ folders: { archive: '99-archive' } } as any);
    expect(result.errors).toContain('Missing required folder: inbox');
  });

  test('rejects non-array protected', () => {
    const result = validateConfig({ protected: 'not-an-array' } as any);
    expect(result.errors).toContain('protected must be an array');
  });

  test('passes valid full config', () => {
    const config = buildDefaultConfig();
    const result = validateConfig(config);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

describe('buildDefaultConfig', () => {
  test('returns full structure with all keys', () => {
    const config = buildDefaultConfig();
    expect(config.version).toBe(1);
    expect(config.provider).toBe('claude');
    expect(config.tier).toBe('fast');
    expect(config.persona).toBe('reflective');
    expect(config.folders.inbox).toBe('00-inbox');
    expect(config.frontmatter.required).toContain('created');
    expect(config.schedule.cron).toBe('0 */4 * * *');
    expect(config.claude.power_model).toBe('opus');
    expect(config.protected).toContain('.obsidian');
    expect(config.social_platforms).toEqual(['twitter', 'linkedin']);
  });

  test('applies overrides on top of defaults', () => {
    const config = buildDefaultConfig({ provider: 'gemini', tier: 'power' });
    expect(config.provider).toBe('gemini');
    expect(config.tier).toBe('power');
    // Non-overridden fields stay default
    expect(config.version).toBe(1);
    expect(config.folders.inbox).toBe('00-inbox');
  });

  test('includes DEFAULT_RESILIENCE values', () => {
    const config = buildDefaultConfig();
    expect(config.resilience.queue_enabled).toBe(DEFAULT_RESILIENCE.queue_enabled);
    expect(config.resilience.queue_max_size).toBe(DEFAULT_RESILIENCE.queue_max_size);
    expect(config.resilience.log_max_size_mb).toBe(DEFAULT_RESILIENCE.log_max_size_mb);
  });

  test('overrides replace entire nested objects', () => {
    const config = buildDefaultConfig({
      folders: { inbox: 'my-inbox' } as any,
    });
    // The spread override replaces entire folders object
    expect(config.folders.inbox).toBe('my-inbox');
    expect(config.folders.journal).toBeUndefined();
  });

  test('includes DEFAULT_FEATURES with all keys true', () => {
    const config = buildDefaultConfig();
    expect(config.features).toBeDefined();
    for (const [key, val] of Object.entries(config.features)) {
      expect(val).toBe(true);
    }
  });
});

const EXPECTED_FEATURE_KEYS: (keyof FeaturesConfig)[] = [
  'memory', 'entity_auto_linking', 'question_tracker', 'context_anchoring',
  'meeting_enhancement', 'auto_summary', 'backlink_context', 'transitive_links',
  'co_mention_network', 'belief_trajectory', 'theme_detection', 'attention_allocation',
  'knowledge_gaps', 'seasonal_patterns', 'goal_tracking', 'commitment_tracker',
  'this_time_last_year', 'tag_normalization', 'persona', 'changelog',
  'adaptive_batch_sizing', 'enrichment_priority', 'social_content',
];

describe('DEFAULT_FEATURES', () => {
  test('has all 23 feature keys', () => {
    const keys = Object.keys(DEFAULT_FEATURES);
    expect(keys).toHaveLength(23);
  });

  test('contains exactly the expected keys', () => {
    for (const key of EXPECTED_FEATURE_KEYS) {
      expect(DEFAULT_FEATURES).toHaveProperty(key);
    }
  });

  test('all values default to true', () => {
    for (const val of Object.values(DEFAULT_FEATURES)) {
      expect(val).toBe(true);
    }
  });
});

describe('validateConfig — features', () => {
  test('warns on non-boolean feature values', () => {
    const result = validateConfig({ features: { memory: 'yes' } } as any);
    expect(result.warnings.some((w) => w.includes('features.memory'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('should be a boolean'))).toBe(true);
  });

  test('warns on numeric feature values', () => {
    const result = validateConfig({ features: { changelog: 1 } } as any);
    expect(result.warnings.some((w) => w.includes('features.changelog'))).toBe(true);
  });

  test('does not warn on valid boolean features', () => {
    const config = buildDefaultConfig();
    const result = validateConfig(config);
    expect(result.warnings.filter((w) => w.includes('features.'))).toHaveLength(0);
  });

  test('does not warn when all features are false', () => {
    const allFalse: Record<string, boolean> = {};
    for (const key of EXPECTED_FEATURE_KEYS) allFalse[key] = false;
    const result = validateConfig({ features: allFalse } as any);
    expect(result.warnings.filter((w) => w.includes('features.'))).toHaveLength(0);
  });
});
