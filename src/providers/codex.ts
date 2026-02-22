import type { Provider, RunOptions, RunResult, ProviderConfig } from './types.js';
import { isCommandAvailable, spawnProvider } from './spawn.js';

const DEFAULT_CONFIG: ProviderConfig = {
  power_model: 'gpt-5.3-codex',
  fast_model: 'gpt-5.3-codex-spark',
  timeout: 600,
};

export function createCodexProvider(config?: Partial<ProviderConfig>): Provider {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  return {
    name: 'codex',

    async isAvailable(): Promise<boolean> {
      return isCommandAvailable('codex');
    },

    async run(opts: RunOptions): Promise<RunResult> {
      const prompt = [
        `Read ${opts.contextFile} for vault context,`,
        `then read ${opts.promptFile} and execute all steps.`,
      ].join(' ');

      const args = [
        '--model', opts.model || cfg.power_model,
        '--approval-mode', 'full-auto',
        '-q', prompt,
      ];

      return spawnProvider('codex', args, {
        cwd: opts.cwd,
        timeout: opts.timeout || cfg.timeout,
        verbose: opts.verbose,
      });
    },
  };
}
