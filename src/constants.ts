/** Directories to skip during recursive vault walks. */
export const SKIP_DIRS = new Set([
  '.git',
  '.obsidian',
  '.logseq',
  '.foam',
  '.gardener',
  '.trash',
  'node_modules',
]);
