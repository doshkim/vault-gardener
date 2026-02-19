import type { FolderMap } from './detect.js';

export interface PresetConfig {
  name: string;
  folders: FolderMap;
  topics: Record<string, string[]>;
  frontmatter: {
    required: string[];
    statuses: string[];
    types: string[];
  };
}

const PRESETS: Record<string, PresetConfig> = {
  'para-plus': {
    name: 'para-plus',
    folders: {
      inbox: '00-inbox',
      journal: '01-journal',
      projects: '02-projects',
      roles: '03-roles',
      resources: '04-resources',
      people: '05-people',
      orgs: '06-orgs',
      playbooks: '07-playbooks',
      sources: '08-sources',
      mocs: '09-mocs',
      archive: '99-archive',
      templates: 'templates',
    },
    topics: {
      'ai-tech': ['ai', 'machine-learning', 'llm', 'deep-learning', 'nlp', 'robotics'],
      neuroscience: ['brain', 'cognition', 'consciousness', 'neuroplasticity'],
      complexity: ['complex-systems', 'emergence', 'networks', 'chaos-theory'],
      space: ['astronomy', 'astrophysics', 'space-exploration', 'cosmology'],
      energy: ['renewable', 'nuclear', 'fusion', 'battery', 'grid'],
      quantum: ['quantum-computing', 'quantum-mechanics', 'quantum-information'],
      longevity: ['aging', 'lifespan', 'senescence', 'longevity-research'],
      health: ['nutrition', 'exercise', 'sleep', 'mental-health', 'biohacking'],
      psychology: ['behavior', 'motivation', 'decision-making', 'habits'],
      philosophy: ['epistemology', 'ethics', 'metaphysics', 'stoicism'],
      finance: ['investing', 'markets', 'economics', 'crypto', 'venture-capital'],
      learning: ['pedagogy', 'spaced-repetition', 'meta-learning', 'memory'],
      parenting: ['child-development', 'education', 'family'],
      strategy: ['business-strategy', 'leadership', 'management', 'operations'],
      music: ['piano', 'composition', 'music-theory', 'practice'],
    },
    frontmatter: {
      required: ['created', 'updated', 'tags', 'status', 'type'],
      statuses: ['seed', 'growing', 'evergreen', 'archived', 'consolidated'],
      types: [
        'journal',
        'project',
        'role',
        'resource',
        'person',
        'org',
        'meeting',
        'idea',
        'playbook',
        'moc',
        'source',
      ],
    },
  },

  zettelkasten: {
    name: 'zettelkasten',
    folders: {
      inbox: 'inbox',
      resources: 'zettelkasten',
      sources: 'references',
      projects: 'projects',
      templates: 'templates',
    },
    topics: {
      ideas: ['concept', 'hypothesis', 'insight'],
      literature: ['book', 'paper', 'article'],
      permanent: ['synthesis', 'principle', 'framework'],
      projects: ['deliverable', 'output', 'milestone'],
    },
    frontmatter: {
      required: ['created', 'updated', 'tags', 'status', 'type'],
      statuses: ['fleeting', 'literature', 'permanent', 'archived'],
      types: ['fleeting', 'literature', 'permanent', 'project', 'index'],
    },
  },

  flat: {
    name: 'flat',
    folders: {
      inbox: 'inbox',
      archive: 'archive',
    },
    topics: {
      ideas: ['idea', 'thought', 'brainstorm'],
      reference: ['note', 'snippet', 'bookmark'],
    },
    frontmatter: {
      required: ['created', 'tags'],
      statuses: ['draft', 'done', 'archived'],
      types: ['note', 'idea', 'reference'],
    },
  },
};

export function getPreset(name: string): PresetConfig {
  const preset = PRESETS[name];
  if (!preset) {
    const available = Object.keys(PRESETS).join(', ');
    throw new Error(`Unknown preset "${name}". Available: ${available}`);
  }
  return preset;
}

export function listPresets(): string[] {
  return Object.keys(PRESETS);
}
