var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/providers/spawn.ts
import { spawn } from "child_process";
import { writeFile, mkdir } from "fs/promises";
import { join as join2 } from "path";
function mapExitCode(code, signal) {
  if (signal) return `Signal: ${signal}`;
  if (code != null && code in EXIT_CODE_MAP) return EXIT_CODE_MAP[code];
  if (code != null) return `Exit code: ${code}`;
  return "Unknown";
}
function filterEnv(extra) {
  const filtered = {};
  for (const [key, val] of Object.entries(process.env)) {
    if (val == null) continue;
    if (ENV_DENYLIST.has(key)) continue;
    const upper = key.toUpperCase();
    if (upper.includes("SECRET") || upper.includes("PASSWORD") || upper.includes("PRIVATE_KEY")) continue;
    filtered[key] = val;
  }
  return { ...filtered, ...extra };
}
async function isCommandAvailable(command) {
  return new Promise((resolve) => {
    const proc = spawn("which", [command], { stdio: "ignore" });
    proc.on("close", (code) => resolve(code === 0));
    proc.on("error", () => resolve(false));
  });
}
async function spawnProvider(command, args, opts) {
  const start = Date.now();
  const killGrace = opts.killGraceSeconds ?? 5;
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd: opts.cwd,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: filterEnv(opts.env)
    });
    let outputBuf = "";
    let killed = false;
    let timedOut = false;
    function appendOutput(chunk) {
      outputBuf += chunk;
      if (outputBuf.length > MAX_OUTPUT_BYTES) {
        outputBuf = outputBuf.slice(-MAX_OUTPUT_BYTES);
      }
    }
    proc.stdout.on("data", (chunk) => {
      const str = chunk.toString("utf-8");
      appendOutput(str);
      if (opts.verbose) process.stdout.write(chunk);
    });
    proc.stderr.on("data", (chunk) => {
      const str = chunk.toString("utf-8");
      appendOutput(str);
      if (opts.verbose) process.stderr.write(chunk);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      if (proc.pid && proc.pid > 0) {
        try {
          process.kill(-proc.pid, "SIGTERM");
        } catch {
        }
        setTimeout(() => {
          if (!killed && proc.pid && proc.pid > 0) {
            try {
              process.kill(-proc.pid, "SIGKILL");
            } catch {
            }
          }
        }, killGrace * 1e3);
      }
    }, opts.timeout * 1e3);
    proc.on("close", async (code, signal) => {
      clearTimeout(timer);
      killed = true;
      const duration = Math.round((Date.now() - start) / 1e3);
      const reason = timedOut ? `Timeout after ${opts.timeout}s` : mapExitCode(code, signal);
      const result2 = {
        output: outputBuf.trim(),
        exitCode: timedOut ? 124 : code ?? 1,
        duration,
        reason
      };
      if (opts.gardenerDir && outputBuf.length > 0) {
        try {
          const logsDir = join2(opts.gardenerDir, "logs");
          await mkdir(logsDir, { recursive: true });
          await writeFile(join2(logsDir, "last-run-output.txt"), outputBuf.slice(-MAX_OUTPUT_BYTES), "utf-8");
        } catch {
        }
      }
      resolve(result2);
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      killed = true;
      const duration = Math.round((Date.now() - start) / 1e3);
      if (timedOut) {
        resolve({
          output: `Process timed out after ${opts.timeout}s`,
          exitCode: 124,
          duration,
          reason: `Timeout after ${opts.timeout}s`
        });
        return;
      }
      reject(err);
    });
  });
}
var EXIT_CODE_MAP, MAX_OUTPUT_BYTES, ENV_DENYLIST;
var init_spawn = __esm({
  "src/providers/spawn.ts"() {
    "use strict";
    EXIT_CODE_MAP = {
      0: "Success",
      1: "General error",
      124: "Timeout",
      137: "Killed (OOM or SIGKILL)",
      139: "Segfault"
    };
    MAX_OUTPUT_BYTES = 10 * 1024;
    ENV_DENYLIST = /* @__PURE__ */ new Set([
      "AWS_SECRET_ACCESS_KEY",
      "AWS_SESSION_TOKEN",
      "GITHUB_TOKEN",
      "GH_TOKEN",
      "GITLAB_TOKEN",
      "NPM_TOKEN",
      "NODE_AUTH_TOKEN",
      "DATABASE_URL",
      "DB_PASSWORD",
      "PGPASSWORD",
      "REDIS_URL",
      "REDIS_PASSWORD",
      "SSH_AUTH_SOCK",
      "SSH_AGENT_PID",
      "DOCKER_AUTH_CONFIG",
      "SLACK_TOKEN",
      "SLACK_WEBHOOK_URL",
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "STRIPE_SECRET_KEY",
      "STRIPE_API_KEY",
      "SECRET_KEY",
      "SECRET_KEY_BASE",
      "ENCRYPTION_KEY",
      "MASTER_KEY"
    ]);
  }
});

// src/providers/claude.ts
var claude_exports = {};
__export(claude_exports, {
  createClaudeProvider: () => createClaudeProvider
});
function createClaudeProvider(config) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  return {
    name: "claude",
    async isAvailable() {
      return isCommandAvailable("claude");
    },
    async run(opts) {
      const prompt = [
        `Read ${opts.contextFile} for vault context,`,
        `then read ${opts.promptFile} and execute all steps.`
      ].join(" ");
      const args = [
        "--dangerously-skip-permissions",
        "--model",
        opts.model || cfg.power_model,
        "--max-turns",
        String(cfg.max_turns),
        "-p",
        prompt
      ];
      return spawnProvider("claude", args, {
        cwd: opts.cwd,
        timeout: opts.timeout || cfg.timeout,
        verbose: opts.verbose,
        gardenerDir: opts.gardenerDir,
        // ANTHROPIC_API_KEY is on the env denylist (prevents leaking secrets to LLMs)
        // but Claude CLI needs it for authentication — pass it explicitly
        env: process.env.ANTHROPIC_API_KEY ? { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY } : void 0
      });
    }
  };
}
var DEFAULT_CONFIG;
var init_claude = __esm({
  "src/providers/claude.ts"() {
    "use strict";
    init_spawn();
    DEFAULT_CONFIG = {
      power_model: "opus",
      fast_model: "sonnet",
      timeout: 600,
      max_turns: 200
    };
  }
});

// src/providers/codex.ts
var codex_exports = {};
__export(codex_exports, {
  createCodexProvider: () => createCodexProvider
});
function createCodexProvider(config) {
  const cfg = { ...DEFAULT_CONFIG2, ...config };
  return {
    name: "codex",
    async isAvailable() {
      return isCommandAvailable("codex");
    },
    async run(opts) {
      const prompt = [
        `Read ${opts.contextFile} for vault context,`,
        `then read ${opts.promptFile} and execute all steps.`
      ].join(" ");
      const args = [
        "--model",
        opts.model || cfg.power_model,
        "--approval-mode",
        "full-auto",
        "-q",
        prompt
      ];
      return spawnProvider("codex", args, {
        cwd: opts.cwd,
        timeout: opts.timeout || cfg.timeout,
        verbose: opts.verbose,
        gardenerDir: opts.gardenerDir,
        // OPENAI_API_KEY is on the env denylist (prevents leaking secrets to LLMs)
        // but Codex CLI needs it for authentication — pass it explicitly
        env: process.env.OPENAI_API_KEY ? { OPENAI_API_KEY: process.env.OPENAI_API_KEY } : void 0
      });
    }
  };
}
var DEFAULT_CONFIG2;
var init_codex = __esm({
  "src/providers/codex.ts"() {
    "use strict";
    init_spawn();
    DEFAULT_CONFIG2 = {
      power_model: "gpt-5.3-codex",
      fast_model: "gpt-5.3-codex-spark",
      timeout: 600
    };
  }
});

// src/providers/gemini.ts
var gemini_exports = {};
__export(gemini_exports, {
  createGeminiProvider: () => createGeminiProvider
});
import { readFile } from "fs/promises";
function createGeminiProvider(config) {
  const cfg = { ...DEFAULT_CONFIG3, ...config };
  return {
    name: "gemini",
    async isAvailable() {
      return isCommandAvailable("gemini");
    },
    async run(opts) {
      const contextContent = await readFile(opts.contextFile, "utf-8");
      const prompt = `Read ${opts.promptFile} and execute all steps.`;
      const args = [
        "-m",
        opts.model || cfg.power_model,
        "-p",
        prompt
      ];
      return spawnProvider("gemini", args, {
        cwd: opts.cwd,
        timeout: opts.timeout || cfg.timeout,
        verbose: opts.verbose,
        gardenerDir: opts.gardenerDir,
        env: { GEMINI_SYSTEM_MD: contextContent }
      });
    }
  };
}
var DEFAULT_CONFIG3;
var init_gemini = __esm({
  "src/providers/gemini.ts"() {
    "use strict";
    init_spawn();
    DEFAULT_CONFIG3 = {
      power_model: "gemini-3.1-pro-preview",
      fast_model: "gemini-3-flash-preview",
      timeout: 600
    };
  }
});

// src/prompts/render.ts
var render_exports = {};
__export(render_exports, {
  renderAll: () => renderAll,
  renderContext: () => renderContext,
  renderPrompts: () => renderPrompts
});
import Handlebars from "handlebars";
import { writeFile as writeFile2, mkdir as mkdir2 } from "fs/promises";
import { join as join3 } from "path";
function getTemplate(name) {
  const template = TEMPLATES[name];
  if (!template) {
    const available = Object.keys(TEMPLATES).join(", ");
    throw new Error(`Unknown template "${name}". Available: ${available}`);
  }
  return template;
}
function compile(name) {
  let fn = compiled.get(name);
  if (!fn) {
    fn = Handlebars.compile(getTemplate(name), { noEscape: true });
    compiled.set(name, fn);
  }
  return fn;
}
async function renderPrompts(gardenerDir, config) {
  const promptsDir = join3(gardenerDir, "prompts");
  await mkdir2(promptsDir, { recursive: true });
  await Promise.all(
    PHASE_NAMES.map(async (name) => {
      const render = compile(name);
      const output = render(config);
      await writeFile2(join3(promptsDir, `${name}.md`), output, "utf-8");
    })
  );
}
async function renderContext(gardenerDir, config) {
  await mkdir2(gardenerDir, { recursive: true });
  const render = compile("context");
  const output = render(config);
  await writeFile2(join3(gardenerDir, "context.md"), output, "utf-8");
}
async function renderAll(gardenerDir, config) {
  await Promise.all([
    renderContext(gardenerDir, config),
    renderPrompts(gardenerDir, config)
  ]);
}
var TEMPLATES, compiled, PHASE_NAMES;
var init_render = __esm({
  "src/prompts/render.ts"() {
    "use strict";
    Handlebars.registerHelper("eq", (a, b) => a === b);
    TEMPLATES = {
      context: `# Vault Context (Auto-Generated)

> This file is auto-generated by vault-gardener from \`.gardener/config.yaml\`.
> Do not edit manually \u2014 run \`vault-gardener config regen\` to regenerate.

## Vault Structure

{{#each folders}}
{{@key}}: \`{{this}}/\`
{{/each}}

## Routing Rules

### Step 1: Classify \u2014 episodic or entity?
- **Episodic** (first-person, temporal markers, meetings, decisions) \u2192 \`{{folders.journal}}/\` via Binder
- **Entity/Reference** (resources, people, orgs, clips) \u2192 direct to folder below

### Step 2: Route entity/reference items:
- Uncertain where it goes? \u2192 \`{{folders.inbox}}/\`
{{#if folders.projects}}- Has a deadline or deliverable? \u2192 \`{{folders.projects}}/\`{{/if}}
{{#if folders.roles}}- Ongoing role or responsibility? \u2192 \`{{folders.roles}}/\`{{/if}}
{{#if folders.resources}}- Reference/knowledge to retrieve later? \u2192 \`{{folders.resources}}/{topic-subfolder}/\`{{/if}}
{{#if folders.people}}- About a person? \u2192 \`{{folders.people}}/\`{{/if}}
{{#if folders.orgs}}- About an organization? \u2192 \`{{folders.orgs}}/\`{{/if}}
{{#if folders.playbooks}}- Repeatable process or SOP? \u2192 \`{{folders.playbooks}}/\`{{/if}}
{{#if folders.sources}}- External article, book, paper? \u2192 \`{{folders.sources}}/\`{{/if}}
{{#if folders.mocs}}- Index/hub note? \u2192 \`{{folders.mocs}}/\`{{/if}}
{{#if folders.archive}}- Done or no longer relevant? \u2192 \`{{folders.archive}}/\`{{/if}}

## Topic Taxonomy

{{#each topics}}
### {{@key}}
Keywords: {{#each this}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}
{{/each}}

## Frontmatter Standards

### Required Fields (all notes)
{{#each frontmatter.required}}
- \`{{this}}\`
{{/each}}

### Status Values
{{#each frontmatter.statuses}}
- \`{{this}}\`
{{/each}}

### Type Values
{{#each frontmatter.types}}
- \`{{this}}\`
{{/each}}

## Note Lifecycle

\`\`\`
seed \u2192 growing \u2192 evergreen \u2192 archived       (all notes)
seed \u2192 consolidated                          (event journals, after Store items processed)
\`\`\`

| Status | Gardener behavior |
|--------|-------------------|
| **seed** | Maximum attention. Enriches content, fills frontmatter, adds links, organizes. |
| **growing** | Active management. Adds links, updates beliefs, tracks goals. |
| **evergreen** | Passive. Only adds back-links. Does NOT modify content. |
| **archived** | Ignored. Gardener skips entirely. |
| **consolidated** | Event journals only. All Store items processed. Gardener skips. |

### What the gardener NEVER does:
- Never deletes any note
- Never auto-archives (only suggests)
- Never demotes status
- Never modifies evergreen content (only adds back-links in See Also)

## File Naming

| Type | Pattern | Example |
|------|---------|---------|
| People | \`Firstname Lastname.md\` | \`Jane Smith.md\` |
| Organizations | \`Name.md\` | \`Acme Corp.md\` |
| Resources/Topics | \`Title Case.md\` | \`Machine Learning Basics.md\` |
| Projects | \`Project - Name.md\` | \`Project - Website Redesign.md\` |
| Daily journals | \`YYYY-MM-DD.md\` | \`2026-01-19.md\` |
| Event journals | \`YYYY-MM-DD Kind - Title.md\` | \`2026-01-19 Insight - API Design.md\` |
| Meeting notes | \`YYYY-MM-DD Meeting - Topic.md\` | \`2026-01-19 Meeting - Sprint Review.md\` |

## Formatting Conventions

- Tags: kebab-case (\`#machine-learning\`)
- Links: Always \`[[WikiLinks]]\`
- Max 5 tags per note
- Lead with key insight (inverted pyramid)

{{#if features.persona}}
## Gardener Persona

**Active persona:** \`{{persona}}\`

| Persona | Behavior |
|---------|----------|
| analytical | Facts and data. Minimal interpretation. Precise and structured. |
| reflective | Questions and deeper meaning. Surfaces connections. Thoughtful commentary. |
| coach | Prescriptive and action-oriented. Recommendations. Pushes for clarity. |

{{/if}}
## Batch Limits

**Base limits** (adjusted by adaptive batch sizing based on vault size):

{{#each limits}}
- {{@key}}: {{this}}
{{/each}}

{{#if features.adaptive_batch_sizing}}
**Adaptive sizing rules:**
- Vault < 100 notes \u2192 limits \xD7 2 (small vault, process more aggressively)
- Vault 100-500 notes \u2192 standard limits
- Vault 500+ notes \u2192 limits \xF7 2 (minimum 3) (large vault, be selective)
{{/if}}

## Memory & Changelog

{{#if features.memory}}- **Memory file**: \`.gardener/memory.md\` \u2014 read at start of each phase, updated at end
{{/if}}{{#if features.changelog}}- **Changelog**: \`.gardener/changelog.md\` \u2014 appended after each phase (last 50 entries)
{{/if}}

{{#if features.social_content}}
## Social Media Platforms

{{#if social_platforms}}Target platforms: {{#each social_platforms}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}{{/if}}

{{/if}}
## Protected Paths (NEVER touch)

{{#each protected}}
- \`{{this}}/\`
{{/each}}

## Concurrency Safety

Before modifying any file, check its modification time. If the file was
modified in the last 5 minutes, SKIP it \u2014 the user may be actively editing.`,
      // ---------------------------------------------------------------------------
      garden: `# Gardener \u2014 AI-Powered Vault Maintenance Pipeline

Run the full vault gardener. Three phases execute in sequence:
1. **Seed** \u2014 process inbox into journals and semantic folders
2. **Nurture** \u2014 repair structure, synthesize knowledge, build links
3. **Tend** \u2014 lifecycle management, organization, enrichment

**No information is ever deleted** \u2014 only reorganized, enriched, and connected.

{{#if features.persona}}
## Persona

{{#if (eq persona "analytical")}}You are an **analytical** gardener. Focus on facts, data, and minimal interpretation. Be precise, structured, and evidence-based. Avoid speculation.{{/if}}
{{#if (eq persona "reflective")}}You are a **reflective** gardener. Ask questions, explore deeper meaning, and surface connections. Balance structure with thoughtful commentary.{{/if}}
{{#if (eq persona "coach")}}You are a **coaching** gardener. Be prescriptive and action-oriented. Frame observations as recommendations. Push for clarity and commitment.{{/if}}

{{/if}}
{{#if features.memory}}
## Memory

Read \`.gardener/memory.md\` if it exists. This file contains context from previous runs:
- What was done, what was deferred, running vault observations
- Use this to avoid re-processing and to continue multi-run projects
- Each phase will update memory with its results

{{/if}}
## Protected Paths

**NEVER read, modify, or process files in these locations:**
{{#each protected}}
- \`{{this}}/\`
{{/each}}

## Concurrency Safety

Before modifying any file, check its modification time. If the file was
modified in the last 5 minutes, SKIP it \u2014 the user may be actively editing.
Log skipped files with reason "skipped: recently modified".

## Instructions

First, read \`.gardener/context.md\` to understand vault structure and rules.

Then execute the pipeline:

### Phase 1: Seed
Read \`.gardener/prompts/seed.md\` and execute all steps.

### Phase 2: Nurture
Read \`.gardener/prompts/nurture.md\` and execute all steps.

### Phase 3: Tend
Read \`.gardener/prompts/tend.md\` and execute all steps.

## Run Report

Each phase template includes instructions to write \`.gardener/run-report.json\`.
The **seed** phase creates the file. **Nurture** and **tend** read the existing file
and append their phase to the \`phases\` array. The final file contains all three phases.

## Output

Combined summary from all three phases:
- **Seed**: Inbox items triaged, journals created, salience tags applied, items routed, questions extracted, commitments tracked
- **Nurture**: Structure repaired, beliefs synthesized, playbooks/MOCs generated, entity + semantic + transitive links added, tags normalized, knowledge gaps identified, co-mention networks updated
- **Tend**: Stale notes reviewed, resources organized, notes enriched with context anchoring and summaries, journals generated with themes/attention/goals/social content`,
      // ---------------------------------------------------------------------------
      seed: `# Seed \u2014 Intake & Routing

Process inbox items into journals and semantic folders. Raw captures become
structured episodic and semantic memories.

**No information is ever deleted** \u2014 only reorganized, enriched, and connected.

{{#if features.persona}}
## Persona

{{#if (eq persona "analytical")}}You are an **analytical** gardener. Focus on facts, data, and minimal interpretation. Be precise, structured, and evidence-based. Avoid speculation.{{/if}}
{{#if (eq persona "reflective")}}You are a **reflective** gardener. Ask questions, explore deeper meaning, and surface connections. Balance structure with thoughtful commentary.{{/if}}
{{#if (eq persona "coach")}}You are a **coaching** gardener. Be prescriptive and action-oriented. Frame observations as recommendations. Push for clarity and commitment.{{/if}}

{{/if}}
{{#if features.memory}}
## Memory

Read \`.gardener/memory.md\` if it exists. This file contains context from previous runs \u2014
what was done, what was deferred, running observations about vault state. Use this to:
- Avoid re-processing items handled in previous runs
- Continue multi-run projects from where they left off
- Make strategic decisions about what to prioritize this run

{{/if}}
## Safety

- **Never delete** \u2014 only reorganize, enrich, connect
- **Skip recently modified** \u2014 if file modified in last 5 min, skip it
- **Never touch protected paths**: {{#each protected}}\`{{this}}/\` {{/each}}

## Instructions

Read \`.gardener/context.md\` for vault structure and routing rules.

---

## Step 0 \u2014 Document Cleanup

Run cleanup on recently modified notes before other maintenance:

1. **Find recent notes**: Identify all notes modified in the last 7 days
   (skip protected paths)

2. **Skip already clean**: Exclude notes with \`status: evergreen\`

3. **Run cleanup phases** for each note:
   - **Format**: Normalize whitespace, bullets, headings, dates
   - **Structure**: Add missing sections for document type
   - **Enrich**: Fill thin content (<100 words) with context
   - **Cross-link**: Discover and add WikiLinks to related notes

4. **Processing rules**:
   - Skip protected paths
   - Never reduce content, only add or restructure
   - Preserve code blocks, WikiLinks, and embeds exactly

---

## Step 1 \u2014 Triage

Classify each \`{{folders.inbox}}/\` item:

**EPISODIC signals** (any match \u2192 episodic):
- First-person pronouns: "I", "my", "we", "our"
- Temporal markers: "today", "yesterday", "just now", "this morning"
- Frontmatter: \`type: meeting\`, \`type: journal\`
- Contains \`[decision]\`, \`[milestone]\`, \`[insight]\`, \`[met]\` tags
- Voice memo transcription

**ENTITY/REFERENCE signals** (any match \u2192 direct route):
- Frontmatter: \`type: resource\`, \`person\`, \`org\`
- Contains URL as primary content
- Filename matches person/org naming patterns
- Is a clipped article (\`type: clip\`, \`source: url\`)

**AMBIGUOUS** \u2192 default episodic

- Episodic items \u2192 **Step 1.1 (Binder)**
- Entity/reference items \u2192 **Step 1.3 (Route Remaining)**

## Step 1.1 \u2014 Binder

Process episodic inbox items into journals.

**Content maturity check:**
- Structured (headings, links, checklists, or >50 words) \u2192 process now
- Bare capture (<50 words, no structure) \u2192 skip if < 12h old
- Has explicit routing tag \u2192 process immediately

### SMALL captures (< 50 words, single thought)

1. Find or create \`{{folders.journal}}/YYYY/{{journal.journal_subfolders.daily}}/YYYY-MM-DD.md\`
2. Append under \`## Captures\`:
   \`\`\`
   - {content} \u2014 [[source-if-any]] ({HH:MM})
   \`\`\`
3. Delete inbox file

{{#if features.this_time_last_year}}
### This Time Last Year (#29)

When creating or updating a daily journal, look for journals from roughly one year ago.
Search \`{{folders.journal}}/{YYYY-1}/{{journal.journal_subfolders.daily}}/\` for any daily
or event journals within \xB13 days of today's date last year (7-day window).

**Search order** (pick the best single match):
1. Exact date last year (\`{YYYY-1}-MM-DD\`)
2. Same weekday in the nearest week (e.g., if today is Tuesday, find last year's nearest Tuesday)
3. Any journal within the \xB13 day window, preferring the one with the most content

If found, add a callout at the top of the daily note (after frontmatter):

\`\`\`markdown
> [!calendar] This Time Last Year
> {2-3 sentence summary of that day's journal}
> \u2014 [[{matched-date}]]
\`\`\`

If multiple journals exist in the window (e.g., a daily + event journals), summarize the
most interesting one and link to the others:

\`\`\`markdown
> [!calendar] This Time Last Year
> {2-3 sentence summary of the most notable entry}
> \u2014 [[{matched-date}]] \xB7 also: [[{YYYY-1}-MM-DD Kind - Title]]
\`\`\`

Only add once per daily note. Skip if a \`[!calendar] This Time Last Year\` callout already exists.

{{/if}}
### LARGE captures (>= 50 words, OR has headings, OR contains [decision]/[milestone]/[insight])

1. **Determine Kind** from content:
   | Signal | Kind |
   |--------|------|
   | "decided", "chose", "going with" | Decision |
   | "realized", "learned", "turns out" | Insight |
   | "shipped", "launched", "completed" | Milestone |
   | "failed", "broke", "mistake" | Failure |
   | "met", "talked", "called" | Encounter |
   | "won", "closed", "landed" | Win |
   | Default | Observation |

2. **Create event journal**: \`{{folders.journal}}/YYYY/{{journal.journal_subfolders.daily}}/YYYY-MM-DD {Kind} - {Title}.md\`
3. **Apply frontmatter**:
   \`\`\`yaml
   ---
   created: YYYY-MM-DD
   updated: YYYY-MM-DD
   tags: [journal, {kind-lowercase}]
   status: seed
   type: journal
   kind: {Kind}
   ---
   \`\`\`
   Sections: \`## Context\`, \`## Takeaways\`, \`## Store\`

{{#if features.meeting_enhancement}}
4. **Kind-specific enhancements:**

   **Encounter (type: meeting):**
   - Add \`## Action Items\` with checkboxes: \`- [ ] {action} \u2014 @{owner} (due: {date})\`
   - Add \`## Key Quotes\` attributed to attendees
   - Add \`## Follow-up Required\` with timeline
   - Link to relevant \`{{folders.people}}/\` and \`{{folders.orgs}}/\` notes
   - Update \`last-contact\` frontmatter on referenced person notes

{{/if}}
{{#if features.question_tracker}}
5. **Extract questions** (#3 Question Tracker):
   Scan journal content for substantive questions \u2014 "I wonder...", "need to figure out...",
   sentences ending in \`?\` about decisions, strategy, or understanding.
   **Filter:** Only track questions about decisions, strategy, understanding, or personal growth.
   Ignore logistics, scheduling, and rhetorical questions.
   Collect into \`## Open Questions\` section on the event journal.
   Also append to the relevant MOC's \`## Open Questions\` section if a MOC exists for the topic.

{{/if}}
{{#if features.commitment_tracker}}
6. **Extract commitments** (#24 Commitment Tracker):
   Scan for commitments to people \u2014 "I told {person} I'd...", "promised to...",
   "need to send {person}...", "agreed to..." with deadlines if mentioned.
   Add to \`## Commitments\` section on the relevant person note in \`{{folders.people}}/\`:
   \`\`\`markdown
   - [ ] {commitment} \u2014 from [[{journal-date}]] (due: {date-if-mentioned})
   \`\`\`
   **Important:** Check the person note's existing commitments and open todo lists in the vault
   to avoid duplicating items already tracked elsewhere.

{{/if}}
7. **Link from daily note** under \`## Events\`
8. Delete inbox file

## Step 1.2 \u2014 Salience Tagger

Scan journals modified in last 24h.

**HIGH salience** \u2192 add \`#salient\`:
- Explicit tags: \`#salient\`, \`#urgent\`, \`#painful\`, \`#win\`
- Risk language: "risk", "threat", "red flag", "critical"
- Emotional markers: "surprised", "shocked", "changed my mind"
- High stakes: "$", "million", "funding", "fired", "hired"

**MEDIUM salience** \u2192 add \`#notable\`:
- "interesting", "worth noting", "keep in mind", "opportunity"

**Idempotent:** skip if already tagged.

## Step 1.3 \u2014 Route Remaining Inbox

Route entity/reference items to folders:

{{#if folders.people}}- **People** \u2192 \`{{folders.people}}/\`{{/if}}
{{#if folders.orgs}}- **Orgs** \u2192 \`{{folders.orgs}}/\`{{/if}}
{{#if folders.projects}}- **Projects** \u2192 \`{{folders.projects}}/\`{{/if}}
{{#if folders.sources}}- **Sources** (articles, books, clips) \u2192 \`{{folders.sources}}/\`{{/if}}
{{#if folders.resources}}- **Concepts/Knowledge** \u2192 \`{{folders.resources}}/{topic-subfolder}/\`{{/if}}
{{#if folders.playbooks}}- **Playbooks** (how-tos, processes) \u2192 \`{{folders.playbooks}}/\`{{/if}}

For each routed item:
- Enrich with proper frontmatter
- Add relevant links to existing notes
- Move to destination

## Step 1.4 \u2014 People Auto-Research

Detect sparse people notes and enrich:

1. Find sparse people notes in \`{{folders.people}}/\`:
   - File size < 500 bytes, \`status: seed\`, NOT \`auto-researched: true\`
   - NOT modified within last 7 days
2. Batch limit: 3-5 notes per run
3. Web search for job title, company, brief bio
4. Update with attribution banner
5. Safety: only fill empty sections, never overwrite

---

## Commit (if git available)

\`\`\`bash
git add -A && git commit -m "vault-gardener seed: {date} ({count} items processed)"
\`\`\`

---

{{#if features.changelog}}
## Vault Changelog

Append a human-readable summary of this seed run to \`.gardener/changelog.md\`:

\`\`\`markdown
### {YYYY-MM-DD HH:MM} \u2014 Seed
- {1-line summary of what was processed}
- Items: {count} triaged, {journals} journals created
- Questions extracted: {count}
- Commitments tracked: {count}
\`\`\`

Keep only the last 50 entries in the changelog file.

{{/if}}
---

{{#if features.memory}}
## Memory Update

Update \`.gardener/memory.md\` with seed phase results. Use YAML frontmatter + markdown:

\`\`\`markdown
---
last_run: {ISO timestamp}
last_phase: seed
items_processed: {count}
items_deferred: {count}
---
## Seed Phase
- Processed {count} inbox items
- {any items deferred and why}
- {observations about vault state relevant to next run}
\`\`\`

Merge with existing memory content \u2014 don't overwrite nurture/tend sections.

---

{{/if}}
## Run Report

After completing all steps, write a JSON file to \`.gardener/run-report.json\`:

\\\`\\\`\\\`json
{
  "version": 1,
  "timestamp": "{ISO-8601 timestamp}",
  "phases": [{
    "phase": "seed",
    "started": true,
    "features": [
      { "feature": "{key}", "status": "executed|skipped|error", "counts": { ... }, "reason": "{if skipped/error}" }
    ]
  }],
  "summary": "{1-2 sentence summary of what was done}",
  "warnings": []
}
\\\`\\\`\\\`

Report these features (only report enabled features listed here):
{{#if features.memory}}- \`memory\` \u2014 counts: \`{ "read": 0|1, "updated": 0|1 }\`
{{/if}}{{#if features.changelog}}- \`changelog\` \u2014 counts: \`{ "entries_written": 0|1 }\`
{{/if}}{{#if features.persona}}- \`persona\` \u2014 counts: \`{ "applied": 0|1 }\`
{{/if}}{{#if features.this_time_last_year}}- \`this_time_last_year\` \u2014 counts: \`{ "lookbacks_added": {n} }\`
{{/if}}{{#if features.meeting_enhancement}}- \`meeting_enhancement\` \u2014 counts: \`{ "meetings_enhanced": {n} }\`
{{/if}}{{#if features.question_tracker}}- \`question_tracker\` \u2014 counts: \`{ "questions_extracted": {n} }\`
{{/if}}{{#if features.commitment_tracker}}- \`commitment_tracker\` \u2014 counts: \`{ "commitments_tracked": {n} }\`
{{/if}}

Also report core steps as features:
- \`cleanup\` \u2014 counts: \`{ "files_cleaned": {n} }\`
- \`triage\` \u2014 counts: \`{ "episodic": {n}, "entity": {n} }\`
- \`binder\` \u2014 counts: \`{ "daily_captures": {n}, "event_journals": {n} }\`
- \`salience\` \u2014 counts: \`{ "high": {n}, "medium": {n} }\`
- \`routing\` \u2014 counts: \`{ "items_routed": {n} }\`

**Rules:**
- Report EVERY listed feature, even if skipped (use status "skipped" with a reason)
- The \`phase\` field MUST be exactly one of: \`"seed"\`, \`"nurture"\`, or \`"tend"\` \u2014 no other values
- Write valid JSON \u2014 no trailing commas, no comments
- If \`.gardener/run-report.json\` already exists (multi-phase run), read it first and APPEND your phase to the \`phases\` array

---

## Output

Summary:
- **Cleanup**: {files} files cleaned
- **Triage**: {episodic} episodic, {entity} entity items classified
- **Journals**: {daily} daily captures, {event} event journals created
- **Salience**: {high} high, {medium} medium tags applied
- **Routing**: {routed} items routed to folders
- **People**: {researched} people notes auto-researched
- **Questions**: {count} substantive questions extracted
- **Commitments**: {count} commitments tracked on person notes`,
      // ---------------------------------------------------------------------------
      nurture: `# Nurture \u2014 Structure & Knowledge Building

> **Phase name: nurture** \u2014 use exactly \`"nurture"\` in all reporting.

Repair structure, synthesize episodic memories into semantic knowledge, and build
the knowledge graph. Structural integrity first, then belief updates, playbook
extraction, MOC generation, and semantic linking.

**No information is ever deleted** \u2014 only reorganized, enriched, and connected.

{{#if features.persona}}
## Persona

{{#if (eq persona "analytical")}}You are an **analytical** gardener. Focus on facts, data, and minimal interpretation. Be precise, structured, and evidence-based. Avoid speculation.{{/if}}
{{#if (eq persona "reflective")}}You are a **reflective** gardener. Ask questions, explore deeper meaning, and surface connections. Balance structure with thoughtful commentary.{{/if}}
{{#if (eq persona "coach")}}You are a **coaching** gardener. Be prescriptive and action-oriented. Frame observations as recommendations. Push for clarity and commitment.{{/if}}

{{/if}}
{{#if features.memory}}
## Memory

Read \`.gardener/memory.md\` if it exists. Use previous run context to:
- Avoid re-processing already-processed beliefs
- Continue linking projects from where they left off
- Prioritize areas flagged in previous runs

{{/if}}
## Safety

- **Never delete** \u2014 only reorganize, enrich, connect
- **Skip recently modified** \u2014 if file modified in last 5 min, skip it
- **Never touch protected paths**: {{#each protected}}\`{{this}}/\` {{/each}}

## Instructions

Read \`.gardener/context.md\` for vault structure and rules.

---

## Step 1 \u2014 Structural Integrity Checks

- **Root orphans**: Find \`.md\` files in vault root (not in any folder). Move to \`{{folders.inbox}}/\` for triage.
- **Depth check**: Flag folders nested deeper than 3 levels.
- **Duplicate detection**: Find notes with identical titles in different folders. Log for review.
- **Broken WikiLinks**: Scan for \`[[links]]\` pointing to non-existent notes. Auto-fix close matches (case-insensitive). Log rest.
- **Empty notes**: Find notes with only frontmatter and no body content, older than 7 days. Flag for review.

## Step 1.1 \u2014 Frontmatter Compliance Sweep

Scan notes modified in the last 14 days. Verify required frontmatter:

- **All notes**: {{#each frontmatter.required}}\`{{this}}\`{{#unless @last}}, {{/unless}}{{/each}}
{{#if folders.projects}}- **Projects**: \`deadline\`, \`outcome\`, \`priority\`, \`role\`{{/if}}
{{#if folders.roles}}- **Roles**: \`role\`, \`cadence\`{{/if}}
{{#if folders.people}}- **People**: \`relationship\`, \`company\`, \`last-contact\`{{/if}}
{{#if folders.orgs}}- **Orgs**: \`org-type\`, \`industry\`, \`website\`, \`relationship\`{{/if}}
{{#if folders.resources}}- **Resources**: \`source\`, \`author\`, \`rating\`, \`topic\`{{/if}}

Fill missing fields with sensible defaults:
- \`created\`/\`updated\` \u2192 file dates
- \`status\` \u2192 \`seed\` if new
- \`type\` \u2192 infer from folder location
- \`tags\` \u2192 infer 1-3 from title/content

{{#if features.tag_normalization}}
## Step 1.3 \u2014 Tag Taxonomy Normalization

Scan tags across recently modified notes. Detect tags that should be merged:

- **Synonyms**: \`#machine-learning\` and \`#ml\`, \`#artificial-intelligence\` and \`#ai\`
- **Plural/singular**: \`#projects\` and \`#project\`
- **Spelling variants**: \`#behaviour\` and \`#behavior\`
- **Hierarchy candidates**: \`#react\` could be under \`#frontend\`

**Actions:**
- Report suggested merges in the run's output \u2014 **never auto-merge** (user should confirm)
- If a clear canonical form exists (the one used more often), note it
- Log suggestions to \`## Tag Cleanup\` section in \`.gardener/changelog.md\`

---

{{/if}}
## Step 1.4 \u2014 Orphan Triage

Identify notes with no incoming links (orphans).

- \`status: seed\` + >14 days + 0 incoming links \u2192 add review comment, try to auto-link
- \`status: growing\` + orphan \u2192 add to "Needs Attention" list
- \`status: evergreen\` + orphan \u2192 attempt auto-link

**Never auto-archive orphans.**

---

## Step 2 \u2014 Belief Synthesizer

Scan all journals with \`## Store\` sections.

### Process checked items (\`- [x] Update [[Target]] with {content}\`)

1. Open target note
2. Find or create \`## Beliefs (with receipts)\` section
3. Count supporting journals:
   - 2+ journals \u2192 \`\u2705 confirmed\`
   - 1 journal \u2192 \`\u{1F7E1} emerging\`
   - Explicitly hypothesis \u2192 \`\u{1F9EA} hypothesis\`
4. Append bullet: \`- {marker} {belief} \u2014 evidence: [[Journal 1]], [[Journal 2]]\`
5. **Contradiction check:** If conflicting belief found, mark both \`\u{1F7E1} emerging\` and add warning callout
6. Mark Store checkbox as processed

**Never delete beliefs.** Mark \`\u26D4 retracted\` when outdated.
**Remember: this is the NURTURE phase \u2014 report as \`"phase": "nurture"\` in run-report.**

**Batch limit:** Max {{limits.beliefs_per_run}} belief updates per run.

{{#if features.co_mention_network}}
## Step 2.0.1 \u2014 People Co-Mention Network

For each person note in \`{{folders.people}}/\` modified or referenced in the last 14 days:

1. Scan recent journals for co-mentions \u2014 when two people appear in the same journal entry
2. Build or update a \`## Network\` section on the person note:
   \`\`\`markdown
   ## Network
   Frequently mentioned alongside:
   - [[Jane Smith]] (5 entries)
   - [[Acme Corp]] (3 entries)
   - [[Bob Johnson]] (2 entries)
   \`\`\`
3. Only include co-mentions appearing in 2+ journal entries
4. Update counts if section already exists (don't duplicate)

{{/if}}
{{#if features.commitment_tracker}}
## Step 2.0.2 \u2014 Commitment Compliance

For each person note in \`{{folders.people}}/\`:
1. Check \`## Commitments\` section for overdue items (past due date)
2. Check open todo lists in the vault to avoid duplicating tracked items
3. Flag overdue commitments in the run summary
4. Cross-reference with recent journals \u2014 if a commitment was fulfilled, mark it:
   \`- [x] {commitment} \u2014 completed [[{journal-date}]]\`

{{/if}}
---

## Step 2.1 \u2014 Playbook Builder

Detect procedural patterns across journals.

**Triggers:**
- 3+ journals share 2+ tags AND contain step-lists
- OR note tagged \`#playbook-candidate\`

**Actions:**
- Create/update \`{{folders.playbooks}}/{topic-slug}.md\`
- Sections: \`## Trigger\`, \`## Steps\`, \`## Failure Modes\`, \`## Evidence\`

**Batch limit:** Max {{limits.playbooks_per_run}} playbooks per run.

## Step 2.2 \u2014 Auto-MOC

Generate Maps of Content for frequently-mentioned entities.

**Threshold (adaptive):**
| Vault Notes | Base | Salient Override |
|-------------|------|------------------|
| < 100 | 5 | 3 |
| 100-500 | 8 | 5 |
| 500+ | 12 | 7 |

**Actions:**
- Create \`{{folders.mocs}}/MOC - {Entity}.md\`
- Sections: \`## Timeline\`, \`## Key Beliefs\`, \`## Related\`, \`## Open Questions\`

**Batch limit:** Max {{limits.mocs_per_run}} new MOCs per run.

{{#if features.knowledge_gaps}}
### Knowledge Gap Detection (#19)

During MOC generation/update, identify subtopics that are frequently referenced or implied
but have no dedicated note in the vault:

1. Scan MOC content and linked notes for entity/concept mentions without matching vault notes
2. **Threshold:** Only flag gaps appearing in **5+ journal entries** (not just casual mentions)
3. Add a \`## Knowledge Gaps\` section to the MOC:
   \`\`\`markdown
   ## Knowledge Gaps
   Frequently mentioned but no dedicated note:
   - **transformer architecture** \u2014 mentioned in 7 journals, referenced by [[ML Basics]], [[GPT Notes]]
   - **CAP theorem** \u2014 mentioned in 5 journals, referenced by [[Distributed Systems]]
   \`\`\`
4. These are natural candidates for future learning or note creation
{{/if}}

---

{{#if features.entity_auto_linking}}
## Step 3 \u2014 Entity Mention Auto-Linking

Scan notes modified in the last 14 days for plain-text mentions of known entities
(people, organizations, projects) that exist as vault notes but aren't WikiLinked.

1. Build entity list from filenames in \`{{folders.people}}/\`, \`{{folders.orgs}}/\`, \`{{folders.projects}}/\`
2. For each recently modified note, find plain-text mentions matching entity names (case-insensitive)
3. Convert to WikiLinks: \`I talked to John Smith\` \u2192 \`I talked to [[John Smith]]\`
4. **Safety rules:**
   - Only link names that **exactly match** an existing note filename (case-insensitive)
   - Skip names shorter than 4 characters (too many false positives)
   - Don't link inside code blocks, URLs, or existing WikiLinks
   - Use contextual disambiguation: "Apple" the company vs the fruit \u2014 only link if context
     matches the note's \`type\` frontmatter
5. **Batch limit:** Max {{limits.links_per_run}} auto-links per run (shared with Step 3.1 below)

{{/if}}
---

## Step 3.1 \u2014 Semantic Similarity Linking

Analyze notes modified in the last 14 days. Find related notes using:
- **Tag overlap**: 2+ topic-specific tags shared (exclude structural tags)
- **Title word overlap**: Significant shared words
- **Topic match**: Same \`topic\` frontmatter
- **Content keywords**: Top 5 keywords, find notes mentioning them

For each candidate pair with no existing link:
- Add bidirectional WikiLinks in \`## See Also\` section
{{#if features.backlink_context}}
- **Include context sentence** (#10): Don't add bare links. Include the sentence that
  establishes the connection:
  \`\`\`markdown
  ## See Also
  - [[Thinking in Systems]] \u2014 "Applied the systems framework to the architecture decision"
    (from [[Journal 2026-02-15]])
  - [[Conway's Law]] \u2014 shares tags #architecture, #org-design
  \`\`\`
  Only add context for **newly-added links** (don't retroactively annotate existing links).
{{/if}}

**Limit:** Max {{limits.links_per_run}} new links per run (shared with Step 3 entity linking).

{{#if features.transitive_links}}
## Step 3.2 \u2014 Transitive Link Suggestions

If note A links to B and B links to C, but A does not link to C, and A and C share
tags or keywords, suggest a direct link with the connection path annotated:

\`\`\`markdown
## See Also
- [[Conway's Law]] \u2014 transitive via [[Org Design]]: "Your thoughts on hiring connect
  to system design through organizational structure"
\`\`\`

**Scope limit:** Only analyze notes modified in the last 14 days, only 1 hop deep.
Present as suggestions in \`## See Also\` \u2014 clearly marked as transitive connections.

{{/if}}
---

## Commit (if git available)

\`\`\`bash
git add -A && git commit -m "vault-gardener nurture: {date} ({beliefs} beliefs, {links} links)"
\`\`\`

---

{{#if features.changelog}}
## Vault Changelog

Append a human-readable summary of this nurture run to \`.gardener/changelog.md\`:

\`\`\`markdown
### {YYYY-MM-DD HH:MM} \u2014 Nurture
- {1-line summary of structural work}
- Beliefs: {synthesized} synthesized, {contradictions} contradictions found
- Links: {count} new (entity: {entity}, semantic: {semantic}, transitive: {transitive})
- Tags: {count} merge suggestions
- Knowledge gaps: {count} identified
\`\`\`

Keep only the last 50 entries in the changelog file.

{{/if}}
---

{{#if features.memory}}
## Memory Update

Update \`.gardener/memory.md\` with nurture phase results:

\`\`\`markdown
## Nurture Phase
- Synthesized {count} beliefs, {remaining} Store items remaining
- Added {count} links, {orphans} orphans still unlinked
- Tag merge suggestions: {list}
- {observations for next run}
\`\`\`

Merge with existing memory \u2014 preserve seed/tend sections.

---

{{/if}}
## Run Report

After completing all steps, write a JSON file to \`.gardener/run-report.json\`:

\\\`\\\`\\\`json
{
  "version": 1,
  "timestamp": "{ISO-8601 timestamp}",
  "phases": [{
    "phase": "nurture",
    "started": true,
    "features": [
      { "feature": "{key}", "status": "executed|skipped|error", "counts": { ... }, "reason": "{if skipped/error}" }
    ]
  }],
  "summary": "{1-2 sentence summary of what was done}",
  "warnings": []
}
\\\`\\\`\\\`

Report these features (only report enabled features listed here):
{{#if features.memory}}- \`memory\` \u2014 counts: \`{ "read": 0|1, "updated": 0|1 }\`
{{/if}}{{#if features.changelog}}- \`changelog\` \u2014 counts: \`{ "entries_written": 0|1 }\`
{{/if}}{{#if features.persona}}- \`persona\` \u2014 counts: \`{ "applied": 0|1 }\`
{{/if}}{{#if features.tag_normalization}}- \`tag_normalization\` \u2014 counts: \`{ "merge_suggestions": {n} }\`
{{/if}}{{#if features.co_mention_network}}- \`co_mention_network\` \u2014 counts: \`{ "networks_updated": {n} }\`
{{/if}}{{#if features.knowledge_gaps}}- \`knowledge_gaps\` \u2014 counts: \`{ "gaps_identified": {n} }\`
{{/if}}{{#if features.entity_auto_linking}}- \`entity_auto_linking\` \u2014 counts: \`{ "mentions_linked": {n} }\`
{{/if}}{{#if features.backlink_context}}- \`backlink_context\` \u2014 counts: \`{ "contexts_added": {n} }\`
{{/if}}{{#if features.transitive_links}}- \`transitive_links\` \u2014 counts: \`{ "links_suggested": {n} }\`
{{/if}}{{#if features.commitment_tracker}}- \`commitment_tracker\` \u2014 counts: \`{ "commitments_reviewed": {n}, "overdue": {n} }\`
{{/if}}

Also report core steps as features:
- \`structural_integrity\` \u2014 counts: \`{ "orphans_moved": {n}, "duplicates_found": {n}, "broken_links_fixed": {n} }\`
- \`frontmatter_sweep\` \u2014 counts: \`{ "notes_fixed": {n}, "fields_added": {n} }\`
- \`consolidator\` \u2014 counts: \`{ "beliefs_consolidated": {n}, "contradictions": {n} }\`
- \`playbook_builder\` \u2014 counts: \`{ "created": {n}, "updated": {n} }\`
- \`auto_moc\` \u2014 counts: \`{ "created": {n}, "refreshed": {n} }\`
- \`semantic_linking\` \u2014 counts: \`{ "links_added": {n} }\`

**Rules:**
- Report EVERY listed feature, even if skipped (use status "skipped" with a reason)
- The \`phase\` field MUST be exactly one of: \`"seed"\`, \`"nurture"\`, or \`"tend"\` \u2014 no other values
- Write valid JSON \u2014 no trailing commas, no comments
- If \`.gardener/run-report.json\` already exists (multi-phase run), read it first and APPEND your phase to the \`phases\` array

---

## Output

Summary:
- **Structure**: {root} orphans moved, {dupes} duplicates found, {broken} links fixed
- **Frontmatter**: {notes} notes fixed, {fields} fields added
- **Tags**: {count} merge suggestions identified
- **Orphans**: {linked} auto-linked, {flagged} flagged
- **Beliefs**: {consolidated} beliefs consolidated, {contradictions} contradictions
- **Playbooks**: {created} created, {updated} updated
- **MOCs**: {created} new MOCs, {updated} refreshed, {gaps} knowledge gaps identified
- **Entity links**: {count} plain-text mentions auto-linked
- **Semantic links**: {count} new links with context sentences
- **Transitive links**: {count} suggested
- **People**: {networks} co-mention networks updated, {commitments} commitments reviewed`,
      // ---------------------------------------------------------------------------
      tend: `# Tend \u2014 Lifecycle & Enrichment

Review note lifecycle, organize semantic memory into topic folders, and progressively
enrich sparse notes. Pruning, organizing, and nurturing the knowledge garden.

**No information is ever deleted** \u2014 only reorganized, enriched, and connected.

{{#if features.persona}}
## Persona

{{#if (eq persona "analytical")}}You are an **analytical** gardener. Focus on facts, data, and minimal interpretation. Be precise, structured, and evidence-based. Avoid speculation.{{/if}}
{{#if (eq persona "reflective")}}You are a **reflective** gardener. Ask questions, explore deeper meaning, and surface connections. Balance structure with thoughtful commentary.{{/if}}
{{#if (eq persona "coach")}}You are a **coaching** gardener. Be prescriptive and action-oriented. Frame observations as recommendations. Push for clarity and commitment.{{/if}}

{{/if}}
{{#if features.memory}}
## Memory

Read \`.gardener/memory.md\` if it exists. Use previous run context to:
- Continue enrichment from where it left off
- Avoid re-generating journals already created
- Track enrichment queue progress across runs

{{/if}}
## Safety

- **Never delete** \u2014 only reorganize, enrich, connect
- **Skip recently modified** \u2014 if file modified in last 5 min, skip it
- **Never touch protected paths**: {{#each protected}}\`{{this}}/\` {{/each}}

## Instructions

Read \`.gardener/context.md\` for vault structure and rules.

---

## Step 1 \u2014 Stale Note Review

Non-destructive review. **Never auto-archive or delete.**

| Condition | Action |
|-----------|--------|
| \`seed\` + 0 incoming links + >14 days old | Add review comment. Find 2-3 related notes and add WikiLinks. |
| \`seed\` + >30 days old | Flag in summary: "Needs attention \u2014 develop or connect." |
| Event journal with all Store items processed | Set \`status: consolidated\`. |

## Step 1.1 \u2014 Semantic Memory Organizer

Auto-organize \`{{folders.resources}}/\` into topic subfolders.

1. **Scan loose files** in \`{{folders.resources}}/\` root
2. **Detect topic** from title, tags, content, \`topic\` frontmatter
3. **Route to matching subfolder:**
   - Subfolder exists \u2192 move file, update \`topic\` frontmatter
   - No subfolder but {{auto_grow.resources}}+ loose files share topic \u2192 create subfolder + index note
   - Topic unclear or < {{auto_grow.resources}} matches \u2192 leave in root
4. **Update index notes** with file links
5. **Never move files OUT of existing subfolders**

**Topic taxonomy:**
{{#each topics}}
- **{{@key}}**: {{#each this}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}
{{/each}}

New topic categories auto-created when {{auto_grow.resources}}+ notes share keywords not covered above.

**Batch limit:** Max {{limits.organize_per_run}} files organized per run.

---

## Step 2 \u2014 Journal Generation

Generate higher-level journal summaries when threshold data exists.

### Weekly Summary
- **Trigger**: 3+ daily entries exist for the week
- **Location**: \`{{folders.journal}}/YYYY/{{journal.journal_subfolders.weekly}}/YYYY-WNN.md\`
- **Style**: {{journal.style.weekly}}
- **Sections**: Highlights, Decisions, Learnings, People, Open Items for Next Week
- **Links**: Back-links to each daily + event journal

**Additional weekly sections:**

{{#if features.social_content}}
\`## Social Content\` \u2014 Generate draft social media content targeting {{#each social_platforms}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}:
- Source from that week's journals and newly created/modified notes
- 2-3 post drafts per platform, adapted to platform style and length
- **Exclude** personal/sensitive information, private names, health data, financial details
- Focus on professional insights, learnings, and publicly shareable observations
- Mark as \`> [!social] Draft \u2014 review before posting\`

{{/if}}
{{#if features.question_tracker}}
\`## Question Tracker Update\` \u2014 Review open questions from this week's journals.
For each: is there evidence in subsequent entries that it was answered? If yes,
mark resolved with link to the answering journal. Surface unresolved questions.

{{/if}}
### Monthly Summary
- **Trigger**: 2+ weekly entries exist for the month
- **Location**: \`{{folders.journal}}/YYYY/{{journal.journal_subfolders.monthly}}/YYYY-MM.md\`
- **Style**: {{journal.style.monthly}}
- **Sections**: Highlights, Goal Progress, Key Relationships, Knowledge Growth, Gardener Recommendations

**Additional monthly sections:**

{{#if features.belief_trajectory}}
\`## Belief Changes\` (#15 Belief Trajectory) \u2014 Review the Consolidator's recent work.
Include only when there are recent belief changes:
- Newly confirmed beliefs (with evidence links)
- Emerging contradictions between beliefs
- Retracted beliefs and why
- Group by topic for readability

{{/if}}
{{#if features.theme_detection}}
\`## Emerging Themes\` (#16 Monthly Theme Detection) \u2014 Analyze all daily/event journals
from this month to detect recurring themes the user hasn't explicitly tagged:
- What topics consumed the most writing energy?
- What unexpected patterns emerged?
- Example: "This month's emerging theme: Convergence \u2014 multiple projects reached
  critical milestones simultaneously."
- Labels are suggestions, not permanent categories

{{/if}}
{{#if features.attention_allocation}}
\`## Attention Allocation\` (#17) \u2014 Count journal entries referencing each role, project,
and person. Present breakdown:
- "This month: 40% [[Engineering Lead]], 25% [[Website Redesign]], 15% [[Jane Smith]], 20% misc."
- Compare to previous month if available
- Include note view counts / modification frequency as additional signal
- **Caveat note**: "Based on journal mentions and note activity, not time spent."

{{/if}}
{{#if features.goal_tracking}}
\`## Goal Progress\` (#21 Goal Tracking via Journal Evidence) \u2014 Scan yearly/quarterly
notes for goal definitions (e.g., \`- [ ] Ship v2 by March\`). For each goal:
- Count journal entries mentioning it
- Link to milestone journals as evidence
- Identify blockers mentioned in journals
- **Present evidence counts and links** \u2014 do NOT estimate percentages
- Example: "Ship v2: 4 mentions, 2 milestones ([[API Complete]], [[Frontend Draft]]),
  1 blocker identified ([[Auth Issues]])"

{{/if}}
### Quarterly Reflection
- **Trigger**: 2+ monthly entries exist for the quarter
- **Location**: \`{{folders.journal}}/YYYY/{{journal.journal_subfolders.quarterly}}/YYYY-QN.md\`
- **Style**: {{journal.style.quarterly}}
- **Sections**: Quarter in Review, Progress Against Themes, Goal Assessment, Key Learnings, Top Relationships, Gardener Recommendations

**Additional quarterly sections:**

{{#if features.seasonal_patterns}}
\`## Seasonal Patterns\` (#20) \u2014 If 12+ months of journal data exists, compare current
quarter's themes and attention allocation with the same quarter in previous years:
- "You tend to focus on hiring in Q1"
- "Journaling frequency drops in Q3"
- Even weak 2-year patterns are interesting hypotheses \u2014 present as observations
- If insufficient data (<12 months), skip this section entirely

{{/if}}
{{#if features.commitment_tracker}}
\`## Commitment Review\` (#24) \u2014 Summarize commitment tracking from person notes:
- Total commitments made this quarter
- Completion rate
- Overdue items with links
- People with most outstanding commitments

{{/if}}
### Yearly Review
- **Trigger**: User sets themes in yearly note
- **Location**: \`{{folders.journal}}/YYYY/{{journal.journal_subfolders.yearly}}/YYYY.md\`
- **Style**: {{journal.style.yearly}}
- **Sections**: Themes, Goals & Plans, Progress Tracker, Key Events, Key Learnings, Gardener Recommendations
- **Lifecycle**: Created on Jan 1st (or init). Updated monthly. Comprehensive Q4 review.

**Additional yearly sections:**

{{#if features.seasonal_patterns}}
\`## Seasonal Patterns\` (#20) \u2014 Full year pattern analysis. Compare month-by-month
attention allocation. Surface rhythms: when do you write most? Which themes peak when?

{{/if}}
{{#if features.goal_tracking}}
\`## Annual Goal Evidence\` (#21) \u2014 Comprehensive evidence-based goal review using all
monthly summaries and quarterly reflections. Link to key milestone journals.

{{/if}}
---

## Step 3 \u2014 Progressive Enrichment Queue

Process sparse notes for enrichment.

{{#if features.adaptive_batch_sizing}}
### Adaptive Batch Sizing (#36)

Adjust enrichment limits based on vault size:
| Vault Notes | enrich_per_run | Reasoning |
|-------------|---------------|-----------|
| < 100       | {{limits.enrich_per_run}} \xD7 2 | Small vault, process more aggressively |
| 100-500     | {{limits.enrich_per_run}} | Standard limits |
| 500+        | max({{limits.enrich_per_run}} \xF7 2, 3) | Large vault, be selective |

{{/if}}
### Candidate Selection

1. Scan vault for candidates:
   - Notes with \`status: seed\` and content < 200 words
   - Notes with 0 outgoing WikiLinks
   - Resource notes missing \`## Key Takeaways\`
   - Notes >1000 words without a \`## TL;DR\` section

{{#if features.enrichment_priority}}
### Priority Scoring (#37)

Rank candidates using **multi-factor priority** (not just journal references):

| Factor | Weight | Description |
|--------|--------|-------------|
| Journal references | High | More journals mention it \u2192 higher priority |
| Goal alignment | High | Connected to active goals in yearly/quarterly notes |
| Salience tags | Medium | Has \`#salient\` or \`#notable\` |
| Project activity | Medium | Referenced by active projects (not archived) |
| Connectivity | Medium | Orphan notes (0 incoming links) get priority boost |
| Recency | Low | More recently created notes slightly preferred |

{{/if}}
### Enrichment Actions

Process top candidates (adjusted by adaptive batch sizing):

**For all sparse notes (<200 words):**
- Extract key concepts and create/link resource notes
- Add 3-5 WikiLinks to related notes
- Expand thin sections
- Promote \`seed\` \u2192 \`growing\` if substantially enriched

{{#if features.context_anchoring}}
**Context Anchoring for sparse notes (#4):**
When enriching a sparse note, scan the vault for *when and why* it was created.
Find journal entries from the same week, identify what the user was working on.
Add \`## Origin Context\`:
\`\`\`markdown
## Origin Context
> [!context] Auto-generated by vault-gardener
> You likely created this during the week you were working on [[Project X]],
> after meeting with [[Person Y]]. Related journals: [[2026-01-15]], [[2026-01-17]].
\`\`\`
Use confidence language: "likely related to" when temporal correlation is strong,
"created during the same period as" when weaker.

{{/if}}
{{#if features.auto_summary}}
**Auto-Summary for long notes (#8):**
Any note >1000 words without a \`## TL;DR\` gets an auto-generated 2-3 sentence summary
placed after frontmatter:
\`\`\`markdown
> [!summary] Auto-generated by vault-gardener
> {2-3 sentence summary capturing the key point and main conclusion}
\`\`\`

{{/if}}
4. Report: "Enriched {count} notes, {remaining} remaining in queue"

---

## Commit (if git available)

\`\`\`bash
git add -A && git commit -m "vault-gardener tend: {date} ({enriched} enriched, {organized} organized)"
\`\`\`

---

{{#if features.changelog}}
## Vault Changelog

Append a human-readable summary of this tend run to \`.gardener/changelog.md\`:

\`\`\`markdown
### {YYYY-MM-DD HH:MM} \u2014 Tend
- {1-line summary of lifecycle/enrichment work}
- Journals generated: {weekly} weekly, {monthly} monthly, {quarterly} quarterly
- Notes enriched: {count} ({remaining} remaining)
- Summaries added: {count}
- Context anchors: {count}
\`\`\`

Keep only the last 50 entries in the changelog file.

{{/if}}
---

{{#if features.memory}}
## Memory Update

Update \`.gardener/memory.md\` with tend phase results:

\`\`\`markdown
## Tend Phase
- Enriched {count} notes, {remaining} in queue
- Next enrichment candidates: {top 3 by priority score}
- Journals generated: {list}
- {observations about vault health for next run}
## Vault Stats
- Total notes: {count}
- Seed notes: {count}
- Orphan notes: {count}
- Last full run: {date}
\`\`\`

This is the final phase \u2014 merge all memory sections into a clean file.

---

{{/if}}
## Run Report

After completing all steps, write a JSON file to \`.gardener/run-report.json\`:

\\\`\\\`\\\`json
{
  "version": 1,
  "timestamp": "{ISO-8601 timestamp}",
  "phases": [{
    "phase": "tend",
    "started": true,
    "features": [
      { "feature": "{key}", "status": "executed|skipped|error", "counts": { ... }, "reason": "{if skipped/error}" }
    ]
  }],
  "summary": "{1-2 sentence summary of what was done}",
  "warnings": []
}
\\\`\\\`\\\`

Report these features (only report enabled features listed here):
{{#if features.memory}}- \`memory\` \u2014 counts: \`{ "read": 0|1, "updated": 0|1 }\`
{{/if}}{{#if features.changelog}}- \`changelog\` \u2014 counts: \`{ "entries_written": 0|1 }\`
{{/if}}{{#if features.persona}}- \`persona\` \u2014 counts: \`{ "applied": 0|1 }\`
{{/if}}{{#if features.social_content}}- \`social_content\` \u2014 counts: \`{ "drafts_generated": {n} }\`
{{/if}}{{#if features.belief_trajectory}}- \`belief_trajectory\` \u2014 counts: \`{ "trajectories_tracked": {n} }\`
{{/if}}{{#if features.theme_detection}}- \`theme_detection\` \u2014 counts: \`{ "themes_detected": {n} }\`
{{/if}}{{#if features.attention_allocation}}- \`attention_allocation\` \u2014 counts: \`{ "allocations_tracked": {n} }\`
{{/if}}{{#if features.goal_tracking}}- \`goal_tracking\` \u2014 counts: \`{ "goals_tracked": {n} }\`
{{/if}}{{#if features.seasonal_patterns}}- \`seasonal_patterns\` \u2014 counts: \`{ "patterns_found": {n} }\`
{{/if}}{{#if features.adaptive_batch_sizing}}- \`adaptive_batch_sizing\` \u2014 counts: \`{ "adjusted": 0|1 }\`
{{/if}}{{#if features.enrichment_priority}}- \`enrichment_priority\` \u2014 counts: \`{ "candidates_scored": {n} }\`
{{/if}}{{#if features.context_anchoring}}- \`context_anchoring\` \u2014 counts: \`{ "anchors_added": {n} }\`
{{/if}}{{#if features.auto_summary}}- \`auto_summary\` \u2014 counts: \`{ "summaries_added": {n} }\`
{{/if}}{{#if features.question_tracker}}- \`question_tracker\` \u2014 counts: \`{ "questions_resolved": {n}, "questions_open": {n} }\`
{{/if}}{{#if features.commitment_tracker}}- \`commitment_tracker\` \u2014 counts: \`{ "commitments_reviewed": {n} }\`
{{/if}}

Also report core steps as features:
- \`stale_review\` \u2014 counts: \`{ "flagged": {n}, "consolidated": {n} }\`
- \`organizer\` \u2014 counts: \`{ "files_organized": {n} }\`
- \`journal_generation\` \u2014 counts: \`{ "weekly": {n}, "monthly": {n}, "quarterly": {n} }\`
- \`enrichment\` \u2014 counts: \`{ "notes_enriched": {n}, "remaining": {n} }\`

**Rules:**
- Report EVERY listed feature, even if skipped (use status "skipped" with a reason)
- The \`phase\` field MUST be exactly one of: \`"seed"\`, \`"nurture"\`, or \`"tend"\` \u2014 no other values
- Write valid JSON \u2014 no trailing commas, no comments
- If \`.gardener/run-report.json\` already exists (multi-phase run), read it first and APPEND your phase to the \`phases\` array

---

## Output

Summary:
- **Stale review**: {flagged} notes flagged, {consolidated} journals consolidated
- **Organization**: {organized} files organized into topic subfolders
- **Journals**: {weekly} weekly, {monthly} monthly, {quarterly} quarterly generated
- **Enrichment**: {enriched} notes enriched, {remaining} remaining in queue
- **Summaries**: {count} TL;DR sections added to long notes
- **Context**: {count} origin context sections added to sparse notes
- **Social**: {count} draft posts generated for {{#each social_platforms}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}`
    };
    compiled = /* @__PURE__ */ new Map();
    PHASE_NAMES = ["garden", "seed", "nurture", "tend"];
  }
});

// src/config/schema.ts
import { validate as cronValidate } from "node-cron";
function validateConfig(config) {
  const errors = [];
  const warnings = [];
  const c = config;
  for (const key of ["version", "provider", "tier", "folders"]) {
    if (c[key] == null) {
      errors.push(`Missing required key: ${key}`);
    }
  }
  if (config.provider && !["claude", "codex", "gemini"].includes(config.provider)) {
    errors.push(`Invalid provider "${config.provider}". Must be: claude, codex, gemini`);
  }
  if (config.persona && !["analytical", "reflective", "coach"].includes(config.persona)) {
    errors.push(`Invalid persona "${config.persona}". Must be: analytical, reflective, coach`);
  }
  if (config.tier && !["power", "fast"].includes(config.tier)) {
    errors.push(`Invalid tier "${config.tier}". Must be: power, fast`);
  }
  if (config.folders && typeof config.folders === "object") {
    if (!config.folders.inbox) {
      errors.push("Missing required folder: inbox");
    }
  }
  if (config.protected != null && !Array.isArray(config.protected)) {
    errors.push("protected must be an array");
  }
  if (config.limits && typeof config.limits === "object") {
    for (const [key, val] of Object.entries(config.limits)) {
      if (typeof val !== "number" || val < 1 || !Number.isInteger(val)) {
        warnings.push(`limits.${key} should be a positive integer (got ${val})`);
      }
    }
  }
  if (config.features && typeof config.features === "object") {
    for (const [key, val] of Object.entries(config.features)) {
      if (typeof val !== "boolean") {
        warnings.push(`features.${key} should be a boolean (got ${typeof val})`);
      }
    }
  }
  if (config.schedule?.cron) {
    if (!cronValidate(config.schedule.cron)) {
      errors.push(`Invalid cron expression: "${config.schedule.cron}"`);
    }
  }
  return { valid: errors.length === 0, errors, warnings };
}
function buildDefaultConfig(overrides = {}) {
  return {
    version: 1,
    provider: "claude",
    tier: "fast",
    persona: "reflective",
    folders: {
      inbox: "00-inbox",
      journal: "01-journal",
      projects: "02-projects",
      roles: "03-roles",
      resources: "04-resources",
      people: "05-people",
      orgs: "06-orgs",
      playbooks: "07-playbooks",
      sources: "08-sources",
      mocs: "09-mocs",
      archive: "99-archive",
      templates: "templates"
    },
    topics: {
      ideas: ["ideas", "concepts", "brainstorm", "innovation", "creativity"],
      finance: ["investing", "portfolio", "markets", "stocks", "economics", "money", "budget"],
      learning: ["learning", "education", "courses", "books", "research", "science"],
      health: ["health", "wellness", "fitness", "nutrition", "sleep", "exercise", "mental-health"],
      travel: ["travel", "trips", "destinations", "itinerary", "places"]
    },
    frontmatter: {
      required: ["created", "updated", "tags", "status", "type"],
      statuses: ["seed", "growing", "evergreen", "archived", "consolidated"],
      types: ["journal", "project", "role", "resource", "person", "org", "meeting", "idea", "playbook", "moc"]
    },
    schedule: {
      enabled: false,
      cron: "0 */4 * * *"
    },
    auto_grow: {
      projects: 5,
      roles: 3,
      resources: 3,
      people: 5,
      orgs: 8,
      playbooks: 5,
      sources: 5
    },
    limits: {
      beliefs_per_run: 10,
      playbooks_per_run: 2,
      mocs_per_run: 2,
      links_per_run: 10,
      organize_per_run: 10,
      enrich_per_run: 5
    },
    claude: {
      power_model: "opus",
      fast_model: "sonnet",
      timeout: 1500,
      max_turns: 200
    },
    codex: {
      power_model: "gpt-5.3-codex",
      fast_model: "gpt-5.3-codex-spark",
      timeout: 1500
    },
    gemini: {
      power_model: "gemini-3.1-pro-preview",
      fast_model: "gemini-3-flash-preview",
      timeout: 1500
    },
    journal: {
      style: {
        weekly: "structured",
        monthly: "structured",
        quarterly: "structured",
        yearly: "structured"
      },
      journal_subfolders: {
        yearly: "yearly",
        quarterly: "quarterly",
        monthly: "monthly",
        weekly: "weekly",
        daily: "daily"
      }
    },
    social_platforms: ["twitter", "linkedin"],
    protected: [
      ".gardener",
      ".obsidian",
      ".logseq",
      ".foam",
      ".dendron",
      ".vscode",
      ".git",
      "node_modules",
      "templates"
    ],
    resilience: { ...DEFAULT_RESILIENCE },
    features: { ...DEFAULT_FEATURES },
    ...overrides
  };
}
var DEFAULT_RESILIENCE, FEATURE_KEYS, DEFAULT_FEATURES;
var init_schema = __esm({
  "src/config/schema.ts"() {
    "use strict";
    DEFAULT_RESILIENCE = {
      queue_enabled: true,
      queue_max_size: 10,
      queue_max_age_hours: 24,
      metrics_timeout_seconds: 30,
      metrics_max_files: 5e4,
      lock_heartbeat_interval_seconds: 30,
      lock_stale_threshold_seconds: 300,
      provider_kill_grace_seconds: 10,
      log_max_size_mb: 10,
      log_max_backups: 3,
      daemon_max_consecutive_failures: 5,
      vault_quiet_seconds: 30,
      preflight_enabled: true
    };
    FEATURE_KEYS = Object.keys({
      memory: true,
      entity_auto_linking: true,
      question_tracker: true,
      context_anchoring: true,
      meeting_enhancement: true,
      auto_summary: true,
      backlink_context: true,
      transitive_links: true,
      co_mention_network: true,
      belief_trajectory: true,
      theme_detection: true,
      attention_allocation: true,
      knowledge_gaps: true,
      seasonal_patterns: true,
      goal_tracking: true,
      commitment_tracker: true,
      this_time_last_year: true,
      tag_normalization: true,
      persona: true,
      changelog: true,
      adaptive_batch_sizing: true,
      enrichment_priority: true,
      social_content: true
    });
    DEFAULT_FEATURES = {
      memory: true,
      entity_auto_linking: true,
      question_tracker: true,
      context_anchoring: true,
      meeting_enhancement: true,
      auto_summary: true,
      backlink_context: true,
      transitive_links: true,
      co_mention_network: true,
      belief_trajectory: true,
      theme_detection: true,
      attention_allocation: true,
      knowledge_gaps: true,
      seasonal_patterns: true,
      goal_tracking: true,
      commitment_tracker: true,
      this_time_last_year: true,
      tag_normalization: true,
      persona: true,
      changelog: true,
      adaptive_batch_sizing: true,
      enrichment_priority: true,
      social_content: true
    };
  }
});

// src/config/loader.ts
import { readFile as readFile2, writeFile as writeFile3, mkdir as mkdir3, copyFile, rename } from "fs/promises";
import { join as join4 } from "path";
import { parse, stringify } from "yaml";
import chalk from "chalk";
function getGardenerDir(cwd) {
  return join4(cwd ?? process.cwd(), GARDENER_DIR);
}
function getConfigPath(cwd) {
  return join4(getGardenerDir(cwd), CONFIG_FILE);
}
function deepMerge(defaults, user) {
  const result2 = { ...defaults };
  for (const key of Object.keys(user)) {
    if (user[key] != null && typeof user[key] === "object" && !Array.isArray(user[key]) && typeof defaults[key] === "object" && !Array.isArray(defaults[key])) {
      result2[key] = deepMerge(defaults[key], user[key]);
    } else {
      result2[key] = user[key];
    }
  }
  return result2;
}
async function loadConfig(cwd) {
  const configPath = getConfigPath(cwd);
  const bakPath = configPath + ".bak";
  let raw;
  let loadedFromBackup = false;
  try {
    raw = await readFile2(configPath, "utf-8");
  } catch {
    try {
      raw = await readFile2(bakPath, "utf-8");
      loadedFromBackup = true;
      console.error(chalk.yellow("Config restored from .bak"));
    } catch {
      throw new Error("No config.yaml found");
    }
  }
  let config;
  try {
    config = parse(raw);
  } catch {
    try {
      const bakRaw = await readFile2(bakPath, "utf-8");
      config = parse(bakRaw);
      loadedFromBackup = true;
      console.error(chalk.yellow("Config corrupted \u2014 restored from .bak"));
    } catch {
      throw new Error("config.yaml is corrupted and no valid .bak available");
    }
  }
  const { valid, errors, warnings } = validateConfig(config);
  if (!valid) {
    for (const err of errors) console.error(chalk.yellow(`[config auto-repair] ${err}`));
    const defaults = buildDefaultConfig();
    config = deepMerge(
      defaults,
      config
    );
  }
  for (const w of warnings) console.error(chalk.dim(`[config] ${w}`));
  config.resilience = { ...DEFAULT_RESILIENCE, ...config.resilience };
  config.features = { ...DEFAULT_FEATURES, ...config.features };
  if (loadedFromBackup) {
    await writeFile3(configPath, stringify(config, { lineWidth: 0 }), "utf-8").catch(() => {
    });
  }
  await copyFile(configPath, bakPath).catch(() => {
  });
  return config;
}
async function saveConfig(config, cwd) {
  const gardenerDir = getGardenerDir(cwd);
  await mkdir3(gardenerDir, { recursive: true });
  const configPath = getConfigPath(cwd);
  const tmpPath2 = configPath + ".tmp";
  const bakPath = configPath + ".bak";
  await writeFile3(tmpPath2, stringify(config, { lineWidth: 0 }), "utf-8");
  await rename(tmpPath2, configPath);
  await copyFile(configPath, bakPath).catch(() => {
  });
}
function resolveModel(config) {
  const providerConfig = config[config.provider];
  return config.tier === "power" ? providerConfig.power_model : providerConfig.fast_model;
}
function resolveTimeout(config) {
  return config[config.provider].timeout;
}
var GARDENER_DIR, CONFIG_FILE;
var init_loader = __esm({
  "src/config/loader.ts"() {
    "use strict";
    init_schema();
    GARDENER_DIR = ".gardener";
    CONFIG_FILE = "config.yaml";
  }
});

// src/config/index.ts
var init_config = __esm({
  "src/config/index.ts"() {
    "use strict";
    init_schema();
    init_loader();
  }
});

// src/cli/config.ts
var config_exports = {};
__export(config_exports, {
  DEFAULT_RESILIENCE: () => DEFAULT_RESILIENCE,
  buildDefaultConfig: () => buildDefaultConfig,
  configGet: () => configGet,
  configRegen: () => configRegen,
  configSet: () => configSet,
  deepMerge: () => deepMerge,
  getConfigPath: () => getConfigPath,
  getGardenerDir: () => getGardenerDir,
  loadConfig: () => loadConfig,
  resolveModel: () => resolveModel,
  resolveTimeout: () => resolveTimeout,
  saveConfig: () => saveConfig,
  validateConfig: () => validateConfig
});
import { stringify as stringify2 } from "yaml";
import chalk2 from "chalk";
function getNestedValue(obj, key) {
  const parts = key.split(".");
  let current = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return void 0;
    current = current[part];
  }
  return current;
}
function setNestedValue(obj, key, value) {
  const parts = key.split(".");
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (current[parts[i]] == null || typeof current[parts[i]] !== "object") {
      current[parts[i]] = {};
    }
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
}
async function configGet(key) {
  try {
    const config = await loadConfig();
    const value = getNestedValue(config, key);
    if (value === void 0) {
      console.error(chalk2.red(`Key "${key}" not found in config`));
      process.exit(1);
    }
    if (typeof value === "object") {
      console.log(stringify2(value));
    } else {
      console.log(String(value));
    }
  } catch {
    console.error(chalk2.red("No .gardener/config.yaml found. Run `vault-gardener init` first."));
    process.exit(1);
  }
}
async function configSet(key, value) {
  try {
    const config = await loadConfig();
    let parsed = value;
    if (!STRING_FIELDS.has(key)) {
      if (value === "true") parsed = true;
      else if (value === "false") parsed = false;
      else if (/^\d+$/.test(value)) parsed = parseInt(value, 10);
    }
    setNestedValue(config, key, parsed);
    const { valid, errors } = validateConfig(config);
    if (!valid) {
      for (const err of errors) {
        console.error(chalk2.red(`Validation error: ${err}`));
      }
      process.exit(1);
    }
    await saveConfig(config);
    console.log(chalk2.green(`Set ${key} = ${value}`));
  } catch {
    console.error(chalk2.red("No .gardener/config.yaml found. Run `vault-gardener init` first."));
    process.exit(1);
  }
}
async function configRegen() {
  try {
    const config = await loadConfig();
    const { renderAll: renderAll2 } = await Promise.resolve().then(() => (init_render(), render_exports));
    await renderAll2(getGardenerDir(), config);
    console.log(chalk2.green("Prompts regenerated in .gardener/prompts/"));
  } catch {
    console.error(chalk2.red("No .gardener/config.yaml found. Run `vault-gardener init` first."));
    process.exit(1);
  }
}
var STRING_FIELDS;
var init_config2 = __esm({
  "src/cli/config.ts"() {
    "use strict";
    init_config();
    init_config();
    STRING_FIELDS = /* @__PURE__ */ new Set([
      "provider",
      "tier",
      "schedule.cron",
      "folders.inbox",
      "folders.journal",
      "folders.projects",
      "folders.roles",
      "folders.resources",
      "folders.people",
      "folders.orgs",
      "folders.playbooks",
      "folders.sources",
      "folders.mocs",
      "folders.archive",
      "folders.templates",
      "claude.power_model",
      "claude.fast_model",
      "codex.power_model",
      "codex.fast_model",
      "gemini.power_model",
      "gemini.fast_model"
    ]);
  }
});

// src/queue/index.ts
import { readFile as readFile3, writeFile as writeFile5, rename as rename2 } from "fs/promises";
import { join as join6 } from "path";
function queuePath(gardenerDir) {
  return join6(gardenerDir, QUEUE_FILE);
}
function tmpPath(gardenerDir) {
  return join6(gardenerDir, QUEUE_FILE + ".tmp");
}
async function readQueue(gardenerDir) {
  try {
    const raw = await readFile3(queuePath(gardenerDir), "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}
async function writeQueue(gardenerDir, entries) {
  const tmp = tmpPath(gardenerDir);
  await writeFile5(tmp, JSON.stringify(entries, null, 2), "utf-8");
  await rename2(tmp, queuePath(gardenerDir));
}
function isStale(entry, maxAgeHours) {
  const age = Date.now() - new Date(entry.queuedAt).getTime();
  return age > maxAgeHours * 60 * 60 * 1e3;
}
async function enqueue(gardenerDir, entry, config) {
  const maxSize = config?.maxSize ?? DEFAULT_MAX_SIZE;
  const maxAgeHours = config?.maxAgeHours ?? DEFAULT_MAX_AGE_HOURS;
  let entries = await readQueue(gardenerDir);
  entries = entries.filter((e) => !isStale(e, maxAgeHours));
  entries.push(entry);
  while (entries.length > maxSize) {
    entries.shift();
  }
  await writeQueue(gardenerDir, entries);
}
async function purgeStale(gardenerDir, maxAgeHours = DEFAULT_MAX_AGE_HOURS) {
  const entries = await readQueue(gardenerDir);
  const fresh = entries.filter((e) => !isStale(e, maxAgeHours));
  const purged = entries.length - fresh.length;
  if (purged > 0) {
    await writeQueue(gardenerDir, fresh);
  }
  return purged;
}
var QUEUE_FILE, DEFAULT_MAX_SIZE, DEFAULT_MAX_AGE_HOURS;
var init_queue = __esm({
  "src/queue/index.ts"() {
    "use strict";
    QUEUE_FILE = "queue.json";
    DEFAULT_MAX_SIZE = 10;
    DEFAULT_MAX_AGE_HOURS = 24;
  }
});

// src/lock/index.ts
import { readFile as readFile4, writeFile as writeFile6, unlink as unlink2, rename as rename3, open, constants } from "fs/promises";
import { join as join7 } from "path";
import { hostname } from "os";
function lockPath(gardenerDir) {
  return join7(gardenerDir, LOCK_FILE);
}
function heartbeatPath(gardenerDir) {
  return join7(gardenerDir, HEARTBEAT_FILE);
}
function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
async function getHeartbeat(gardenerDir) {
  try {
    const raw = await readFile4(heartbeatPath(gardenerDir), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
async function isStaleWithHeartbeat(info, gardenerDir) {
  if (!isPidAlive(info.pid)) return true;
  const hb = await getHeartbeat(gardenerDir);
  if (hb) {
    const hbAge = Date.now() - new Date(hb.timestamp).getTime();
    if (hbAge > HEARTBEAT_STALE_MS) return true;
  }
  return false;
}
async function writeHeartbeat(gardenerDir) {
  const data = JSON.stringify({ pid: process.pid, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
  const tmpFile = heartbeatPath(gardenerDir) + ".tmp";
  await writeFile6(tmpFile, data, "utf-8");
  await rename3(tmpFile, heartbeatPath(gardenerDir));
}
async function removeFiles(gardenerDir) {
  await unlink2(lockPath(gardenerDir)).catch(() => {
  });
  await unlink2(heartbeatPath(gardenerDir)).catch(() => {
  });
}
async function acquireLock(gardenerDir, logger) {
  const path = lockPath(gardenerDir);
  const info = {
    pid: process.pid,
    startedAt: (/* @__PURE__ */ new Date()).toISOString(),
    hostname: hostname()
  };
  try {
    const fd = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
    await fd.writeFile(JSON.stringify(info, null, 2), "utf-8");
    await fd.close();
  } catch (err) {
    if (err.code === "EEXIST") {
      const existing = await getLockInfo(gardenerDir);
      if (existing && await isStaleWithHeartbeat(existing, gardenerDir)) {
        logger?.warn("lock.stale_removed", { context: { stalePid: existing.pid, staleHost: existing.hostname } });
        await removeFiles(gardenerDir);
        return acquireLock(gardenerDir, logger);
      }
      throw new Error(`Gardener is already running (PID: ${existing?.pid})`);
    }
    throw err;
  }
  await writeHeartbeat(gardenerDir);
  let heartbeatTimer = null;
  const handle = {
    startHeartbeat() {
      if (heartbeatTimer) return;
      heartbeatTimer = setInterval(() => {
        writeHeartbeat(gardenerDir).catch(() => {
        });
      }, HEARTBEAT_INTERVAL_MS);
      heartbeatTimer.unref();
    },
    stopHeartbeat() {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    },
    async release() {
      handle.stopHeartbeat();
      await removeFiles(gardenerDir);
    }
  };
  return handle;
}
async function acquireOrQueue(gardenerDir, queueEntry, logger) {
  try {
    return await acquireLock(gardenerDir, logger);
  } catch (err) {
    if (err.message.startsWith("Gardener is already running")) {
      logger?.info("lock.queued", { context: { phase: queueEntry.phase } });
      await enqueue(gardenerDir, queueEntry);
      return null;
    }
    throw err;
  }
}
async function forceRelease(gardenerDir, logger) {
  logger?.warn("lock.force_release");
  await removeFiles(gardenerDir);
}
async function isLocked(gardenerDir) {
  const info = await getLockInfo(gardenerDir);
  if (!info) return false;
  return !await isStaleWithHeartbeat(info, gardenerDir);
}
async function getLockInfo(gardenerDir) {
  try {
    const raw = await readFile4(lockPath(gardenerDir), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
var LOCK_FILE, HEARTBEAT_FILE, HEARTBEAT_INTERVAL_MS, HEARTBEAT_STALE_MS;
var init_lock = __esm({
  "src/lock/index.ts"() {
    "use strict";
    init_queue();
    LOCK_FILE = ".lock";
    HEARTBEAT_FILE = ".lock-heartbeat";
    HEARTBEAT_INTERVAL_MS = 3e4;
    HEARTBEAT_STALE_MS = 9e4;
  }
});

// src/logging/index.ts
import { appendFile, stat, rename as rename4, mkdir as mkdir5 } from "fs/promises";
import { join as join8 } from "path";
function buildEntry(level, event, data) {
  return {
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    level,
    event,
    ...data
  };
}
async function rotateIfNeeded(logPath, maxBytes, maxBackups) {
  try {
    const info = await stat(logPath);
    if (info.size > maxBytes) {
      for (let i = maxBackups - 1; i >= 1; i--) {
        await rename4(`${logPath}.${i}`, `${logPath}.${i + 1}`).catch(() => {
        });
      }
      await rename4(logPath, `${logPath}.1`);
    }
  } catch {
  }
}
async function createLogger(gardenerDir, opts) {
  const logsDir = join8(gardenerDir, LOG_DIR);
  await mkdir5(logsDir, { recursive: true });
  const logPath = join8(logsDir, LOG_FILE);
  const maxBytes = opts?.maxLogBytes ?? DEFAULT_MAX_LOG_BYTES;
  const maxBackups = opts?.maxBackups ?? DEFAULT_MAX_BACKUPS;
  await rotateIfNeeded(logPath, maxBytes, maxBackups);
  const verbose = opts?.verbose ?? false;
  let pendingWrites = [];
  function writeLine(entry) {
    const line = JSON.stringify(entry) + "\n";
    const p = appendFile(logPath, line, "utf-8").catch(() => {
      try {
        process.stderr.write(`[gardener] ${entry.level}: ${entry.event}
`);
      } catch {
      }
    });
    pendingWrites.push(p);
    if (pendingWrites.length > 50) {
      pendingWrites = pendingWrites.filter((pw) => {
        let resolved = false;
        pw.then(() => {
          resolved = true;
        });
        return !resolved;
      });
    }
  }
  function log(level, event, data) {
    const entry = buildEntry(level, event, data);
    if (!verbose && entry.error?.stack) {
      const { stack: _stack, ...rest } = entry.error;
      entry.error = rest;
    }
    writeLine(entry);
  }
  return {
    info: (event, data) => log("info", event, data),
    warn: (event, data) => log("warn", event, data),
    error: (event, data) => log("error", event, data),
    fatal: (event, data) => log("fatal", event, data),
    async flush() {
      await Promise.all(pendingWrites);
      pendingWrites = [];
    }
  };
}
var DEFAULT_MAX_LOG_BYTES, DEFAULT_MAX_BACKUPS, LOG_DIR, LOG_FILE;
var init_logging = __esm({
  "src/logging/index.ts"() {
    "use strict";
    DEFAULT_MAX_LOG_BYTES = 10 * 1024 * 1024;
    DEFAULT_MAX_BACKUPS = 3;
    LOG_DIR = "logs";
    LOG_FILE = "gardener.log";
  }
});

// src/metrics/collector.ts
import { readFile as readFile5, writeFile as writeFile7, readdir as readdir3, mkdir as mkdir6, stat as stat3, rename as rename5 } from "fs/promises";
import { join as join10, extname as extname2 } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { performance as performance2 } from "perf_hooks";
async function walkMd(dir, opts) {
  const maxFiles = opts?.maxFiles ?? DEFAULT_MAX_FILES;
  const timeoutMs = opts?.timeout;
  const startTime = timeoutMs != null ? performance2.now() : 0;
  const results = [];
  let approximate = false;
  let timedOut = false;
  async function walk(d) {
    if (approximate || timedOut) return;
    if (timeoutMs != null && performance2.now() - startTime > timeoutMs) {
      timedOut = true;
      approximate = true;
      return;
    }
    let entries;
    try {
      entries = await readdir3(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (approximate || timedOut) return;
      if (entry.name.startsWith(".") || SKIP_DIRS3.has(entry.name)) continue;
      if (entry.isSymbolicLink()) continue;
      const full = join10(d, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && extname2(entry.name) === ".md") {
        results.push(full);
        if (results.length >= maxFiles) {
          approximate = true;
          return;
        }
      }
    }
  }
  await walk(dir);
  return { files: results, approximate, timedOut };
}
async function countInbox(dir) {
  try {
    const entries = await readdir3(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && extname2(e.name) === ".md").length;
  } catch {
    return 0;
  }
}
async function matchesInHead(filePath, pattern, lines) {
  try {
    const info = await stat3(filePath);
    if (info.size > MAX_FILE_SIZE) return false;
    const content = await readFile5(filePath, "utf-8");
    const head = content.split("\n").slice(0, lines).join("\n");
    return head.includes(pattern);
  } catch {
    return false;
  }
}
async function countLinks(files, timeout) {
  const timeoutMs = timeout ?? COUNT_LINKS_TIMEOUT_MS;
  const startTime = performance2.now();
  let total = 0;
  const linkPattern = /\[\[/g;
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    if (performance2.now() - startTime > timeoutMs) break;
    const batch = files.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (file) => {
        try {
          const info = await stat3(file);
          if (info.size > MAX_FILE_SIZE) return 0;
          const content = await readFile5(file, "utf-8");
          const matches = content.match(linkPattern);
          return matches ? matches.length : 0;
        } catch {
          return 0;
        }
      })
    );
    for (const count of batchResults) total += count;
  }
  return total;
}
async function countMoved(cwd) {
  try {
    const { stdout } = await execFileAsync("git", ["diff", "--name-only", "--diff-filter=R"], {
      cwd
    });
    return stdout.trim().split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}
async function countSeeds(files, timeout) {
  const timeoutMs = timeout ?? SEED_DETECTION_TIMEOUT_MS;
  const startTime = performance2.now();
  let total = 0;
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    if (performance2.now() - startTime > timeoutMs) break;
    const batch = files.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map((f) => matchesInHead(f, "status: seed", 10))
    );
    total += results.filter(Boolean).length;
  }
  return total;
}
async function collectPreMetrics(vaultPath, config, opts) {
  const inboxDir = join10(vaultPath, config.folders.inbox ?? "00-inbox");
  const walkResult = await walkMd(vaultPath, opts);
  const seedCount = await countSeeds(walkResult.files);
  const linkCount = await countLinks(walkResult.files);
  return {
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    inboxItems: await countInbox(inboxDir),
    totalNotes: walkResult.files.length,
    seedNotes: seedCount,
    totalLinks: linkCount
  };
}
async function collectPostMetrics(vaultPath, config, pre, opts) {
  const inboxDir = join10(vaultPath, config.folders.inbox ?? "00-inbox");
  const walkResult = await walkMd(vaultPath, opts);
  const seedCount = await countSeeds(walkResult.files);
  const linkCount = await countLinks(walkResult.files);
  const inboxItems = await countInbox(inboxDir);
  const notesMoved = await countMoved(vaultPath);
  return {
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    inboxItems,
    totalNotes: walkResult.files.length,
    seedNotes: seedCount,
    totalLinks: linkCount,
    inboxProcessed: pre.inboxItems - inboxItems,
    linksAdded: linkCount - pre.totalLinks,
    notesMoved
  };
}
async function writeMetrics(gardenerDir, metrics) {
  const metricsDir = join10(gardenerDir, "metrics");
  await mkdir6(metricsDir, { recursive: true });
  const filename = `${metrics.date}.json`;
  const filePath = join10(metricsDir, filename);
  let runs = [];
  try {
    const raw = await readFile5(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      runs = parsed;
    }
  } catch {
  }
  runs.push(metrics);
  const tmpFile = filePath + ".tmp";
  await writeFile7(tmpFile, JSON.stringify(runs, null, 2), "utf-8");
  await rename5(tmpFile, filePath);
}
async function readMetrics(gardenerDir, days) {
  const metricsDir = join10(gardenerDir, "metrics");
  let files;
  try {
    const entries = await readdir3(metricsDir);
    files = entries.filter((f) => f.endsWith(".json")).sort();
  } catch {
    return [];
  }
  if (days && days > 0) {
    const cutoff = /* @__PURE__ */ new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    files = files.filter((f) => f.replace(".json", "") >= cutoffStr);
  }
  const allRuns = [];
  for (const file of files) {
    try {
      const raw = await readFile5(join10(metricsDir, file), "utf-8");
      const runs = JSON.parse(raw);
      allRuns.push(...runs);
    } catch {
    }
  }
  return allRuns.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}
var execFileAsync, SKIP_DIRS3, DEFAULT_MAX_FILES, MAX_FILE_SIZE, COUNT_LINKS_TIMEOUT_MS, BATCH_SIZE, SEED_DETECTION_TIMEOUT_MS;
var init_collector = __esm({
  "src/metrics/collector.ts"() {
    "use strict";
    execFileAsync = promisify(execFile);
    SKIP_DIRS3 = /* @__PURE__ */ new Set([".git", ".obsidian", ".gardener", "node_modules", ".trash"]);
    DEFAULT_MAX_FILES = 5e4;
    MAX_FILE_SIZE = 1048576;
    COUNT_LINKS_TIMEOUT_MS = 3e4;
    BATCH_SIZE = 100;
    SEED_DETECTION_TIMEOUT_MS = 3e4;
  }
});

// src/analysis/utils.ts
import { execFile as execFile2 } from "child_process";
import { promisify as promisify2 } from "util";
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result2 = {};
  for (const line of match[1].split("\n")) {
    const sepMatch = line.match(/^([a-zA-Z_-]+)\s*:\s*(.*)/);
    if (sepMatch) {
      result2[sepMatch[1]] = sepMatch[2].trim();
    }
  }
  return result2;
}
function gitCommand(cwd, args) {
  return execFileAsync2("git", args, { cwd, timeout: 5e3 }).then((r) => r.stdout.trim()).catch(() => "");
}
var execFileAsync2;
var init_utils = __esm({
  "src/analysis/utils.ts"() {
    "use strict";
    execFileAsync2 = promisify2(execFile2);
  }
});

// src/analysis/suggestions.ts
import { readdir as readdir5, readFile as readFile8, stat as stat4 } from "fs/promises";
import { join as join13, extname as extname3 } from "path";
async function generateSuggestions(opts) {
  const suggestions = [];
  const { vaultPath, folders } = opts;
  try {
    const inboxPath = join13(vaultPath, folders.inbox ?? "00-inbox");
    const entries = await readdir5(inboxPath, { withFileTypes: true });
    const mdFiles = entries.filter((e) => e.isFile() && extname3(e.name) === ".md");
    const now = Date.now();
    let oldCount = 0;
    for (const file of mdFiles) {
      try {
        const s = await stat4(join13(inboxPath, file.name));
        if ((now - s.mtimeMs) / (1e3 * 60 * 60 * 24) > 7) oldCount++;
      } catch {
        continue;
      }
    }
    if (oldCount > 0) {
      suggestions.push(`${oldCount} item${oldCount > 1 ? "s have" : " has"} been in inbox for over 7 days`);
    }
  } catch {
  }
  const growingFolders = ["projects", "roles", "resources"].map((k) => folders[k]).filter((v) => typeof v === "string" && v.length > 0);
  let staleGrowing = 0;
  for (const folder of growingFolders) {
    try {
      const folderPath = join13(vaultPath, folder);
      const entries = await readdir5(folderPath, { recursive: true });
      const mdFiles = entries.filter((e) => e.endsWith(".md"));
      for (const file of mdFiles.slice(0, 50)) {
        try {
          const content = await readFile8(join13(folderPath, file), "utf-8");
          const fm = parseFrontmatter(content);
          if (fm.status !== "growing") continue;
          const updated = fm.updated ? new Date(fm.updated) : null;
          if (updated && (Date.now() - updated.getTime()) / (1e3 * 60 * 60 * 24) > 30) {
            staleGrowing++;
          }
        } catch {
          continue;
        }
      }
    } catch {
      continue;
    }
  }
  if (staleGrowing > 0) {
    suggestions.push(`${staleGrowing} growing note${staleGrowing > 1 ? "s haven't" : " hasn't"} been updated in 30+ days`);
  }
  try {
    const projectsPath = join13(vaultPath, folders.projects ?? "02-projects");
    const entries = await readdir5(projectsPath, { recursive: true });
    const mdFiles = entries.filter((e) => e.endsWith(".md"));
    let approachingCount = 0;
    for (const file of mdFiles) {
      try {
        const content = await readFile8(join13(projectsPath, file), "utf-8");
        const fm = parseFrontmatter(content);
        if (!fm.deadline || fm.status === "archived") continue;
        const deadline = new Date(fm.deadline);
        const daysLeft = (deadline.getTime() - Date.now()) / (1e3 * 60 * 60 * 24);
        if (daysLeft > 0 && daysLeft <= 14) approachingCount++;
      } catch {
        continue;
      }
    }
    if (approachingCount > 0) {
      suggestions.push(`${approachingCount} project${approachingCount > 1 ? "s have" : " has"} deadline${approachingCount > 1 ? "s" : ""} in the next 14 days`);
    }
  } catch {
  }
  return suggestions;
}
var init_suggestions = __esm({
  "src/analysis/suggestions.ts"() {
    "use strict";
    init_utils();
  }
});

// src/analysis/weekly-brief.ts
import { readdir as readdir6, readFile as readFile9 } from "fs/promises";
import { join as join14, basename } from "path";
async function generateWeeklyBrief(opts) {
  const { vaultPath, folders } = opts;
  const weekAgo = await gitCommand(vaultPath, ["log", "--since=7 days ago", "--diff-filter=A", "--name-only", "--format=", "--", "*.md"]);
  const newNotes = [...new Set(weekAgo.split("\n").filter(Boolean))];
  const weekChanges = await gitCommand(vaultPath, ["log", "--since=7 days ago", "--name-only", "--format=", "--", "*.md"]);
  const areaActivity = {};
  for (const line of weekChanges.split("\n").filter(Boolean)) {
    const folder = line.split("/")[0];
    if (folder) areaActivity[folder] = (areaActivity[folder] || 0) + 1;
  }
  const mostActiveAreas = Object.entries(areaActivity).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([folder]) => folder);
  const approachingDeadlines = [];
  try {
    const projectsPath = join14(vaultPath, folders.projects ?? "02-projects");
    const entries = await readdir6(projectsPath, { recursive: true });
    const mdFiles = entries.filter((e) => e.endsWith(".md"));
    for (const file of mdFiles) {
      try {
        const content = await readFile9(join14(projectsPath, file), "utf-8");
        const fm = parseFrontmatter(content);
        if (!fm.deadline || fm.status === "archived") continue;
        const deadline = new Date(fm.deadline);
        const daysLeft = Math.ceil((deadline.getTime() - Date.now()) / (1e3 * 60 * 60 * 24));
        if (daysLeft > 0 && daysLeft <= 14) {
          approachingDeadlines.push({
            title: basename(file, ".md"),
            deadline: fm.deadline,
            daysLeft
          });
        }
      } catch {
        continue;
      }
    }
  } catch {
  }
  approachingDeadlines.sort((a, b) => a.daysLeft - b.daysLeft);
  const archiveSuggestions = [];
  const archiveFolders = ["projects", "resources"].map((k) => folders[k]).filter((v) => typeof v === "string" && v.length > 0);
  for (const folder of archiveFolders) {
    try {
      const folderPath = join14(vaultPath, folder);
      const entries = await readdir6(folderPath, { recursive: true });
      for (const file of entries.filter((e) => e.endsWith(".md")).slice(0, 50)) {
        try {
          const content = await readFile9(join14(folderPath, file), "utf-8");
          const fm = parseFrontmatter(content);
          if (fm.status !== "seed") continue;
          const created = fm.created ? new Date(fm.created) : null;
          if (created && (Date.now() - created.getTime()) / (1e3 * 60 * 60 * 24) > 30) {
            archiveSuggestions.push(basename(file, ".md"));
          }
        } catch {
          continue;
        }
      }
    } catch {
      continue;
    }
  }
  return {
    vaultGrowth: newNotes.length,
    mostActiveAreas,
    approachingDeadlines: approachingDeadlines.slice(0, 5),
    archiveSuggestions: archiveSuggestions.slice(0, 5)
  };
}
var init_weekly_brief = __esm({
  "src/analysis/weekly-brief.ts"() {
    "use strict";
    init_utils();
  }
});

// src/analysis/activity.ts
import { basename as basename2 } from "path";
async function analyzeActivity(vaultPath) {
  const recentNames = await gitCommand(vaultPath, [
    "log",
    "--since=24 hours ago",
    "--author=gardener",
    "--name-only",
    "--format=",
    "--",
    "*.md"
  ]);
  const notesEnriched = parseChangedNotes(recentNames);
  const notesMoved = await parseMoved(vaultPath);
  const recentDiff = await gitCommand(vaultPath, [
    "log",
    "--since=24 hours ago",
    "--author=gardener",
    "-p",
    "--",
    "*.md"
  ]);
  const linksCreated = countLinksInDiff(recentDiff);
  return {
    inboxProcessed: 0,
    // filled by caller from metrics
    linksCreated,
    notesEnriched,
    notesMoved
  };
}
function parseChangedNotes(nameOutput) {
  if (!nameOutput) return [];
  const seen = /* @__PURE__ */ new Set();
  return nameOutput.split("\n").filter((line) => line.endsWith(".md")).map((line) => {
    const fullPath = line.trim().replace(/\.md$/, "");
    if (!fullPath || seen.has(fullPath)) return null;
    seen.add(fullPath);
    return { name: basename2(fullPath), path: fullPath };
  }).filter((n) => n !== null).slice(0, 10);
}
async function parseMoved(vaultPath) {
  const output = await gitCommand(vaultPath, [
    "log",
    "--since=24 hours ago",
    "--author=gardener",
    "--name-status",
    "--diff-filter=R",
    "--format=",
    "--",
    "*.md"
  ]);
  if (!output) return [];
  return output.split("\n").filter((line) => line.startsWith("R")).map((line) => {
    const parts = line.split("	");
    if (parts.length < 3) return null;
    const fromPath = parts[1].replace(/\.md$/, "");
    const toPath = parts[2].replace(/\.md$/, "");
    return { name: basename2(toPath), fromPath, toPath };
  }).filter((n) => n !== null).slice(0, 10);
}
function countLinksInDiff(diffOutput) {
  const linkPattern = /\[\[.+?\]\]/g;
  let count = 0;
  for (const line of diffOutput.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      const matches = line.match(linkPattern);
      if (matches) count += matches.length;
    }
  }
  return count;
}
var init_activity = __esm({
  "src/analysis/activity.ts"() {
    "use strict";
    init_utils();
  }
});

// src/cli/digest.ts
var digest_exports = {};
__export(digest_exports, {
  digestCommand: () => digestCommand,
  generateDigest: () => generateDigest
});
import { writeFile as writeFile9, mkdir as mkdir8 } from "fs/promises";
import { join as join15 } from "path";
import chalk5 from "chalk";
async function digestCommand(options) {
  const cwd = process.cwd();
  const digest = await generateDigest(cwd, { ...options, writeToDisk: true });
  if (options.json) {
    console.log(JSON.stringify(digest, null, 2));
  } else {
    printDigest(digest);
  }
}
async function generateDigest(vaultPath, options = {}) {
  const gardenerDir = getGardenerDir(vaultPath);
  let config;
  try {
    config = await loadConfig(vaultPath);
  } catch {
    config = { folders: { inbox: "00-inbox", projects: "02-projects", roles: "03-roles", resources: "04-resources" } };
  }
  const metrics = await readMetrics(gardenerDir, 7);
  const latest = metrics[0] ?? null;
  const lastRun = latest ? {
    timestamp: latest.timestamp,
    status: latest.exitCode === 0 ? "completed" : "error",
    phase: latest.phase,
    duration: latest.duration_seconds,
    provider: latest.provider
  } : null;
  const activity = await analyzeActivity(vaultPath);
  if (latest) {
    activity.inboxProcessed = latest.metrics.inbox_processed;
  }
  const suggestions = await generateSuggestions({
    vaultPath,
    folders: config.folders
  });
  const summaryParts = [];
  if (activity.inboxProcessed > 0) summaryParts.push(`${activity.inboxProcessed} inbox items processed`);
  if (activity.linksCreated > 0) summaryParts.push(`${activity.linksCreated} WikiLinks created`);
  if (activity.notesEnriched.length > 0) summaryParts.push(`${activity.notesEnriched.length} notes enriched`);
  const inboxCount = await countInbox(join15(vaultPath, config.folders.inbox ?? "00-inbox"));
  if (inboxCount > 0) summaryParts.push(`${inboxCount} item${inboxCount !== 1 ? "s" : ""} in inbox`);
  const summary = summaryParts.length > 0 ? summaryParts.join(", ") : "No recent gardener activity";
  const digest = {
    generated: (/* @__PURE__ */ new Date()).toISOString(),
    summary,
    lastRun,
    activity,
    suggestions
  };
  const includeWeekly = options.weekly ?? (/* @__PURE__ */ new Date()).getDay() === 0;
  if (includeWeekly) {
    digest.weeklyBrief = await generateWeeklyBrief({
      vaultPath,
      folders: config.folders
    });
  }
  if (options.writeToDisk !== false) {
    const digestPath = join15(gardenerDir, "digest.json");
    await mkdir8(gardenerDir, { recursive: true });
    await writeFile9(digestPath, JSON.stringify(digest, null, 2), "utf-8");
  }
  return digest;
}
function printDigest(digest) {
  console.log(chalk5.bold("\nvault-gardener digest\n"));
  console.log(chalk5.cyan("Summary"));
  console.log(`  ${digest.summary}`);
  if (digest.lastRun) {
    console.log(chalk5.cyan("\nLast Run"));
    console.log(`  Phase: ${digest.lastRun.phase}`);
    console.log(`  Status: ${digest.lastRun.status === "completed" ? chalk5.green("completed") : chalk5.red(digest.lastRun.status)}`);
    console.log(`  Duration: ${digest.lastRun.duration}s`);
    console.log(`  Provider: ${digest.lastRun.provider}`);
    console.log(`  Time: ${digest.lastRun.timestamp}`);
  }
  if (digest.suggestions.length > 0) {
    console.log(chalk5.cyan("\nSuggestions"));
    for (const s of digest.suggestions) {
      console.log(`  ${chalk5.yellow("!")} ${s}`);
    }
  }
  if (digest.weeklyBrief) {
    const wb = digest.weeklyBrief;
    console.log(chalk5.cyan("\nWeekly Brief"));
    console.log(`  New notes: ${wb.vaultGrowth}`);
    if (wb.mostActiveAreas.length > 0) console.log(`  Active areas: ${wb.mostActiveAreas.join(", ")}`);
    if (wb.approachingDeadlines.length > 0) {
      console.log(`  Deadlines:`);
      for (const d of wb.approachingDeadlines) {
        console.log(`    ${d.title} -- ${d.daysLeft}d left`);
      }
    }
    if (wb.archiveSuggestions.length > 0) {
      console.log(`  Consider archiving: ${wb.archiveSuggestions.join(", ")}`);
    }
  }
  console.log("");
}
var init_digest = __esm({
  "src/cli/digest.ts"() {
    "use strict";
    init_config2();
    init_collector();
    init_suggestions();
    init_weekly_brief();
    init_activity();
  }
});

// src/cli/recover.ts
var recover_exports = {};
__export(recover_exports, {
  recoverCommand: () => recoverCommand
});
import { readFile as readFile15, readdir as readdir7, rename as rename8, rm, stat as stat5, unlink as unlink5, access as access4 } from "fs/promises";
import { join as join23 } from "path";
import { execFileSync as execFileSync2 } from "child_process";
import chalk10 from "chalk";
async function recoverCommand() {
  const cwd = process.cwd();
  const gardenerDir = getGardenerDir(cwd);
  const logger = await createLogger(gardenerDir);
  let fixed = 0;
  let reported = 0;
  console.log(chalk10.bold("\nvault-gardener recover\n"));
  const lockFile = join23(gardenerDir, ".lock");
  try {
    const raw = await readFile15(lockFile, "utf-8");
    let lockData;
    try {
      lockData = JSON.parse(raw);
    } catch {
      await unlink5(lockFile);
      console.log(chalk10.green("  [FIXED] Removed orphan .lock (invalid JSON)"));
      logger.info("recover.orphan_lock_removed");
      fixed++;
      lockData = {};
    }
    if (lockData.pid != null) {
      if (!isPidAlive(lockData.pid)) {
        await unlink5(lockFile);
        console.log(chalk10.green(`  [FIXED] Removed stale .lock (PID ${lockData.pid} dead)`));
        logger.info("recover.stale_lock_removed", { context: { pid: lockData.pid } });
        fixed++;
      } else {
        console.log(chalk10.yellow(`  [REPORT] .lock held by PID ${lockData.pid} (alive)`));
        reported++;
      }
    }
  } catch {
  }
  const heartbeatFile = join23(gardenerDir, ".lock-heartbeat");
  try {
    await access4(heartbeatFile);
    try {
      await access4(lockFile);
    } catch {
      await unlink5(heartbeatFile);
      console.log(chalk10.green("  [FIXED] Removed orphan .lock-heartbeat"));
      logger.info("recover.orphan_heartbeat_removed");
      fixed++;
    }
  } catch {
  }
  try {
    const staged = execFileSync2("git", ["diff", "--cached", "--name-only"], {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    if (staged.trim()) {
      const files = staged.trim().split("\n");
      console.log(chalk10.yellow(`  [REPORT] ${files.length} staged-but-uncommitted file(s)`));
      for (const f of files.slice(0, 5)) {
        console.log(chalk10.dim(`           ${f}`));
      }
      if (files.length > 5) console.log(chalk10.dim(`           ... and ${files.length - 5} more`));
      reported++;
    }
  } catch {
  }
  const tmpDir = join23(gardenerDir, ".gardener.tmp");
  try {
    const info = await stat5(tmpDir);
    if (info.isDirectory()) {
      await rm(tmpDir, { recursive: true, force: true });
      console.log(chalk10.green("  [FIXED] Removed orphan .gardener.tmp/"));
      logger.info("recover.orphan_tmp_removed");
      fixed++;
    }
  } catch {
  }
  try {
    const purged = await purgeStale(gardenerDir, 24);
    if (purged > 0) {
      console.log(chalk10.green(`  [FIXED] Purged ${purged} stale queue entry(ies) (>24h)`));
      logger.info("recover.stale_queue_purged", { context: { purged } });
      fixed++;
    }
  } catch {
  }
  const metricsDir = join23(gardenerDir, "metrics");
  try {
    const files = await readdir7(metricsDir);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const filePath = join23(metricsDir, file);
      try {
        const raw = await readFile15(filePath, "utf-8");
        JSON.parse(raw);
      } catch {
        const corruptPath = filePath + ".corrupt";
        await rename8(filePath, corruptPath);
        console.log(chalk10.green(`  [FIXED] Renamed corrupted metrics: ${file} \u2192 ${file}.corrupt`));
        logger.info("recover.corrupt_metrics", { context: { file } });
        fixed++;
      }
    }
  } catch {
  }
  console.log("");
  if (fixed === 0 && reported === 0) {
    console.log(chalk10.green("All clear \u2014 no issues found."));
  } else {
    console.log(chalk10.dim(`Fixed: ${fixed}  Reported: ${reported}`));
  }
}
var init_recover = __esm({
  "src/cli/recover.ts"() {
    "use strict";
    init_logging();
    init_queue();
    init_lock();
    init_config2();
  }
});

// src/cli/index.ts
import { createRequire } from "module";
import { Command } from "commander";

// src/cli/init.ts
import { mkdir as mkdir4, access as access2 } from "fs/promises";
import { join as join5 } from "path";
import { createInterface } from "readline";
import chalk3 from "chalk";

// src/scanner/detect.ts
import { readdir, access } from "fs/promises";
import { join, extname } from "path";
var PARA_PLUS_PATTERNS = {
  "00-inbox": "inbox",
  "01-journal": "journal",
  "02-projects": "projects",
  "03-roles": "roles",
  "04-resources": "resources",
  "05-people": "people",
  "06-orgs": "orgs",
  "07-playbooks": "playbooks",
  "08-sources": "sources",
  "09-mocs": "mocs",
  "99-archive": "archive"
};
var ZETTELKASTEN_FOLDERS = ["inbox", "zettelkasten", "references", "templates"];
var FLAT_FOLDERS = ["inbox", "notes", "archive"];
var ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}\.md$/;
var YEAR_RE = /^(20\d{2})$/;
var SKIP_DIRS = /* @__PURE__ */ new Set([
  "node_modules",
  ".git",
  ".obsidian",
  ".logseq",
  ".foam",
  ".trash",
  ".gardener"
]);
async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
var COUNT_MAX_FILES = 5e4;
async function countMarkdownFiles(dir, state = { count: 0 }) {
  if (state.count >= COUNT_MAX_FILES) return state.count;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return state.count;
  }
  for (const entry of entries) {
    if (state.count >= COUNT_MAX_FILES) break;
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await countMarkdownFiles(fullPath, state);
    } else if (entry.isFile() && extname(entry.name) === ".md") {
      state.count++;
    }
  }
  return state.count;
}
async function detectTool(vaultPath) {
  if (await exists(join(vaultPath, ".obsidian"))) return "obsidian";
  if (await exists(join(vaultPath, ".logseq"))) return "logseq";
  if (await exists(join(vaultPath, ".foam"))) return "foam";
  if (await exists(join(vaultPath, ".dendron.yml"))) return "dendron";
  return null;
}
function detectFolders(topLevelDirs) {
  const detected = {};
  const lowerDirs = new Map(topLevelDirs.map((d) => [d.toLowerCase(), d]));
  for (const [pattern, key] of Object.entries(PARA_PLUS_PATTERNS)) {
    const match = lowerDirs.get(pattern);
    if (match) {
      detected[key] = match;
    }
  }
  const plainMappings = {
    inbox: "inbox",
    journal: "journal",
    journals: "journal",
    projects: "projects",
    roles: "roles",
    resources: "resources",
    people: "people",
    orgs: "orgs",
    organizations: "orgs",
    playbooks: "playbooks",
    sources: "sources",
    references: "sources",
    mocs: "mocs",
    archive: "archive",
    archives: "archive",
    templates: "templates",
    notes: "resources",
    zettelkasten: "resources"
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
function scorePreset(detected, topLevelDirs) {
  const lowerDirs = new Set(topLevelDirs.map((d) => d.toLowerCase()));
  const paraKeys = Object.keys(PARA_PLUS_PATTERNS);
  const paraMatches = paraKeys.filter((p) => lowerDirs.has(p)).length;
  const paraConfidence = paraMatches / paraKeys.length;
  const zetMatches = ZETTELKASTEN_FOLDERS.filter((f) => lowerDirs.has(f)).length;
  const zetConfidence = zetMatches / ZETTELKASTEN_FOLDERS.length;
  const flatMatches = FLAT_FOLDERS.filter((f) => lowerDirs.has(f)).length;
  const flatConfidence = flatMatches / FLAT_FOLDERS.length;
  const scores = [
    { preset: "para-plus", confidence: paraConfidence },
    { preset: "zettelkasten", confidence: zetConfidence },
    { preset: "flat", confidence: flatConfidence }
  ];
  scores.sort((a, b) => b.confidence - a.confidence);
  const best = scores[0];
  if (best.confidence < 0.2) {
    return { preset: null, confidence: 0 };
  }
  return { preset: best.preset, confidence: Math.round(best.confidence * 100) / 100 };
}
async function detectJournalStructure(vaultPath, detected) {
  const result2 = {
    hasYearFolders: false,
    subfolders: {},
    namingPattern: "unknown"
  };
  const journalDir = detected.journal ? join(vaultPath, detected.journal) : null;
  if (!journalDir || !await exists(journalDir)) {
    return result2;
  }
  let entries;
  try {
    entries = await readdir(journalDir, { withFileTypes: true });
  } catch {
    return result2;
  }
  const yearFolders = entries.filter(
    (e) => e.isDirectory() && YEAR_RE.test(e.name)
  );
  result2.hasYearFolders = yearFolders.length > 0;
  const subfoldersToCheck = ["yearly", "quarterly", "monthly", "weekly", "daily"];
  const searchDirs = result2.hasYearFolders ? yearFolders.map((yf) => join(journalDir, yf.name)) : [journalDir];
  for (const searchDir of searchDirs) {
    let subEntries;
    try {
      subEntries = await readdir(searchDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const sub of subfoldersToCheck) {
      if (!result2.subfolders[sub]) {
        const match = subEntries.find(
          (e) => e.isDirectory() && e.name.toLowerCase() === sub
        );
        if (match) {
          result2.subfolders[sub] = match.name;
        }
      }
    }
  }
  const mdFiles = await collectJournalFiles(journalDir, 3);
  if (mdFiles.length > 0) {
    const isoCount = mdFiles.filter((f) => ISO_DATE_RE.test(f)).length;
    if (isoCount / mdFiles.length > 0.5) {
      result2.namingPattern = "iso-date";
    } else if (mdFiles.length > 0) {
      result2.namingPattern = "custom";
    }
  }
  return result2;
}
async function collectJournalFiles(dir, maxDepth, depth = 0) {
  if (depth > maxDepth) return [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory()) {
      const sub = await collectJournalFiles(
        join(dir, entry.name),
        maxDepth,
        depth + 1
      );
      files.push(...sub);
    } else if (entry.isFile() && extname(entry.name) === ".md") {
      files.push(entry.name);
    }
  }
  return files;
}
async function scanVault(vaultPath) {
  const entries = await readdir(vaultPath, { withFileTypes: true });
  const topLevelDirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name);
  const detected = detectFolders(topLevelDirs);
  const { preset, confidence } = scorePreset(detected, topLevelDirs);
  const tool = await detectTool(vaultPath);
  const totalNotes = await countMarkdownFiles(vaultPath);
  const journalStructure = await detectJournalStructure(vaultPath, detected);
  return {
    preset,
    confidence,
    detected,
    journalStructure,
    totalNotes,
    tool
  };
}

// src/scanner/presets.ts
var PRESETS = {
  "para-plus": {
    name: "para-plus",
    folders: {
      inbox: "00-inbox",
      journal: "01-journal",
      projects: "02-projects",
      roles: "03-roles",
      resources: "04-resources",
      people: "05-people",
      orgs: "06-orgs",
      playbooks: "07-playbooks",
      sources: "08-sources",
      mocs: "09-mocs",
      archive: "99-archive",
      templates: "templates"
    },
    topics: {
      "ai-tech": ["ai", "machine-learning", "llm", "deep-learning", "nlp", "robotics"],
      neuroscience: ["brain", "cognition", "consciousness", "neuroplasticity"],
      complexity: ["complex-systems", "emergence", "networks", "chaos-theory"],
      space: ["astronomy", "astrophysics", "space-exploration", "cosmology"],
      energy: ["renewable", "nuclear", "fusion", "battery", "grid"],
      quantum: ["quantum-computing", "quantum-mechanics", "quantum-information"],
      longevity: ["aging", "lifespan", "senescence", "longevity-research"],
      health: ["nutrition", "exercise", "sleep", "mental-health", "biohacking"],
      psychology: ["behavior", "motivation", "decision-making", "habits"],
      philosophy: ["epistemology", "ethics", "metaphysics", "stoicism"],
      finance: ["investing", "markets", "economics", "crypto", "venture-capital"],
      learning: ["pedagogy", "spaced-repetition", "meta-learning", "memory"],
      parenting: ["child-development", "education", "family"],
      strategy: ["business-strategy", "leadership", "management", "operations"],
      music: ["piano", "composition", "music-theory", "practice"]
    },
    frontmatter: {
      required: ["created", "updated", "tags", "status", "type"],
      statuses: ["seed", "growing", "evergreen", "archived", "consolidated"],
      types: [
        "journal",
        "project",
        "role",
        "resource",
        "person",
        "org",
        "meeting",
        "idea",
        "playbook",
        "moc",
        "source"
      ]
    }
  },
  zettelkasten: {
    name: "zettelkasten",
    folders: {
      inbox: "inbox",
      resources: "zettelkasten",
      sources: "references",
      projects: "projects",
      templates: "templates"
    },
    topics: {
      ideas: ["concept", "hypothesis", "insight"],
      literature: ["book", "paper", "article"],
      permanent: ["synthesis", "principle", "framework"],
      projects: ["deliverable", "output", "milestone"]
    },
    frontmatter: {
      required: ["created", "updated", "tags", "status", "type"],
      statuses: ["fleeting", "literature", "permanent", "archived"],
      types: ["fleeting", "literature", "permanent", "project", "index"]
    }
  },
  flat: {
    name: "flat",
    folders: {
      inbox: "inbox",
      archive: "archive"
    },
    topics: {
      ideas: ["idea", "thought", "brainstorm"],
      reference: ["note", "snippet", "bookmark"]
    },
    frontmatter: {
      required: ["created", "tags"],
      statuses: ["draft", "done", "archived"],
      types: ["note", "idea", "reference"]
    }
  }
};
function getPreset(name) {
  const preset = PRESETS[name];
  if (!preset) {
    const available = Object.keys(PRESETS).join(", ");
    throw new Error(`Unknown preset "${name}". Available: ${available}`);
  }
  return preset;
}
function listPresets() {
  return Object.keys(PRESETS);
}

// src/providers/detect.ts
init_claude();
init_codex();
init_gemini();
var PRIORITY = ["claude", "codex", "gemini"];
async function detectProviders() {
  const providers = [
    createClaudeProvider(),
    createCodexProvider(),
    createGeminiProvider()
  ];
  const checks = await Promise.all(
    providers.map(async (p) => ({
      name: p.name,
      ok: await p.isAvailable()
    }))
  );
  const available = checks.filter((c) => c.ok).map((c) => c.name);
  const recommended = PRIORITY.find((name) => available.includes(name)) ?? null;
  return { available, recommended };
}

// src/cli/init.ts
init_render();
init_config2();
function ask(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}
async function choose(rl, prompt, options, defaultIdx = 0) {
  console.log(chalk3.cyan(prompt));
  for (let i = 0; i < options.length; i++) {
    const marker = i === defaultIdx ? chalk3.green("\u2192") : " ";
    console.log(`  ${marker} ${i + 1}. ${options[i]}`);
  }
  const answer = await ask(rl, `Choice [${defaultIdx + 1}]: `);
  const idx = answer ? parseInt(answer, 10) - 1 : defaultIdx;
  if (idx < 0 || idx >= options.length) return options[defaultIdx];
  return options[idx];
}
async function choosePreset(rl) {
  const presets = listPresets();
  const choice = await choose(rl, "Choose a vault preset:", [
    "para-plus (PARA+ with 11 folders \u2014 recommended for Obsidian)",
    "zettelkasten (Zettelkasten-style with inbox + notes)",
    "flat (Minimal \u2014 inbox, notes, archive)"
  ]);
  if (choice.startsWith("zettelkasten")) return "zettelkasten";
  if (choice.startsWith("flat")) return "flat";
  return "para-plus";
}
async function initCommand(options) {
  const cwd = process.cwd();
  const gardenerDir = getGardenerDir(cwd);
  const interactive = options.interactive !== false;
  const rl = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  try {
    await runInit(cwd, gardenerDir, interactive, options, rl);
  } finally {
    rl?.close();
  }
}
async function runInit(cwd, gardenerDir, interactive, options, rl) {
  console.log(chalk3.bold("\nvault-gardener init\n"));
  try {
    await access2(gardenerDir);
    if (interactive && rl) {
      const answer = await ask(
        rl,
        chalk3.yellow(".gardener/ already exists. Reset? (y/N): ")
      );
      if (answer.toLowerCase() !== "y") {
        console.log("Aborted.");
        return;
      }
    }
  } catch {
  }
  console.log(chalk3.dim("Scanning vault..."));
  const scan = await scanVault(cwd);
  console.log(
    chalk3.dim(
      `Found ${scan.totalNotes} notes` + (scan.tool ? ` (${scan.tool} vault)` : "") + (scan.preset ? ` \u2014 detected ${chalk3.bold(scan.preset)} structure (${Math.round(scan.confidence * 100)}% confidence)` : "")
    )
  );
  let config;
  if (options.preset) {
    const preset = getPreset(options.preset);
    config = buildDefaultConfig({
      folders: preset.folders,
      topics: preset.topics,
      frontmatter: preset.frontmatter
    });
    console.log(chalk3.green(`Using preset: ${options.preset}`));
  } else if (scan.preset && scan.confidence > 0.7) {
    if (interactive && rl) {
      console.log(chalk3.cyan("\nDetected folder structure:"));
      for (const [key, value] of Object.entries(scan.detected)) {
        if (value) console.log(`  ${chalk3.dim(key)}: ${value}/`);
      }
      const answer = await ask(rl, "\nUse detected structure? (Y/n): ");
      if (answer.toLowerCase() === "n") {
        const presetName = await choosePreset(rl);
        const preset = getPreset(presetName);
        config = buildDefaultConfig({
          folders: preset.folders,
          topics: preset.topics,
          frontmatter: preset.frontmatter
        });
      } else {
        config = buildDefaultConfig({
          folders: scan.detected
        });
      }
    } else {
      config = buildDefaultConfig({
        folders: scan.detected
      });
    }
  } else {
    if (interactive && rl) {
      const presetName = await choosePreset(rl);
      const preset = getPreset(presetName);
      config = buildDefaultConfig({
        folders: preset.folders,
        topics: preset.topics,
        frontmatter: preset.frontmatter
      });
      const scaffold = await ask(
        rl,
        chalk3.cyan("Scaffold folders now? (Y/n): ")
      );
      if (scaffold.toLowerCase() !== "n") {
        for (const folder of Object.values(config.folders)) {
          await mkdir4(join5(cwd, folder), { recursive: true });
        }
        console.log(chalk3.green("Folders created."));
      }
    } else {
      config = buildDefaultConfig();
    }
  }
  if (scan.journalStructure.subfolders.daily) {
    config.journal.journal_subfolders = {
      ...config.journal.journal_subfolders,
      ...scan.journalStructure.subfolders
    };
  }
  console.log(chalk3.dim("\nDetecting LLM providers..."));
  const providers = await detectProviders();
  if (providers.available.length === 0) {
    console.error(
      chalk3.red(
        "\nNo LLM CLI tools found. Install one of:\n  claude  \u2014 https://docs.anthropic.com/en/docs/claude-code\n  codex   \u2014 https://github.com/openai/codex\n  gemini  \u2014 https://github.com/google-gemini/gemini-cli\n"
      )
    );
    process.exit(1);
  }
  console.log(
    chalk3.dim(`Available: ${providers.available.join(", ")}`)
  );
  if (options.provider) {
    config.provider = options.provider;
  } else if (interactive && rl && providers.available.length > 1) {
    const providerChoice = await choose(
      rl,
      "\nChoose LLM provider:",
      providers.available.map(
        (p) => `${p}${p === providers.recommended ? " (recommended)" : ""}`
      )
    );
    config.provider = providerChoice.replace(" (recommended)", "");
  } else {
    config.provider = providers.recommended ?? providers.available[0];
  }
  if (options.tier) {
    config.tier = options.tier;
  } else if (interactive && rl) {
    const tierChoice = await choose(rl, "\nChoose model tier:", [
      "fast (recommended \u2014 quicker, cheaper)",
      "power (thorough, slower)"
    ]);
    config.tier = tierChoice.startsWith("fast") ? "fast" : "power";
  }
  const model = config.tier === "power" ? config[config.provider].power_model : config[config.provider].fast_model;
  console.log(
    chalk3.dim(`
Provider: ${config.provider}, Tier: ${config.tier}, Model: ${model}`)
  );
  await mkdir4(gardenerDir, { recursive: true });
  await mkdir4(join5(gardenerDir, "prompts"), { recursive: true });
  await mkdir4(join5(gardenerDir, "metrics"), { recursive: true });
  await mkdir4(join5(gardenerDir, "logs"), { recursive: true });
  await saveConfig(config, cwd);
  console.log(chalk3.dim("Wrote .gardener/config.yaml"));
  await renderAll(gardenerDir, config);
  console.log(chalk3.dim("Generated .gardener/context.md and .gardener/prompts/"));
  if (interactive) {
    console.log(
      chalk3.dim(
        "\nConsider adding to .gitignore:\n  .gardener/logs/\n  .gardener/.lock\n  .gardener/metrics/\n"
      )
    );
  }
  console.log(
    chalk3.green.bold(
      `
Ready! Run ${chalk3.cyan("vault-gardener run")} to start your first garden cycle.
`
    )
  );
}

// src/cli/run.ts
init_config2();
init_render();
init_lock();
init_logging();
import { join as join16 } from "path";
import { writeFile as writeFile10 } from "fs/promises";
import chalk6 from "chalk";
import ora from "ora";

// src/preflight/index.ts
import { readdir as readdir2, stat as stat2, access as access3 } from "fs/promises";
import { join as join9 } from "path";
import { execFileSync } from "child_process";
import { performance } from "perf_hooks";
var SYNC_CONFLICT_MAX_FILES = 1e4;
var SYNC_CONFLICT_TIMEOUT_MS = 5e3;
var SKIP_DIRS2 = /* @__PURE__ */ new Set([".git", ".obsidian", ".gardener", "node_modules", ".trash"]);
function result() {
  return { ok: true, errors: [], warnings: [] };
}
async function checkVaultAccessibility(vaultPath, r, timeout = 5e3) {
  try {
    await Promise.race([
      readdir2(vaultPath),
      new Promise(
        (_, reject) => setTimeout(() => reject(new Error("Vault access timed out")), timeout)
      )
    ]);
  } catch (err) {
    r.ok = false;
    r.errors.push(`Vault inaccessible: ${err.message}`);
  }
}
async function checkVaultQuiet(vaultPath, config, r) {
  const quietSeconds = config.resilience?.vault_quiet_seconds ?? 30;
  const inboxDir = join9(vaultPath, config.folders?.inbox ?? "00-inbox");
  const dirsToCheck = [vaultPath, inboxDir];
  try {
    const now = Date.now();
    const threshold = quietSeconds * 1e3;
    for (const dir of dirsToCheck) {
      let entries;
      try {
        entries = await readdir2(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
        const info = await stat2(join9(dir, entry.name));
        if (now - info.mtimeMs < threshold) {
          r.warnings.push(`Vault has recent edits (${entry.name} modified <${quietSeconds}s ago)`);
          return;
        }
      }
    }
  } catch {
  }
}
async function detectSyncConflicts(vaultPath, r) {
  const conflictPatterns = ["sync-conflict", "(conflict)", ".icloud"];
  const startTime = performance.now();
  let filesChecked = 0;
  async function walk(dir) {
    if (filesChecked >= SYNC_CONFLICT_MAX_FILES) return;
    if (performance.now() - startTime > SYNC_CONFLICT_TIMEOUT_MS) return;
    let entries;
    try {
      entries = await readdir2(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (filesChecked >= SYNC_CONFLICT_MAX_FILES) return;
      if (performance.now() - startTime > SYNC_CONFLICT_TIMEOUT_MS) return;
      const name = entry.name;
      if (name.startsWith(".") && name !== ".icloud") continue;
      if (SKIP_DIRS2.has(name)) continue;
      const full = join9(dir, name);
      if (entry.isDirectory()) {
        await walk(full);
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
  await walk(vaultPath);
}
function validateGitState(vaultPath, r) {
  try {
    const headRef = execFileSync("git", ["symbolic-ref", "-q", "HEAD"], {
      cwd: vaultPath,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    if (!headRef.trim()) {
      r.warnings.push("Git is in detached HEAD state");
    }
  } catch {
    r.warnings.push("Git is in detached HEAD state or not a git repo");
  }
  try {
    const mergeHead = execFileSync("git", ["rev-parse", "--verify", "MERGE_HEAD"], {
      cwd: vaultPath,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    if (mergeHead.trim()) {
      r.ok = false;
      r.errors.push("Git has unresolved merge conflicts");
    }
  } catch {
  }
  try {
    const staged = execFileSync("git", ["diff", "--cached", "--name-only"], {
      cwd: vaultPath,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    if (staged.trim()) {
      r.warnings.push("Git has staged but uncommitted changes");
    }
  } catch {
  }
}
function checkDiskSpace(vaultPath, r, minMB = 100) {
  try {
    const output = execFileSync("df", ["-Pk", vaultPath], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    const lines = output.trim().split("\n");
    if (lines.length < 2) return;
    const parts = lines[1].split(/\s+/);
    const availableKB = parseInt(parts[3], 10);
    if (isNaN(availableKB)) return;
    const availableMB = availableKB / 1024;
    if (availableMB < minMB) {
      r.ok = false;
      r.errors.push(`Low disk space: ${Math.round(availableMB)}MB available (minimum: ${minMB}MB)`);
    }
  } catch {
    r.warnings.push("Could not check disk space");
  }
}
async function checkPreviousRunDirty(gardenerDir, r) {
  try {
    const entries = await readdir2(gardenerDir);
    for (const name of entries) {
      if (name === ".lock" || name.endsWith(".gardener.tmp")) {
        r.warnings.push(`Stale artifact from previous run: ${name}`);
      }
    }
  } catch {
  }
}
function checkProviderCli(provider, r) {
  try {
    execFileSync("which", [provider], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch {
    r.ok = false;
    r.errors.push(`Provider CLI not found: ${provider}`);
  }
}
async function checkContextFiles(gardenerDir, r) {
  const promptsDir = join9(gardenerDir, "prompts");
  try {
    await access3(promptsDir);
  } catch {
    r.ok = false;
    r.errors.push("Missing prompts/ directory in gardener dir. Run `vault-gardener init` first.");
  }
}
async function runPreflight(vaultPath, gardenerDir, config, logger) {
  const r = result();
  logger.info("preflight_start", { phase: "preflight" });
  await checkVaultAccessibility(vaultPath, r);
  if (!r.ok) {
    logger.error("preflight_fail", { phase: "preflight", context: { errors: r.errors } });
    return r;
  }
  await checkVaultQuiet(vaultPath, config, r);
  await detectSyncConflicts(vaultPath, r);
  validateGitState(vaultPath, r);
  checkDiskSpace(vaultPath, r);
  await checkPreviousRunDirty(gardenerDir, r);
  checkProviderCli(config.provider, r);
  await checkContextFiles(gardenerDir, r);
  if (r.warnings.length > 0) {
    logger.warn("preflight_warnings", {
      phase: "preflight",
      context: { warnings: r.warnings }
    });
  }
  if (!r.ok) {
    logger.error("preflight_fail", { phase: "preflight", context: { errors: r.errors } });
  } else {
    logger.info("preflight_pass", { phase: "preflight" });
  }
  return r;
}

// src/notify/index.ts
async function notifyFailure(metrics, logger) {
  const url = process.env.GARDENER_WEBHOOK_URL;
  if (!url) {
    logger.info("notify_skip", { context: { reason: "GARDENER_WEBHOOK_URL not set" } });
    return;
  }
  try {
    new URL(url);
  } catch {
    logger.warn("notify_skip", { context: { reason: "GARDENER_WEBHOOK_URL is not a valid URL" } });
    return;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5e3);
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(metrics),
      signal: controller.signal
    });
    logger.info("notify_sent", { phase: metrics.phase });
  } catch (err) {
    logger.warn("notify_failed", {
      phase: metrics.phase,
      error: { message: err.message }
    });
  } finally {
    clearTimeout(timer);
  }
}

// src/cli/run.ts
init_collector();

// src/metrics/format.ts
import chalk4 from "chalk";
function formatSummary(metrics) {
  const phase = chalk4.cyan(metrics.phase.charAt(0).toUpperCase() + metrics.phase.slice(1));
  const inbox = metrics.metrics.inbox_processed;
  const links = metrics.metrics.links_added;
  const moved = metrics.metrics.notes_moved;
  const duration = metrics.duration_seconds;
  const exit = metrics.exitCode;
  const parts = [];
  if (exit === 0) {
    parts.push(`${phase} complete.`);
  } else {
    parts.push(`${phase} ${chalk4.red("failed")} (exit ${exit}).`);
  }
  const details = [];
  if (inbox > 0) details.push(`${chalk4.green(String(inbox))} inbox items processed`);
  if (links > 0) details.push(`${chalk4.green(String(links))} links added`);
  if (moved > 0) details.push(`${chalk4.green(String(moved))} notes moved`);
  if (details.length > 0) {
    parts.push(details.join(", ") + ".");
  }
  parts.push(chalk4.dim(`(${duration}s)`));
  return parts.join(" ");
}

// src/reports/features.ts
var FEATURE_PHASE_MAP = {
  memory: ["seed", "nurture", "tend"],
  changelog: ["seed", "nurture", "tend"],
  persona: ["seed", "nurture", "tend"],
  this_time_last_year: ["seed"],
  meeting_enhancement: ["seed"],
  question_tracker: ["seed", "tend"],
  commitment_tracker: ["seed", "nurture", "tend"],
  tag_normalization: ["nurture"],
  co_mention_network: ["nurture"],
  knowledge_gaps: ["nurture"],
  entity_auto_linking: ["nurture"],
  backlink_context: ["nurture"],
  transitive_links: ["nurture"],
  social_content: ["tend"],
  belief_trajectory: ["tend"],
  theme_detection: ["tend"],
  attention_allocation: ["tend"],
  goal_tracking: ["tend"],
  seasonal_patterns: ["tend"],
  adaptive_batch_sizing: ["tend"],
  enrichment_priority: ["tend"],
  context_anchoring: ["tend"],
  auto_summary: ["tend"]
};
function featuresForPhase(phase, enabledFeatures) {
  const flags = enabledFeatures;
  return Object.entries(FEATURE_PHASE_MAP).filter(([key, phases]) => phases.includes(phase) && flags[key]).map(([key]) => key);
}

// src/reports/parser.ts
import { readFile as readFile6 } from "fs/promises";
import { join as join11 } from "path";
var REPORT_FILENAME = "run-report.json";
async function parseRunReport(cwd, enabledFeatures) {
  const gardenerDir = join11(cwd, ".gardener");
  const reportPath = join11(gardenerDir, REPORT_FILENAME);
  let raw;
  try {
    raw = await readFile6(reportPath, "utf-8");
  } catch {
    return null;
  }
  const parseErrors = [];
  const validationWarnings = [];
  const missingFeatures = [];
  const unexpectedFeatures = [];
  let report;
  try {
    report = JSON.parse(raw);
  } catch (err) {
    parseErrors.push(`Invalid JSON: ${err.message}`);
    return {
      version: 1,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      phases: [],
      _parsed: {
        reportPath,
        parseErrors,
        validationWarnings,
        missingFeatures,
        unexpectedFeatures
      }
    };
  }
  if (report.version !== 1) {
    validationWarnings.push(`Unexpected version: ${report.version}`);
  }
  if (!report.timestamp) {
    validationWarnings.push("Missing timestamp");
  }
  if (!Array.isArray(report.phases)) {
    parseErrors.push("phases must be an array");
    report.phases = [];
  }
  for (const phase of report.phases) {
    validatePhase(phase, enabledFeatures, validationWarnings, missingFeatures, unexpectedFeatures);
  }
  return {
    ...report,
    _parsed: {
      reportPath,
      parseErrors,
      validationWarnings,
      missingFeatures,
      unexpectedFeatures
    }
  };
}
function validatePhase(phase, enabledFeatures, validationWarnings, missingFeatures, unexpectedFeatures) {
  if (!["seed", "nurture", "tend"].includes(phase.phase)) {
    validationWarnings.push(`Unknown phase: ${phase.phase}`);
    return;
  }
  if (!Array.isArray(phase.features)) {
    validationWarnings.push(`${phase.phase}: features must be an array`);
    phase.features = [];
    return;
  }
  for (const f of phase.features) {
    validateFeatureReport(f, phase.phase, validationWarnings);
  }
  const expected = new Set(featuresForPhase(phase.phase, enabledFeatures));
  const reported = new Set(phase.features.map((f) => f.feature));
  for (const key of expected) {
    if (!reported.has(key)) {
      missingFeatures.push(`${phase.phase}/${key}`);
    }
  }
  for (const key of reported) {
    if (!expected.has(key)) {
      unexpectedFeatures.push(`${phase.phase}/${key}`);
    }
  }
}
function validateFeatureReport(f, phase, warnings) {
  if (!f.feature) {
    warnings.push(`${phase}: feature report missing 'feature' key`);
  }
  if (!["executed", "skipped", "error"].includes(f.status)) {
    warnings.push(`${phase}/${f.feature}: invalid status "${f.status}"`);
  }
  if (f.status === "error") {
    warnings.push(`${phase}/${f.feature}: reported error \u2014 ${f.reason ?? "no reason given"}`);
  }
  if (f.counts == null || typeof f.counts !== "object") {
    warnings.push(`${phase}/${f.feature}: missing or invalid counts`);
  }
}

// src/reports/store.ts
import { readFile as readFile7, writeFile as writeFile8, readdir as readdir4, mkdir as mkdir7, rename as rename6 } from "fs/promises";
import { join as join12 } from "path";
async function archiveReport(gardenerDir, report) {
  const date = report.timestamp.slice(0, 10);
  const reportsDir = join12(gardenerDir, "reports");
  await mkdir7(reportsDir, { recursive: true });
  const filePath = join12(reportsDir, `${date}.json`);
  let existing = [];
  try {
    const raw = await readFile7(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) existing = parsed;
  } catch {
  }
  existing.push(report);
  const tmpFile = filePath + ".tmp";
  await writeFile8(tmpFile, JSON.stringify(existing, null, 2), "utf-8");
  await rename6(tmpFile, filePath);
}
async function readReports(gardenerDir, days = 30) {
  const reportsDir = join12(gardenerDir, "reports");
  let files;
  try {
    const entries = await readdir4(reportsDir);
    files = entries.filter((f) => f.endsWith(".json")).sort();
  } catch {
    return [];
  }
  if (days > 0) {
    const cutoff = /* @__PURE__ */ new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    files = files.filter((f) => f.replace(".json", "") >= cutoffStr);
  }
  const all = [];
  for (const file of files) {
    try {
      const raw = await readFile7(join12(reportsDir, file), "utf-8");
      const reports = JSON.parse(raw);
      all.push(...reports);
    } catch {
    }
  }
  return all.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}
async function readLatestReport(gardenerDir) {
  const reports = await readReports(gardenerDir, 7);
  return reports[0] ?? null;
}
async function writeGardeningLog(gardenerDir, report, ctx) {
  const now = /* @__PURE__ */ new Date();
  const date = localDate(now);
  const year = date.slice(0, 4);
  const time = localTime(now);
  const logsDir = join12(gardenerDir, "logs", year);
  await mkdir7(logsDir, { recursive: true });
  const logPath = join12(logsDir, `${date}.md`);
  let existing = "";
  try {
    existing = await readFile7(logPath, "utf-8");
  } catch {
  }
  const entry = renderLogEntry(report, ctx, time);
  const content = existing ? `${existing}
${entry}` : `# Gardening Log \u2014 ${date}

${entry}`;
  await writeFile8(logPath, content, "utf-8");
}
function renderLogEntry(report, ctx, time) {
  const { phase, duration, config, pre, post } = ctx;
  const model = resolveModelName(config);
  const lines = [];
  if (!report) {
    lines.push(`## ${time} \u2014 ${capitalize(phase)} (${config.provider}/${model}, ${duration}s)`);
    lines.push("");
    lines.push("> No feature report \u2014 LLM did not write run-report.json");
    lines.push("");
    lines.push("### Vault Health");
    lines.push(renderVaultHealth(pre, post));
    lines.push("");
    lines.push("---");
    return lines.join("\n");
  }
  const hasErrors = report._parsed.parseErrors.length > 0;
  const marker = hasErrors ? "\u26A0" : "\u2713";
  lines.push(`## ${time} \u2014 ${capitalize(phase)} (${config.provider}/${model}, ${duration}s) ${marker}`);
  lines.push("");
  for (const phaseReport of report.phases) {
    if (report.phases.length > 1) {
      lines.push(`### ${capitalize(phaseReport.phase)} Phase`);
      lines.push("");
    }
    if (phaseReport.features.length > 0) {
      lines.push("### Features");
      lines.push("| Feature | Status | Details |");
      lines.push("|---------|--------|---------|");
      for (const f of phaseReport.features) {
        const statusIcon = featureStatusIcon(f.status);
        const details = formatFeatureDetails(f);
        lines.push(`| ${f.feature} | ${statusIcon} | ${details} |`);
      }
      lines.push("");
    }
  }
  lines.push("### Vault Health");
  lines.push(renderVaultHealth(pre, post));
  lines.push("");
  const allWarnings = [
    ...report._parsed.validationWarnings,
    ...report._parsed.missingFeatures.map((f) => `${f} enabled but not reported`)
  ];
  if (allWarnings.length > 0) {
    lines.push("### Warnings");
    for (const w of allWarnings) {
      lines.push(`- \u26A0 ${w}`);
    }
    lines.push("");
  }
  if (report.summary) {
    lines.push(`> ${report.summary}`);
    lines.push("");
  }
  lines.push("---");
  return lines.join("\n");
}
function renderVaultHealth(pre, post) {
  const lines = [];
  lines.push(formatDelta("Notes", pre.totalNotes, post.totalNotes));
  lines.push(formatDelta("Inbox", pre.inboxItems, post.inboxItems));
  lines.push(formatDelta("Seed", pre.seedNotes, post.seedNotes));
  return lines.join("\n");
}
function formatDelta(label, before, after) {
  const diff = after - before;
  const sign = diff >= 0 ? "+" : "";
  return `- ${label}: ${before.toLocaleString()} \u2192 ${after.toLocaleString()} (${sign}${diff})`;
}
function featureStatusIcon(status) {
  switch (status) {
    case "executed":
      return "\u2713";
    case "skipped":
      return "\u2013";
    case "error":
      return "\u2717";
    default:
      return "?";
  }
}
function formatFeatureDetails(f) {
  if (f.status === "skipped" && f.reason) return `skipped: ${f.reason}`;
  if (f.status === "error" && f.reason) return `error: ${f.reason}`;
  if (f.notes) return f.notes;
  const entries = Object.entries(f.counts ?? {});
  if (entries.length === 0) return f.status;
  return entries.map(([k, v]) => `${v} ${k.replace(/_/g, " ")}`).join(", ");
}
function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function resolveModelName(config) {
  const providerConfig = config[config.provider];
  const key = config.tier === "power" ? "power_model" : "fast_model";
  return providerConfig?.[key] ?? config.tier;
}
function localDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function localTime(d) {
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${min}`;
}

// src/cli/run.ts
var PHASE_PROMPTS = {
  seed: "seed.md",
  nurture: "nurture.md",
  tend: "tend.md",
  all: "garden.md"
};
async function runCommand(phase, options) {
  const cwd = process.cwd();
  const gardenerDir = getGardenerDir(cwd);
  const resolvedPhase = phase ?? "all";
  if (!["seed", "nurture", "tend", "all"].includes(resolvedPhase)) {
    console.error(
      chalk6.red(`Invalid phase "${resolvedPhase}". Use: seed, nurture, tend, or all`)
    );
    process.exit(1);
  }
  let config;
  try {
    config = await loadConfig(cwd);
  } catch {
    console.error(
      chalk6.red("No .gardener/config.yaml found. Run `vault-gardener init` first.")
    );
    process.exit(1);
  }
  if (options.provider) config.provider = options.provider;
  if (options.tier) config.tier = options.tier;
  const model = resolveModel(config);
  const timeout = resolveTimeout(config);
  const promptFile = join16(gardenerDir, "prompts", PHASE_PROMPTS[resolvedPhase]);
  const contextFile = join16(gardenerDir, "context.md");
  const logger = await createLogger(gardenerDir, { verbose: options.verbose });
  logger.info("run_start", { phase: resolvedPhase, provider: config.provider, model });
  if (options.validate || !options.force) {
    const preflight = await runPreflight(cwd, gardenerDir, config, logger);
    if (preflight.warnings.length > 0) {
      for (const w of preflight.warnings) {
        console.log(chalk6.yellow(`  [warn] ${w}`));
      }
    }
    if (!preflight.ok) {
      for (const e of preflight.errors) {
        console.error(chalk6.red(`  [error] ${e}`));
      }
      process.exit(1);
    }
  }
  if (options.validate) {
    console.log(chalk6.green("Preflight checks passed."));
    process.exit(0);
  }
  console.log(
    chalk6.dim(
      `
vault-gardener run ${resolvedPhase} \u2014 ${config.provider}/${model}
`
    )
  );
  if (options.dryRun) {
    console.log(chalk6.yellow("Dry run \u2014 would execute:"));
    console.log(chalk6.dim(`  Provider: ${config.provider}`));
    console.log(chalk6.dim(`  Model: ${model}`));
    console.log(chalk6.dim(`  Prompt: ${promptFile}`));
    console.log(chalk6.dim(`  Context: ${contextFile}`));
    console.log(chalk6.dim(`  Timeout: ${timeout}s`));
    console.log(chalk6.dim(`  CWD: ${cwd}`));
    return;
  }
  if (options.forceUnlock) {
    await forceRelease(gardenerDir, logger);
  }
  let lockHandle;
  try {
    if (options.noQueue) {
      lockHandle = await acquireLock(gardenerDir, logger);
    } else {
      const queueEntry = {
        phase: resolvedPhase,
        provider: config.provider,
        tier: config.tier,
        queuedAt: (/* @__PURE__ */ new Date()).toISOString(),
        reason: "lock_busy"
      };
      const handle = await acquireOrQueue(gardenerDir, queueEntry, logger);
      if (!handle) {
        console.log(chalk6.yellow("Gardener busy \u2014 run queued for next invocation."));
        process.exit(0);
      }
      lockHandle = handle;
    }
  } catch (err) {
    console.error(chalk6.red(`${err.message}`));
    process.exit(1);
  }
  lockHandle.startHeartbeat();
  const startTime = Date.now();
  let exitCode = 0;
  try {
    await renderAll(gardenerDir, config);
    const pre = await collectPreMetrics(cwd, config);
    const provider = await loadProvider(config.provider, config);
    const spinner = options.verbose ? null : ora({
      text: `Running ${resolvedPhase} phase...`,
      color: "green"
    }).start();
    const runOpts = {
      prompt: `Read ${contextFile} for vault context, then read ${promptFile} and execute all steps.`,
      contextFile,
      promptFile,
      cwd,
      timeout,
      model,
      verbose: options.verbose,
      gardenerDir
    };
    const result2 = await provider.run(runOpts);
    exitCode = result2.exitCode;
    if (spinner) spinner.stop();
    if (result2.exitCode !== 0) {
      console.error(chalk6.red(`
Provider exited with code ${result2.exitCode}`));
      if (result2.output) {
        console.error(chalk6.dim(result2.output.slice(-500)));
      }
    }
    const post = await collectPostMetrics(cwd, config, pre);
    const duration = Math.round((Date.now() - startTime) / 1e3);
    let report = null;
    try {
      report = await parseRunReport(cwd, config.features);
      if (report) {
        for (const w of report._parsed.validationWarnings) {
          logger.warn("report_validation", { context: { warning: w } });
        }
        if (report._parsed.missingFeatures.length > 0) {
          logger.warn("report_missing_features", { context: { features: report._parsed.missingFeatures } });
        }
        await archiveReport(gardenerDir, report);
      } else {
        logger.warn("report_not_found");
      }
    } catch {
      logger.warn("report_parse_failed");
    }
    try {
      await writeGardeningLog(gardenerDir, report, {
        pre,
        post,
        duration,
        phase: resolvedPhase,
        config
      });
    } catch {
    }
    const metrics = {
      date: (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      phase: resolvedPhase,
      provider: config.provider,
      tier: config.tier,
      model,
      duration_seconds: duration,
      exitCode,
      metrics: {
        inbox_before: pre.inboxItems,
        inbox_after: post.inboxItems,
        inbox_processed: post.inboxProcessed,
        links_added: post.linksAdded,
        notes_moved: post.notesMoved
      },
      vault_health: {
        total_notes: post.totalNotes,
        inbox_items: post.inboxItems,
        seed_notes: post.seedNotes
      }
    };
    await writeMetrics(gardenerDir, metrics);
    console.log("\n" + formatSummary(metrics));
    try {
      const { generateDigest: generateDigest2 } = await Promise.resolve().then(() => (init_digest(), digest_exports));
      await generateDigest2(cwd, { weekly: (/* @__PURE__ */ new Date()).getDay() === 0 });
    } catch {
    }
    const lastRunPath = join16(gardenerDir, "last-run.md");
    const lastRunContent = `---
date: ${metrics.date}
timestamp: ${metrics.timestamp}
phase: ${resolvedPhase}
provider: ${config.provider}
model: ${model}
duration: ${duration}s
exitCode: ${exitCode}
---
`;
    await writeFile10(lastRunPath, lastRunContent, "utf-8").catch(() => {
    });
  } finally {
    lockHandle.stopHeartbeat();
    await lockHandle.release();
  }
  if (exitCode !== 0) {
    const duration = Math.round((Date.now() - startTime) / 1e3);
    await notifyFailure(
      {
        phase: resolvedPhase,
        duration_seconds: duration,
        exit_code: exitCode,
        reason: `Provider exited with code ${exitCode}`,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      },
      logger
    );
    logger.error("run_failed", { phase: resolvedPhase, exitCode });
  } else {
    logger.info("run_complete", { phase: resolvedPhase });
  }
  if (exitCode !== 0) process.exit(1);
}
async function loadProvider(name, config) {
  const providerConfig = config[name];
  switch (name) {
    case "claude": {
      const { createClaudeProvider: createClaudeProvider2 } = await Promise.resolve().then(() => (init_claude(), claude_exports));
      return createClaudeProvider2(providerConfig);
    }
    case "codex": {
      const { createCodexProvider: createCodexProvider2 } = await Promise.resolve().then(() => (init_codex(), codex_exports));
      return createCodexProvider2(providerConfig);
    }
    case "gemini": {
      const { createGeminiProvider: createGeminiProvider2 } = await Promise.resolve().then(() => (init_gemini(), gemini_exports));
      return createGeminiProvider2(providerConfig);
    }
    default:
      throw new Error(`Unknown provider: ${name}`);
  }
}

// src/cli/start.ts
init_config2();
import { readFile as readFile12 } from "fs/promises";
import { join as join20 } from "path";
import chalk7 from "chalk";

// src/scheduler/daemon.ts
import { writeFile as writeFile11, readFile as readFile11, unlink as unlink3, rename as rename7 } from "fs/promises";
import { join as join17 } from "path";
import { fork } from "child_process";
import { fileURLToPath } from "url";
var HEALTH_FILE = ".daemon-health";
var HEALTH_STALE_MS = 5 * 60 * 1e3;
function healthPath(gardenerDir) {
  return join17(gardenerDir, HEALTH_FILE);
}
async function writeDaemonHealth(gardenerDir, health) {
  const tmpFile = healthPath(gardenerDir) + ".tmp";
  await writeFile11(tmpFile, JSON.stringify(health, null, 2), "utf-8");
  await rename7(tmpFile, healthPath(gardenerDir));
}
async function startDaemon(vaultPath, cronExpression) {
  const daemonScript = join17(
    fileURLToPath(import.meta.url),
    "..",
    "..",
    "..",
    "dist",
    "src",
    "scheduler",
    "daemon-worker.js"
  );
  const child = fork(daemonScript, [vaultPath, cronExpression], {
    detached: true,
    stdio: "ignore",
    cwd: vaultPath
  });
  child.unref();
  const pid = child.pid;
  const gardenerDir = join17(vaultPath, ".gardener");
  const pidFile = join17(gardenerDir, ".daemon-pid");
  await writeFile11(pidFile, String(pid), "utf-8");
  await writeDaemonHealth(gardenerDir, {
    pid,
    lastCheck: (/* @__PURE__ */ new Date()).toISOString(),
    lastRun: null,
    status: "idle",
    consecutiveFailures: 0
  });
  return pid;
}

// src/scheduler/launchd.ts
import { writeFile as writeFile12 } from "fs/promises";
import { join as join18 } from "path";
import { homedir } from "os";
import { createHash } from "crypto";
async function generateLaunchdPlist(vaultPath, cronExpression) {
  const interval = parseCronToSeconds(cronExpression);
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.vault-gardener.${vaultHash(vaultPath)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>npx</string>
    <string>vault-gardener</string>
    <string>run</string>
    <string>all</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${vaultPath}</string>
  <key>StartInterval</key>
  <integer>${interval}</integer>
  <key>StandardOutPath</key>
  <string>${join18(vaultPath, ".gardener", "logs", "launchd-stdout.log")}</string>
  <key>StandardErrorPath</key>
  <string>${join18(vaultPath, ".gardener", "logs", "launchd-stderr.log")}</string>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>`;
  const plistPath = join18(
    homedir(),
    "Library",
    "LaunchAgents",
    `com.vault-gardener.${vaultHash(vaultPath)}.plist`
  );
  await writeFile12(plistPath, plist, "utf-8");
  return plistPath;
}
function vaultHash(vaultPath) {
  return createHash("sha256").update(vaultPath).digest("hex").slice(0, 8);
}
function parseCronToSeconds(cron) {
  const parts = cron.split(" ");
  if (parts.length >= 2) {
    const hourPart = parts[1];
    const match = hourPart.match(/\*\/(\d+)/);
    if (match) return parseInt(match[1], 10) * 3600;
  }
  return 14400;
}

// src/scheduler/systemd.ts
import { writeFile as writeFile13, mkdir as mkdir9 } from "fs/promises";
import { join as join19 } from "path";
import { homedir as homedir2 } from "os";
import { createHash as createHash2 } from "crypto";
async function generateSystemdUnit(vaultPath, cronExpression) {
  const interval = parseCronToOnCalendar(cronExpression);
  const unitDir = join19(homedir2(), ".config", "systemd", "user");
  await mkdir9(unitDir, { recursive: true });
  const service = `[Unit]
Description=Vault Gardener \u2014 AI-powered vault maintenance
After=network.target

[Service]
Type=oneshot
WorkingDirectory=${vaultPath}
ExecStart=npx vault-gardener run all
StandardOutput=append:${join19(vaultPath, ".gardener", "logs", "systemd.log")}
StandardError=append:${join19(vaultPath, ".gardener", "logs", "systemd-error.log")}

[Install]
WantedBy=default.target
`;
  const timer = `[Unit]
Description=Vault Gardener Timer

[Timer]
OnCalendar=${interval}
Persistent=true

[Install]
WantedBy=timers.target
`;
  const suffix = vaultHash2(vaultPath);
  const servicePath = join19(unitDir, `vault-gardener-${suffix}.service`);
  const timerPath = join19(unitDir, `vault-gardener-${suffix}.timer`);
  await writeFile13(servicePath, service, "utf-8");
  await writeFile13(timerPath, timer, "utf-8");
  return servicePath;
}
function vaultHash2(vaultPath) {
  return createHash2("sha256").update(vaultPath).digest("hex").slice(0, 8);
}
function parseCronToOnCalendar(cron) {
  const parts = cron.split(" ");
  if (parts.length >= 2) {
    const minutePart = parts[0];
    const hourPart = parts[1];
    const match = hourPart.match(/\*\/(\d+)/);
    if (match) {
      return `*-*-* 0/${match[1]}:${minutePart.padStart(2, "0")}:00`;
    }
  }
  return "*-*-* 0/4:00:00";
}

// src/cli/start.ts
async function startCommand(options) {
  const cwd = process.cwd();
  const gardenerDir = getGardenerDir(cwd);
  let config;
  try {
    config = await loadConfig(cwd);
  } catch {
    console.error(chalk7.red("No .gardener/config.yaml found. Run `vault-gardener init` first."));
    process.exit(1);
  }
  if (!config.schedule.enabled) {
    console.log(chalk7.yellow("Schedule is disabled in config. Enabling..."));
    config.schedule.enabled = true;
  }
  if (options.install) {
    const platform = process.platform;
    if (platform === "darwin") {
      const plistPath = await generateLaunchdPlist(cwd, config.schedule.cron);
      console.log(chalk7.green(`Installed launchd plist: ${plistPath}`));
      console.log(chalk7.dim("Run: launchctl load " + plistPath));
    } else if (platform === "linux") {
      const unitPath = await generateSystemdUnit(cwd, config.schedule.cron);
      console.log(chalk7.green(`Generated systemd unit: ${unitPath}`));
      const unitName = unitPath.split("/").pop().replace(".service", "");
      console.log(chalk7.dim(`Run: systemctl --user enable ${unitName} && systemctl --user start ${unitName}`));
    } else {
      console.error(chalk7.red(`Platform ${platform} not supported for --install. Use the daemon instead.`));
      process.exit(1);
    }
    return;
  }
  const pidFile = join20(gardenerDir, ".daemon-pid");
  try {
    const pid2 = parseInt(await readFile12(pidFile, "utf-8"), 10);
    process.kill(pid2, 0);
    console.log(chalk7.yellow(`Daemon already running (PID: ${pid2})`));
    return;
  } catch {
  }
  const pid = await startDaemon(cwd, config.schedule.cron);
  console.log(
    chalk7.green(`Gardener started. Cron: ${config.schedule.cron}. PID: ${pid}`)
  );
}

// src/cli/stop.ts
init_config2();
import { readFile as readFile13, unlink as unlink4 } from "fs/promises";
import { join as join21 } from "path";
import chalk8 from "chalk";
async function stopCommand() {
  const gardenerDir = getGardenerDir(process.cwd());
  const pidFile = join21(gardenerDir, ".daemon-pid");
  try {
    const pid = parseInt(await readFile13(pidFile, "utf-8"), 10);
    try {
      process.kill(pid, "SIGTERM");
      console.log(chalk8.green(`Gardener stopped (PID: ${pid})`));
    } catch {
      console.log(chalk8.yellow(`Process ${pid} not found. Cleaning up stale PID file.`));
    }
    await unlink4(pidFile).catch(() => {
    });
  } catch {
    console.log(chalk8.yellow("No daemon running."));
  }
}

// src/cli/status.ts
init_config2();
init_collector();
init_lock();
import { readFile as readFile14 } from "fs/promises";
import { join as join22 } from "path";
import chalk9 from "chalk";
async function statusCommand(options) {
  const cwd = process.cwd();
  const gardenerDir = getGardenerDir(cwd);
  let config;
  try {
    config = await loadConfig(cwd);
  } catch {
    console.error(chalk9.red("No .gardener/config.yaml found. Run `vault-gardener init` first."));
    process.exit(1);
  }
  const metrics = await readMetrics(gardenerDir, 30);
  const locked = await isLocked(gardenerDir);
  const latestReport = await readLatestReport(gardenerDir);
  let daemonPid = null;
  try {
    const pidFile = join22(gardenerDir, ".daemon-pid");
    const pid = parseInt(await readFile14(pidFile, "utf-8"), 10);
    process.kill(pid, 0);
    daemonPid = pid;
  } catch {
  }
  if (options.json) {
    let vaultHealth = null;
    if (metrics.length > 0) {
      const latest2 = metrics[0];
      let suggestions = [];
      let lastDigest = null;
      try {
        const digestPath = join22(gardenerDir, "digest.json");
        const digestRaw = await readFile14(digestPath, "utf-8");
        const digest = JSON.parse(digestRaw);
        suggestions = digest.suggestions ?? [];
        lastDigest = digest.generated ?? null;
      } catch {
      }
      vaultHealth = {
        totalNotes: latest2.vault_health.total_notes,
        inboxItems: latest2.vault_health.inbox_items,
        seedNotes: latest2.vault_health.seed_notes,
        suggestions,
        lastDigest
      };
    }
    console.log(
      JSON.stringify(
        {
          config: {
            provider: config.provider,
            tier: config.tier,
            schedule: config.schedule
          },
          daemon: daemonPid ? { pid: daemonPid, running: true } : { running: false },
          locked,
          recentRuns: metrics.slice(0, 10),
          vaultHealth,
          featureActivity: latestReport ? formatReportJson(latestReport) : null
        },
        null,
        2
      )
    );
    return;
  }
  console.log(chalk9.bold("\nvault-gardener status\n"));
  console.log(chalk9.cyan("Configuration"));
  console.log(`  Provider: ${config.provider} / ${config.tier}`);
  console.log(`  Schedule: ${config.schedule.enabled ? config.schedule.cron : "disabled"}`);
  console.log(`  Daemon: ${daemonPid ? chalk9.green(`running (PID: ${daemonPid})`) : chalk9.dim("stopped")}`);
  console.log(`  Lock: ${locked ? chalk9.yellow("active") : chalk9.dim("free")}`);
  if (metrics.length === 0) {
    console.log(chalk9.dim("\nNo runs yet. Run `vault-gardener run` to start.\n"));
    return;
  }
  console.log(chalk9.cyan("\nRecent Runs"));
  console.log(
    chalk9.dim(
      "  Date                Phase     Duration  Inbox  Links  Status"
    )
  );
  for (const m of metrics.slice(0, 10)) {
    const date = m.timestamp.slice(0, 16).replace("T", " ");
    const phase = m.phase.padEnd(9);
    const duration = `${m.duration_seconds}s`.padStart(8);
    const inbox = `${m.metrics.inbox_processed}`.padStart(5);
    const links = `${m.metrics.links_added}`.padStart(5);
    const status = m.exitCode === 0 ? chalk9.green("ok") : chalk9.red("fail");
    console.log(`  ${date}  ${phase}  ${duration}  ${inbox}  ${links}  ${status}`);
  }
  const latest = metrics[0];
  if (latest) {
    console.log(chalk9.cyan("\nVault Health"));
    console.log(`  Total notes: ${latest.vault_health.total_notes}`);
    console.log(`  Inbox items: ${latest.vault_health.inbox_items}`);
    console.log(`  Seed notes: ${latest.vault_health.seed_notes}`);
    const inboxHistory = metrics.slice(0, 7).reverse().map((m) => m.vault_health.inbox_items);
    if (inboxHistory.length > 1) {
      const sparkChars = "\u2581\u2582\u2583\u2584\u2585\u2586\u2587\u2588";
      const max = Math.max(...inboxHistory, 1);
      const spark = inboxHistory.map((v) => sparkChars[Math.min(Math.floor(v / max * 8), 7)]).join("");
      console.log(`  Inbox trend: ${spark} (last ${inboxHistory.length} runs)`);
    }
  }
  if (latestReport) {
    printFeatureActivity(latestReport);
  }
  console.log("");
}
function printFeatureActivity(report) {
  const phases = report.phases;
  if (phases.length === 0) return;
  const phaseNames = phases.map((p) => p.phase).join(", ");
  const time = new Date(report.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  console.log(chalk9.cyan(`
Feature Activity (last run \u2014 ${phaseNames}, ${time})`));
  for (const phase of phases) {
    for (const f of phase.features) {
      const icon = f.status === "executed" ? chalk9.green("\u2713") : f.status === "error" ? chalk9.red("\u2717") : chalk9.dim("\u2013");
      const detail = formatFeatureDetail(f);
      console.log(`  ${icon} ${f.feature}${detail ? ` (${detail})` : ""}`);
    }
  }
  const warnings = [
    ...report._parsed.validationWarnings,
    ...report._parsed.missingFeatures.map((f) => `${f} enabled but not reported`)
  ];
  if (warnings.length > 0) {
    console.log("");
    console.log(chalk9.cyan("  Warnings:"));
    for (const w of warnings) {
      console.log(chalk9.yellow(`  \u26A0 ${w}`));
    }
  }
}
function formatFeatureDetail(f) {
  if (f.status === "skipped" && f.reason) return `skipped: ${f.reason}`;
  if (f.status === "error" && f.reason) return `error: ${f.reason}`;
  if (f.notes) return f.notes;
  const entries = Object.entries(f.counts ?? {});
  if (entries.length === 0) return "";
  return entries.map(([k, v]) => `${v} ${k.replace(/_/g, " ")}`).join(", ");
}
function formatReportJson(report) {
  return {
    timestamp: report.timestamp,
    phases: report.phases.map((p) => ({
      phase: p.phase,
      started: p.started,
      features: p.features.map((f) => ({
        feature: f.feature,
        status: f.status,
        reason: f.reason,
        counts: f.counts,
        notes: f.notes
      }))
    })),
    summary: report.summary,
    warnings: [
      ...report.warnings ?? [],
      ...report._parsed.validationWarnings,
      ...report._parsed.missingFeatures.map((f) => `${f} enabled but not reported`)
    ]
  };
}

// src/cli/index.ts
var require2 = createRequire(import.meta.url);
var { version } = require2("../../package.json");
function run(argv) {
  const program = new Command();
  program.name("vault-gardener").description("AI-powered vault maintenance pipeline for markdown knowledge bases").version(version);
  program.command("init").description("Interactive setup \u2014 detect vault structure, pick provider, generate config").option("--preset <name>", "Use a preset (para-plus, zettelkasten, flat)").option("--provider <name>", "Set provider (claude, codex, gemini)").option("--tier <tier>", "Set tier (power, fast)").option("--no-interactive", "Skip interactive prompts, use defaults").action(initCommand);
  program.command("run").description("Run gardener pipeline").argument("[phase]", "Phase to run: seed, nurture, tend, or all (default: all)").option("--provider <name>", "Override config provider").option("--tier <tier>", "Override tier (power, fast)").option("--dry-run", "Show what would run without executing").option("--verbose", "Stream LLM output to terminal").option("--force-unlock", "Force-release lock before running").option("--no-queue", "Fail immediately if locked (do not queue)").option("--force", "Skip preflight checks").option("--validate", "Run preflight only, then exit").action(runCommand);
  program.command("start").description("Start background daemon").option("--install", "Install as system service (launchd/systemd)").action(startCommand);
  program.command("stop").description("Stop background daemon").action(stopCommand);
  program.command("status").description("Show TUI dashboard with run history and vault health").option("--json", "Output as JSON instead of TUI").action(statusCommand);
  program.command("digest").description("Generate vault health digest and write .gardener/digest.json").option("--json", "Output as JSON").option("--weekly", "Include weekly brief").action(digestAction);
  program.command("recover").description("Diagnose and fix stale state (locks, queue, metrics)").action(recoverAction);
  const config = program.command("config").description("Manage configuration");
  config.command("get").description("Read a config value").argument("<key>", "Config key (dot notation: provider, tier, folders.inbox)").action(configGetAction);
  config.command("set").description("Write a config value").argument("<key>", "Config key").argument("<value>", "Config value").action(configSetAction);
  config.command("regen").description("Regenerate prompts from config (overwrites .gardener/prompts/)").action(configRegenAction);
  program.parse(argv);
}
async function configGetAction(key) {
  const { configGet: configGet2 } = await Promise.resolve().then(() => (init_config2(), config_exports));
  await configGet2(key);
}
async function configSetAction(key, value) {
  const { configSet: configSet2 } = await Promise.resolve().then(() => (init_config2(), config_exports));
  await configSet2(key, value);
}
async function configRegenAction() {
  const { configRegen: configRegen2 } = await Promise.resolve().then(() => (init_config2(), config_exports));
  await configRegen2();
}
async function digestAction(options) {
  const { digestCommand: digestCommand2 } = await Promise.resolve().then(() => (init_digest(), digest_exports));
  await digestCommand2(options);
}
async function recoverAction() {
  const { recoverCommand: recoverCommand2 } = await Promise.resolve().then(() => (init_recover(), recover_exports));
  await recoverCommand2();
}

// src/index.ts
init_digest();
export {
  generateDigest,
  getPreset,
  listPresets,
  run,
  scanVault
};
//# sourceMappingURL=index.js.map