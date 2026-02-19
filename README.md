# vault-gardener

AI-powered vault maintenance pipeline for markdown knowledge bases. Works with Obsidian, Logseq, Foam, Dendron, or any folder of `.md` files.

Three phases keep your vault organized:

**Seed** — intake and routing (inbox → journals + semantic folders)
**Nurture** — structure repair, knowledge consolidation, link building
**Tend** — lifecycle management, organization, enrichment

## Quick Start

```bash
# In your vault directory
npx vault-gardener init     # Detect structure, pick provider, generate config
vault-gardener run           # Run full pipeline
vault-gardener status        # View run history and vault health
```

## How It Works

vault-gardener delegates to an AI coding agent (Claude, Codex, or Gemini CLI) which reads your vault, understands its structure, and performs maintenance tasks.

```
                        ┌─────────────────────────────────────────────┐
                        │              vault-gardener                  │
                        │         Seed → Nurture → Tend               │
                        └─────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────────────────────────────┐
  │  SEED (Intake & Routing)                                                     │
  │                                                                              │
  │  ┌─────────┐    ┌──────────┐    ┌──────────────────┐    ┌───────────────┐   │
  │  │  Inbox   │───▶│  Triage  │───▶│  Episodic?       │─Y─▶│  Binder       │   │
  │  │  items   │    │  classify │    │  (journal-like)  │    │  → daily note │   │
  │  └─────────┘    └──────────┘    └──────────────────┘    │  → event jrnl │   │
  │                                          │ N            └───────────────┘   │
  │                                          ▼                                   │
  │                                  ┌──────────────────┐                        │
  │                                  │  Route to folder  │                        │
  │                                  │  by type (people, │                        │
  │                                  │  orgs, resources) │                        │
  │                                  └──────────────────┘                        │
  │                                                                              │
  │  + Salience tagging   + People auto-research   + Document cleanup            │
  └──────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
  ┌──────────────────────────────────────────────────────────────────────────────┐
  │  NURTURE (Structure & Knowledge Building)                                    │
  │                                                                              │
  │  Structural Integrity    Consolidator           Playbook Builder             │
  │  • fix orphans           • journals → beliefs   • 3+ journals share          │
  │  • fix broken links      • certainty markers    • steps → playbook           │
  │  • fill frontmatter      • contradiction check                               │
  │                                                                              │
  │  Auto-MOC                Semantic Links                                      │
  │  • generate Maps of      • find related notes                                │
  │    Content for topics     • bidirectional links                               │
  └──────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
  ┌──────────────────────────────────────────────────────────────────────────────┐
  │  TEND (Lifecycle & Enrichment)                                               │
  │                                                                              │
  │  Stale Review            Auto-Organize           Enrichment Queue            │
  │  • seed > 14d            • resources → topics    • sparse notes              │
  │  • suggest promotion     • projects → groups     • add links, expand         │
  │  • mark consolidated     • people → clusters     • seed → growing            │
  │                                                                              │
  │  Journal Generation                                                          │
  │  Daily ──▶ Weekly ──▶ Monthly ──▶ Quarterly ──▶ Yearly                      │
  │  Each: retrospective summary + forward-looking goals + recommendations       │
  └──────────────────────────────────────────────────────────────────────────────┘
```

## Requirements

One of these AI CLI tools must be installed:

| Provider | CLI | Install |
|----------|-----|---------|
| Claude | `claude` | [Claude Code](https://docs.anthropic.com/en/docs/claude-code) |
| OpenAI | `codex` | [Codex CLI](https://github.com/openai/codex) |
| Gemini | `gemini` | [Gemini CLI](https://github.com/google-gemini/gemini-cli) |

## Model Tiers

Each provider has two tiers:

| Provider | Power (thorough) | Fast (quick, cheaper) |
|----------|------------------|-----------------------|
| Claude | `opus` | `sonnet` |
| OpenAI | `gpt-5.3-codex` | `gpt-5.3-codex-spark` |
| Gemini | `gemini-3-pro-preview` | `gemini-3-flash-preview` |

Set in config:

```yaml
provider: claude
tier: fast       # power | fast
```

## Commands

```bash
vault-gardener init                    # Interactive setup
vault-gardener run [phase]             # Run pipeline (seed|nurture|tend|all)
vault-gardener run seed                # Run only intake/routing
vault-gardener run nurture             # Run only structure/consolidation
vault-gardener run tend                # Run only lifecycle/enrichment
vault-gardener start                   # Start background daemon
vault-gardener stop                    # Stop daemon
vault-gardener status                  # View dashboard
vault-gardener recover                 # Diagnose and fix stale state
vault-gardener config get <key>        # Read config value
vault-gardener config set <key> <val>  # Write config value
vault-gardener config regen            # Regenerate prompts from config
```

### Run Flags

```bash
--provider <name>    # Override provider (claude, codex, gemini)
--tier <power|fast>  # Override tier
--dry-run            # Show what would execute
--verbose            # Stream LLM output
--force-unlock       # Force-release stale lock before running
--no-queue           # Fail immediately if locked (don't queue)
--force              # Skip preflight checks
--validate           # Run preflight checks only, then exit
```

## Configuration

After `vault-gardener init`, config lives at `.gardener/config.yaml`.

### Folder Mappings

Map your vault folders to semantic roles:

```yaml
folders:
  inbox: 00-inbox
  journal: 01-journal
  projects: 02-projects
  roles: 03-roles
  resources: 04-resources
  people: 05-people
  orgs: 06-orgs
  playbooks: 07-playbooks
  sources: 08-sources
  mocs: 09-mocs
  archive: 99-archive
  templates: templates
```

### Topic Taxonomy

Define keyword clusters for auto-organizing resources:

```yaml
topics:
  ideas: [ideas, concepts, brainstorm, innovation, creativity]
  finance: [investing, portfolio, markets, stocks, economics, money, budget]
  learning: [learning, education, courses, books, research, science]
  health: [health, wellness, fitness, nutrition, sleep, exercise, mental-health]
  travel: [travel, trips, destinations, itinerary, places]
```

New topics are auto-created when 3+ notes cluster around keywords not in the taxonomy.

### Auto-Grow Thresholds

Control when the gardener creates subfolders:

```yaml
auto_grow:
  projects: 5     # 5+ project notes sharing a role → subfolder
  roles: 3
  resources: 3    # 3+ notes about "quantum" → resources/quantum/
  people: 5
  orgs: 8
  playbooks: 5
  sources: 5
```

Set to `0` to disable auto-grow for a folder type.

### Batch Limits

Safety limits per run:

```yaml
limits:
  beliefs_per_run: 10
  playbooks_per_run: 2
  mocs_per_run: 2
  links_per_run: 10
  organize_per_run: 10
  enrich_per_run: 5
```

### Frontmatter Standards

```yaml
frontmatter:
  required: [created, updated, tags, status, type]
  statuses: [seed, growing, evergreen, archived, consolidated]
  types: [journal, project, role, resource, person, org, meeting, idea, playbook, moc]
```

### Protected Paths

Never touched by the gardener:

```yaml
protected:
  - .gardener
  - .obsidian
  - .logseq
  - .foam
  - .dendron
  - .vscode
  - .git
  - node_modules
  - templates
```

### Resilience

Tune operational behavior:

```yaml
resilience:
  queue_enabled: true
  queue_max_size: 10
  queue_max_age_hours: 24
  metrics_timeout_seconds: 30
  metrics_max_files: 50000
  lock_heartbeat_interval_seconds: 30
  lock_stale_threshold_seconds: 300
  provider_kill_grace_seconds: 10
  log_max_size_mb: 10
  log_max_backups: 3
  daemon_max_consecutive_failures: 5
  vault_quiet_seconds: 30
  preflight_enabled: true
```

## Journal System

The gardener auto-generates higher-level journal summaries from daily notes.

### Hierarchy

```
{journal}/
└── YYYY/
    ├── yearly/YYYY.md
    ├── quarterly/YYYY-Q1.md
    ├── monthly/YYYY-MM.md
    ├── weekly/YYYY-WNN.md
    └── daily/
        ├── YYYY-MM-DD.md
        └── YYYY-MM-DD Kind - Title.md
```

### Generation Triggers

| Level | Trigger | Content |
|-------|---------|---------|
| Weekly | 3+ daily entries | Highlights, Decisions, Learnings, People, Open Items |
| Monthly | 2+ weekly entries | Highlights, Goal Progress, Key Relationships, Gardener Recommendations |
| Quarterly | 2+ monthly entries | Quarter Review, Progress vs Themes, Goal Assessment, Recommendations |
| Yearly | User sets themes | Themes, Goals, Progress Tracker, Key Events, Learnings |

### Journal Styles

Each cadence can use `structured` (default) or `narrative` style:

```yaml
journal:
  style:
    weekly: structured
    monthly: structured
    quarterly: narrative
    yearly: structured
```

**Structured** — section headers with bullet points, scannable:

```markdown
## Highlights
- Closed Series A term sheet with [[Sequoia]]
- Shipped v2.1 with new graph view

## Decisions
- [[2026-02-17 Decision - API Consolidation|Consolidated API layer]]

## Gardener Recommendations
- Theme "Build in public" has low evidence — consider scheduling content days
```

**Narrative** — third-person prose, reads like a memo:

```markdown
This week saw significant progress on the AI Butler project. Monday's sync
reshaped the Q2 roadmap, culminating in a key decision to consolidate the
API layer. The Series A conversations with Sequoia advanced to term sheet
stage — a major milestone.

## Gardener Recommendations
The "Build in public" theme has limited evidence this week. Consider
scheduling dedicated content creation days.
```

## Note Lifecycle

```
seed → growing → evergreen → archived       (all notes)
seed → consolidated                          (event journals only)
```

| Status | Gardener Behavior |
|--------|-------------------|
| **seed** | Maximum attention. Enriches, fills frontmatter, adds links, organizes. |
| **growing** | Active management. Adds links, updates beliefs, tracks goals. |
| **evergreen** | Passive. Only adds back-links. Never modifies content. |
| **archived** | Ignored completely. |
| **consolidated** | Event journals only. All Store items processed. Skipped. |

The gardener **never deletes**, **never auto-archives**, **never demotes** status.

## Customizing Prompts

After init, prompts live at `.gardener/prompts/`:

```
.gardener/prompts/
├── garden.md     # Main orchestrator
├── seed.md       # Phase 1
├── nurture.md    # Phase 2
└── tend.md       # Phase 3
```

Edit these directly to customize behavior. They are never auto-overwritten.

Run `vault-gardener config regen` to regenerate from templates (overwrites edits).

## Presets

Three built-in presets:

| Preset | Structure | Best For |
|--------|-----------|----------|
| **para-plus** | 11 numbered folders (PARA+) | Obsidian power users |
| **zettelkasten** | inbox, zettelkasten, references | Zettelkasten practitioners |
| **flat** | inbox, notes, archive | Minimal setups |

```bash
vault-gardener init --preset zettelkasten
```

## Scheduling

### Background Daemon

```bash
vault-gardener start           # Start node-cron daemon
vault-gardener stop            # Stop daemon
```

### System Service

```bash
vault-gardener start --install   # Generate launchd (macOS) or systemd (Linux) config
```

Configure cron schedule in config:

```yaml
schedule:
  enabled: true
  cron: "0 */4 * * *"    # Every 4 hours
```

## Dashboard

```bash
vault-gardener status
```

Shows:
- Recent runs (date, phase, duration, items processed, status)
- Vault health (total notes, inbox count, seed notes)
- Inbox trend sparkline
- Daemon status

Use `--json` for machine-readable output.

## Preflight Checks

Before each run, vault-gardener checks:

- Vault directory is accessible (5s timeout)
- No recent edits in inbox (configurable quiet period)
- No sync conflicts (iCloud, Syncthing, etc.)
- Git state is clean (no merge conflicts)
- Sufficient disk space (100MB minimum)
- Provider CLI is installed
- Prompt files exist

Skip with `--force`. Run checks only with `--validate`.

## Recovery

If a run crashes or leaves stale state:

```bash
vault-gardener recover
```

Fixes: stale lock files, orphan heartbeats, stale queue entries, corrupted metrics files. Reports: active locks, staged git changes.

## Failure Notifications

Set a webhook URL to receive failure alerts:

```bash
export GARDENER_WEBHOOK_URL=https://hooks.slack.com/services/...
```

On failure, POSTs JSON with phase, duration, exit code, reason, and timestamp.

## What `.gardener/` Contains

```
.gardener/
├── config.yaml          # Main config (user-editable)
├── config.yaml.bak      # Auto-backup of last good config
├── context.md           # Auto-generated vault context for LLM
├── prompts/
│   ├── garden.md        # Orchestrator prompt
│   ├── seed.md          # Phase 1 prompt
│   ├── nurture.md       # Phase 2 prompt
│   └── tend.md          # Phase 3 prompt
├── metrics/
│   └── YYYY-MM-DD.json  # Run metrics
├── logs/
│   ├── gardener.log     # Structured JSON log
│   └── last-run-output.txt  # Last provider output (10KB cap)
├── queue.json           # Pending queued runs
├── .lock                # PID lock (runtime only)
├── .lock-heartbeat      # Lock liveness heartbeat
└── .daemon-health       # Daemon health status
```

## FAQ

**Does it work without Obsidian?**
Yes. vault-gardener works with any folder of `.md` files.

**Does it need git?**
No. Git is optional. Metrics degrade gracefully without it. Git commits are recommended for safety.

**Will it delete my notes?**
Never. The gardener only reorganizes, enriches, and connects. No information is ever deleted.

**Can I use it with multiple providers?**
Yes. Override per-run with `--provider codex --tier power`.

**How do I undo changes?**
If using git: `git log --oneline` then `git checkout <hash> -- .`

## License

MIT
