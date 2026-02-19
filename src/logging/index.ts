import { appendFile, stat, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'fatal';
  event: string;
  phase?: string;
  provider?: string;
  model?: string;
  duration_seconds?: number;
  exitCode?: number;
  error?: { message: string; code?: string; stack?: string };
  context?: Record<string, unknown>;
}

export interface Logger {
  info(event: string, data?: Partial<LogEntry>): void;
  warn(event: string, data?: Partial<LogEntry>): void;
  error(event: string, data?: Partial<LogEntry>): void;
  fatal(event: string, data?: Partial<LogEntry>): void;
  flush(): Promise<void>;
}

const DEFAULT_MAX_LOG_BYTES = 10 * 1024 * 1024; // 10 MB
const DEFAULT_MAX_BACKUPS = 3;
const LOG_DIR = 'logs';
const LOG_FILE = 'gardener.log';

function buildEntry(level: LogEntry['level'], event: string, data?: Partial<LogEntry>): LogEntry {
  return {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...data,
  };
}

// Track pending writes so flush() can await them
let pendingWrites: Promise<void>[] = [];

function writeLine(logPath: string, entry: LogEntry): void {
  const line = JSON.stringify(entry) + '\n';
  const p = appendFile(logPath, line, 'utf-8').catch(() => {
    try {
      process.stderr.write(`[gardener] ${entry.level}: ${entry.event}\n`);
    } catch {
      // last resort: silently discard
    }
  });
  pendingWrites.push(p);
  // Clean up resolved promises periodically
  if (pendingWrites.length > 50) {
    pendingWrites = pendingWrites.filter((pw) => {
      let resolved = false;
      pw.then(() => { resolved = true; });
      return !resolved;
    });
  }
}

async function rotateIfNeeded(logPath: string, maxBytes: number, maxBackups: number): Promise<void> {
  try {
    const info = await stat(logPath);
    if (info.size > maxBytes) {
      // Shift existing backups: .2 -> .3, .1 -> .2, etc.
      for (let i = maxBackups - 1; i >= 1; i--) {
        await rename(`${logPath}.${i}`, `${logPath}.${i + 1}`).catch(() => {});
      }
      await rename(logPath, `${logPath}.1`);
    }
  } catch {
    // file doesn't exist yet, nothing to rotate
  }
}

export async function createLogger(
  gardenerDir: string,
  opts?: { verbose?: boolean; maxLogBytes?: number; maxBackups?: number },
): Promise<Logger> {
  const logsDir = join(gardenerDir, LOG_DIR);
  await mkdir(logsDir, { recursive: true });

  const logPath = join(logsDir, LOG_FILE);
  const maxBytes = opts?.maxLogBytes ?? DEFAULT_MAX_LOG_BYTES;
  const maxBackups = opts?.maxBackups ?? DEFAULT_MAX_BACKUPS;
  await rotateIfNeeded(logPath, maxBytes, maxBackups);

  const verbose = opts?.verbose ?? false;

  function log(level: LogEntry['level'], event: string, data?: Partial<LogEntry>): void {
    const entry = buildEntry(level, event, data);

    // Strip stack from non-verbose unless it's already absent
    if (!verbose && entry.error?.stack) {
      const { stack: _stack, ...rest } = entry.error;
      entry.error = rest;
    }

    writeLine(logPath, entry);
  }

  return {
    info: (event, data) => log('info', event, data),
    warn: (event, data) => log('warn', event, data),
    error: (event, data) => log('error', event, data),
    fatal: (event, data) => log('fatal', event, data),
    async flush() {
      await Promise.all(pendingWrites);
      pendingWrites = [];
    },
  };
}
