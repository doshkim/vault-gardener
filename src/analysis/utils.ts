import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Lightweight YAML frontmatter parser — extracts top-level key-value pairs
 * from a --- delimited block. Handles values containing colons (e.g. timestamps).
 */
export function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    // Match key: value where key has no leading whitespace (top-level only)
    // Use first colon followed by space (or end of line) as the separator
    // to correctly handle values containing colons like "2026-03-15T00:00:00"
    const sepMatch = line.match(/^([a-zA-Z_-]+)\s*:\s*(.*)/);
    if (sepMatch) {
      result[sepMatch[1]] = sepMatch[2].trim();
    }
  }
  return result;
}

/** Run a git command with a 5-second timeout, returning empty string on failure. */
export function gitCommand(cwd: string, args: string[]): Promise<string> {
  return execFileAsync('git', args, { cwd, timeout: 5000 })
    .then(r => r.stdout.trim())
    .catch(() => '');
}
