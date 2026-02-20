import { readdir, readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { parseFrontmatter } from './utils.js';

interface SuggestionOptions {
  vaultPath: string;
  folders: Record<string, string>;
}

/**
 * Scan vault for actionable suggestions:
 * 1. Old inbox items (>7 days by mtime)
 * 2. Stale growing notes (>30 days since `updated` frontmatter)
 * 3. Approaching deadlines (<14 days from `deadline` frontmatter)
 */
export async function generateSuggestions(opts: SuggestionOptions): Promise<string[]> {
  const suggestions: string[] = [];
  const { vaultPath, folders } = opts;

  // 1. Old inbox items
  try {
    const inboxPath = join(vaultPath, folders.inbox ?? '00-inbox');
    const entries = await readdir(inboxPath, { withFileTypes: true });
    const mdFiles = entries.filter(e => e.isFile() && extname(e.name) === '.md');
    const now = Date.now();
    let oldCount = 0;

    for (const file of mdFiles) {
      try {
        const s = await stat(join(inboxPath, file.name));
        if ((now - s.mtimeMs) / (1000 * 60 * 60 * 24) > 7) oldCount++;
      } catch { continue; }
    }

    if (oldCount > 0) {
      suggestions.push(`${oldCount} item${oldCount > 1 ? 's have' : ' has'} been in inbox for over 7 days`);
    }
  } catch { /* inbox doesn't exist */ }

  // 2. Stale growing notes
  const growingFolders = ['projects', 'roles', 'resources']
    .map(k => folders[k])
    .filter((v): v is string => typeof v === 'string' && v.length > 0);
  let staleGrowing = 0;

  for (const folder of growingFolders) {
    try {
      const folderPath = join(vaultPath, folder);
      const entries = await readdir(folderPath, { recursive: true });
      const mdFiles = (entries as string[]).filter(e => e.endsWith('.md'));

      for (const file of mdFiles.slice(0, 50)) {
        try {
          const content = await readFile(join(folderPath, file), 'utf-8');
          const fm = parseFrontmatter(content);
          if (fm.status !== 'growing') continue;
          const updated = fm.updated ? new Date(fm.updated) : null;
          if (updated && (Date.now() - updated.getTime()) / (1000 * 60 * 60 * 24) > 30) {
            staleGrowing++;
          }
        } catch { continue; }
      }
    } catch { continue; }
  }

  if (staleGrowing > 0) {
    suggestions.push(`${staleGrowing} growing note${staleGrowing > 1 ? 's haven\'t' : ' hasn\'t'} been updated in 30+ days`);
  }

  // 3. Approaching deadlines
  try {
    const projectsPath = join(vaultPath, folders.projects ?? '02-projects');
    const entries = await readdir(projectsPath, { recursive: true });
    const mdFiles = (entries as string[]).filter(e => e.endsWith('.md'));
    let approachingCount = 0;

    for (const file of mdFiles) {
      try {
        const content = await readFile(join(projectsPath, file), 'utf-8');
        const fm = parseFrontmatter(content);
        if (!fm.deadline || fm.status === 'archived') continue;
        const deadline = new Date(fm.deadline);
        const daysLeft = (deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
        if (daysLeft > 0 && daysLeft <= 14) approachingCount++;
      } catch { continue; }
    }

    if (approachingCount > 0) {
      suggestions.push(`${approachingCount} project${approachingCount > 1 ? 's have' : ' has'} deadline${approachingCount > 1 ? 's' : ''} in the next 14 days`);
    }
  } catch { /* no projects folder */ }

  return suggestions;
}
