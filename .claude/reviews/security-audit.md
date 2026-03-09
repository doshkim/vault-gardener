# Security Audit - 2026-02-19

## Summary
- CRITICAL: 2 | HIGH: 4 | MEDIUM: 5 | LOW: 3

---

## Findings

### [CRITICAL-001] LLM Providers Spawned With Full Auto-Approval and Permissions Bypass

- **Location**: `/Users/valon/dev/pi/vault-gardener/src/providers/claude.ts:28`
- **Also**: `/Users/valon/dev/pi/vault-gardener/src/providers/codex.ts:28`
- **Issue**: The Claude provider passes `--dangerously-skip-permissions` and the Codex provider passes `--approval-mode full-auto`. Both flags grant the spawned LLM process unrestricted filesystem and command execution within the vault's working directory. The spawned process inherits the full parent environment (`{ ...process.env, ...opts.env }` in `types.ts:85`), which includes all environment variables -- API keys, credentials, cloud tokens, SSH agent sockets, and any other secrets present in the user's shell.
- **Impact**: The LLM process operates with the full privilege of the running user. A prompt injection attack via a malicious markdown file in the vault (e.g., a note dropped into the inbox) could instruct the LLM to read `~/.ssh/`, exfiltrate `~/.aws/credentials`, execute arbitrary shell commands, or modify files outside the vault. Since the tool operates over user-authored content that may come from shared vaults, synced folders, or imported sources, the attack surface is real.
- **Fix**:
  1. Filter `process.env` before passing to the child process -- only forward explicitly needed variables (PATH, HOME, ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, etc.). Create an allowlist.
  2. Document the security implications of `--dangerously-skip-permissions` and `full-auto` prominently.
  3. Consider adding a `--sandbox` mode that uses more restrictive permission settings.
  4. Consider using `allowedTools` or workspace-scoped permissions if the provider CLIs support them.
- **Reference**: OWASP A01:2021 Broken Access Control, OWASP A03:2021 Injection

---

### [CRITICAL-002] Webhook URL Lacks Validation -- SSRF via Environment Variable

- **Location**: `/Users/valon/dev/pi/vault-gardener/src/notify/index.ts:13-29`
- **Issue**: `GARDENER_WEBHOOK_URL` is read from the environment and used directly in a `fetch()` POST with no URL validation. The payload includes `vault_path` (the absolute filesystem path). There is no validation that the URL uses HTTPS, points to an external host, or is not a local/internal address. While this is set via environment variable (not user input in the traditional sense), if an attacker can influence the environment (e.g., through a `.env` file in the vault, a compromised CI pipeline, or LLM-driven command execution), they control where sensitive data is sent.
- **Impact**: Server-Side Request Forgery (SSRF). An attacker could set the URL to `http://169.254.169.254/latest/meta-data/` (cloud metadata), `http://localhost:PORT/...` (internal services), or any external endpoint to exfiltrate vault path information and failure details. The payload contains the absolute vault path, phase information, and error details.
- **Fix**:
  ```typescript
  function isValidWebhookUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') return false;
      // Block private/internal IPs
      const hostname = parsed.hostname;
      if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return false;
      if (hostname.startsWith('169.254.') || hostname.startsWith('10.') || hostname.startsWith('192.168.')) return false;
      if (hostname.startsWith('172.') && parseInt(hostname.split('.')[1]) >= 16 && parseInt(hostname.split('.')[1]) <= 31) return false;
      return true;
    } catch {
      return false;
    }
  }
  ```
  Also consider removing `vault_path` from the webhook payload or hashing it.
- **Reference**: OWASP A10:2021 SSRF

---

### [HIGH-001] Entire Process Environment Forwarded to LLM Child Process

- **Location**: `/Users/valon/dev/pi/vault-gardener/src/providers/types.ts:85`
- **Issue**: `spawnProvider` spreads the entire `process.env` into the child process environment: `env: { ...process.env, ...opts.env }`. This exposes every environment variable to the spawned LLM process, which has unrestricted filesystem access (see CRITICAL-001).
- **Impact**: Environment variables commonly contain API keys (`AWS_SECRET_ACCESS_KEY`, `GITHUB_TOKEN`, `DATABASE_URL`), authentication tokens, and other credentials. The LLM child process can access all of these. Combined with `--dangerously-skip-permissions`, the LLM could read and exfiltrate these values.
- **Fix**: Create an explicit allowlist of environment variables needed by each provider:
  ```typescript
  const ENV_ALLOWLIST = ['PATH', 'HOME', 'USER', 'SHELL', 'TERM', 'LANG', 'LC_ALL',
    'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY'];

  function filteredEnv(extra?: Record<string, string>): Record<string, string> {
    const env: Record<string, string> = {};
    for (const key of ENV_ALLOWLIST) {
      if (process.env[key]) env[key] = process.env[key]!;
    }
    return { ...env, ...extra };
  }
  ```
- **Reference**: OWASP A01:2021 Broken Access Control

---

### [HIGH-002] Lock File Race Condition (TOCTOU)

- **Location**: `/Users/valon/dev/pi/vault-gardener/src/lock/index.ts:79-130`
- **Issue**: `acquireLock` performs a check-then-act sequence: it reads the lock file, checks if it is stale, removes it if so, then writes a new lock file. This is a classic Time-of-Check-to-Time-of-Use (TOCTOU) race. Between the stale check and the new lock write, another process could also determine the lock is stale and acquire it simultaneously. While the write uses atomic tmp+rename, the overall acquire operation is not atomic.
- **Impact**: Two concurrent `vault-gardener run` invocations could both acquire the lock and run simultaneously against the same vault. This could cause data corruption in markdown files (both processes moving/editing the same notes), corrupted metrics files, and conflicting git operations.
- **Fix**: Use an OS-level atomic lock mechanism. Options:
  1. Use `O_EXCL` (exclusive create) flag via `fs.open(path, 'wx')` which atomically fails if the file exists.
  2. Use `proper-lockfile` or `lockfile` npm package which uses `O_EXCL` + stale detection.
  3. Use `flock()` via native addon for true advisory file locking.
  ```typescript
  import { open } from 'node:fs/promises';

  async function atomicLockCreate(path: string, info: LockInfo): Promise<void> {
    const fd = await open(path, 'wx'); // fails if exists
    await fd.writeFile(JSON.stringify(info, null, 2));
    await fd.close();
  }
  ```
- **Reference**: CWE-367 TOCTOU Race Condition

---

### [HIGH-003] PID Reuse Attack in Lock and Daemon Management

- **Location**: `/Users/valon/dev/pi/vault-gardener/src/lock/index.ts:34-41`
- **Also**: `/Users/valon/dev/pi/vault-gardener/src/scheduler/daemon.ts:100-101,114`
- **Also**: `/Users/valon/dev/pi/vault-gardener/src/cli/recover.ts:9-16`
- **Issue**: `isPidAlive` uses `process.kill(pid, 0)` to check if a process is alive. PIDs are recycled by the OS. A stale lock or daemon PID file could reference a PID that has been reassigned to a completely unrelated process. `stopDaemon` sends `SIGTERM` to whatever process holds the PID read from the file, without verifying it is actually a vault-gardener process.
- **Impact**:
  1. **Lock bypass**: If the PID in the lock file was recycled to an unrelated process, `isPidAlive` returns `true`, and the lock appears valid when it is not -- blocking legitimate runs indefinitely.
  2. **Process kill**: `stopDaemon` could send SIGTERM to an unrelated process (database, web server, etc.), causing service disruption.
- **Fix**:
  1. Store additional process identity in the lock/PID file (e.g., process start time, command name, or a random nonce).
  2. Before sending signals, verify the target process name matches expectations (e.g., read `/proc/<pid>/cmdline` on Linux or use `ps -p <pid> -o command=`).
  3. Consider using a secondary verification mechanism (heartbeat file freshness + PID check together).
- **Reference**: CWE-362 Race Condition, CWE-283 Unverified Ownership

---

### [HIGH-004] Daemon Worker Accepts Arbitrary Cron Expression and Vault Path from argv

- **Location**: `/Users/valon/dev/pi/vault-gardener/src/scheduler/daemon-worker.ts:13`
- **Also**: `/Users/valon/dev/pi/vault-gardener/src/scheduler/daemon.ts:69`
- **Issue**: The daemon worker reads `vaultPath` and `cronExpression` directly from `process.argv` without validation. `startDaemon` passes these as arguments to `fork()`. While the cron expression is validated in `config.ts:137-141`, that validation happens in a different code path (config loading) and is not enforced at the daemon-worker entry point. A malicious or malformed cron expression could cause unexpected scheduling behavior. The `vaultPath` is used directly as `cwd` and to construct file paths without any sanitization or verification that it is a valid vault directory.
- **Impact**: If the daemon worker is invoked directly (not through the CLI), arbitrary paths could be targeted. A path traversal value for `vaultPath` could cause the daemon to operate on and write files (logs, health, lock files) into arbitrary directories.
- **Fix**:
  1. Validate `cronExpression` in the daemon worker using `node-cron`'s `validate()` before scheduling.
  2. Validate `vaultPath` -- check that it exists, is a directory, and contains a `.gardener` subdirectory.
  3. Resolve `vaultPath` to an absolute canonical path using `path.resolve()` and `fs.realpath()`.
- **Reference**: OWASP A03:2021 Injection, CWE-22 Path Traversal

---

### [MEDIUM-001] Information Disclosure via Webhook Payload

- **Location**: `/Users/valon/dev/pi/vault-gardener/src/notify/index.ts:28`
- **Also**: `/Users/valon/dev/pi/vault-gardener/src/cli/run.ts:244`
- **Issue**: The webhook payload includes `vault_path` (the absolute filesystem path of the vault) and error `reason` strings. The `vault_path` reveals the user's home directory structure, username, and system layout. Error reasons may contain provider output snippets.
- **Impact**: Information disclosure to the webhook recipient. If the webhook URL is misconfigured or compromised, an attacker learns the filesystem layout of the machine. This aids further attacks.
- **Fix**: Remove `vault_path` from the payload, or replace it with a hash/identifier. Sanitize error reasons to remove filesystem paths.
- **Reference**: OWASP A01:2021 Broken Access Control, CWE-200 Information Exposure

---

### [MEDIUM-002] Structured Log Files May Contain Sensitive Paths and Error Details

- **Location**: `/Users/valon/dev/pi/vault-gardener/src/logging/index.ts:37-46`
- **Issue**: The logger writes structured JSON to disk. Log entries can include `error.stack` (in verbose mode), `context` objects containing file paths, PID numbers, vault paths, and provider output. The log file at `.gardener/logs/gardener.log` is written with default permissions (umask-dependent) and has only basic rotation (single `.1` backup).
- **Impact**: If the vault is synced (Dropbox, iCloud, OneDrive), the log files are synced too, potentially exposing internal error details, stack traces, and filesystem paths to cloud providers and shared folder recipients.
- **Fix**:
  1. Write log files with restrictive permissions (`0o600`).
  2. Add `.gardener/logs/` to sync-exclude patterns in documentation.
  3. Consider adding a `log_sensitive` config option to control whether paths are included in logs.
  4. Sanitize paths in log entries (replace home directory with `~`).
- **Reference**: CWE-532 Information Exposure Through Log Files

---

### [MEDIUM-003] configSet Allows Arbitrary Key Injection via Dot Notation

- **Location**: `/Users/valon/dev/pi/vault-gardener/src/cli/config.ts:229-238,260-277`
- **Issue**: `configSet` uses `setNestedValue` to write any dot-notation key to the config object. There is no allowlist of valid configuration keys. A user (or automated process) could set keys like `__proto__.polluted`, `constructor.prototype.x`, or inject arbitrary nested objects like `schedule.cron` to a value that passes the `configSet` auto-parsing but creates unexpected behavior. While JavaScript object spread does not typically allow `__proto__` pollution through bracket assignment, the lack of key validation means arbitrary config keys can be persisted, potentially causing issues in future code that reads the config.
- **Impact**: Configuration corruption. Setting unexpected keys could cause runtime errors or behavioral changes. The auto-parsing of "true"/"false"/integers at line 266-268 could also cause type confusion (e.g., setting `provider` to a numeric value).
- **Fix**:
  1. Validate the key against a set of known valid configuration paths before setting.
  2. Add explicit `__proto__` and `constructor` checks in `setNestedValue`.
  3. Re-validate the config after modification using `validateConfig`.
  ```typescript
  const VALID_CONFIG_KEYS = new Set(['provider', 'tier', 'schedule.enabled', 'schedule.cron', ...]);
  if (!VALID_CONFIG_KEYS.has(key)) {
    console.error(`Unknown config key: ${key}`);
    process.exit(1);
  }
  ```
- **Reference**: CWE-1321 Prototype Pollution, OWASP A03:2021 Injection

---

### [MEDIUM-004] Queue and Lock File Operations Lack File Permission Restrictions

- **Location**: `/Users/valon/dev/pi/vault-gardener/src/queue/index.ts:39-41`
- **Also**: `/Users/valon/dev/pi/vault-gardener/src/lock/index.ts:99`
- **Also**: `/Users/valon/dev/pi/vault-gardener/src/metrics/collector.ts:262`
- **Issue**: All `writeFile` calls throughout the codebase use default file permissions (determined by umask, typically `0o644`). Lock files, queue files, metrics, and log files are all world-readable on multi-user systems. The lock file contains the PID and hostname. The metrics files contain vault usage statistics. The queue files contain phase/provider information.
- **Impact**: On shared systems, other users can read the lock/queue/metrics files, learning about vault structure, usage patterns, and when the gardener is running. They could also observe the PID for timing attacks on the lock mechanism.
- **Fix**: Use restrictive permissions:
  ```typescript
  await writeFile(path, data, { encoding: 'utf-8', mode: 0o600 });
  ```
- **Reference**: CWE-732 Incorrect Permission Assignment

---

### [MEDIUM-005] Provider Output Written to Disk Without Sanitization

- **Location**: `/Users/valon/dev/pi/vault-gardener/src/providers/types.ts:151-158`
- **Issue**: `spawnProvider` writes the raw provider output (last 10KB) to `.gardener/logs/last-run-output.txt`. This output comes directly from the LLM process and could contain anything -- including sensitive information the LLM read from the filesystem, API keys it encountered, or deliberately crafted escape sequences (terminal injection).
- **Impact**: Sensitive data exfiltration by persistence. If the LLM reads credentials or sensitive files, that content is captured and persisted to disk in the logs directory. If the vault is synced, this data propagates to cloud storage.
- **Fix**:
  1. Strip ANSI escape sequences from output before writing.
  2. Set restrictive file permissions (`0o600`) on the output file.
  3. Consider making output capture opt-in (only in verbose/debug mode).
  4. Document that `.gardener/logs/` may contain sensitive output.
- **Reference**: CWE-532 Information Exposure Through Log Files

---

### [LOW-001] No HTTPS Enforcement on Webhook

- **Location**: `/Users/valon/dev/pi/vault-gardener/src/notify/index.ts:24`
- **Issue**: The webhook POST is made to whatever URL is in `GARDENER_WEBHOOK_URL` with no protocol check. If the user sets an `http://` URL, the failure notification (including vault path) is sent in cleartext.
- **Impact**: Network eavesdroppers could observe failure notifications containing filesystem paths and error details.
- **Fix**: Warn or reject non-HTTPS webhook URLs. At minimum, log a warning when HTTP is used.
- **Reference**: OWASP A02:2021 Cryptographic Failures

---

### [LOW-002] Recursive Directory Deletion in Recovery Without Confirmation

- **Location**: `/Users/valon/dev/pi/vault-gardener/src/cli/recover.ts:101`
- **Issue**: `recoverCommand` calls `rm(tmpDir, { recursive: true, force: true })` on `.gardener.tmp/` without user confirmation. While the path is constructed from `gardenerDir` (which is `.gardener`), the hardcoded path `.gardener.tmp` is joined relative to it. If `getGardenerDir` were to return an unexpected value, this could delete unintended directories.
- **Impact**: Low risk of data loss. The path is tightly scoped, but the `force: true` flag suppresses errors that might indicate something unexpected is happening.
- **Fix**: Add a confirmation prompt before recursive deletion, or at minimum validate that the target directory is inside the expected gardener directory. Log the exact path being deleted.
- **Reference**: CWE-73 External Control of File Name or Path

---

### [LOW-003] .gitignore Does Not Exclude Sensitive Gardener Artifacts

- **Location**: `/Users/valon/dev/pi/vault-gardener/.gitignore`
- **Issue**: The `.gitignore` only contains `node_modules/`, `dist/`, `*.tsbuildinfo`, and `.DS_Store`. It does not exclude `.env`, `.gardener/logs/`, or `.gardener-last-run.md`. If a user's vault is also a git repository (common pattern), these files could be accidentally committed.
- **Impact**: Log files containing error details, run metadata, and potentially sensitive provider output could be committed to version control and pushed to public repositories.
- **Fix**: Add to `.gitignore`:
  ```
  .env
  .env.*
  .gardener/logs/
  .gardener-last-run.md
  ```
  Also document in README that users should add `.gardener/logs/` to their vault's `.gitignore`.
- **Reference**: CWE-200 Information Exposure

---

## Architecture Notes (Not Findings)

**Positive security patterns observed:**
- Atomic file writes (tmp + rename) used consistently for config, metrics, queue, lock, and health files.
- `execFileSync` used instead of `exec`/`execSync` in preflight, avoiding shell injection (arguments are passed as arrays).
- Provider commands use `spawn` with argument arrays, not shell strings.
- Output buffer capped at 10KB to prevent memory exhaustion.
- Symlinks explicitly skipped during directory walks (prevents symlink-following attacks).
- Lock heartbeat mechanism provides defense against stale locks.
- Timeout handling with SIGTERM->SIGKILL escalation for hung providers.
- `node-cron` validation used for cron expressions (in the config path).
- Detached process groups with negative PID kills ensure child process trees are cleaned up.
