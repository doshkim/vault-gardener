import { readFile } from 'node:fs/promises';
import type { Provider, RunOptions, RunResult, ProviderConfig } from './types.js';
import { isCommandAvailable, spawnProvider } from './types.js';

const DEFAULT_CONFIG: ProviderConfig = {
  power_model: 'gemini-2.5-pro',
  fast_model: 'gemini-2.5-flash',
  timeout: 600,
};

export function createGeminiProvider(config?: Partial<ProviderConfig>): Provider {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  return {
    name: 'gemini',

    async isAvailable(): Promise<boolean> {
      return isCommandAvailable('gemini');
    },

    async run(opts: RunOptions): Promise<RunResult> {
      const contextContent = await readFile(opts.contextFile, 'utf-8');

      const prompt = `Read ${opts.promptFile} and execute all steps.`;

      const args = [
        '-m', opts.model || cfg.power_model,
        '-p', prompt,
      ];

      return spawnProvider('gemini', args, {
        cwd: opts.cwd,
        timeout: opts.timeout || cfg.timeout,
        verbose: opts.verbose,
        env: { GEMINI_SYSTEM_MD: contextContent },
      });
    },
  };
}
