import { readFile, writeFile, mkdir, copyFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import chalk from 'chalk';
import { validateConfig, buildDefaultConfig, DEFAULT_RESILIENCE } from './schema.js';
import type { GardenerConfig } from './schema.js';

const GARDENER_DIR = '.gardener';
const CONFIG_FILE = 'config.yaml';

export function getGardenerDir(cwd?: string): string {
  return join(cwd ?? process.cwd(), GARDENER_DIR);
}

export function getConfigPath(cwd?: string): string {
  return join(getGardenerDir(cwd), CONFIG_FILE);
}

/** Deep merge: defaults as base, user config on top, merging nested objects */
export function deepMerge(defaults: Record<string, unknown>, user: Record<string, unknown>): Record<string, unknown> {
  const result = { ...defaults };
  for (const key of Object.keys(user)) {
    if (
      user[key] != null &&
      typeof user[key] === 'object' &&
      !Array.isArray(user[key]) &&
      typeof defaults[key] === 'object' &&
      !Array.isArray(defaults[key])
    ) {
      result[key] = deepMerge(defaults[key] as Record<string, unknown>, user[key] as Record<string, unknown>);
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
  const { valid, errors, warnings } = validateConfig(config);
  if (!valid) {
    for (const err of errors) console.error(chalk.yellow(`[config auto-repair] ${err}`));
    const defaults = buildDefaultConfig();
    config = deepMerge(
      defaults as unknown as Record<string, unknown>,
      config as unknown as Record<string, unknown>,
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
