import { readdir, access } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { SKIP_DIRS } from '../constants.js';
import { walkMarkdownFiles } from '../utils/fs.js';

export interface FolderMap {
  inbox?: string;
  journal?: string;
  projects?: string;
  roles?: string;
  resources?: string;
  people?: string;
  orgs?: string;
  playbooks?: string;
  sources?: string;
  mocs?: string;
  archive?: string;
  templates?: string;
}

export interface JournalStructure {
  hasYearFolders: boolean;
  subfolders: {
    yearly?: string;
    quarterly?: string;
    monthly?: string;
    weekly?: string;
    daily?: string;
  };
  namingPattern: 'iso-date' | 'custom' | 'unknown';
}

export interface VaultScanResult {
  preset: string | null;
  confidence: number;
  detected: FolderMap;
  journalStructure: JournalStructure;
  totalNotes: number;
  tool: string | null;
}

const PARA_PLUS_PATTERNS: Record<string, keyof FolderMap> = {
  '00-inbox': 'inbox',
  '01-journal': 'journal',
  '02-projects': 'projects',
  '03-roles': 'roles',
  '04-resources': 'resources',
  '05-people': 'people',
  '06-orgs': 'orgs',
  '07-playbooks': 'playbooks',
  '08-sources': 'sources',
  '09-mocs': 'mocs',
  '99-archive': 'archive',
};

const ZETTELKASTEN_FOLDERS = ['inbox', 'zettelkasten', 'references', 'templates'];
const FLAT_FOLDERS = ['inbox', 'notes', 'archive'];

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}\.md$/;
const YEAR_RE = /^(20\d{2})$/;

/** Minimum confidence score to consider a preset match valid. */
const MIN_PRESET_CONFIDENCE = 0.2;

/** Minimum ratio of ISO-dated files to consider the pattern 'iso-date'. */
const ISO_DATE_NAMING_THRESHOLD = 0.5;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function detectTool(vaultPath: string): Promise<string | null> {
  if (await exists(join(vaultPath, '.obsidian'))) return 'obsidian';
  if (await exists(join(vaultPath, '.logseq'))) return 'logseq';
  if (await exists(join(vaultPath, '.foam'))) return 'foam';
  if (await exists(join(vaultPath, '.dendron.yml'))) return 'dendron';
  return null;
}

function detectFolders(topLevelDirs: string[]): FolderMap {
  const detected: FolderMap = {};
  const lowerDirs = new Map(topLevelDirs.map((d) => [d.toLowerCase(), d]));

  // Check PARA+ numbered prefixes first
  for (const [pattern, key] of Object.entries(PARA_PLUS_PATTERNS)) {
    const match = lowerDirs.get(pattern);
    if (match) {
      detected[key] = match;
    }
  }

  // Check plain names as fallback
  const plainMappings: Record<string, keyof FolderMap> = {
    inbox: 'inbox',
    journal: 'journal',
    journals: 'journal',
    projects: 'projects',
    roles: 'roles',
    resources: 'resources',
    people: 'people',
    orgs: 'orgs',
    organizations: 'orgs',
    playbooks: 'playbooks',
    sources: 'sources',
    references: 'sources',
    mocs: 'mocs',
    archive: 'archive',
    archives: 'archive',
    templates: 'templates',
    notes: 'resources',
    zettelkasten: 'resources',
  };

  for (const [name, key] of Object.entries(plainMappings)) {
    if (!detected[key]) {
      const match = lowerDirs.get(name);
      if (match) {
        detected[key] = match;
      }
    }
  }

  return detected;
}

function scorePreset(
  detected: FolderMap,
  topLevelDirs: string[],
): { preset: string | null; confidence: number } {
  const lowerDirs = new Set(topLevelDirs.map((d) => d.toLowerCase()));

  // PARA+ score: count numbered prefix matches
  const paraKeys = Object.keys(PARA_PLUS_PATTERNS);
  const paraMatches = paraKeys.filter((p) => lowerDirs.has(p)).length;
  const paraConfidence = paraMatches / paraKeys.length;

  // Zettelkasten score
  const zetMatches = ZETTELKASTEN_FOLDERS.filter((f) => lowerDirs.has(f)).length;
  const zetConfidence = zetMatches / ZETTELKASTEN_FOLDERS.length;

  // Flat score
  const flatMatches = FLAT_FOLDERS.filter((f) => lowerDirs.has(f)).length;
  const flatConfidence = flatMatches / FLAT_FOLDERS.length;

  const scores = [
    { preset: 'para-plus', confidence: paraConfidence },
    { preset: 'zettelkasten', confidence: zetConfidence },
    { preset: 'flat', confidence: flatConfidence },
  ];

  scores.sort((a, b) => b.confidence - a.confidence);
  const best = scores[0];

  if (best.confidence < MIN_PRESET_CONFIDENCE) {
    return { preset: null, confidence: 0 };
  }

  return { preset: best.preset, confidence: Math.round(best.confidence * 100) / 100 };
}

async function detectJournalStructure(
  vaultPath: string,
  detected: FolderMap,
): Promise<JournalStructure> {
  const result: JournalStructure = {
    hasYearFolders: false,
    subfolders: {},
    namingPattern: 'unknown',
  };

  const journalDir = detected.journal
    ? join(vaultPath, detected.journal)
    : null;

  if (!journalDir || !(await exists(journalDir))) {
    return result;
  }

  let entries;
  try {
    entries = await readdir(journalDir, { withFileTypes: true });
  } catch {
    return result;
  }

  // Check for year folders (2024/, 2025/, 2026/)
  const yearFolders = entries.filter(
    (e) => e.isDirectory() && YEAR_RE.test(e.name),
  );
  result.hasYearFolders = yearFolders.length > 0;

  // Scan for subfolders: daily, weekly, monthly, quarterly, yearly
  const subfoldersToCheck = ['yearly', 'quarterly', 'monthly', 'weekly', 'daily'] as const;
  const searchDirs = result.hasYearFolders
    ? yearFolders.map((yf) => join(journalDir, yf.name))
    : [journalDir];

  for (const searchDir of searchDirs) {
    let subEntries;
    try {
      subEntries = await readdir(searchDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const sub of subfoldersToCheck) {
      if (!result.subfolders[sub]) {
        const match = subEntries.find(
          (e) => e.isDirectory() && e.name.toLowerCase() === sub,
        );
        if (match) {
          result.subfolders[sub] = match.name;
        }
      }
    }
  }

  // Detect naming pattern by scanning for .md files
  const mdFiles = await collectJournalFiles(journalDir, 3);
  if (mdFiles.length > 0) {
    const isoCount = mdFiles.filter((f) => ISO_DATE_RE.test(f)).length;
    if (isoCount / mdFiles.length > ISO_DATE_NAMING_THRESHOLD) {
      result.namingPattern = 'iso-date';
    } else if (mdFiles.length > 0) {
      result.namingPattern = 'custom';
    }
  }

  return result;
}

async function collectJournalFiles(
  dir: string,
  maxDepth: number,
  depth = 0,
): Promise<string[]> {
  if (depth > maxDepth) return [];

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;

    if (entry.isDirectory()) {
      const sub = await collectJournalFiles(
        join(dir, entry.name),
        maxDepth,
        depth + 1,
      );
      files.push(...sub);
    } else if (entry.isFile() && extname(entry.name) === '.md') {
      files.push(entry.name);
    }
  }

  return files;
}

export async function scanVault(vaultPath: string): Promise<VaultScanResult> {
  const entries = await readdir(vaultPath, { withFileTypes: true });
  const topLevelDirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name);

  const detected = detectFolders(topLevelDirs);
  const { preset, confidence } = scorePreset(detected, topLevelDirs);
  const tool = await detectTool(vaultPath);
  const walkResult = await walkMarkdownFiles(vaultPath);
  const totalNotes = walkResult.files.length;
  const journalStructure = await detectJournalStructure(vaultPath, detected);

  return {
    preset,
    confidence,
    detected,
    journalStructure,
    totalNotes,
    tool,
  };
}
