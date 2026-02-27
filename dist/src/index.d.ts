declare function run(argv: string[]): void;

type ProviderName = 'claude' | 'codex' | 'gemini';
type Tier = 'power' | 'fast';
interface Provider {
    name: ProviderName;
    isAvailable(): Promise<boolean>;
    run(opts: RunOptions): Promise<RunResult>;
}
interface RunOptions {
    prompt: string;
    contextFile: string;
    promptFile: string;
    cwd: string;
    timeout: number;
    model: string;
    verbose?: boolean;
    gardenerDir?: string;
}
interface RunResult {
    output: string;
    exitCode: number;
    duration: number;
    reason: string;
}

interface FolderMap {
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
interface JournalStructure {
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
interface VaultScanResult {
    preset: string | null;
    confidence: number;
    detected: FolderMap;
    journalStructure: JournalStructure;
    totalNotes: number;
    tool: string | null;
}
declare function scanVault(vaultPath: string): Promise<VaultScanResult>;

interface PresetConfig {
    name: string;
    folders: FolderMap;
    topics: Record<string, string[]>;
    frontmatter: {
        required: string[];
        statuses: string[];
        types: string[];
    };
}
declare function getPreset(name: string): PresetConfig;
declare function listPresets(): string[];

interface JournalConfig {
    style: {
        weekly: 'structured' | 'narrative';
        monthly: 'structured' | 'narrative';
        quarterly: 'structured' | 'narrative';
        yearly: 'structured' | 'narrative';
    };
    journal_subfolders: {
        yearly: string;
        quarterly: string;
        monthly: string;
        weekly: string;
        daily: string;
    };
}
interface ResilienceConfig {
    queue_enabled: boolean;
    queue_max_size: number;
    queue_max_age_hours: number;
    metrics_timeout_seconds: number;
    metrics_max_files: number;
    lock_heartbeat_interval_seconds: number;
    lock_stale_threshold_seconds: number;
    provider_kill_grace_seconds: number;
    log_max_size_mb: number;
    log_max_backups: number;
    daemon_max_consecutive_failures: number;
    vault_quiet_seconds: number;
    preflight_enabled: boolean;
}
/**
 * Single source of truth for feature flags.
 * Add new features here — FeaturesConfig, FEATURE_KEYS, and DEFAULT_FEATURES
 * are all derived from this object.
 */
declare const FEATURE_DEFAULTS: {
    readonly memory: true;
    readonly entity_auto_linking: true;
    readonly question_tracker: true;
    readonly context_anchoring: true;
    readonly meeting_enhancement: true;
    readonly auto_summary: true;
    readonly backlink_context: true;
    readonly transitive_links: true;
    readonly co_mention_network: true;
    readonly belief_trajectory: true;
    readonly theme_detection: true;
    readonly attention_allocation: true;
    readonly knowledge_gaps: true;
    readonly seasonal_patterns: true;
    readonly goal_tracking: true;
    readonly commitment_tracker: true;
    readonly this_time_last_year: true;
    readonly tag_normalization: true;
    readonly persona: true;
    readonly changelog: true;
    readonly adaptive_batch_sizing: true;
    readonly enrichment_priority: true;
    readonly social_content: true;
    readonly todo_lifecycle: true;
};
type FeaturesConfig = {
    -readonly [K in keyof typeof FEATURE_DEFAULTS]: boolean;
};
type Persona = 'analytical' | 'reflective' | 'coach';
interface GardenerConfig {
    version: number;
    provider: ProviderName;
    tier: Tier;
    persona: Persona;
    folders: Record<string, string>;
    topics: Record<string, string[]>;
    frontmatter: {
        required: string[];
        statuses: string[];
        types: string[];
    };
    schedule: {
        enabled: boolean;
        cron: string;
    };
    auto_grow: Record<string, number>;
    limits: Record<string, number>;
    claude: {
        power_model: string;
        fast_model: string;
        timeout: number;
        max_turns: number;
    };
    codex: {
        power_model: string;
        fast_model: string;
        timeout: number;
    };
    gemini: {
        power_model: string;
        fast_model: string;
        timeout: number;
    };
    journal: JournalConfig;
    social_platforms: string[];
    protected: string[];
    resilience: ResilienceConfig;
    features: FeaturesConfig;
}

interface WeeklyBrief {
    vaultGrowth: number;
    mostActiveAreas: string[];
    approachingDeadlines: {
        title: string;
        deadline: string;
        daysLeft: number;
    }[];
    archiveSuggestions: string[];
}

interface EnrichedNote {
    name: string;
    path: string;
}
interface MovedNote {
    name: string;
    fromPath: string;
    toPath: string;
}

interface VaultDigest {
    generated: string;
    summary: string;
    lastRun: {
        timestamp: string;
        status: 'completed' | 'error' | 'skipped';
        phase: string;
        duration: number;
        provider: string;
    } | null;
    activity: {
        inboxProcessed: number;
        linksCreated: number;
        notesEnriched: EnrichedNote[];
        notesMoved: MovedNote[];
    };
    suggestions: string[];
    weeklyBrief?: WeeklyBrief;
}
declare function generateDigest(vaultPath: string, options?: {
    weekly?: boolean;
    writeToDisk?: boolean;
}): Promise<VaultDigest>;

export { type FolderMap, type GardenerConfig, type JournalStructure, type PresetConfig, type Provider, type RunOptions, type RunResult, type VaultDigest, type VaultScanResult, generateDigest, getPreset, listPresets, run, scanVault };
