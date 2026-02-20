import { basename } from 'node:path';
import { gitCommand } from './utils.js';

export interface EnrichedNote {
  name: string;
  path: string;
}

export interface MovedNote {
  name: string;
  fromPath: string;
  toPath: string;
}

export interface ActivityData {
  inboxProcessed: number;
  linksCreated: number;
  notesEnriched: EnrichedNote[];
  notesMoved: MovedNote[];
}

/**
 * Analyze recent gardener activity from git history.
 * Looks at commits in the last 24 hours to find enriched/moved notes and link counts.
 */
export async function analyzeActivity(vaultPath: string): Promise<ActivityData> {
  // Recently changed .md files (enriched) — use --name-only for clean paths
  const recentNames = await gitCommand(vaultPath, [
    'log', '--since=24 hours ago', '--author=gardener',
    '--name-only', '--format=', '--', '*.md',
  ]);
  const notesEnriched = parseChangedNotes(recentNames);

  // Moved notes (git rename detection)
  const notesMoved = await parseMoved(vaultPath);

  // Count WikiLinks added in diffs
  const recentDiff = await gitCommand(vaultPath, [
    'log', '--since=24 hours ago', '--author=gardener',
    '-p', '--', '*.md',
  ]);
  const linksCreated = countLinksInDiff(recentDiff);

  return {
    inboxProcessed: 0, // filled by caller from metrics
    linksCreated,
    notesEnriched,
    notesMoved,
  };
}

/** Parse --name-only output into enriched notes list (no rename arrows). */
function parseChangedNotes(nameOutput: string): EnrichedNote[] {
  if (!nameOutput) return [];
  const seen = new Set<string>();
  return nameOutput
    .split('\n')
    .filter(line => line.endsWith('.md'))
    .map(line => {
      const fullPath = line.trim().replace(/\.md$/, '');
      if (!fullPath || seen.has(fullPath)) return null;
      seen.add(fullPath);
      return { name: basename(fullPath), path: fullPath };
    })
    .filter((n): n is EnrichedNote => n !== null)
    .slice(0, 10);
}

async function parseMoved(vaultPath: string): Promise<MovedNote[]> {
  const output = await gitCommand(vaultPath, [
    'log', '--since=24 hours ago', '--author=gardener',
    '--name-status', '--diff-filter=R', '--format=', '--', '*.md',
  ]);
  if (!output) return [];

  return output
    .split('\n')
    .filter(line => line.startsWith('R'))
    .map(line => {
      const parts = line.split('\t');
      if (parts.length < 3) return null;
      const fromPath = parts[1].replace(/\.md$/, '');
      const toPath = parts[2].replace(/\.md$/, '');
      return { name: basename(toPath), fromPath, toPath };
    })
    .filter((n): n is MovedNote => n !== null)
    .slice(0, 10);
}

function countLinksInDiff(diffOutput: string): number {
  const linkPattern = /\[\[.+?\]\]/g;
  let count = 0;
  for (const line of diffOutput.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      const matches = line.match(linkPattern);
      if (matches) count += matches.length;
    }
  }
  return count;
}
