# Performance Review - 2026-02-19

## Summary
CRITICAL: 2 | HIGH: 3 | MEDIUM: 4 | LOW: 2
Estimated Impact: For a 100k-file vault, current code adds 5-15s of blocking startup latency
and can consume 1-3 GB of heap during metrics collection. The two critical issues --
sequential seed-note scanning and the unbounded preflight walk -- dominate wall-clock time.

---

## Findings

### [PERF-001] Sequential seed-note scanning reads every file in vault one-by-one (CRITICAL)
- **Location**: `/Users/valon/dev/pi/vault-gardener/src/metrics/collector.ts`:189-193 (collectPreMetrics) and :217-219 (collectPostMetrics)
- **Issue**: `matchesInHead()` is called sequentially in a `for` loop for every `.md` file in the vault. Each call performs a `stat()` + `readFile()` -- two syscalls per file. For a 50k-file vault, this is 100k sequential syscalls. This runs **twice** per `run` command (pre-metrics and post-metrics).
- **Impact**: At ~0.2ms per syscall on SSD, 100k syscalls = ~20s per metrics pass, ~40s total. On network/iCloud-backed vaults this can be 2-5x worse. This is the single largest bottleneck in the pipeline.
- **Current**:
  ```typescript
  // collector.ts:189-193
  let seedCount = 0;
  for (const file of walkResult.files) {
    if (await matchesInHead(file, 'status: seed', 10)) {
      seedCount++;
    }
  }
  ```
- **Optimized**:
  ```typescript
  // Batch like countLinks() already does -- parallel batches of 100
  const SEED_BATCH_SIZE = 100;
  let seedCount = 0;
  for (let i = 0; i < walkResult.files.length; i += SEED_BATCH_SIZE) {
    const batch = walkResult.files.slice(i, i + SEED_BATCH_SIZE);
    const results = await Promise.all(
      batch.map((file) => matchesInHead(file, 'status: seed', 10))
    );
    seedCount += results.filter(Boolean).length;
  }
  ```
  Better yet, combine the seed scan and link count into a single pass to avoid reading each file twice:
  ```typescript
  async function collectFileStats(
    files: string[],
    batchSize = 100,
    timeoutMs = 30_000,
  ): Promise<{ seedCount: number; linkCount: number }> {
    const startTime = performance.now();
    let seedCount = 0;
    let linkCount = 0;
    const linkPattern = /\[\[/g;

    for (let i = 0; i < files.length; i += batchSize) {
      if (performance.now() - startTime > timeoutMs) break;
      const batch = files.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(async (file) => {
          try {
            const info = await stat(file);
            if (info.size > MAX_FILE_SIZE) return { seed: false, links: 0 };
            const content = await readFile(file, 'utf-8');
            const head = content.split('\n').slice(0, 10).join('\n');
            const isSeed = head.includes('status: seed');
            const matches = content.match(linkPattern);
            return { seed: isSeed, links: matches ? matches.length : 0 };
          } catch {
            return { seed: false, links: 0 };
          }
        }),
      );
      for (const r of results) {
        if (r.seed) seedCount++;
        linkCount += r.links;
      }
    }
    return { seedCount, linkCount };
  }
  ```
- **Expected Improvement**: 10-40x speedup on seed scanning (sequential -> batched). Combined single-pass eliminates ~50k redundant file reads. For 50k files: ~20s -> ~2s on SSD.

---

### [PERF-002] detectSyncConflicts() walks entire vault with no bounds (CRITICAL)
- **Location**: `/Users/valon/dev/pi/vault-gardener/src/preflight/index.ts`:58-88
- **Issue**: Unlike `walkMd()` which has `maxFiles` and `timeout` guards, `detectSyncConflicts()` has zero bounds. It recursively walks every directory and every file in the vault. On a 100k+ file vault (especially with deep nesting or many non-markdown files), this blocks startup for seconds. It also traverses into potentially large non-vault directories (anything not starting with `.`).
- **Impact**: For 100k files across 5k directories, this adds 2-5s of blocking startup on SSD, potentially 10-30s on iCloud/network drives. This runs on **every** `run` command invocation.
- **Current**:
  ```typescript
  async function detectSyncConflicts(vaultPath: string, r: PreflightResult): Promise<void> {
    const conflictPatterns = ['sync-conflict', '(conflict)', '.icloud'];

    async function walk(dir: string): Promise<void> {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch { return; }

      for (const entry of entries) {
        const name = entry.name;
        if (name.startsWith('.') && name !== '.icloud') continue;
        const full = join(dir, name);
        if (entry.isDirectory()) {
          await walk(full);  // No depth limit, no timeout, no file count cap
        } else {
          for (const pattern of conflictPatterns) {
            if (name.includes(pattern)) {
              r.warnings.push(`Sync conflict detected: ${full}`);
            }
          }
        }
      }
    }
    await walk(vaultPath);
  }
  ```
- **Optimized**:
  ```typescript
  async function detectSyncConflicts(
    vaultPath: string,
    r: PreflightResult,
    opts?: { maxFiles?: number; timeoutMs?: number; maxDepth?: number },
  ): Promise<void> {
    const conflictPatterns = ['sync-conflict', '(conflict)', '.icloud'];
    const maxFiles = opts?.maxFiles ?? 100_000;
    const timeoutMs = opts?.timeoutMs ?? 10_000;
    const maxDepth = opts?.maxDepth ?? 20;
    const startTime = performance.now();
    let filesChecked = 0;

    // Also skip known non-vault dirs
    const SKIP_DIRS = new Set(['node_modules', '.git', '.obsidian', '.gardener', '.trash']);

    async function walk(dir: string, depth: number): Promise<void> {
      if (depth > maxDepth || filesChecked >= maxFiles) return;
      if (performance.now() - startTime > timeoutMs) return;

      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch { return; }

      for (const entry of entries) {
        if (filesChecked >= maxFiles) return;
        if (performance.now() - startTime > timeoutMs) return;

        const name = entry.name;
        if (name.startsWith('.') && name !== '.icloud') continue;
        if (SKIP_DIRS.has(name)) continue;

        const full = join(dir, name);
        if (entry.isDirectory()) {
          await walk(full, depth + 1);
        } else {
          filesChecked++;
          for (const pattern of conflictPatterns) {
            if (name.includes(pattern)) {
              r.warnings.push(`Sync conflict detected: ${full}`);
            }
          }
        }
      }
    }
    await walk(vaultPath, 0);
  }
  ```
- **Expected Improvement**: Guarantees bounded runtime. Prevents runaway walks into `node_modules` or deeply nested non-vault content. Worst case capped at 10s instead of unbounded.

---

### [PERF-003] matchesInHead() reads entire file then discards most of it (HIGH)
- **Location**: `/Users/valon/dev/pi/vault-gardener/src/metrics/collector.ts`:125-136
- **Issue**: To check if a pattern exists in the first N lines, the function reads the **entire** file content into memory, then splits by newlines, then slices. For a 900KB markdown file, this allocates ~1.8MB (UTF-16 string) just to check 10 lines of frontmatter (~200 bytes). Multiplied by batch concurrency of 100 files, peak memory for a single batch could be ~180MB.
- **Impact**: Memory pressure from reading full files when only needing the first ~500 bytes. For a vault with many large files (e.g., meeting notes, research), this could cause GC pressure and slowdowns.
- **Current**:
  ```typescript
  async function matchesInHead(filePath: string, pattern: string, lines: number): Promise<boolean> {
    try {
      const info = await stat(filePath);
      if (info.size > MAX_FILE_SIZE) return false;
      const content = await readFile(filePath, 'utf-8');  // reads entire file
      const head = content.split('\n').slice(0, lines).join('\n');
      return head.includes(pattern);
    } catch {
      return false;
    }
  }
  ```
- **Optimized**:
  ```typescript
  import { open } from 'node:fs/promises';

  async function matchesInHead(filePath: string, pattern: string, lines: number): Promise<boolean> {
    try {
      const fh = await open(filePath, 'r');
      try {
        // Read only the first 2KB -- more than enough for 10 lines of frontmatter
        const buf = Buffer.alloc(2048);
        const { bytesRead } = await fh.read(buf, 0, 2048, 0);
        const head = buf.toString('utf-8', 0, bytesRead);
        const headLines = head.split('\n').slice(0, lines).join('\n');
        return headLines.includes(pattern);
      } finally {
        await fh.close();
      }
    } catch {
      return false;
    }
  }
  ```
  However, if combined with PERF-001's single-pass approach (where you need the full content for link counting anyway), this optimization applies only when `matchesInHead` is used standalone.
- **Expected Improvement**: ~99% reduction in memory per file read for seed scanning (from full file to 2KB). Eliminates GC pressure from large file reads. If seed scanning is kept separate from link counting, this also improves throughput ~3-5x by reducing I/O.

---

### [PERF-004] Fire-and-forget appendFile on every log entry -- no batching (HIGH)
- **Location**: `/Users/valon/dev/pi/vault-gardener/src/logging/index.ts`:37-46
- **Issue**: Every single log call triggers an independent `appendFile()` syscall. The promise is fire-and-forget (`.catch()` only). During a metrics collection pass that logs many events, or during a provider run with verbose logging, this creates a storm of concurrent unbatched writes to the same file. Each `appendFile` is an `open() + write() + close()` under the hood -- 3 syscalls per log line.
- **Impact**: Under high log volume (e.g., daemon with frequent health writes), this can cause file descriptor exhaustion or write contention. More practically, it wastes ~0.3ms per log entry in syscall overhead. With 50+ log entries per run, this adds ~15ms -- negligible individually but the concurrency pattern is risky.
- **Current**:
  ```typescript
  function writeLine(logPath: string, entry: LogEntry): void {
    const line = JSON.stringify(entry) + '\n';
    appendFile(logPath, line, 'utf-8').catch(() => {
      // fallback to stderr
    });
  }
  ```
- **Optimized**:
  ```typescript
  import { createWriteStream } from 'node:fs';

  // In createLogger():
  const stream = createWriteStream(logPath, { flags: 'a' });

  function writeLine(entry: LogEntry): void {
    const line = JSON.stringify(entry) + '\n';
    if (!stream.write(line)) {
      // Backpressure -- Node will buffer internally and drain
    }
  }

  // Expose a close method on the Logger interface for cleanup
  ```
  Using a persistent write stream eliminates the open/close per entry and enables kernel-level write batching.
- **Expected Improvement**: ~3x fewer syscalls per log entry. Eliminates risk of file descriptor contention under concurrent fire-and-forget writes. Better write throughput via kernel buffering.

---

### [PERF-005] queue.json read+parse+write on every enqueue/dequeue (HIGH)
- **Location**: `/Users/valon/dev/pi/vault-gardener/src/queue/index.ts`:29-42, 49-70, 72-79
- **Issue**: `drainQueue()` calls `dequeue()` in a loop. Each `dequeue()` call reads the entire queue file, parses JSON, removes one entry, serializes back to JSON, writes to tmp, and renames. For a queue of N entries, draining does N full read-parse-serialize-write-rename cycles. With `getQueueDepth()` also doing a full read+parse just to return `.length`.
- **Impact**: For the default max queue size of 10, draining performs 10 full file read/write cycles (20 file operations minimum). Not a bottleneck in isolation but wasteful. The real risk is the `drainQueue` pattern in `run.ts:253` where it runs after every successful run.
- **Current**:
  ```typescript
  export async function drainQueue(
    gardenerDir: string,
    runFn: (entry: QueueEntry) => Promise<void>,
  ): Promise<void> {
    let entry = await dequeue(gardenerDir);  // read + parse + write
    while (entry) {
      await runFn(entry);
      entry = await dequeue(gardenerDir);    // read + parse + write again
    }
  }
  ```
- **Optimized**:
  ```typescript
  export async function drainQueue(
    gardenerDir: string,
    runFn: (entry: QueueEntry) => Promise<void>,
  ): Promise<void> {
    const entries = await readQueue(gardenerDir);
    if (entries.length === 0) return;

    for (const entry of entries) {
      await runFn(entry);
    }

    // Clear the queue in a single write
    await writeQueue(gardenerDir, []);
  }
  ```
  If partial drain safety is needed (e.g., `runFn` might fail):
  ```typescript
  export async function drainQueue(
    gardenerDir: string,
    runFn: (entry: QueueEntry) => Promise<void>,
  ): Promise<void> {
    const entries = await readQueue(gardenerDir);
    if (entries.length === 0) return;

    let processed = 0;
    try {
      for (const entry of entries) {
        await runFn(entry);
        processed++;
      }
    } finally {
      // Write remaining entries back
      const remaining = entries.slice(processed);
      await writeQueue(gardenerDir, remaining);
    }
  }
  ```
- **Expected Improvement**: Reduces file I/O from O(N) reads + O(N) writes to O(1) read + O(1) write. For a full 10-entry queue: 20 file operations -> 2.

---

### [PERF-006] isVaultQuiet() does sequential stat() for every .md in vault root (MEDIUM)
- **Location**: `/Users/valon/dev/pi/vault-gardener/src/preflight/index.ts`:35-56
- **Issue**: Checks vault root for recent file edits by iterating every `.md` file and calling `stat()` one at a time. While it returns early on the first recent edit, the worst case (no recent edits) stats every `.md` file in the root directory. A vault with thousands of files in root would be slow.
- **Impact**: Typically minor since most vaults keep root fairly clean. But for flat vaults with 1000+ files in root: ~200ms. The function only checks root (not recursive), so impact is bounded by root directory size.
- **Current**:
  ```typescript
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const info = await stat(join(vaultPath, entry.name));
    if (now - info.mtimeMs < threshold) {
      r.warnings.push(...);
      return;
    }
  }
  ```
- **Optimized**: Batch the stat calls or use `readdir` with `{ withFileTypes: true }` and check a random sample:
  ```typescript
  // Quick check: sample first 10 .md files instead of all
  const mdFiles = entries.filter(e => e.isFile() && e.name.endsWith('.md'));
  const sample = mdFiles.slice(0, 10);
  const stats = await Promise.all(
    sample.map(e => stat(join(vaultPath, e.name)).catch(() => null))
  );
  for (const info of stats) {
    if (info && now - info.mtimeMs < threshold) {
      r.warnings.push(`Vault has recent edits`);
      return;
    }
  }
  ```
- **Expected Improvement**: Caps worst-case from O(N) sequential stats to O(1) parallel batch. Reduces worst-case from ~200ms to ~20ms for large root directories.

---

### [PERF-007] loadConfig() creates a backup copy on every invocation (MEDIUM)
- **Location**: `/Users/valon/dev/pi/vault-gardener/src/cli/config.ts`:190
- **Issue**: `loadConfig()` calls `copyFile(configPath, bakPath)` unconditionally on every load. `loadConfig()` is called on every CLI command (`run`, `config get`, `config set`, `config regen`). The backup copy is redundant when config has not changed since last backup.
- **Impact**: One unnecessary file copy per CLI invocation (~1-2ms). Minor individually, but the pattern is wasteful. More importantly, it masks a semantic issue: the backup should reflect the last *known good* config, not the last *loaded* config.
- **Current**:
  ```typescript
  // Write backup -- every single load
  await copyFile(configPath, bakPath).catch(() => {});
  ```
- **Optimized**:
  ```typescript
  // Only write backup after successful validation
  if (valid) {
    await copyFile(configPath, bakPath).catch(() => {});
  }
  ```
  Or skip backup entirely in `loadConfig()` and only write it in `saveConfig()` (which already does its own backup).
- **Expected Improvement**: Eliminates one redundant file copy per CLI invocation. More importantly, fixes the semantic issue where a corrupted config would overwrite a good backup.

---

### [PERF-008] Heartbeat does non-atomic write every 30 seconds (MEDIUM)
- **Location**: `/Users/valon/dev/pi/vault-gardener/src/lock/index.ts`:69-72
- **Issue**: `writeHeartbeat()` uses `writeFile()` directly (not atomic tmp+rename like the lock file itself). If the process crashes mid-write, the heartbeat file could be left corrupted or truncated, causing `isStaleWithHeartbeat()` to fail to parse it and potentially triggering false stale detection.
- **Impact**: Low probability but high consequence -- a corrupted heartbeat file during a concurrent run could cause a second instance to steal the lock and run in parallel, potentially corrupting vault data.
- **Current**:
  ```typescript
  async function writeHeartbeat(gardenerDir: string): Promise<void> {
    const data = JSON.stringify({ pid: process.pid, timestamp: new Date().toISOString() });
    await writeFile(heartbeatPath(gardenerDir), data, 'utf-8');  // NOT atomic
  }
  ```
- **Optimized**:
  ```typescript
  async function writeHeartbeat(gardenerDir: string): Promise<void> {
    const data = JSON.stringify({ pid: process.pid, timestamp: new Date().toISOString() });
    const tmp = heartbeatPath(gardenerDir) + '.tmp';
    await writeFile(tmp, data, 'utf-8');
    await rename(tmp, heartbeatPath(gardenerDir));
  }
  ```
- **Expected Improvement**: Prevents corrupted heartbeat files. Consistency fix rather than performance improvement, but included because the current pattern creates a reliability gap that could lead to duplicate runs (which is itself a performance problem -- two provider processes consuming API quota and vault write contention).

---

### [PERF-009] Preflight runs synchronous execFileSync for git checks (MEDIUM)
- **Location**: `/Users/valon/dev/pi/vault-gardener/src/preflight/index.ts`:90-133 (validateGitState) and :135-158 (checkDiskSpace)
- **Issue**: `validateGitState()` makes 3 sequential `execFileSync()` calls. `checkDiskSpace()` makes 1 `execFileSync()` call. `checkProviderCli()` makes 1 `execFileSync()` call. These are all synchronous and block the event loop. Combined, they block for ~50-150ms depending on git repo size and disk speed.
- **Impact**: 5 synchronous subprocess spawns blocking the event loop for ~50-150ms total. Not critical, but these could easily be parallelized as async calls since they're independent.
- **Current**:
  ```typescript
  validateGitState(vaultPath, r);    // 3x execFileSync
  checkDiskSpace(vaultPath, r);      // 1x execFileSync
  checkProviderCli(config.provider, r); // 1x execFileSync
  ```
- **Optimized**: Convert to async `execFile` and run in parallel:
  ```typescript
  await Promise.all([
    validateGitStateAsync(vaultPath, r),
    checkDiskSpaceAsync(vaultPath, r),
    checkProviderCliAsync(config.provider, r),
  ]);
  ```
- **Expected Improvement**: Reduces ~150ms of sequential blocking to ~50ms of parallel async execution. Also unblocks the event loop during subprocess execution.

---

### [PERF-010] Output buffer uses string concatenation + slice (LOW)
- **Location**: `/Users/valon/dev/pi/vault-gardener/src/providers/types.ts`:92-98
- **Issue**: `appendOutput()` concatenates strings then slices to keep the last 10KB. String concatenation in a hot loop (stdout/stderr data events) creates intermediate strings that are immediately discarded. For a provider that outputs heavily (e.g., verbose claude with 100KB+ output), this creates significant GC pressure.
- **Impact**: For a typical provider run producing ~50KB of output with 10KB chunks, this creates ~5 intermediate strings averaging ~30KB each = ~150KB of garbage. Negligible for most runs, but for verbose long-running providers the GC pressure could cause brief latency spikes.
- **Current**:
  ```typescript
  function appendOutput(chunk: string): void {
    outputBuf += chunk;
    if (outputBuf.length > MAX_OUTPUT_BYTES) {
      outputBuf = outputBuf.slice(-MAX_OUTPUT_BYTES);
    }
  }
  ```
- **Optimized**: Use an array-based ring buffer:
  ```typescript
  const chunks: string[] = [];
  let totalLength = 0;

  function appendOutput(chunk: string): void {
    chunks.push(chunk);
    totalLength += chunk.length;
    // Compact when 2x over limit
    if (totalLength > MAX_OUTPUT_BYTES * 2) {
      const joined = chunks.join('');
      chunks.length = 0;
      chunks.push(joined.slice(-MAX_OUTPUT_BYTES));
      totalLength = chunks[0].length;
    }
  }

  // In the close handler:
  const output = chunks.join('').slice(-MAX_OUTPUT_BYTES);
  ```
- **Expected Improvement**: Reduces GC pressure for large outputs. Practical improvement is minimal for typical runs but prevents worst-case latency spikes.

---

### [PERF-011] Double vault walk in a single run (pre + post metrics) (LOW)
- **Location**: `/Users/valon/dev/pi/vault-gardener/src/cli/run.ts`:160 and :195
- **Issue**: `collectPreMetrics()` walks the entire vault and reads all files for seed count + link count. After the provider runs, `collectPostMetrics()` walks and reads the entire vault again. Combined with PERF-001, this means 4 passes over all files per run (2 walks + 2 full-file-read passes).
- **Impact**: The post-metrics walk is inherently necessary (you need post-run state). But the redundancy is in the per-file reading: both pre and post call `matchesInHead()` on every file + `countLinks()` on every file. If the single-pass optimization from PERF-001 is applied, this becomes 2 walks + 2 single-pass reads, which is reasonable.
- **Optimized**: This is mostly addressed by PERF-001's single-pass optimization. Additionally, consider caching the walk result and passing it to `countLinks` / `matchesInHead` rather than having each function independently discover files. The current architecture already does this (walk returns file list, other functions use it).
- **Expected Improvement**: Addressed by PERF-001. No additional optimization needed beyond the single-pass approach.

---

## Aggregate Impact Analysis

### Startup Latency (before provider runs)
| Step | Current (50k files, SSD) | Optimized |
|------|-------------------------|-----------|
| loadConfig + backup copy | ~5ms | ~3ms |
| createLogger + rotation check | ~2ms | ~2ms |
| preflight: vault access | ~1ms | ~1ms |
| preflight: isVaultQuiet | ~50ms (500 root files) | ~5ms |
| preflight: detectSyncConflicts | ~3-5s (100k files) | ~2s (bounded) |
| preflight: git checks (sync) | ~100ms | ~40ms (async) |
| preflight: disk + provider check | ~50ms | parallelized above |
| collectPreMetrics walk | ~2s | ~2s (same) |
| collectPreMetrics seedScan | ~10-20s | ~1-2s (batched+partial read) |
| collectPreMetrics countLinks | ~5-10s | ~0s (merged with seed) |
| **Total before provider** | **~20-37s** | **~5-7s** |

### Memory (peak, 50k files)
| Current | Optimized |
|---------|-----------|
| ~500MB-1.5GB (full file reads x2) | ~50-100MB (partial reads, single pass) |

### I/O Syscalls per run (50k files)
| Current | Optimized |
|---------|-----------|
| ~250k+ (walks + stat + read x2 passes) | ~110k (walks + single-pass batched reads) |

---

## Priority Order for Fixes

1. **[PERF-001] CRITICAL** -- Sequential seed scan. Highest impact, easiest fix (batch + single-pass). Expected improvement: 10-20s per run.
2. **[PERF-002] CRITICAL** -- Unbounded sync conflict walk. Risk of hanging on large/network vaults. Add timeout + maxFiles + maxDepth.
3. **[PERF-003] HIGH** -- Full file read for head check. Reduces memory from GB to MB range. Especially important if PERF-001 keeps separate passes.
4. **[PERF-005] HIGH** -- Queue drain I/O amplification. Simple fix, reduces N file operations to 1.
5. **[PERF-004] HIGH** -- Log write storm. Switch to write stream for correctness under concurrency.
6. **[PERF-009] MEDIUM** -- Sync subprocess calls. Convert to async + parallelize.
7. **[PERF-008] MEDIUM** -- Non-atomic heartbeat. Correctness fix preventing potential duplicate runs.
8. **[PERF-007] MEDIUM** -- Redundant config backup. Only backup after validation passes.
9. **[PERF-006] MEDIUM** -- Sequential root stat. Sample-based approach.
10. **[PERF-010] LOW** -- String concat in output buffer.
11. **[PERF-011] LOW** -- Double walk addressed by PERF-001.
