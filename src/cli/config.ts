import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import chalk from 'chalk';
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
}

const GARDENER_DIR = '.gardener';
const CONFIG_FILE = 'config.yaml';

export function getGardenerDir(cwd?: string): string {
  return join(cwd ?? process.cwd(), GARDENER_DIR);
}

export function getConfigPath(cwd?: string): string {
  return join(getGardenerDir(cwd), CONFIG_FILE);
}

export async function loadConfig(cwd?: string): Promise<GardenerConfig> {
  const configPath = getConfigPath(cwd);
  const raw = await readFile(configPath, 'utf-8');
  return parse(raw) as GardenerConfig;
}

export async function saveConfig(config: GardenerConfig, cwd?: string): Promise<void> {
  const gardenerDir = getGardenerDir(cwd);
  await mkdir(gardenerDir, { recursive: true });
  const configPath = getConfigPath(cwd);
  await writeFile(configPath, stringify(config, { lineWidth: 0 }), 'utf-8');
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

    // Auto-parse booleans and numbers
    let parsed: unknown = value;
    if (value === 'true') parsed = true;
    else if (value === 'false') parsed = false;
    else if (/^\d+$/.test(value)) parsed = parseInt(value, 10);

    setNestedValue(config as unknown as Record<string, any>, key, parsed);
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
    ...overrides,
  };
}
