import { mkdir, access, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface, type Interface } from 'node:readline';
import chalk from 'chalk';
import { scanVault } from '../scanner/detect.js';
import { getPreset, listPresets } from '../scanner/presets.js';
import { detectProviders } from '../providers/detect.js';
import { renderAll } from '../prompts/render.js';
import {
  buildDefaultConfig,
  saveConfig,
  getGardenerDir,
  type GardenerConfig,
} from './config.js';
import type { ProviderName, Tier } from '../providers/types.js';

interface InitOptions {
  preset?: string;
  provider?: string;
  tier?: string;
  interactive?: boolean;
}

function ask(rl: Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

async function choose(rl: Interface, prompt: string, options: string[], defaultIdx = 0): Promise<string> {
  console.log(chalk.cyan(prompt));
  for (let i = 0; i < options.length; i++) {
    const marker = i === defaultIdx ? chalk.green('→') : ' ';
    console.log(`  ${marker} ${i + 1}. ${options[i]}`);
  }
  const answer = await ask(rl, `Choice [${defaultIdx + 1}]: `);
  const idx = answer ? parseInt(answer, 10) - 1 : defaultIdx;
  if (idx < 0 || idx >= options.length) return options[defaultIdx];
  return options[idx];
}

async function choosePreset(rl: Interface): Promise<string> {
  const presets = listPresets();
  const choice = await choose(rl, 'Choose a vault preset:', [
    'para-plus (PARA+ with 11 folders — recommended for Obsidian)',
    'zettelkasten (Zettelkasten-style with inbox + notes)',
    'flat (Minimal — inbox, notes, archive)',
  ]);
  if (choice.startsWith('zettelkasten')) return 'zettelkasten';
  if (choice.startsWith('flat')) return 'flat';
  return 'para-plus';
}

export async function initCommand(options: InitOptions): Promise<void> {
  const cwd = process.cwd();
  const gardenerDir = getGardenerDir(cwd);
  const interactive = options.interactive !== false;

  const rl = interactive
    ? createInterface({ input: process.stdin, output: process.stdout })
    : null;

  try {
    await runInit(cwd, gardenerDir, interactive, options, rl);
  } finally {
    rl?.close();
  }
}

async function runInit(
  cwd: string,
  gardenerDir: string,
  interactive: boolean,
  options: InitOptions,
  rl: Interface | null,
): Promise<void> {
  console.log(chalk.bold('\nvault-gardener init\n'));

  // Check if .gardener already exists
  try {
    await access(gardenerDir);
    if (interactive && rl) {
      const answer = await ask(
        rl,
        chalk.yellow('.gardener/ already exists. Reset? (y/N): ')
      );
      if (answer.toLowerCase() !== 'y') {
        console.log('Aborted.');
        return;
      }
    }
  } catch {
    // Doesn't exist, continue
  }

  // Step 1: Scan vault
  console.log(chalk.dim('Scanning vault...'));
  const scan = await scanVault(cwd);
  console.log(
    chalk.dim(
      `Found ${scan.totalNotes} notes` +
        (scan.tool ? ` (${scan.tool} vault)` : '') +
        (scan.preset ? ` — detected ${chalk.bold(scan.preset)} structure (${Math.round(scan.confidence * 100)}% confidence)` : '')
    )
  );

  // Step 2: Determine folder structure
  let config: GardenerConfig;

  if (options.preset) {
    // CLI flag preset
    const preset = getPreset(options.preset);
    config = buildDefaultConfig({
      folders: preset.folders as Record<string, string>,
      topics: preset.topics,
      frontmatter: preset.frontmatter,
    });
    console.log(chalk.green(`Using preset: ${options.preset}`));
  } else if (scan.preset && scan.confidence > 0.7) {
    // Auto-detected with high confidence
    if (interactive && rl) {
      console.log(chalk.cyan('\nDetected folder structure:'));
      for (const [key, value] of Object.entries(scan.detected)) {
        if (value) console.log(`  ${chalk.dim(key)}: ${value}/`);
      }
      const answer = await ask(rl, '\nUse detected structure? (Y/n): ');
      if (answer.toLowerCase() === 'n') {
        const presetName = await choosePreset(rl);
        const preset = getPreset(presetName);
        config = buildDefaultConfig({
          folders: preset.folders as Record<string, string>,
          topics: preset.topics,
          frontmatter: preset.frontmatter,
        });
      } else {
        config = buildDefaultConfig({
          folders: scan.detected as Record<string, string>,
        });
      }
    } else {
      config = buildDefaultConfig({
        folders: scan.detected as Record<string, string>,
      });
    }
  } else {
    // No clear structure detected
    if (interactive && rl) {
      const presetName = await choosePreset(rl);
      const preset = getPreset(presetName);
      config = buildDefaultConfig({
        folders: preset.folders as Record<string, string>,
        topics: preset.topics,
        frontmatter: preset.frontmatter,
      });

      const scaffold = await ask(
        rl,
        chalk.cyan('Scaffold folders now? (Y/n): ')
      );
      if (scaffold.toLowerCase() !== 'n') {
        for (const folder of Object.values(config.folders)) {
          await mkdir(join(cwd, folder), { recursive: true });
        }
        console.log(chalk.green('Folders created.'));
      }
    } else {
      config = buildDefaultConfig();
    }
  }

  // Apply journal structure from scan
  if (scan.journalStructure.subfolders.daily) {
    config.journal.journal_subfolders = {
      ...config.journal.journal_subfolders,
      ...scan.journalStructure.subfolders,
    };
  }

  // Step 3: Detect and choose provider
  console.log(chalk.dim('\nDetecting LLM providers...'));
  const providers = await detectProviders();

  if (providers.available.length === 0) {
    console.error(
      chalk.red(
        '\nNo LLM CLI tools found. Install one of:\n' +
          '  claude  — https://docs.anthropic.com/en/docs/claude-code\n' +
          '  codex   — https://github.com/openai/codex\n' +
          '  gemini  — https://github.com/google-gemini/gemini-cli\n'
      )
    );
    process.exit(1);
  }

  console.log(
    chalk.dim(`Available: ${providers.available.join(', ')}`)
  );

  if (options.provider) {
    config.provider = options.provider as ProviderName;
  } else if (interactive && rl && providers.available.length > 1) {
    const providerChoice = await choose(
      rl,
      '\nChoose LLM provider:',
      providers.available.map(
        (p) => `${p}${p === providers.recommended ? ' (recommended)' : ''}`
      )
    );
    config.provider = providerChoice.replace(' (recommended)', '') as ProviderName;
  } else {
    config.provider = providers.recommended ?? providers.available[0];
  }

  // Choose tier
  if (options.tier) {
    config.tier = options.tier as Tier;
  } else if (interactive && rl) {
    const tierChoice = await choose(rl, '\nChoose model tier:', [
      'fast (recommended — quicker, cheaper)',
      'power (thorough, slower)',
    ]);
    config.tier = tierChoice.startsWith('fast') ? 'fast' : 'power';
  }

  const model = config.tier === 'power'
    ? config[config.provider].power_model
    : config[config.provider].fast_model;

  console.log(
    chalk.dim(`\nProvider: ${config.provider}, Tier: ${config.tier}, Model: ${model}`)
  );

  // Step 4: Write config and render prompts
  await mkdir(gardenerDir, { recursive: true });
  await mkdir(join(gardenerDir, 'prompts'), { recursive: true });
  await mkdir(join(gardenerDir, 'metrics'), { recursive: true });
  await mkdir(join(gardenerDir, 'logs'), { recursive: true });

  await saveConfig(config, cwd);
  console.log(chalk.dim('Wrote .gardener/config.yaml'));

  await renderAll(gardenerDir, config);
  console.log(chalk.dim('Generated .gardener/context.md and .gardener/prompts/'));

  // Step 5: Suggest .gitignore additions
  if (interactive) {
    console.log(
      chalk.dim(
        '\nConsider adding to .gitignore:\n' +
          '  .gardener/logs/\n' +
          '  .gardener/.lock\n' +
          '  .gardener/metrics/\n'
      )
    );
  }

  console.log(
    chalk.green.bold(
      `\nReady! Run ${chalk.cyan('vault-gardener run')} to start your first garden cycle.\n`
    )
  );
}
