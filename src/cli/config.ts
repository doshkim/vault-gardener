import { readFile, writeFile, mkdir, copyFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import chalk from 'chalk';
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

export interface GardenerConfig {
  version: number;
  provider: ProviderName;
  tier: Tier;
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
  protected: string[];
  resilience: ResilienceConfig;
}

const GARDENER_DIR = '.gardener';
const CONFIG_FILE = 'config.yaml';

// Fields that should always be parsed as strings, never auto-cast
const STRING_FIELDS = new Set([
  'provider', 'tier', 'schedule.cron',
  'folders.inbox', 'folders.journal', 'folders.projects', 'folders.roles',
  'folders.resources', 'folders.people', 'folders.orgs', 'folders.playbooks',
  'folders.sources', 'folders.mocs', 'folders.archive', 'folders.templates',
  'claude.power_model', 'claude.fast_model', 'codex.power_model', 'codex.fast_model',
  'gemini.power_model', 'gemini.fast_model',
]);

export function getGardenerDir(cwd?: string): string {
  return join(cwd ?? process.cwd(), GARDENER_DIR);
}

export function getConfigPath(cwd?: string): string {
  return join(getGardenerDir(cwd), CONFIG_FILE);
}

export function validateConfig(
  config: Record<string, any>,
): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required top-level keys
  for (const key of ['version', 'provider', 'tier', 'folders']) {
    if (config[key] == null) {
      errors.push(`Missing required key: ${key}`);
    }
  }

  // Provider validation
  if (config.provider && !['claude', 'codex', 'gemini'].includes(config.provider)) {
    errors.push(`Invalid provider "${config.provider}". Must be: claude, codex, gemini`);
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

  // Schedule cron validation
  if (config.schedule?.cron) {
    if (!cronValidate(config.schedule.cron)) {
      errors.push(`Invalid cron expression: "${config.schedule.cron}"`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/** Deep merge: defaults as base, user config on top, merging nested objects */
function deepMerge(defaults: Record<string, any>, user: Record<string, any>): Record<string, any> {
  const result = { ...defaults };
  for (const key of Object.keys(user)) {
    if (
      user[key] != null &&
      typeof user[key] === 'object' &&
      !Array.isArray(user[key]) &&
      typeof defaults[key] === 'object' &&
      !Array.isArray(defaults[key])
    ) {
      result[key] = deepMerge(defaults[key], user[key]);
    } else {
      result[key] = user[key];
    }
  }
  return result;
}

export async function loadConfig(cwd?: string): Promise<GardenerConfig> {
  const configPath = getConfigPath(cwd);
  const bakPath = configPath + '.bak';

  let raw: string;
  let loadedFromBackup = false;
  try {
    raw = await readFile(configPath, 'utf-8');
  } catch {
    // Primary config missing — try backup
    try {
      raw = await readFile(bakPath, 'utf-8');
      loadedFromBackup = true;
      console.error(chalk.yellow('Config restored from .bak'));
    } catch {
      throw new Error('No config.yaml found');
    }
  }

  let config: GardenerConfig;
  try {
    config = parse(raw) as GardenerConfig;
  } catch {
    // YAML parse failed — try backup
    try {
      const bakRaw = await readFile(bakPath, 'utf-8');
      config = parse(bakRaw) as GardenerConfig;
      loadedFromBackup = true;
      console.error(chalk.yellow('Config corrupted — restored from .bak'));
    } catch {
      throw new Error('config.yaml is corrupted and no valid .bak available');
    }
  }

  // Validate and auto-repair with deep merge
  const { valid, errors, warnings } = validateConfig(config as unknown as Record<string, any>);
  if (!valid) {
    for (const err of errors) console.error(chalk.yellow(`[config auto-repair] ${err}`));
    const defaults = buildDefaultConfig();
    config = deepMerge(
      defaults as unknown as Record<string, any>,
      config as unknown as Record<string, any>,
    ) as unknown as GardenerConfig;
  }
  for (const w of warnings) console.error(chalk.dim(`[config] ${w}`));

  // Fill missing resilience fields with defaults
  config.resilience = { ...DEFAULT_RESILIENCE, ...config.resilience };

  // Restore primary config if loaded from backup
  if (loadedFromBackup) {
    await writeFile(configPath, stringify(config, { lineWidth: 0 }), 'utf-8').catch(() => {});
  }

  // Write backup
  await copyFile(configPath, bakPath).catch(() => {});

  return config;
}

export async function saveConfig(config: GardenerConfig, cwd?: string): Promise<void> {
  const gardenerDir = getGardenerDir(cwd);
  await mkdir(gardenerDir, { recursive: true });
  const configPath = getConfigPath(cwd);
  const tmpPath = configPath + '.tmp';
  const bakPath = configPath + '.bak';

  // Atomic write: write to .tmp, rename into place
  await writeFile(tmpPath, stringify(config, { lineWidth: 0 }), 'utf-8');
  await rename(tmpPath, configPath);

  // Write backup
  await copyFile(configPath, bakPath).catch(() => {});
}

export function resolveModel(config: GardenerConfig): string {
  const providerConfig = config[config.provider];
  return config.tier === 'power' ? providerConfig.power_model : providerConfig.fast_model;
}

export function resolveTimeout(config: GardenerConfig): number {
  return config[config.provider].timeout;
}

function getNestedValue(obj: Record<string, any>, key: string): unknown {
  const parts = key.split('.');
  let current: any = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
}

function setNestedValue(obj: Record<string, any>, key: string, value: unknown): void {
  const parts = key.split('.');
  let current: any = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (current[parts[i]] == null || typeof current[parts[i]] !== 'object') {
      current[parts[i]] = {};
    }
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
}

export async function configGet(key: string): Promise<void> {
  try {
    const config = await loadConfig();
    const value = getNestedValue(config as unknown as Record<string, any>, key);
    if (value === undefined) {
      console.error(chalk.red(`Key "${key}" not found in config`));
      process.exit(1);
    }
    if (typeof value === 'object') {
      console.log(stringify(value));
    } else {
      console.log(String(value));
    }
  } catch {
    console.error(chalk.red('No .gardener/config.yaml found. Run `vault-gardener init` first.'));
    process.exit(1);
  }
}

export async function configSet(key: string, value: string): Promise<void> {
  try {
    const config = await loadConfig();

    // Auto-parse booleans and numbers, but only for non-string fields
    let parsed: unknown = value;
    if (!STRING_FIELDS.has(key)) {
      if (value === 'true') parsed = true;
      else if (value === 'false') parsed = false;
      else if (/^\d+$/.test(value)) parsed = parseInt(value, 10);
    }

    setNestedValue(config as unknown as Record<string, any>, key, parsed);

    // Validate after setting
    const { valid, errors } = validateConfig(config as unknown as Record<string, any>);
    if (!valid) {
      for (const err of errors) {
        console.error(chalk.red(`Validation error: ${err}`));
      }
      process.exit(1);
    }

    await saveConfig(config);
    console.log(chalk.green(`Set ${key} = ${value}`));
  } catch {
    console.error(chalk.red('No .gardener/config.yaml found. Run `vault-gardener init` first.'));
    process.exit(1);
  }
}

export async function configRegen(): Promise<void> {
  try {
    const config = await loadConfig();
    const { renderAll } = await import('../prompts/render.js');
    await renderAll(getGardenerDir(), config as unknown as Record<string, any>);
    console.log(chalk.green('Prompts regenerated in .gardener/prompts/'));
  } catch {
    console.error(chalk.red('No .gardener/config.yaml found. Run `vault-gardener init` first.'));
    process.exit(1);
  }
}

export function buildDefaultConfig(overrides: Partial<GardenerConfig> = {}): GardenerConfig {
  return {
    version: 1,
    provider: 'claude',
    tier: 'fast',
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
      max_turns: 50,
    },
    codex: {
      power_model: 'gpt-5.3-codex',
      fast_model: 'gpt-5.3-codex-spark',
      timeout: 1500,
    },
    gemini: {
      power_model: 'gemini-3-pro-preview',
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
    ...overrides,
  };
}
