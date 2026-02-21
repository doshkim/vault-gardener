export type ProviderName = 'claude' | 'codex' | 'gemini';
export type Tier = 'power' | 'fast';

export interface Provider {
  name: ProviderName;
  isAvailable(): Promise<boolean>;
  run(opts: RunOptions): Promise<RunResult>;
}

export interface RunOptions {
  prompt: string;
  contextFile: string;
  promptFile: string;
  cwd: string;
  timeout: number;
  model: string;
  verbose?: boolean;
}

export interface RunResult {
  output: string;
  exitCode: number;
  duration: number;
  reason: string;
}

export interface ProviderConfig {
  power_model: string;
  fast_model: string;
  timeout: number;
  max_turns?: number;
}
