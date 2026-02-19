import { spawn } from 'node:child_process';

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
}

export interface ProviderConfig {
  power_model: string;
  fast_model: string;
  timeout: number;
  max_turns?: number;
}

/** Check if a CLI tool exists on PATH. */
export async function isCommandAvailable(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('which', [command], { stdio: 'ignore' });
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

/** Spawn a CLI process and capture output with timeout support. */
export async function spawnProvider(
  command: string,
  args: string[],
  opts: {
    cwd: string;
    timeout: number;
    verbose?: boolean;
    env?: Record<string, string>;
  },
): Promise<RunResult> {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeout * 1000);

  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd: opts.cwd,
      signal: controller.signal,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...opts.env },
    });

    const chunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    proc.stdout.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      if (opts.verbose) {
        process.stdout.write(chunk);
      }
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
      if (opts.verbose) {
        process.stderr.write(chunk);
      }
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      const duration = Math.round((Date.now() - start) / 1000);
      const stdout = Buffer.concat(chunks).toString('utf-8');
      const stderr = Buffer.concat(stderrChunks).toString('utf-8');
      const output = stderr ? `${stdout}\n${stderr}`.trim() : stdout.trim();

      resolve({
        output,
        exitCode: code ?? 1,
        duration,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      const duration = Math.round((Date.now() - start) / 1000);

      if (controller.signal.aborted) {
        resolve({
          output: `Process timed out after ${opts.timeout}s`,
          exitCode: 124,
          duration,
        });
        return;
      }

      reject(err);
    });
  });
}
