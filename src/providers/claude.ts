import type { Provider, RunOptions, RunResult, ProviderConfig } from './types.js';
import { isCommandAvailable, spawnProvider } from './spawn.js';

const DEFAULT_CONFIG: ProviderConfig = {
  power_model: 'opus',
  fast_model: 'sonnet',
  timeout: 600,
  max_turns: 50,
};

export function createClaudeProvider(config?: Partial<ProviderConfig>): Provider {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  return {
    name: 'claude',

    async isAvailable(): Promise<boolean> {
      return isCommandAvailable('claude');
    },

    async run(opts: RunOptions): Promise<RunResult> {
      const prompt = [
        `Read ${opts.contextFile} for vault context,`,
        `then read ${opts.promptFile} and execute all steps.`,
      ].join(' ');

      const args = [
        '--dangerously-skip-permissions',
        '--model', opts.model || cfg.power_model,
        '--max-turns', String(cfg.max_turns),
        '-p', prompt,
      ];

      return spawnProvider('claude', args, {
        cwd: opts.cwd,
        timeout: opts.timeout || cfg.timeout,
        verbose: opts.verbose,
        gardenerDir: opts.gardenerDir,
        // ANTHROPIC_API_KEY is on the env denylist (prevents leaking secrets to LLMs)
        // but Claude CLI needs it for authentication — pass it explicitly
        env: process.env.ANTHROPIC_API_KEY
          ? { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY }
          : undefined,
      });
    },
  };
}
