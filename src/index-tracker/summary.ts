import type { VaultIndex, IndexSummary } from './schema.js';
import type { IndexConfig } from '../config/schema.js';

const MAX_LIST_SIZE = 50;

/** Generate a concise, actionable summary from the full vault index. */
export function generateIndexSummary(
  index: VaultIndex,
  config: IndexConfig,
): IndexSummary {
  const now = Date.now();
  const cooldownMs = config.cooldown_days * 24 * 60 * 60 * 1000;

  const cooldownNotes: string[] = [];
  const maxEnrichmentNotes: string[] = [];
  const highDensityNotes: string[] = [];

  let totalWikilinks = 0;
  let neverGardened = 0;

  const entries = Object.entries(index.files);

  for (const [path, entry] of entries) {
    totalWikilinks += entry.wikilinkCount;

    // Never gardened
    if (!entry.lastGardened) {
      neverGardened++;
    }

    // Cooldown check
    if (
      entry.lastGardened &&
      cooldownNotes.length < MAX_LIST_SIZE
    ) {
      const gardenedAt = new Date(entry.lastGardened).getTime();
      if (now - gardenedAt < cooldownMs) {
        cooldownNotes.push(path);
      }
    }

    // Max enrichment check
    if (
      entry.enrichmentCount >= config.max_enrichments &&
      maxEnrichmentNotes.length < MAX_LIST_SIZE
    ) {
      maxEnrichmentNotes.push(path);
    }

    // High wikilink density check (links per 1000 words)
    if (entry.wordCount > 0 && highDensityNotes.length < MAX_LIST_SIZE) {
      const density = (entry.wikilinkCount / entry.wordCount) * 1000;
      if (density > config.max_wikilink_density) {
        highDensityNotes.push(path);
      }
    }
  }

  const totalIndexed = entries.length;
  const avgWikilinkCount = totalIndexed > 0
    ? Math.round(totalWikilinks / totalIndexed)
    : 0;

  return {
    cooldownNotes,
    maxEnrichmentNotes,
    highDensityNotes,
    stats: {
      totalIndexed,
      neverGardened,
      onCooldown: cooldownNotes.length,
      atMaxEnrichment: maxEnrichmentNotes.length,
      avgWikilinkCount,
    },
  };
}
