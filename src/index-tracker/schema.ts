/** Per-file tracking record in the vault index. */
export interface FileEntry {
  /** Frontmatter status if present (seed, growing, evergreen, etc.) */
  status: string | null;
  /** Count of outgoing [[WikiLinks]] */
  wikilinkCount: number;
  /** Approximate word count */
  wordCount: number;
  /** Number of times this file has been modified by the gardener across runs */
  enrichmentCount: number;
  /** ISO date (YYYY-MM-DD) of last gardener run that touched this file */
  lastGardened: string | null;
  /** File mtime ISO string at last scan (for incremental diffing) */
  mtime: string;
}

/** Top-level vault index structure, persisted to .gardener/index.json. */
export interface VaultIndex {
  version: 1;
  lastBuilt: string;
  files: Record<string, FileEntry>;
}

/** Actionable summary injected into the context template. */
export interface IndexSummary {
  cooldownNotes: string[];
  maxEnrichmentNotes: string[];
  highDensityNotes: string[];
  stats: {
    totalIndexed: number;
    neverGardened: number;
    onCooldown: number;
    atMaxEnrichment: number;
    avgWikilinkCount: number;
  };
}
