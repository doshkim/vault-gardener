import { describe, expect, test } from 'bun:test';
import { mapExitCode, filterEnv } from '../spawn.js';

describe('mapExitCode', () => {
  test('returns "Success" for exit code 0', () => {
    expect(mapExitCode(0, null)).toBe('Success');
  });

  test('returns "General error" for exit code 1', () => {
    expect(mapExitCode(1, null)).toBe('General error');
  });

  test('returns "Timeout" for exit code 124', () => {
    expect(mapExitCode(124, null)).toBe('Timeout');
  });

  test('returns "Killed (OOM or SIGKILL)" for exit code 137', () => {
    expect(mapExitCode(137, null)).toBe('Killed (OOM or SIGKILL)');
  });

  test('returns "Segfault" for exit code 139', () => {
    expect(mapExitCode(139, null)).toBe('Segfault');
  });

  test('returns generic message for unknown exit code', () => {
    expect(mapExitCode(42, null)).toBe('Exit code: 42');
  });

  test('prioritizes signal over exit code', () => {
    expect(mapExitCode(0, 'SIGTERM')).toBe('Signal: SIGTERM');
    expect(mapExitCode(137, 'SIGKILL')).toBe('Signal: SIGKILL');
  });

  test('returns "Unknown" for null code and null signal', () => {
    expect(mapExitCode(null, null)).toBe('Unknown');
  });
});

describe('filterEnv', () => {
  test('excludes denylist items', () => {
    const original = process.env;
    try {
      process.env = { ...original, GITHUB_TOKEN: 'secret123', PATH: '/usr/bin', HOME: '/home/test' };
      const filtered = filterEnv();
      expect(filtered.GITHUB_TOKEN).toBeUndefined();
      expect(filtered.PATH).toBe('/usr/bin');
      expect(filtered.HOME).toBe('/home/test');
    } finally {
      process.env = original;
    }
  });

  test('excludes SECRET pattern vars', () => {
    const original = process.env;
    try {
      process.env = { ...original, MY_SECRET_VALUE: 'hidden', NORMAL_VAR: 'visible' };
      const filtered = filterEnv();
      expect(filtered.MY_SECRET_VALUE).toBeUndefined();
      expect(filtered.NORMAL_VAR).toBe('visible');
    } finally {
      process.env = original;
    }
  });

  test('excludes PASSWORD pattern vars', () => {
    const original = process.env;
    try {
      process.env = { ...original, DB_PASSWORD_PROD: 'pw123', USER: 'testuser' };
      const filtered = filterEnv();
      expect(filtered.DB_PASSWORD_PROD).toBeUndefined();
      expect(filtered.USER).toBe('testuser');
    } finally {
      process.env = original;
    }
  });

  test('excludes PRIVATE_KEY pattern vars', () => {
    const original = process.env;
    try {
      process.env = { ...original, SSH_PRIVATE_KEY: 'key', LANG: 'en_US' };
      const filtered = filterEnv();
      expect(filtered.SSH_PRIVATE_KEY).toBeUndefined();
      expect(filtered.LANG).toBe('en_US');
    } finally {
      process.env = original;
    }
  });

  test('merges extra vars into result', () => {
    const filtered = filterEnv({ CUSTOM_VAR: 'hello', ANOTHER: 'world' });
    expect(filtered.CUSTOM_VAR).toBe('hello');
    expect(filtered.ANOTHER).toBe('world');
  });

  test('extra vars override filtered env', () => {
    const original = process.env;
    try {
      process.env = { ...original, PATH: '/original' };
      const filtered = filterEnv({ PATH: '/overridden' });
      expect(filtered.PATH).toBe('/overridden');
    } finally {
      process.env = original;
    }
  });
});
