import type { FeaturesConfig } from '../config/schema.js';

export const FEATURE_PHASE_MAP: Record<string, string[]> = {
  memory: ['seed', 'nurture', 'tend'],
  changelog: ['seed', 'nurture', 'tend'],
  persona: ['seed', 'nurture', 'tend'],
  this_time_last_year: ['seed'],
  meeting_enhancement: ['seed'],
  question_tracker: ['seed', 'tend'],
  commitment_tracker: ['seed', 'nurture', 'tend'],
  tag_normalization: ['nurture'],
  co_mention_network: ['nurture'],
  knowledge_gaps: ['nurture'],
  entity_auto_linking: ['nurture'],
  backlink_context: ['nurture'],
  transitive_links: ['nurture'],
  social_content: ['tend'],
  belief_trajectory: ['tend'],
  theme_detection: ['tend'],
  attention_allocation: ['tend'],
  goal_tracking: ['tend'],
  seasonal_patterns: ['tend'],
  adaptive_batch_sizing: ['tend'],
  enrichment_priority: ['tend'],
  context_anchoring: ['tend'],
  auto_summary: ['tend'],
};

/** Return feature keys that are enabled and belong to the given phase. */
export function featuresForPhase(
  phase: string,
  enabledFeatures: FeaturesConfig,
): string[] {
  const flags = enabledFeatures as unknown as Record<string, boolean>;
  return Object.entries(FEATURE_PHASE_MAP)
    .filter(([key, phases]) => phases.includes(phase) && flags[key])
    .map(([key]) => key);
}
