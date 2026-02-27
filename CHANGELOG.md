# Changelog

## [0.1.7] - 2026-02-27

### Added
- `todo_lifecycle` feature flag — manages the lifecycle of `- [ ]` action items across daily, weekly, and monthly journals
- Todo forwarding: unchecked items carry forward from dailies → weeklies → monthlies with `from [[origin]]` links
- Staleness escalation: 3-week nudge, 4-week monthly escalation, 6-week drop with persona-modulated tone
- Deduplication via `from [[...]]` origin links (primary) and fuzzy text match (fallback)
- Weekly section renamed from "Open Items for Next Week" to "Carrying Forward" when feature is enabled
- Memory tracking with `## Todo Lifecycle` section (active forwards + recently resolved tables)
- Commitment cross-reference callout when both `todo_lifecycle` and `commitment_tracker` are enabled
- 8 new tests for todo lifecycle feature toggle, section naming, run report, and memory update

### Changed
- Features config uses single source of truth — `FEATURE_DEFAULTS` derives type, keys, and defaults (was triple-defined)
- `SKIP_DIRS` consolidated to shared `src/constants.ts` (was independently defined in 4 files)
- `walkMarkdownFiles`, `appendJsonArrayFile`, `readJsonArrayDir`, `localDate`, `localTime` extracted to `src/utils/fs.ts`
- `metrics/collector.ts` reduced from 305 → 187 lines using shared utilities
- `reports/store.ts` reduced from 267 → 211 lines using shared utilities
- `scanner/detect.ts` reduced from 319 → 291 lines; magic numbers named as constants
- Persona and Safety template blocks extracted to shared JS constants (single-site maintenance)
- Bundle size reduced from 170KB → 167KB
- 24 feature flags (up from 23)

## [0.1.5] - 2026-02-22

### Fixed
- Output not saving: pass `gardenerDir` through `RunOptions` to all providers so `last-run-output.txt` is written
- Memory not saving: call `renderAll()` before each run to ensure prompts are up-to-date with current config

## [0.1.4] - 2026-02-21

### Changed
- Gemini power model updated from `gemini-3-pro-preview` to `gemini-3.1-pro-preview`

## [0.1.3] - 2026-02-21

### Added
- 23 toggleable feature flags via `features:` config — every feature can be independently enabled/disabled
- `FeaturesConfig` interface, `DEFAULT_FEATURES` constant, and feature validation in schema
- Feature backfill in config loader — missing keys auto-filled with defaults
- Handlebars `{{#if features.xxx}}` conditionals across all 5 templates (context, garden, seed, nurture, tend)
- Features section in README with tables grouped by phase
- Feature flags config section in README with YAML example
- 74 new tests (164 total): feature toggle, isolation, persona rendering, social platforms, config interaction

### Changed
- Pipeline diagram in README updated with new capabilities per phase
- Journal system table in README updated with additional sections per cadence level
- `.gardener/` contents in README updated with `memory.md` and `changelog.md`

## [0.1.2] - 2026-02-20

### Added
- Test infrastructure using `bun:test` — 90 unit tests across 8 modules covering config validation, deep merge, model/timeout resolution, YAML round-trip, exit code mapping, env filtering, preset lookup, vault detection, metrics formatting, template rendering, and structured logging with rotation
- `@types/bun` dev dependency for TypeScript type-checking of test files
- `bun test` script in package.json

### Changed
- `tsconfig.json` types array now includes `"bun"` alongside `"node"`

## [0.1.1] - 2026-02-20

### Added
- Digest command with analysis modules and post-run hook
- ANTHROPIC_API_KEY passthrough to Claude CLI via env denylist

### Changed
- Architectural cleanup for OSS readiness
- README rewritten with resilience features, new commands, and run flags

## [0.1.0] - Initial Release

### Added
- Core vault-gardener pipeline: Seed, Nurture, Tend phases
- Multi-provider support: Claude, Codex, Gemini
- Vault scanning with preset detection (PARA+, Zettelkasten, Flat)
- Handlebars-based prompt rendering
- Structured JSON logging with rotation
- Resilience features: queue, lock, metrics, preflight checks
- YAML-based configuration with validation and auto-repair
- Cron-based scheduling via `daemon` command
