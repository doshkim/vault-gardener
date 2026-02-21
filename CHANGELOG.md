# Changelog

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
