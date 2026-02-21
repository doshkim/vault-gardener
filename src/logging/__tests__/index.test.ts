import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '../index.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'vg-logging-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('createLogger', () => {
  test('writes JSON lines to log file', async () => {
    const logger = await createLogger(tmpDir);
    logger.info('test-event', { context: { key: 'value' } });
    await logger.flush();

    const logPath = join(tmpDir, 'logs', 'gardener.log');
    const content = await readFile(logPath, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(1);

    const entry = JSON.parse(lines[0]);
    expect(entry.level).toBe('info');
    expect(entry.event).toBe('test-event');
    expect(entry.context).toEqual({ key: 'value' });
    expect(entry.timestamp).toBeDefined();
  });

  test('all 4 levels work', async () => {
    const logger = await createLogger(tmpDir);
    logger.info('info-event');
    logger.warn('warn-event');
    logger.error('error-event');
    logger.fatal('fatal-event');
    await logger.flush();

    const logPath = join(tmpDir, 'logs', 'gardener.log');
    const content = await readFile(logPath, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(4);

    const levels = lines.map((l) => JSON.parse(l).level).sort();
    expect(levels).toEqual(['error', 'fatal', 'info', 'warn']);
  });

  test('flush() awaits all pending writes', async () => {
    const logger = await createLogger(tmpDir);
    // Write many entries rapidly
    for (let i = 0; i < 20; i++) {
      logger.info(`event-${i}`);
    }
    await logger.flush();

    const logPath = join(tmpDir, 'logs', 'gardener.log');
    const content = await readFile(logPath, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(20);
  });
});

describe('per-instance isolation', () => {
  test('two loggers do not share pendingWrites', async () => {
    const dir1 = await mkdtemp(join(tmpdir(), 'vg-log1-'));
    const dir2 = await mkdtemp(join(tmpdir(), 'vg-log2-'));

    try {
      const logger1 = await createLogger(dir1);
      const logger2 = await createLogger(dir2);

      logger1.info('logger1-event');
      logger2.info('logger2-event');

      await logger1.flush();
      await logger2.flush();

      const content1 = await readFile(join(dir1, 'logs', 'gardener.log'), 'utf-8');
      const content2 = await readFile(join(dir2, 'logs', 'gardener.log'), 'utf-8');

      expect(content1).toContain('logger1-event');
      expect(content1).not.toContain('logger2-event');
      expect(content2).toContain('logger2-event');
      expect(content2).not.toContain('logger1-event');
    } finally {
      await rm(dir1, { recursive: true, force: true });
      await rm(dir2, { recursive: true, force: true });
    }
  });
});

describe('log rotation', () => {
  test('triggers when file exceeds max size', async () => {
    const logDir = join(tmpDir, 'logs');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(logDir, { recursive: true });

    const logPath = join(logDir, 'gardener.log');
    // Write a file that exceeds our small max
    const bigContent = 'x'.repeat(500);
    await writeFile(logPath, bigContent, 'utf-8');

    // Create logger with tiny max — should trigger rotation
    const logger = await createLogger(tmpDir, { maxLogBytes: 100 });
    logger.info('after-rotation');
    await logger.flush();

    // Old log should be rotated to .1
    const rotatedPath = join(logDir, 'gardener.log.1');
    const rotatedInfo = await stat(rotatedPath);
    expect(rotatedInfo.size).toBeGreaterThan(0);

    // New log should have only our new entry
    const newContent = await readFile(logPath, 'utf-8');
    expect(newContent).toContain('after-rotation');
    expect(newContent).not.toContain('x'.repeat(100));
  });
});
