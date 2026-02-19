import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

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

export const EXIT_CODE_MAP: Record<number, string> = {
  0: 'Success',
  1: 'General error',
  124: 'Timeout',
  137: 'Killed (OOM or SIGKILL)',
  139: 'Segfault',
};

export function mapExitCode(code: number | null, signal: string | null): string {
  if (signal) return `Signal: ${signal}`;
  if (code != null && code in EXIT_CODE_MAP) return EXIT_CODE_MAP[code];
  if (code != null) return `Exit code: ${code}`;
  return 'Unknown';
}

const MAX_OUTPUT_BYTES = 10 * 1024; // 10 KB

// Only pass safe environment variables to spawned provider processes.
// Excludes secrets, credentials, and sensitive tokens from the LLM's environment.
const ENV_DENYLIST = new Set([
  'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN',
  'GITHUB_TOKEN', 'GH_TOKEN', 'GITLAB_TOKEN',
  'NPM_TOKEN', 'NODE_AUTH_TOKEN',
  'DATABASE_URL', 'DB_PASSWORD', 'PGPASSWORD',
  'REDIS_URL', 'REDIS_PASSWORD',
  'SSH_AUTH_SOCK', 'SSH_AGENT_PID',
  'DOCKER_AUTH_CONFIG',
  'SLACK_TOKEN', 'SLACK_WEBHOOK_URL',
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY',
  'STRIPE_SECRET_KEY', 'STRIPE_API_KEY',
  'SECRET_KEY', 'SECRET_KEY_BASE',
  'ENCRYPTION_KEY', 'MASTER_KEY',
]);

function filterEnv(extra?: Record<string, string>): Record<string, string> {
  const filtered: Record<string, string> = {};
  for (const [key, val] of Object.entries(process.env)) {
    if (val == null) continue;
    if (ENV_DENYLIST.has(key)) continue;
    // Also skip anything that looks like a secret
    const upper = key.toUpperCase();
    if (upper.includes('SECRET') || upper.includes('PASSWORD') || upper.includes('PRIVATE_KEY')) continue;
    filtered[key] = val;
  }
  return { ...filtered, ...extra };
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
    killGraceSeconds?: number;
    gardenerDir?: string;
  },
): Promise<RunResult> {
  const start = Date.now();
  const killGrace = opts.killGraceSeconds ?? 5;

  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd: opts.cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: filterEnv(opts.env),
    });

    let outputBuf = '';
    let killed = false;
    let timedOut = false;

    function appendOutput(chunk: string): void {
      outputBuf += chunk;
      // Cap to last MAX_OUTPUT_BYTES
      if (outputBuf.length > MAX_OUTPUT_BYTES) {
        outputBuf = outputBuf.slice(-MAX_OUTPUT_BYTES);
      }
    }

    proc.stdout.on('data', (chunk: Buffer) => {
      const str = chunk.toString('utf-8');
      appendOutput(str);
      if (opts.verbose) process.stdout.write(chunk);
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      const str = chunk.toString('utf-8');
      appendOutput(str);
      if (opts.verbose) process.stderr.write(chunk);
    });

    // Timeout handling with SIGKILL escalation
    const timer = setTimeout(() => {
      timedOut = true;
      if (proc.pid && proc.pid > 0) {
        try {
          process.kill(-proc.pid, 'SIGTERM');
        } catch {
          // process may already be dead
        }

        setTimeout(() => {
          if (!killed && proc.pid && proc.pid > 0) {
            try {
              process.kill(-proc.pid, 'SIGKILL');
            } catch {
              // already dead
            }
          }
        }, killGrace * 1000);
      }
    }, opts.timeout * 1000);

    proc.on('close', async (code, signal) => {
      clearTimeout(timer);
      killed = true;
      const duration = Math.round((Date.now() - start) / 1000);

      const reason = timedOut
        ? `Timeout after ${opts.timeout}s`
        : mapExitCode(code, signal);

      const result: RunResult = {
        output: outputBuf.trim(),
        exitCode: timedOut ? 124 : (code ?? 1),
        duration,
        reason,
      };

      // Preserve last output to file
      if (opts.gardenerDir && outputBuf.length > 0) {
        try {
          const logsDir = join(opts.gardenerDir, 'logs');
          await mkdir(logsDir, { recursive: true });
          await writeFile(join(logsDir, 'last-run-output.txt'), outputBuf.slice(-MAX_OUTPUT_BYTES), 'utf-8');
        } catch {
          // best effort
        }
      }

      resolve(result);
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      killed = true;
      const duration = Math.round((Date.now() - start) / 1000);

      if (timedOut) {
        resolve({
          output: `Process timed out after ${opts.timeout}s`,
          exitCode: 124,
          duration,
          reason: `Timeout after ${opts.timeout}s`,
        });
        return;
      }

      reject(err);
    });
  });
}
