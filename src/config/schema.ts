import { validate as cronValidate } from 'node-cron';
import type { ProviderName, Tier } from '../providers/types.js';

export interface JournalConfig {
  style: {
    weekly: 'structured' | 'narrative';
    monthly: 'structured' | 'narrative';
    quarterly: 'structured' | 'narrative';
    yearly: 'structured' | 'narrative';
  };
  journal_subfolders: {
    yearly: string;
    quarterly: string;
    monthly: string;
    weekly: string;
    daily: string;
  };
}

export interface ResilienceConfig {
  queue_enabled: boolean;
  queue_max_size: number;
  queue_max_age_hours: number;
  metrics_timeout_seconds: number;
  metrics_max_files: number;
  lock_heartbeat_interval_seconds: number;
  lock_stale_threshold_seconds: number;
  provider_kill_grace_seconds: number;
  log_max_size_mb: number;
  log_max_backups: number;
  daemon_max_consecutive_failures: number;
  vault_quiet_seconds: number;
  preflight_enabled: boolean;
}

export const DEFAULT_RESILIENCE: ResilienceConfig = {
  queue_enabled: true,
  queue_max_size: 10,
  queue_max_age_hours: 24,
  metrics_timeout_seconds: 30,
  metrics_max_files: 50_000,
  lock_heartbeat_interval_seconds: 30,
  lock_stale_threshold_seconds: 300,
  provider_kill_grace_seconds: 10,
  log_max_size_mb: 10,
  log_max_backups: 3,
  daemon_max_consecutive_failures: 5,
  vault_quiet_seconds: 30,
  preflight_enabled: true,
};

/**
 * Single source of truth for feature flags.
 * Add new features here — FeaturesConfig, FEATURE_KEYS, and DEFAULT_FEATURES
 * are all derived from this object.
 */
const FEATURE_DEFAULTS = {
  memory: true,
  entity_auto_linking: true,
  question_tracker: true,
  context_anchoring: true,
  meeting_enhancement: true,
  auto_summary: true,
  backlink_context: true,
  transitive_links: true,
  co_mention_network: true,
  belief_trajectory: true,
  theme_detection: true,
  attention_allocation: true,
  knowledge_gaps: true,
  seasonal_patterns: true,
  goal_tracking: true,
  commitment_tracker: true,
  this_time_last_year: true,
  tag_normalization: true,
  persona: true,
  changelog: true,
  adaptive_batch_sizing: true,
  enrichment_priority: true,
  social_content: true,
  todo_lifecycle: true,
} as const satisfies Record<string, boolean>;

export type FeaturesConfig = { -readonly [K in keyof typeof FEATURE_DEFAULTS]: boolean };

export const FEATURE_KEYS = Object.keys(FEATURE_DEFAULTS) as (keyof FeaturesConfig)[];

export const DEFAULT_FEATURES: FeaturesConfig = { ...FEATURE_DEFAULTS };

export type Persona = 'analytical' | 'reflective' | 'coach';

export interface GardenerConfig {
  version: number;
  provider: ProviderName;
  tier: Tier;
  persona: Persona;
  folders: Record<string, string>;
  topics: Record<string, string[]>;
  frontmatter: {
    required: string[];
    statuses: string[];
    types: string[];
  };
  schedule: {
    enabled: boolean;
    cron: string;
  };
  auto_grow: Record<string, number>;
  limits: Record<string, number>;
  claude: { power_model: string; fast_model: string; timeout: number; max_turns: number };
  codex: { power_model: string; fast_model: string; timeout: number };
  gemini: { power_model: string; fast_model: string; timeout: number };
  journal: JournalConfig;
  social_platforms: string[];
  protected: string[];
  resilience: ResilienceConfig;
  features: FeaturesConfig;
}

export function validateConfig(
  config: Partial<GardenerConfig>,
): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  const c = config as Record<string, unknown>;

  // Required top-level keys
  for (const key of ['version', 'provider', 'tier', 'folders']) {
    if (c[key] == null) {
      errors.push(`Missing required key: ${key}`);
    }
  }

  // Provider validation
  if (config.provider && !['claude', 'codex', 'gemini'].includes(config.provider)) {
    errors.push(`Invalid provider "${config.provider}". Must be: claude, codex, gemini`);
  }

  // Persona validation
  if (config.persona && !['analytical', 'reflective', 'coach'].includes(config.persona)) {
    errors.push(`Invalid persona "${config.persona}". Must be: analytical, reflective, coach`);
  }

  // Tier validation
  if (config.tier && !['power', 'fast'].includes(config.tier)) {
    errors.push(`Invalid tier "${config.tier}". Must be: power, fast`);
  }

  // Folders validation
  if (config.folders && typeof config.folders === 'object') {
    if (!config.folders.inbox) {
      errors.push('Missing required folder: inbox');
    }
  }

  // Protected validation
  if (config.protected != null && !Array.isArray(config.protected)) {
    errors.push('protected must be an array');
  }

  // Limits validation
  if (config.limits && typeof config.limits === 'object') {
    for (const [key, val] of Object.entries(config.limits)) {
      if (typeof val !== 'number' || val < 1 || !Number.isInteger(val)) {
        warnings.push(`limits.${key} should be a positive integer (got ${val})`);
      }
    }
  }

  // Features validation
  if (config.features && typeof config.features === 'object') {
    for (const [key, val] of Object.entries(config.features)) {
      if (typeof val !== 'boolean') {
        warnings.push(`features.${key} should be a boolean (got ${typeof val})`);
      }
    }
  }

  // Schedule cron validation
  if (config.schedule?.cron) {
    if (!cronValidate(config.schedule.cron)) {
      errors.push(`Invalid cron expression: "${config.schedule.cron}"`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function buildDefaultConfig(overrides: Partial<GardenerConfig> = {}): GardenerConfig {
  return {
    version: 1,
    provider: 'claude',
    tier: 'fast',
    persona: 'reflective',
    folders: {
      inbox: '00-inbox',
      journal: '01-journal',
      projects: '02-projects',
      roles: '03-roles',
      resources: '04-resources',
      people: '05-people',
      orgs: '06-orgs',
      playbooks: '07-playbooks',
      sources: '08-sources',
      mocs: '09-mocs',
      archive: '99-archive',
      templates: 'templates',
    },
    topics: {
      ideas: ['ideas', 'concepts', 'brainstorm', 'innovation', 'creativity'],
      finance: ['investing', 'portfolio', 'markets', 'stocks', 'economics', 'money', 'budget'],
      learning: ['learning', 'education', 'courses', 'books', 'research', 'science'],
      health: ['health', 'wellness', 'fitness', 'nutrition', 'sleep', 'exercise', 'mental-health'],
      travel: ['travel', 'trips', 'destinations', 'itinerary', 'places'],
    },
    frontmatter: {
      required: ['created', 'updated', 'tags', 'status', 'type'],
      statuses: ['seed', 'growing', 'evergreen', 'archived', 'consolidated'],
      types: ['journal', 'project', 'role', 'resource', 'person', 'org', 'meeting', 'idea', 'playbook', 'moc'],
    },
    schedule: {
      enabled: false,
      cron: '0 */4 * * *',
    },
    auto_grow: {
      projects: 5,
      roles: 3,
      resources: 3,
      people: 5,
      orgs: 8,
      playbooks: 5,
      sources: 5,
    },
    limits: {
      beliefs_per_run: 10,
      playbooks_per_run: 2,
      mocs_per_run: 2,
      links_per_run: 10,
      organize_per_run: 10,
      enrich_per_run: 5,
    },
    claude: {
      power_model: 'opus',
      fast_model: 'sonnet',
      timeout: 1500,
      max_turns: 200,
    },
    codex: {
      power_model: 'gpt-5.3-codex',
      fast_model: 'gpt-5.3-codex-spark',
      timeout: 1500,
    },
    gemini: {
      power_model: 'gemini-3.1-pro-preview',
      fast_model: 'gemini-3-flash-preview',
      timeout: 1500,
    },
    journal: {
      style: {
        weekly: 'structured',
        monthly: 'structured',
        quarterly: 'structured',
        yearly: 'structured',
      },
      journal_subfolders: {
        yearly: 'yearly',
        quarterly: 'quarterly',
        monthly: 'monthly',
        weekly: 'weekly',
        daily: 'daily',
      },
    },
    social_platforms: ['twitter', 'linkedin'],
    protected: [
      '.gardener',
      '.obsidian',
      '.logseq',
      '.foam',
      '.dendron',
      '.vscode',
      '.git',
      'node_modules',
      'templates',
    ],
    resilience: { ...DEFAULT_RESILIENCE },
    features: { ...DEFAULT_FEATURES },
    ...overrides,
  };
}
