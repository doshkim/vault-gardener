import { stringify } from 'yaml';
import chalk from 'chalk';
import {
  loadConfig,
  saveConfig,
  getGardenerDir,
  validateConfig,
} from '../config/index.js';

// Re-export config types and functions for backward compatibility
export {
  type GardenerConfig,
  type JournalConfig,
  type ResilienceConfig,
  DEFAULT_RESILIENCE,
  validateConfig,
  buildDefaultConfig,
  getGardenerDir,
  getConfigPath,
  loadConfig,
  saveConfig,
  resolveModel,
  resolveTimeout,
  deepMerge,
} from '../config/index.js';

// Fields that should always be parsed as strings, never auto-cast
const STRING_FIELDS = new Set([
  'provider', 'tier', 'schedule.cron',
  'folders.inbox', 'folders.journal', 'folders.projects', 'folders.roles',
  'folders.resources', 'folders.people', 'folders.orgs', 'folders.playbooks',
  'folders.sources', 'folders.mocs', 'folders.archive', 'folders.templates',
  'claude.power_model', 'claude.fast_model', 'codex.power_model', 'codex.fast_model',
  'gemini.power_model', 'gemini.fast_model',
]);

function getNestedValue(obj: Record<string, unknown>, key: string): unknown {
  const parts = key.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function setNestedValue(obj: Record<string, unknown>, key: string, value: unknown): void {
  const parts = key.split('.');
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (current[parts[i]] == null || typeof current[parts[i]] !== 'object') {
      current[parts[i]] = {};
    }
    current = current[parts[i]] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

export async function configGet(key: string): Promise<void> {
  try {
    const config = await loadConfig();
    const value = getNestedValue(config as unknown as Record<string, unknown>, key);
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

    setNestedValue(config as unknown as Record<string, unknown>, key, parsed);

    // Validate after setting
    const { valid, errors } = validateConfig(config);
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
    await renderAll(getGardenerDir(), config);
    console.log(chalk.green('Prompts regenerated in .gardener/prompts/'));
  } catch {
    console.error(chalk.red('No .gardener/config.yaml found. Run `vault-gardener init` first.'));
    process.exit(1);
  }
}
