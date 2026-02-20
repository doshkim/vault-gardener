export { run } from './cli/index.js';
export type { Provider, RunOptions, RunResult } from './providers/types.js';
export { scanVault } from './scanner/detect.js';
export type { VaultScanResult, FolderMap, JournalStructure } from './scanner/detect.js';
export { getPreset, listPresets } from './scanner/presets.js';
export type { PresetConfig } from './scanner/presets.js';
export type { GardenerConfig } from './cli/config.js';
export type { VaultDigest } from './cli/digest.js';
export { generateDigest } from './cli/digest.js';
