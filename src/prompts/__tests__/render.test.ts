import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderAll } from '../render.js';
import { buildDefaultConfig, DEFAULT_FEATURES } from '../../config/schema.js';
import type { GardenerConfig, FeaturesConfig } from '../../config/schema.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'vg-render-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

/** Build a FeaturesConfig with all values set to the given boolean */
function makeFeatures(value: boolean): FeaturesConfig {
  const features = { ...DEFAULT_FEATURES };
  for (const key of Object.keys(features) as (keyof FeaturesConfig)[]) {
    features[key] = value;
  }
  return features;
}

/** Build config with all features OFF */
function allFeaturesOff(): GardenerConfig {
  return buildDefaultConfig({ features: makeFeatures(false) });
}

/** Build config with a single feature ON, all others OFF */
function singleFeatureOn(key: keyof FeaturesConfig): GardenerConfig {
  const features = makeFeatures(false);
  features[key] = true;
  return buildDefaultConfig({ features });
}

/** Read all 5 rendered files */
async function readRendered(dir: string) {
  const [context, garden, seed, nurture, tend] = await Promise.all([
    readFile(join(dir, 'context.md'), 'utf-8'),
    readFile(join(dir, 'prompts', 'garden.md'), 'utf-8'),
    readFile(join(dir, 'prompts', 'seed.md'), 'utf-8'),
    readFile(join(dir, 'prompts', 'nurture.md'), 'utf-8'),
    readFile(join(dir, 'prompts', 'tend.md'), 'utf-8'),
  ]);
  return { context, garden, seed, nurture, tend };
}

// ===========================================================================
// A. Regression tests (core rendering)
// ===========================================================================

describe('Regression — core rendering', () => {
  test('renders all 5 files (context + 4 prompts)', async () => {
    const config = buildDefaultConfig();
    await renderAll(tmpDir, config);
    const files = await readRendered(tmpDir);

    expect(files.context.length).toBeGreaterThan(0);
    expect(files.garden.length).toBeGreaterThan(0);
    expect(files.seed.length).toBeGreaterThan(0);
    expect(files.nurture.length).toBeGreaterThan(0);
    expect(files.tend.length).toBeGreaterThan(0);
  });

  test('context contains interpolated folder names', async () => {
    const config = buildDefaultConfig();
    await renderAll(tmpDir, config);
    const { context } = await readRendered(tmpDir);

    expect(context).toContain('00-inbox');
    expect(context).toContain('01-journal');
    expect(context).toContain('02-projects');
    expect(context).toContain('09-mocs');
  });

  test('context contains interpolated topics', async () => {
    const config = buildDefaultConfig();
    await renderAll(tmpDir, config);
    const { context } = await readRendered(tmpDir);

    expect(context).toContain('ideas');
    expect(context).toContain('finance');
  });

  test('context contains interpolated limits', async () => {
    const config = buildDefaultConfig();
    await renderAll(tmpDir, config);
    const { context } = await readRendered(tmpDir);

    expect(context).toContain('beliefs_per_run');
    expect(context).toContain('10');
  });

  test('seed prompt contains inbox folder reference', async () => {
    const config = buildDefaultConfig();
    await renderAll(tmpDir, config);
    const { seed } = await readRendered(tmpDir);
    expect(seed).toContain('00-inbox');
  });

  test('uses custom config values in output', async () => {
    const config = buildDefaultConfig({
      folders: {
        inbox: 'my-inbox',
        journal: 'my-journal',
        projects: 'my-projects',
        roles: 'my-roles',
        resources: 'my-resources',
        people: 'my-people',
        orgs: 'my-orgs',
        playbooks: 'my-playbooks',
        sources: 'my-sources',
        mocs: 'my-mocs',
        archive: 'my-archive',
        templates: 'my-templates',
      },
    });
    await renderAll(tmpDir, config);
    const { context } = await readRendered(tmpDir);

    expect(context).toContain('my-inbox');
    expect(context).toContain('my-journal');
  });

  test('template compilation does not throw', async () => {
    const config = buildDefaultConfig();
    await renderAll(tmpDir, config);
  });

  test('protected paths rendered in all templates', async () => {
    const config = buildDefaultConfig();
    await renderAll(tmpDir, config);
    const files = await readRendered(tmpDir);

    for (const [name, content] of Object.entries(files)) {
      if (name === 'context') {
        expect(content).toContain('.obsidian');
      }
    }
  });
});

// ===========================================================================
// B. Feature flag toggle tests
// ===========================================================================

describe('Feature toggle — persona', () => {
  test('ON: persona block is present', async () => {
    const config = buildDefaultConfig(); // all features ON by default
    await renderAll(tmpDir, config);
    const files = await readRendered(tmpDir);

    expect(files.context).toContain('Gardener Persona');
    expect(files.context).toContain('reflective');
    expect(files.garden).toContain('reflective');
    expect(files.seed).toContain('reflective');
    expect(files.nurture).toContain('Persona');
    expect(files.tend).toContain('Persona');
  });

  test('OFF: persona block is absent', async () => {
    const config = buildDefaultConfig({ features: { ...DEFAULT_FEATURES, persona: false } });
    await renderAll(tmpDir, config);
    const files = await readRendered(tmpDir);

    expect(files.context).not.toContain('Gardener Persona');
    expect(files.garden).not.toContain('## Persona');
    expect(files.seed).not.toContain('## Persona');
    expect(files.nurture).not.toContain('## Persona');
    expect(files.tend).not.toContain('## Persona');
  });
});

describe('Feature toggle — memory', () => {
  test('ON: memory sections present', async () => {
    const config = buildDefaultConfig();
    await renderAll(tmpDir, config);
    const files = await readRendered(tmpDir);

    expect(files.context).toContain('memory.md');
    expect(files.garden).toContain('memory.md');
    expect(files.seed).toContain('memory.md');
    expect(files.seed).toContain('Memory Update');
    expect(files.nurture).toContain('Memory Update');
    expect(files.tend).toContain('Memory Update');
  });

  test('OFF: memory sections absent', async () => {
    const config = buildDefaultConfig({ features: { ...DEFAULT_FEATURES, memory: false } });
    await renderAll(tmpDir, config);
    const files = await readRendered(tmpDir);

    expect(files.context).not.toContain('Memory file');
    expect(files.garden).not.toContain('## Memory');
    expect(files.seed).not.toContain('## Memory');
    expect(files.seed).not.toContain('Memory Update');
    expect(files.nurture).not.toContain('Memory Update');
    expect(files.tend).not.toContain('Memory Update');
  });
});

describe('Feature toggle — changelog', () => {
  test('ON: changelog sections present', async () => {
    const config = buildDefaultConfig();
    await renderAll(tmpDir, config);
    const files = await readRendered(tmpDir);

    expect(files.context).toContain('changelog.md');
    expect(files.seed).toContain('Vault Changelog');
    expect(files.nurture).toContain('Vault Changelog');
    expect(files.tend).toContain('Vault Changelog');
  });

  test('OFF: changelog sections absent', async () => {
    const config = buildDefaultConfig({ features: { ...DEFAULT_FEATURES, changelog: false } });
    await renderAll(tmpDir, config);
    const files = await readRendered(tmpDir);

    expect(files.context).not.toContain('changelog.md');
    expect(files.seed).not.toContain('Vault Changelog');
    expect(files.nurture).not.toContain('Vault Changelog');
    expect(files.tend).not.toContain('Vault Changelog');
  });
});

describe('Feature toggle — adaptive_batch_sizing', () => {
  test('ON: adaptive sizing content present', async () => {
    const config = buildDefaultConfig();
    await renderAll(tmpDir, config);
    const files = await readRendered(tmpDir);

    expect(files.context).toContain('Adaptive sizing rules');
    expect(files.tend).toContain('Adaptive Batch Sizing');
  });

  test('OFF: adaptive sizing content absent', async () => {
    const config = buildDefaultConfig({ features: { ...DEFAULT_FEATURES, adaptive_batch_sizing: false } });
    await renderAll(tmpDir, config);
    const files = await readRendered(tmpDir);

    expect(files.context).not.toContain('Adaptive sizing rules');
    expect(files.tend).not.toContain('Adaptive Batch Sizing');
  });
});

describe('Feature toggle — social_content', () => {
  test('ON: social content present', async () => {
    const config = buildDefaultConfig();
    await renderAll(tmpDir, config);
    const files = await readRendered(tmpDir);

    expect(files.context).toContain('Social Media Platforms');
    expect(files.tend).toContain('Social Content');
  });

  test('OFF: social content absent', async () => {
    const config = buildDefaultConfig({ features: { ...DEFAULT_FEATURES, social_content: false } });
    await renderAll(tmpDir, config);
    const files = await readRendered(tmpDir);

    expect(files.context).not.toContain('Social Media Platforms');
    expect(files.tend).not.toContain('Social Content');
  });
});

describe('Feature toggle — this_time_last_year', () => {
  test('ON: this time last year present in seed', async () => {
    const config = buildDefaultConfig();
    await renderAll(tmpDir, config);
    const { seed } = await readRendered(tmpDir);
    expect(seed).toContain('This Time Last Year');
  });

  test('OFF: this time last year absent from seed', async () => {
    const config = buildDefaultConfig({ features: { ...DEFAULT_FEATURES, this_time_last_year: false } });
    await renderAll(tmpDir, config);
    const { seed } = await readRendered(tmpDir);
    expect(seed).not.toContain('This Time Last Year');
  });
});

describe('Feature toggle — meeting_enhancement', () => {
  test('ON: meeting enhancement present in seed', async () => {
    const config = buildDefaultConfig();
    await renderAll(tmpDir, config);
    const { seed } = await readRendered(tmpDir);
    expect(seed).toContain('Action Items');
    expect(seed).toContain('Key Quotes');
  });

  test('OFF: meeting enhancement absent from seed', async () => {
    const config = buildDefaultConfig({ features: { ...DEFAULT_FEATURES, meeting_enhancement: false } });
    await renderAll(tmpDir, config);
    const { seed } = await readRendered(tmpDir);
    expect(seed).not.toContain('Action Items');
    expect(seed).not.toContain('Key Quotes');
  });
});

describe('Feature toggle — question_tracker', () => {
  test('ON: question tracker present', async () => {
    const config = buildDefaultConfig();
    await renderAll(tmpDir, config);
    const files = await readRendered(tmpDir);
    expect(files.seed).toContain('Question Tracker');
    expect(files.tend).toContain('Question Tracker Update');
  });

  test('OFF: question tracker absent', async () => {
    const config = buildDefaultConfig({ features: { ...DEFAULT_FEATURES, question_tracker: false } });
    await renderAll(tmpDir, config);
    const files = await readRendered(tmpDir);
    expect(files.seed).not.toContain('Question Tracker');
    expect(files.tend).not.toContain('Question Tracker Update');
  });
});

describe('Feature toggle — commitment_tracker', () => {
  test('ON: commitment tracker present', async () => {
    const config = buildDefaultConfig();
    await renderAll(tmpDir, config);
    const files = await readRendered(tmpDir);
    expect(files.seed).toContain('Commitment Tracker');
    expect(files.nurture).toContain('Commitment Compliance');
    expect(files.tend).toContain('Commitment Review');
  });

  test('OFF: commitment tracker absent', async () => {
    const config = buildDefaultConfig({ features: { ...DEFAULT_FEATURES, commitment_tracker: false } });
    await renderAll(tmpDir, config);
    const files = await readRendered(tmpDir);
    expect(files.seed).not.toContain('Commitment Tracker');
    expect(files.nurture).not.toContain('Commitment Compliance');
    expect(files.tend).not.toContain('Commitment Review');
  });
});

describe('Feature toggle — tag_normalization', () => {
  test('ON: tag normalization present in nurture', async () => {
    const config = buildDefaultConfig();
    await renderAll(tmpDir, config);
    const { nurture } = await readRendered(tmpDir);
    expect(nurture).toContain('Tag Taxonomy Normalization');
  });

  test('OFF: tag normalization absent from nurture', async () => {
    const config = buildDefaultConfig({ features: { ...DEFAULT_FEATURES, tag_normalization: false } });
    await renderAll(tmpDir, config);
    const { nurture } = await readRendered(tmpDir);
    expect(nurture).not.toContain('Tag Taxonomy Normalization');
  });
});

describe('Feature toggle — co_mention_network', () => {
  test('ON: co-mention network present in nurture', async () => {
    const config = buildDefaultConfig();
    await renderAll(tmpDir, config);
    const { nurture } = await readRendered(tmpDir);
    expect(nurture).toContain('Co-Mention Network');
  });

  test('OFF: co-mention network absent from nurture', async () => {
    const config = buildDefaultConfig({ features: { ...DEFAULT_FEATURES, co_mention_network: false } });
    await renderAll(tmpDir, config);
    const { nurture } = await readRendered(tmpDir);
    expect(nurture).not.toContain('Co-Mention Network');
  });
});

describe('Feature toggle — knowledge_gaps', () => {
  test('ON: knowledge gaps present in nurture', async () => {
    const config = buildDefaultConfig();
    await renderAll(tmpDir, config);
    const { nurture } = await readRendered(tmpDir);
    expect(nurture).toContain('Knowledge Gap Detection');
  });

  test('OFF: knowledge gaps absent from nurture', async () => {
    const config = buildDefaultConfig({ features: { ...DEFAULT_FEATURES, knowledge_gaps: false } });
    await renderAll(tmpDir, config);
    const { nurture } = await readRendered(tmpDir);
    expect(nurture).not.toContain('Knowledge Gap Detection');
  });
});

describe('Feature toggle — entity_auto_linking', () => {
  test('ON: entity auto-linking present in nurture', async () => {
    const config = buildDefaultConfig();
    await renderAll(tmpDir, config);
    const { nurture } = await readRendered(tmpDir);
    expect(nurture).toContain('Entity Mention Auto-Linking');
  });

  test('OFF: entity auto-linking absent from nurture', async () => {
    const config = buildDefaultConfig({ features: { ...DEFAULT_FEATURES, entity_auto_linking: false } });
    await renderAll(tmpDir, config);
    const { nurture } = await readRendered(tmpDir);
    expect(nurture).not.toContain('Entity Mention Auto-Linking');
  });
});

describe('Feature toggle — backlink_context', () => {
  test('ON: backlink context sentence present in nurture', async () => {
    const config = buildDefaultConfig();
    await renderAll(tmpDir, config);
    const { nurture } = await readRendered(tmpDir);
    expect(nurture).toContain('Include context sentence');
  });

  test('OFF: backlink context sentence absent from nurture', async () => {
    const config = buildDefaultConfig({ features: { ...DEFAULT_FEATURES, backlink_context: false } });
    await renderAll(tmpDir, config);
    const { nurture } = await readRendered(tmpDir);
    expect(nurture).not.toContain('Include context sentence');
  });
});

describe('Feature toggle — transitive_links', () => {
  test('ON: transitive links present in nurture', async () => {
    const config = buildDefaultConfig();
    await renderAll(tmpDir, config);
    const { nurture } = await readRendered(tmpDir);
    expect(nurture).toContain('Transitive Link Suggestions');
  });

  test('OFF: transitive links absent from nurture', async () => {
    const config = buildDefaultConfig({ features: { ...DEFAULT_FEATURES, transitive_links: false } });
    await renderAll(tmpDir, config);
    const { nurture } = await readRendered(tmpDir);
    expect(nurture).not.toContain('Transitive Link Suggestions');
  });
});

describe('Feature toggle — belief_trajectory', () => {
  test('ON: belief changes present in tend', async () => {
    const config = buildDefaultConfig();
    await renderAll(tmpDir, config);
    const { tend } = await readRendered(tmpDir);
    expect(tend).toContain('Belief Changes');
  });

  test('OFF: belief changes absent from tend', async () => {
    const config = buildDefaultConfig({ features: { ...DEFAULT_FEATURES, belief_trajectory: false } });
    await renderAll(tmpDir, config);
    const { tend } = await readRendered(tmpDir);
    expect(tend).not.toContain('Belief Changes');
  });
});

describe('Feature toggle — theme_detection', () => {
  test('ON: emerging themes present in tend', async () => {
    const config = buildDefaultConfig();
    await renderAll(tmpDir, config);
    const { tend } = await readRendered(tmpDir);
    expect(tend).toContain('Emerging Themes');
  });

  test('OFF: emerging themes absent from tend', async () => {
    const config = buildDefaultConfig({ features: { ...DEFAULT_FEATURES, theme_detection: false } });
    await renderAll(tmpDir, config);
    const { tend } = await readRendered(tmpDir);
    expect(tend).not.toContain('Emerging Themes');
  });
});

describe('Feature toggle — attention_allocation', () => {
  test('ON: attention allocation present in tend', async () => {
    const config = buildDefaultConfig();
    await renderAll(tmpDir, config);
    const { tend } = await readRendered(tmpDir);
    expect(tend).toContain('Attention Allocation');
  });

  test('OFF: attention allocation absent from tend', async () => {
    const config = buildDefaultConfig({ features: { ...DEFAULT_FEATURES, attention_allocation: false } });
    await renderAll(tmpDir, config);
    const { tend } = await readRendered(tmpDir);
    expect(tend).not.toContain('Attention Allocation');
  });
});

describe('Feature toggle — goal_tracking', () => {
  test('ON: goal tracking present in tend', async () => {
    const config = buildDefaultConfig();
    await renderAll(tmpDir, config);
    const { tend } = await readRendered(tmpDir);
    expect(tend).toContain('Goal Tracking via Journal Evidence');
    expect(tend).toContain('Annual Goal Evidence');
  });

  test('OFF: goal tracking absent from tend', async () => {
    const config = buildDefaultConfig({ features: { ...DEFAULT_FEATURES, goal_tracking: false } });
    await renderAll(tmpDir, config);
    const { tend } = await readRendered(tmpDir);
    expect(tend).not.toContain('Goal Tracking via Journal Evidence');
    expect(tend).not.toContain('Annual Goal Evidence');
  });
});

describe('Feature toggle — seasonal_patterns', () => {
  test('ON: seasonal patterns present in tend', async () => {
    const config = buildDefaultConfig();
    await renderAll(tmpDir, config);
    const { tend } = await readRendered(tmpDir);
    expect(tend).toContain('Seasonal Patterns');
  });

  test('OFF: seasonal patterns absent from tend', async () => {
    const config = buildDefaultConfig({ features: { ...DEFAULT_FEATURES, seasonal_patterns: false } });
    await renderAll(tmpDir, config);
    const { tend } = await readRendered(tmpDir);
    expect(tend).not.toContain('Seasonal Patterns');
  });
});

describe('Feature toggle — enrichment_priority', () => {
  test('ON: priority scoring present in tend', async () => {
    const config = buildDefaultConfig();
    await renderAll(tmpDir, config);
    const { tend } = await readRendered(tmpDir);
    expect(tend).toContain('Priority Scoring');
  });

  test('OFF: priority scoring absent from tend', async () => {
    const config = buildDefaultConfig({ features: { ...DEFAULT_FEATURES, enrichment_priority: false } });
    await renderAll(tmpDir, config);
    const { tend } = await readRendered(tmpDir);
    expect(tend).not.toContain('Priority Scoring');
  });
});

describe('Feature toggle — context_anchoring', () => {
  test('ON: context anchoring present in tend', async () => {
    const config = buildDefaultConfig();
    await renderAll(tmpDir, config);
    const { tend } = await readRendered(tmpDir);
    expect(tend).toContain('Context Anchoring');
  });

  test('OFF: context anchoring absent from tend', async () => {
    const config = buildDefaultConfig({ features: { ...DEFAULT_FEATURES, context_anchoring: false } });
    await renderAll(tmpDir, config);
    const { tend } = await readRendered(tmpDir);
    expect(tend).not.toContain('Context Anchoring');
  });
});

describe('Feature toggle — auto_summary', () => {
  test('ON: auto-summary present in tend', async () => {
    const config = buildDefaultConfig();
    await renderAll(tmpDir, config);
    const { tend } = await readRendered(tmpDir);
    expect(tend).toContain('Auto-Summary');
  });

  test('OFF: auto-summary absent from tend', async () => {
    const config = buildDefaultConfig({ features: { ...DEFAULT_FEATURES, auto_summary: false } });
    await renderAll(tmpDir, config);
    const { tend } = await readRendered(tmpDir);
    expect(tend).not.toContain('Auto-Summary');
  });
});

// ===========================================================================
// C. Feature isolation tests
// ===========================================================================

describe('Feature isolation', () => {
  test('all features OFF → core pipeline still renders', async () => {
    const config = allFeaturesOff();
    await renderAll(tmpDir, config);
    const files = await readRendered(tmpDir);

    // Core structure always present
    expect(files.context).toContain('Vault Structure');
    expect(files.context).toContain('Routing Rules');
    expect(files.context).toContain('Protected Paths');
    expect(files.seed).toContain('Seed — Intake & Routing');
    expect(files.seed).toContain('Step 0 — Document Cleanup');
    expect(files.seed).toContain('Step 1 — Triage');
    expect(files.nurture).toContain('Nurture — Structure & Knowledge Building');
    expect(files.nurture).toContain('Structural Integrity');
    expect(files.nurture).toContain('Belief Synthesizer');
    expect(files.tend).toContain('Tend — Lifecycle & Enrichment');
    expect(files.tend).toContain('Stale Note Review');
    expect(files.tend).toContain('Enrichment Actions');
    expect(files.garden).toContain('Gardener — AI-Powered Vault Maintenance Pipeline');

    // Features should be absent
    expect(files.context).not.toContain('Gardener Persona');
    expect(files.context).not.toContain('Adaptive sizing rules');
    expect(files.context).not.toContain('Social Media Platforms');
    expect(files.seed).not.toContain('This Time Last Year');
    expect(files.seed).not.toContain('## Persona');
    expect(files.nurture).not.toContain('Tag Taxonomy Normalization');
    expect(files.tend).not.toContain('Belief Changes');
  });

  test('single feature ON → only that feature content present', async () => {
    // Test with belief_trajectory - only appears in tend
    const config = singleFeatureOn('belief_trajectory');
    await renderAll(tmpDir, config);
    const files = await readRendered(tmpDir);

    expect(files.tend).toContain('Belief Changes');
    // Other features should be off
    expect(files.tend).not.toContain('Emerging Themes');
    expect(files.tend).not.toContain('Attention Allocation');
    expect(files.tend).not.toContain('## Persona');
    expect(files.tend).not.toContain('Memory Update');
    expect(files.tend).not.toContain('Social Content');
  });

  test('multiple specific features → only those features present', async () => {
    const features = makeFeatures(false);
    features.persona = true;
    features.memory = true;
    features.changelog = true;
    const config = buildDefaultConfig({ features });
    await renderAll(tmpDir, config);
    const files = await readRendered(tmpDir);

    // Enabled features present
    expect(files.seed).toContain('## Persona');
    expect(files.seed).toContain('## Memory');
    expect(files.seed).toContain('Vault Changelog');

    // Disabled features absent
    expect(files.seed).not.toContain('This Time Last Year');
    expect(files.seed).not.toContain('Question Tracker');
    expect(files.seed).not.toContain('Commitment Tracker');
  });
});

// ===========================================================================
// D. Persona rendering tests
// ===========================================================================

describe('Persona rendering', () => {
  test('analytical persona renders correct text', async () => {
    const config = buildDefaultConfig({ persona: 'analytical' });
    await renderAll(tmpDir, config);
    const files = await readRendered(tmpDir);

    expect(files.seed).toContain('analytical');
    expect(files.seed).toContain('facts, data, and minimal interpretation');
    expect(files.seed).not.toContain('deeper meaning');
    expect(files.seed).not.toContain('action-oriented');
  });

  test('reflective persona renders correct text', async () => {
    const config = buildDefaultConfig({ persona: 'reflective' });
    await renderAll(tmpDir, config);
    const files = await readRendered(tmpDir);

    expect(files.garden).toContain('reflective');
    expect(files.garden).toContain('deeper meaning');
  });

  test('coach persona renders correct text', async () => {
    const config = buildDefaultConfig({ persona: 'coach' });
    await renderAll(tmpDir, config);
    const files = await readRendered(tmpDir);

    expect(files.nurture).toContain('coaching');
    expect(files.nurture).toContain('action-oriented');
  });

  test('persona disabled → no persona block anywhere', async () => {
    const config = buildDefaultConfig({ features: { ...DEFAULT_FEATURES, persona: false } });
    await renderAll(tmpDir, config);
    const files = await readRendered(tmpDir);

    for (const [, content] of Object.entries(files)) {
      expect(content).not.toContain('## Persona');
      expect(content).not.toContain('Gardener Persona');
    }
  });

  test('all persona values render in all phase prompts', async () => {
    for (const persona of ['analytical', 'reflective', 'coach'] as const) {
      const config = buildDefaultConfig({ persona });
      const dir = await mkdtemp(join(tmpdir(), 'vg-persona-'));
      try {
        await renderAll(dir, config);
        const seed = await readFile(join(dir, 'prompts', 'seed.md'), 'utf-8');
        expect(seed).toContain(persona === 'coach' ? 'coaching' : persona);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });
});

// ===========================================================================
// E. Social platforms interpolation
// ===========================================================================

describe('Social platforms interpolation', () => {
  test('custom platform list renders in tend + context', async () => {
    const config = buildDefaultConfig({ social_platforms: ['twitter', 'linkedin', 'instagram'] });
    await renderAll(tmpDir, config);
    const files = await readRendered(tmpDir);

    expect(files.context).toContain('instagram');
    expect(files.tend).toContain('instagram');
    expect(files.tend).toContain('twitter');
    expect(files.tend).toContain('linkedin');
  });

  test('empty platform list renders no platform names', async () => {
    const config = buildDefaultConfig({ social_platforms: [] });
    await renderAll(tmpDir, config);
    const files = await readRendered(tmpDir);

    // When social_content is on but platforms empty, the section still renders
    // but without specific platform names
    expect(files.tend).not.toContain('twitter');
    expect(files.tend).not.toContain('linkedin');
  });

  test('social_content OFF hides platforms even if configured', async () => {
    const config = buildDefaultConfig({
      social_platforms: ['twitter', 'linkedin'],
      features: { ...DEFAULT_FEATURES, social_content: false },
    });
    await renderAll(tmpDir, config);
    const files = await readRendered(tmpDir);

    expect(files.context).not.toContain('Social Media Platforms');
    expect(files.tend).not.toContain('Social Content');
  });
});

// ===========================================================================
// F. Config interaction tests
// ===========================================================================

describe('Config interactions', () => {
  test('features + limits interact correctly', async () => {
    const config = buildDefaultConfig({
      limits: { beliefs_per_run: 20, enrich_per_run: 10 } as any,
    });
    await renderAll(tmpDir, config);
    const files = await readRendered(tmpDir);

    expect(files.nurture).toContain('20');
    expect(files.tend).toContain('10');
  });

  test('features + folders interact correctly', async () => {
    const config = buildDefaultConfig({
      folders: {
        inbox: 'custom-inbox',
        journal: 'custom-journal',
        projects: 'custom-projects',
        roles: 'custom-roles',
        resources: 'custom-resources',
        people: 'custom-people',
        orgs: 'custom-orgs',
        playbooks: 'custom-playbooks',
        sources: 'custom-sources',
        mocs: 'custom-mocs',
        archive: 'custom-archive',
        templates: 'custom-templates',
      },
    });
    await renderAll(tmpDir, config);
    const files = await readRendered(tmpDir);

    // Entity auto-linking references people/orgs/projects folders
    expect(files.nurture).toContain('custom-people');
    expect(files.nurture).toContain('custom-orgs');
    // Seed references inbox
    expect(files.seed).toContain('custom-inbox');
  });

  test('all features ON matches default config behavior', async () => {
    const defaultConfig = buildDefaultConfig();
    const explicitConfig = buildDefaultConfig({ features: { ...DEFAULT_FEATURES } });

    const dir1 = await mkdtemp(join(tmpdir(), 'vg-default-'));
    const dir2 = await mkdtemp(join(tmpdir(), 'vg-explicit-'));
    try {
      await renderAll(dir1, defaultConfig);
      await renderAll(dir2, explicitConfig);

      const files1 = await readRendered(dir1);
      const files2 = await readRendered(dir2);

      expect(files1.context).toEqual(files2.context);
      expect(files1.garden).toEqual(files2.garden);
      expect(files1.seed).toEqual(files2.seed);
      expect(files1.nurture).toEqual(files2.nurture);
      expect(files1.tend).toEqual(files2.tend);
    } finally {
      await rm(dir1, { recursive: true, force: true });
      await rm(dir2, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// G. Run Report section tests
// ===========================================================================

describe('Run Report section', () => {
  test('all phases include Run Report section when features enabled', async () => {
    const config = buildDefaultConfig();
    await renderAll(tmpDir, config);
    const files = await readRendered(tmpDir);

    expect(files.seed).toContain('## Run Report');
    expect(files.nurture).toContain('## Run Report');
    expect(files.tend).toContain('## Run Report');
    expect(files.garden).toContain('## Run Report');
  });

  test('seed Run Report lists seed-phase features', async () => {
    const config = buildDefaultConfig();
    await renderAll(tmpDir, config);
    const { seed } = await readRendered(tmpDir);

    expect(seed).toContain('`memory`');
    expect(seed).toContain('`question_tracker`');
    expect(seed).toContain('`commitment_tracker`');
    expect(seed).toContain('`this_time_last_year`');
    expect(seed).toContain('`meeting_enhancement`');
    expect(seed).toContain('run-report.json');
  });

  test('nurture Run Report lists nurture-phase features', async () => {
    const config = buildDefaultConfig();
    await renderAll(tmpDir, config);
    const { nurture } = await readRendered(tmpDir);

    expect(nurture).toContain('`tag_normalization`');
    expect(nurture).toContain('`co_mention_network`');
    expect(nurture).toContain('`entity_auto_linking`');
    expect(nurture).toContain('`knowledge_gaps`');
    expect(nurture).toContain('`backlink_context`');
    expect(nurture).toContain('`transitive_links`');
  });

  test('tend Run Report lists tend-phase features', async () => {
    const config = buildDefaultConfig();
    await renderAll(tmpDir, config);
    const { tend } = await readRendered(tmpDir);

    expect(tend).toContain('`social_content`');
    expect(tend).toContain('`belief_trajectory`');
    expect(tend).toContain('`theme_detection`');
    expect(tend).toContain('`auto_summary`');
    expect(tend).toContain('`context_anchoring`');
    expect(tend).toContain('`enrichment_priority`');
  });

  test('disabled features excluded from Run Report instruction', async () => {
    const config = buildDefaultConfig({
      features: { ...DEFAULT_FEATURES, memory: false, question_tracker: false },
    });
    await renderAll(tmpDir, config);
    const { seed } = await readRendered(tmpDir);

    // The Run Report section should exist
    expect(seed).toContain('## Run Report');
    // But disabled features should not be listed in the feature report instructions
    // (they're guarded by {{#if features.xxx}})
    const reportSection = seed.split('## Run Report')[1].split('## Output')[0];
    expect(reportSection).not.toContain('`memory`');
    expect(reportSection).not.toContain('`question_tracker`');
    // Enabled features should still be there
    expect(reportSection).toContain('`commitment_tracker`');
  });

  test('all features OFF → Run Report still has core steps', async () => {
    const config = allFeaturesOff();
    await renderAll(tmpDir, config);
    const { seed, nurture, tend } = await readRendered(tmpDir);

    // Core steps should always be present
    expect(seed).toContain('`cleanup`');
    expect(seed).toContain('`triage`');
    expect(seed).toContain('`binder`');
    expect(nurture).toContain('`structural_integrity`');
    expect(nurture).toContain('`consolidator`');
    expect(tend).toContain('`stale_review`');
    expect(tend).toContain('`enrichment`');
  });

  test('garden template mentions multi-phase run-report.json workflow', async () => {
    const config = buildDefaultConfig();
    await renderAll(tmpDir, config);
    const { garden } = await readRendered(tmpDir);

    expect(garden).toContain('seed');
    expect(garden).toContain('append');
  });

  test('Run Report includes JSON structure example', async () => {
    const config = buildDefaultConfig();
    await renderAll(tmpDir, config);
    const { seed } = await readRendered(tmpDir);

    expect(seed).toContain('"version": 1');
    expect(seed).toContain('"phases"');
    expect(seed).toContain('"phase": "seed"');
  });
});
