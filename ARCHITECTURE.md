# Architecture

vault-gardener is a TypeScript CLI that orchestrates LLM CLI tools (claude, codex, gemini) to maintain markdown knowledge bases.

## System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     CLI (commander.js)                       │
│  init │ run │ start │ stop │ status │ digest │ config │ recover │
└──────┬──────────────────────────────────────────────────────┘
       │
       ├── config/          Schema, validation, YAML I/O
       ├── providers/       LLM CLI abstraction (claude, codex, gemini)
       ├── prompts/         Handlebars templates → .gardener/prompts/
       ├── scanner/         Vault structure detection & presets
       ├── preflight/       Pre-run safety checks
       ├── lock/            File-based mutex with heartbeat
       ├── queue/           Deferred run queue
       ├── metrics/         Per-run metrics collection & formatting
       ├── analysis/        Post-run analysis (suggestions, weekly brief)
       ├── scheduler/       Cron daemon, launchd, systemd
       ├── notify/          Failure notifications
       └── logging/         Structured JSON logging with rotation
```

## Data Flow

```
init ──► scan vault ──► detect providers ──► build config ──► render prompts
                                                                    │
run  ──► preflight ──► acquire lock ──► collect pre-metrics ────────┤
                                              │                     │
                                        spawn provider CLI ◄────────┘
                                              │
                                        collect post-metrics ──► write metrics
                                              │
                                        generate digest ──► write digest.json
```

## Module Responsibilities

### `src/config/`
- **schema.ts** — `GardenerConfig` type, `ResilienceConfig`, `JournalConfig`, defaults, validation
- **loader.ts** — YAML read/write, deep merge, path resolution, model/timeout resolution
- **index.ts** — barrel re-export

### `src/providers/`
- **types.ts** — Pure type definitions (`Provider`, `RunOptions`, `RunResult`, `ProviderConfig`)
- **spawn.ts** — `spawnProvider()`, `isCommandAvailable()`, `filterEnv()`, exit code mapping
- **claude.ts / codex.ts / gemini.ts** — Provider implementations
- **detect.ts** — Detect available providers on PATH

### `src/prompts/`
- **render.ts** — Embedded Handlebars templates compiled and written to `.gardener/prompts/`

### `src/cli/`
- **index.ts** — Commander program definition and command registration
- **init.ts** — Interactive vault setup wizard
- **run.ts** — Main pipeline execution (seed → nurture → tend)
- **config.ts** — `config get/set/regen` CLI actions
- **start.ts / stop.ts** — Daemon management
- **status.ts** — TUI-lite dashboard
- **digest.ts** — Vault health digest generation
- **recover.ts** — Stale state diagnosis and repair

### `src/scanner/`
- **detect.ts** — Vault structure scanner (folder detection, journal structure, presets)
- **presets.ts** — Built-in vault presets (para-plus, zettelkasten, flat)

### `src/lock/`
File-based mutex preventing concurrent runs. Supports heartbeat monitoring and stale lock detection.

### `src/queue/`
JSON-file queue for deferred runs when the lock is busy.

### `src/metrics/`
- **collector.ts** — Pre/post run metrics, inbox counting, markdown walking
- **format.ts** — Human-readable summary formatting

### `src/preflight/`
Safety checks before each run: vault accessibility, sync conflicts, git state, disk space, provider CLI availability.

### `src/logging/`
Structured JSON logger with file rotation. Each logger instance maintains its own write queue.

## Provider Plugin Interface

Each provider implements the `Provider` interface:

```typescript
interface Provider {
  name: ProviderName;
  isAvailable(): Promise<boolean>;
  run(opts: RunOptions): Promise<RunResult>;
}
```

Providers are thin wrappers that translate `RunOptions` into CLI arguments for their respective tool, then delegate to `spawnProvider()` for process management.

## Configuration

Config lives at `.gardener/config.yaml`. Schema defined in `src/config/schema.ts`. Key sections:

- **provider/tier** — Which LLM CLI and model tier to use
- **folders** — Vault folder structure mapping
- **topics** — Topic taxonomy for routing
- **frontmatter** — Required fields and valid statuses/types
- **schedule** — Cron expression for daemon mode
- **resilience** — Timeouts, limits, queue settings, lock parameters

## Contributing

1. `bun install`
2. `bun run build` — build with tsup
3. `bun run lint` — type-check with tsc
4. Make changes, ensure `bun run build` passes
5. Test with `node dist/bin/vault-gardener.js --help`
