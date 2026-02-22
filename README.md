# 🌱 vault-gardener

<p align="center"><strong>Your vault is a garden. Stop weeding it by hand.</strong></p>

<p align="center">
  <a href="https://github.com/doshkim/vault-gardener/releases"><img src="https://img.shields.io/github/v/release/doshkim/vault-gardener?style=for-the-badge" alt="GitHub release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
</p>

**vault-gardener** is an AI-powered maintenance pipeline for your markdown knowledge base. Point it at your vault, pick a provider (Claude, Codex, or Gemini), and let it do the grunt work — triaging your inbox, fixing broken links, building Maps of Content, writing journal summaries, and connecting ideas you forgot were related.

It works with Obsidian, Logseq, Foam, Dendron, or literally any folder of `.md` files. No plugins, no lock-in.

Three phases, inspired by actual gardening:

- 🌱 **Seed** — intake and routing. Inbox items get triaged, classified, and planted in the right soil.
- 🪴 **Nurture** — structure repair, knowledge consolidation, link building. Fix the orphans. Connect the dots.
- ✂️ **Tend** — lifecycle management, enrichment, journal generation. Promote what's growing. Prune what's stale.

The gardener **never deletes your notes**. Ever. It only reorganizes, enriches, and connects.

## Features

vault-gardener ships with 23 features, all enabled by default. Every feature can be toggled independently via `features:` in your config.

### Seed phase

| Feature | Config key | Description |
|---------|-----------|-------------|
| Persona | `persona` | Gardener personality (analytical, reflective, coach) shapes tone and recommendations |
| Memory | `memory` | Persistent cross-run context in `.gardener/memory.md` |
| This Time Last Year | `this_time_last_year` | Surfaces journal entries from exactly one year ago |
| Meeting Enhancement | `meeting_enhancement` | Adds action items, key quotes, and follow-ups to meeting notes |
| Question Tracker | `question_tracker` | Extracts substantive questions and tracks resolution |
| Commitment Tracker | `commitment_tracker` | Tracks promises made to people with due dates |
| Changelog | `changelog` | Human-readable run log in `.gardener/changelog.md` |

### Nurture phase

| Feature | Config key | Description |
|---------|-----------|-------------|
| Tag Normalization | `tag_normalization` | Detects synonym, plural, and spelling variants in tags |
| Co-mention Network | `co_mention_network` | Maps who appears alongside whom in journal entries |
| Knowledge Gaps | `knowledge_gaps` | Identifies frequently referenced concepts with no dedicated note |
| Entity Auto-linking | `entity_auto_linking` | Converts plain-text people/org/project names to WikiLinks |
| Backlink Context | `backlink_context` | Adds explanatory sentences to new See Also links |
| Transitive Links | `transitive_links` | Suggests A→C links when A→B→C and A,C share tags |

### Tend phase

| Feature | Config key | Description |
|---------|-----------|-------------|
| Social Content | `social_content` | Drafts platform-specific social media posts from weekly journals |
| Belief Trajectory | `belief_trajectory` | Monthly review of confirmed, contradicted, and retracted beliefs |
| Theme Detection | `theme_detection` | Detects recurring monthly themes not explicitly tagged |
| Attention Allocation | `attention_allocation` | Monthly breakdown of journal mentions by role, project, person |
| Goal Tracking | `goal_tracking` | Evidence-based goal progress using journal mentions and milestones |
| Seasonal Patterns | `seasonal_patterns` | Compares quarterly/yearly rhythms across years |
| Adaptive Batch Sizing | `adaptive_batch_sizing` | Scales processing limits based on vault size |
| Enrichment Priority | `enrichment_priority` | Multi-factor scoring for which notes to enrich first |
| Context Anchoring | `context_anchoring` | Adds origin context to sparse notes from contemporaneous journals |
| Auto-summary | `auto_summary` | Generates TL;DR for notes longer than 1000 words |

## Quick start

```bash
npx vault-gardener init      # detect structure, pick provider, generate config
vault-gardener run            # run full pipeline (seed → nurture → tend)
vault-gardener status         # see what happened
```

That's it. Three commands. Your inbox is clear and your vault has structure.

## How it works

vault-gardener delegates to an AI coding agent that reads your vault, understands its structure, and performs the maintenance you keep putting off. It's a pipeline, not a chatbot — fire and forget.

```
                        ┌─────────────────────────────────────────────┐
                        │              vault-gardener                  │
                        │         Seed → Nurture → Tend               │
                        └─────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────────────────────────────┐
  │  🌱 SEED (Intake & Routing)                                                 │
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
  │  + Question tracker   + Commitment tracker    + This time last year         │
  └──────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
  ┌──────────────────────────────────────────────────────────────────────────────┐
  │  🪴 NURTURE (Structure & Knowledge Building)                                │
  │                                                                              │
  │  Structural Integrity    Consolidator           Playbook Builder             │
  │  • fix orphans           • journals → beliefs   • 3+ journals share          │
  │  • fix broken links      • certainty markers    • steps → playbook           │
  │  • fill frontmatter      • contradiction check                               │
  │                                                                              │
  │  Auto-MOC                Semantic Links                                      │
  │  • generate Maps of      • find related notes                                │
  │    Content for topics     • bidirectional links                               │
  │                                                                              │
  │  Entity auto-linking   + Tag normalization    + Transitive links             │
  │  + Co-mention network  + Knowledge gaps                                      │
  └──────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
  ┌──────────────────────────────────────────────────────────────────────────────┐
  │  ✂️  TEND (Lifecycle & Enrichment)                                           │
  │                                                                              │
  │  Stale Review            Auto-Organize           Enrichment Queue            │
  │  • seed > 14d            • resources → topics    • sparse notes              │
  │  • suggest promotion     • projects → groups     • add links, expand         │
  │  • mark consolidated     • people → clusters     • seed → growing            │
  │                                                                              │
  │  Journal Generation                                                          │
  │  Daily ──▶ Weekly ──▶ Monthly ──▶ Quarterly ──▶ Yearly                      │
  │  Each: retrospective summary + forward-looking goals + recommendations       │
  │                                                                              │
  │  + Belief trajectory   + Theme detection      + Attention allocation         │
  │  + Goal tracking       + Social content                                      │
  └──────────────────────────────────────────────────────────────────────────────┘
```

## Requirements

You need one AI CLI tool installed. Pick your favorite:

| Provider | CLI | Install | Opinion |
|----------|-----|---------|---------|
| Claude | `claude` | [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | **Recommended.** Best at understanding vault context. |
| OpenAI | `codex` | [Codex CLI](https://github.com/openai/codex) | Solid. Fast. |
| Gemini | `gemini` | [Gemini CLI](https://github.com/google-gemini/gemini-cli) | Good for large vaults (long context). |

Each provider has two tiers:

| Provider | ⚡ Power (thorough) | 🏎️ Fast (quick, cheaper) |
|----------|------------------|-----------------------|
| Claude | `opus` | `sonnet` |
| OpenAI | `gpt-5.3-codex` | `gpt-5.3-codex-spark` |
| Gemini | `gemini-3.1-pro-preview` | `gemini-3-flash-preview` |

Start with `fast`. Switch to `power` for deep nurture/tend runs. You'll feel the difference.

## Commands

```bash
vault-gardener init                    # Interactive setup wizard
vault-gardener run [phase]             # Run pipeline (seed|nurture|tend|all)
vault-gardener run seed                # Just intake/routing
vault-gardener run nurture             # Just structure/consolidation
vault-gardener run tend                # Just lifecycle/enrichment
vault-gardener start                   # Start background daemon
vault-gardener stop                    # Stop daemon
vault-gardener status                  # Dashboard — what happened, vault health
vault-gardener recover                 # Fix stale locks, broken state, corrupted files
vault-gardener config get <key>        # Read config value
vault-gardener config set <key> <val>  # Write config value
vault-gardener config regen            # Regenerate prompts from config
```

### Run flags

```bash
--provider <name>    # Override provider for this run
--tier <power|fast>  # Override tier
--dry-run            # Show what would execute, touch nothing
--verbose            # Stream raw LLM output to terminal
--force-unlock       # Nuke a stale lock before running
--no-queue           # Fail immediately if locked (don't queue)
--force              # Skip preflight checks (you're feeling lucky)
--validate           # Run preflight only, then exit
```

## Configuration

After `vault-gardener init`, your config lives at `.gardener/config.yaml`. It's YAML, it's human-readable, it's version-controllable. Edit it directly or use `config set`.

### 📁 Folder mappings

Tell the gardener where things live:

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

### 🏷️ Topic taxonomy

Define keyword clusters. The gardener uses these to auto-organize resources:

```yaml
topics:
  ideas: [ideas, concepts, brainstorm, innovation, creativity]
  finance: [investing, portfolio, markets, stocks, economics, money, budget]
  learning: [learning, education, courses, books, research, science]
  health: [health, wellness, fitness, nutrition, sleep, exercise, mental-health]
  travel: [travel, trips, destinations, itinerary, places]
```

When 3+ notes cluster around keywords not in the taxonomy, a new topic is born.

### 📐 Auto-grow thresholds

When a folder type accumulates enough notes about the same thing, the gardener creates subfolders:

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

Set to `0` to disable. The gardener won't get creative if you don't want it to.

### 🚦 Batch limits

Safety valves. The gardener won't go wild in a single run:

```yaml
limits:
  beliefs_per_run: 10
  playbooks_per_run: 2
  mocs_per_run: 2
  links_per_run: 10
  organize_per_run: 10
  enrich_per_run: 5
```

### 📝 Frontmatter standards

```yaml
frontmatter:
  required: [created, updated, tags, status, type]
  statuses: [seed, growing, evergreen, archived, consolidated]
  types: [journal, project, role, resource, person, org, meeting, idea, playbook, moc]
```

### 🛡️ Protected paths

These directories are sacred. The gardener will never touch them:

```yaml
protected:
  - .gardener
  - .obsidian
  - .git
  - node_modules
  - templates
```

### ⚙️ Resilience

For the operators. Tune timeouts, queue behavior, and failure thresholds:

```yaml
resilience:
  queue_max_size: 10               # max queued runs
  queue_max_age_hours: 24          # auto-expire stale queue entries
  metrics_timeout_seconds: 30      # give up counting links after 30s
  metrics_max_files: 50000         # cap vault walk at 50k files
  lock_stale_threshold_seconds: 300
  provider_kill_grace_seconds: 10  # SIGTERM → SIGKILL grace period
  log_max_size_mb: 10
  log_max_backups: 3
  daemon_max_consecutive_failures: 5
  vault_quiet_seconds: 30          # wait for edits to settle
  preflight_enabled: true
```

### 🎛️ Feature flags

All 23 features are **on by default**. You don't need a `features:` block in your config unless you want to disable something. Features not listed in your config default to `true` — new features added in future versions auto-enable on upgrade.

To disable specific features, add only the ones you want off:

```yaml
# Only list features you want to disable
features:
  social_content: false
  seasonal_patterns: false
```

Available keys (all default to `true`):

```
memory, persona, changelog, question_tracker, commitment_tracker,
this_time_last_year, meeting_enhancement, tag_normalization,
co_mention_network, knowledge_gaps, entity_auto_linking,
backlink_context, transitive_links, social_content, belief_trajectory,
theme_detection, attention_allocation, goal_tracking, seasonal_patterns,
adaptive_batch_sizing, enrichment_priority, context_anchoring, auto_summary
```

The core pipeline (triage, routing, structural integrity, consolidation, linking, enrichment) always runs regardless of feature flags.

## 📓 Journal system

The gardener auto-generates higher-level journal summaries from your daily notes. Write daily, get weekly/monthly/quarterly/yearly for free.

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

| Level | Triggers when | What you get |
|-------|---------------|-------------|
| Weekly | 3+ daily entries | Highlights, Decisions, Learnings, People, Open Items, Social Content, Question Tracker |
| Monthly | 2+ weeklies | Goal Progress, Key Relationships, Gardener Recommendations, Belief Changes, Emerging Themes, Attention Allocation, Goal Progress |
| Quarterly | 2+ monthlies | Quarter Review, Progress vs Themes, Goal Assessment, Seasonal Patterns, Commitment Review |
| Yearly | You set themes | Themes, Goals, Progress Tracker, Key Events, Seasonal Patterns, Annual Goal Evidence |

Two styles — pick per cadence:

**Structured** (default) — scannable bullet points:

```markdown
## Highlights
- Closed Series A term sheet with [[Sequoia]]
- Shipped v2.1 with new graph view

## Gardener Recommendations
- Theme "Build in public" has low evidence — consider scheduling content days
```

**Narrative** — reads like a memo your future self will thank you for:

```markdown
This week saw significant progress on the AI Butler project. Monday's sync
reshaped the Q2 roadmap, culminating in a key decision to consolidate the
API layer.
```

## 🌿 Note lifecycle

Every note has a lifecycle. The gardener respects it:

```
seed → growing → evergreen → archived       (all notes)
seed → consolidated                          (event journals only)
```

| Status | What the gardener does |
|--------|----------------------|
| 🌱 **seed** | Maximum attention. Enriches, fills frontmatter, adds links, organizes. |
| 🪴 **growing** | Active management. Adds links, updates beliefs, tracks goals. |
| 🌳 **evergreen** | Hands off. Only adds back-links. Never touches content. |
| 📦 **archived** | Invisible. Completely ignored. |
| 🔗 **consolidated** | Event journals only. Fully processed. Skipped. |

The gardener **never deletes**, **never auto-archives**, **never demotes** status. Your notes, your decisions.

## ✏️ Customizing prompts

After init, prompts live at `.gardener/prompts/`. These are the actual instructions sent to the AI:

```
.gardener/prompts/
├── garden.md     # Main orchestrator (all phases)
├── seed.md       # Phase 1
├── nurture.md    # Phase 2
└── tend.md       # Phase 3
```

Edit them directly. They're yours. The gardener never auto-overwrites them.

Want to start fresh? `vault-gardener config regen` regenerates from templates.

## 🎭 Presets

Don't want to configure everything? Pick a preset:

| Preset | Structure | Best for |
|--------|-----------|----------|
| **para-plus** | 11 numbered folders (PARA+) | Obsidian power users who like hierarchy |
| **zettelkasten** | inbox, zettelkasten, references | Zettelkasten purists |
| **flat** | inbox, notes, archive | "I just want folders" minimalists |

```bash
vault-gardener init --preset zettelkasten
```

## ⏰ Scheduling

Set it and forget it. The gardener runs on a cron schedule:

```bash
vault-gardener start             # Start node-cron daemon
vault-gardener stop              # Stop daemon
vault-gardener start --install   # Install as system service (launchd/systemd)
```

```yaml
schedule:
  enabled: true
  cron: "0 */4 * * *"    # Every 4 hours
```

The daemon has built-in resilience — exponential backoff on consecutive failures, graceful shutdown, and health monitoring. It won't hammer your vault if things go wrong.

## 📊 Dashboard

```bash
vault-gardener status
```

Shows recent runs, vault health (total notes, inbox count, seed notes), inbox trend sparkline, and daemon status. Use `--json` for machine-readable output.

## 🔒 Preflight checks

Before each run, the gardener sanity-checks your environment:

- ✅ Vault directory accessible (5s timeout — catches unmounted drives)
- ✅ No active editing in inbox (waits for your edits to settle)
- ✅ No sync conflicts (iCloud, Syncthing, Dropbox)
- ✅ Git state clean (no merge conflicts, no detached HEAD)
- ✅ Disk space > 100MB
- ✅ Provider CLI installed and on PATH
- ✅ Prompt files exist

Skip with `--force`. Validate-only with `--validate`.

## 🔧 Recovery

Things happen. Processes crash. Locks go stale. The gardener has a built-in doctor:

```bash
vault-gardener recover
```

Auto-fixes stale locks, orphan heartbeats, expired queue entries, and corrupted metrics files. Reports anything it can't auto-fix (like an active lock held by a running process).

## 📡 Failure notifications

Want to know when a run fails? Set a webhook:

```bash
export GARDENER_WEBHOOK_URL=https://hooks.slack.com/services/...
```

POSTs JSON on failure: phase, duration, exit code, reason, timestamp. No local paths, no secrets.

## 🗂️ What `.gardener/` contains

```
.gardener/
├── config.yaml              # Your config (edit this)
├── config.yaml.bak          # Auto-backup of last good config
├── context.md               # Auto-generated vault context for the LLM
├── memory.md                # Cross-run memory (auto-managed)
├── changelog.md             # Human-readable run log (last 50 entries)
├── prompts/                 # The actual prompts (edit these too)
│   ├── garden.md
│   ├── seed.md
│   ├── nurture.md
│   └── tend.md
├── metrics/
│   └── YYYY-MM-DD.json      # Run metrics by day
├── logs/
│   ├── gardener.log          # Structured JSON log (rotated)
│   └── last-run-output.txt   # Last provider output (10KB cap)
├── queue.json                # Pending queued runs
├── .lock                     # PID lock (runtime only)
├── .lock-heartbeat           # Lock liveness proof
└── .daemon-health            # Daemon status
```

## FAQ

**Does it work without Obsidian?**
Yes. Any folder of `.md` files. Logseq, Foam, Dendron, or a pile of markdown in Dropbox. The gardener doesn't care.

**Does it need git?**
No. Git is optional. Some metrics (notes moved) use git if available. Git commits before runs are *strongly* recommended for safety, but not required.

**Will it delete my notes?**
No. Never. Not even once. The gardener only reorganizes, enriches, and connects.

**Can I use different providers for different runs?**
Yes. `vault-gardener run --provider codex --tier power` overrides per-run.

**How do I undo changes?**
If using git: `git log --oneline` then `git checkout <hash> -- .` and breathe.

**How big of a vault can it handle?**
Tested with 50k+ files. The metrics collector, preflight checks, and file walkers are all bounded with timeouts. If your vault is truly massive, tune the `resilience` config.

**Is it safe to run unattended?**
That's the whole point. Atomic locks, heartbeat-based liveness detection, preflight checks, failure notifications, and exponential backoff in the daemon. Run it on a cron and sleep well.

## License

MIT
