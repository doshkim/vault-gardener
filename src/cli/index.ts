import { Command } from 'commander';
import { initCommand } from './init.js';
import { runCommand } from './run.js';
import { startCommand } from './start.js';
import { stopCommand } from './stop.js';
import { statusCommand } from './status.js';
export function run(argv: string[]): void {
  const program = new Command();

  program
    .name('vault-gardener')
    .description('AI-powered vault maintenance pipeline for markdown knowledge bases')
    .version('0.1.0');

  program
    .command('init')
    .description('Interactive setup — detect vault structure, pick provider, generate config')
    .option('--preset <name>', 'Use a preset (para-plus, zettelkasten, flat)')
    .option('--provider <name>', 'Set provider (claude, codex, gemini)')
    .option('--tier <tier>', 'Set tier (power, fast)')
    .option('--no-interactive', 'Skip interactive prompts, use defaults')
    .action(initCommand);

  program
    .command('run')
    .description('Run gardener pipeline')
    .argument('[phase]', 'Phase to run: seed, nurture, tend, or all (default: all)')
    .option('--provider <name>', 'Override config provider')
    .option('--tier <tier>', 'Override tier (power, fast)')
    .option('--dry-run', 'Show what would run without executing')
    .option('--verbose', 'Stream LLM output to terminal')
    .option('--force-unlock', 'Force-release lock before running')
    .option('--no-queue', 'Fail immediately if locked (do not queue)')
    .option('--force', 'Skip preflight checks')
    .option('--validate', 'Run preflight only, then exit')
    .action(runCommand);

  program
    .command('start')
    .description('Start background daemon')
    .option('--install', 'Install as system service (launchd/systemd)')
    .action(startCommand);

  program
    .command('stop')
    .description('Stop background daemon')
    .action(stopCommand);

  program
    .command('status')
    .description('Show TUI dashboard with run history and vault health')
    .option('--json', 'Output as JSON instead of TUI')
    .action(statusCommand);

  program
    .command('digest')
    .description('Generate vault health digest and write .gardener/digest.json')
    .option('--json', 'Output as JSON')
    .option('--weekly', 'Include weekly brief')
    .action(digestAction);

  program
    .command('recover')
    .description('Diagnose and fix stale state (locks, queue, metrics)')
    .action(recoverAction);

  const config = program
    .command('config')
    .description('Manage configuration');

  config
    .command('get')
    .description('Read a config value')
    .argument('<key>', 'Config key (dot notation: provider, tier, folders.inbox)')
    .action(configGetAction);

  config
    .command('set')
    .description('Write a config value')
    .argument('<key>', 'Config key')
    .argument('<value>', 'Config value')
    .action(configSetAction);

  config
    .command('regen')
    .description('Regenerate prompts from config (overwrites .gardener/prompts/)')
    .action(configRegenAction);

  program.parse(argv);
}

async function configGetAction(key: string): Promise<void> {
  const { configGet } = await import('./config.js');
  await configGet(key);
}

async function configSetAction(key: string, value: string): Promise<void> {
  const { configSet } = await import('./config.js');
  await configSet(key, value);
}

async function configRegenAction(): Promise<void> {
  const { configRegen } = await import('./config.js');
  await configRegen();
}

async function digestAction(options: { json?: boolean; weekly?: boolean }): Promise<void> {
  const { digestCommand } = await import('./digest.js');
  await digestCommand(options);
}

async function recoverAction(): Promise<void> {
  const { recoverCommand } = await import('./recover.js');
  await recoverCommand();
}
