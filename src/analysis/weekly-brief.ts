import { readdir, readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { parseFrontmatter, gitCommand } from './utils.js';

export interface WeeklyBrief {
  vaultGrowth: number;
  mostActiveAreas: string[];
  approachingDeadlines: { title: string; deadline: string; daysLeft: number }[];
  archiveSuggestions: string[];
}

interface WeeklyBriefOptions {
  vaultPath: string;
  folders: Record<string, string>;
}

export async function generateWeeklyBrief(opts: WeeklyBriefOptions): Promise<WeeklyBrief> {
  const { vaultPath, folders } = opts;

  // Count notes created this week via git (deduplicate by path)
  const weekAgo = await gitCommand(vaultPath, ['log', '--since=7 days ago', '--diff-filter=A', '--name-only', '--format=', '--', '*.md']);
  const newNotes = [...new Set(weekAgo.split('\n').filter(Boolean))];

  // Most active areas by commits per folder
  const weekChanges = await gitCommand(vaultPath, ['log', '--since=7 days ago', '--name-only', '--format=', '--', '*.md']);
  const areaActivity: Record<string, number> = {};
  for (const line of weekChanges.split('\n').filter(Boolean)) {
    const folder = line.split('/')[0];
    if (folder) areaActivity[folder] = (areaActivity[folder] || 0) + 1;
  }
  const mostActiveAreas = Object.entries(areaActivity)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([folder]) => folder);

  // Approaching deadlines
  const approachingDeadlines: WeeklyBrief['approachingDeadlines'] = [];
  try {
    const projectsPath = join(vaultPath, folders.projects ?? '02-projects');
    const entries = await readdir(projectsPath, { recursive: true });
    const mdFiles = (entries as string[]).filter(e => e.endsWith('.md'));

    for (const file of mdFiles) {
      try {
        const content = await readFile(join(projectsPath, file), 'utf-8');
        const fm = parseFrontmatter(content);
        if (!fm.deadline || fm.status === 'archived') continue;
        const deadline = new Date(fm.deadline);
        const daysLeft = Math.ceil((deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        if (daysLeft > 0 && daysLeft <= 14) {
          approachingDeadlines.push({
            title: basename(file, '.md'),
            deadline: fm.deadline,
            daysLeft,
          });
        }
      } catch { continue; }
    }
  } catch { /* no projects folder */ }
  approachingDeadlines.sort((a, b) => a.daysLeft - b.daysLeft);

  // Archive suggestions: seed notes >30 days
  const archiveSuggestions: string[] = [];
  const archiveFolders = ['projects', 'resources']
    .map(k => folders[k])
    .filter((v): v is string => typeof v === 'string' && v.length > 0);
  for (const folder of archiveFolders) {
    try {
      const folderPath = join(vaultPath, folder);
      const entries = await readdir(folderPath, { recursive: true });
      for (const file of (entries as string[]).filter(e => e.endsWith('.md')).slice(0, 50)) {
        try {
          const content = await readFile(join(folderPath, file), 'utf-8');
          const fm = parseFrontmatter(content);
          if (fm.status !== 'seed') continue;
          const created = fm.created ? new Date(fm.created) : null;
          if (created && (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24) > 30) {
            archiveSuggestions.push(basename(file, '.md'));
          }
        } catch { continue; }
      }
    } catch { continue; }
  }

  return {
    vaultGrowth: newNotes.length,
    mostActiveAreas,
    approachingDeadlines: approachingDeadlines.slice(0, 5),
    archiveSuggestions: archiveSuggestions.slice(0, 5),
  };
}
