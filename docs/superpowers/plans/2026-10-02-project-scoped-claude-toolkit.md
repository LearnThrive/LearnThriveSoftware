# Project-scoped Claude Toolkit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Windows-safe, project-scoped Claude Code toolkit for LearnThrive from the curated Everything Claude Code design.

**Architecture:** Use Claude Code's native project directories under `.claude/` instead of installing the upstream marketplace plugin. Keep always-on context small through path-scoped rules, expose heavier workflows through project agents/skills/commands, and merge two read-only hook checks into the existing Graphify settings.

**Tech Stack:** Claude Code project configuration, Markdown/YAML frontmatter, JSON, Node.js 23 CommonJS, `node:test`, PowerShell, Git.

**Spec:** `docs/superpowers/specs/2026-10-02-project-scoped-claude-toolkit-design.md`

## Global Constraints

- Scope every runtime change to `D:\LearnThriveSoftware\.claude`; do not change `~/.claude` or another repository.
- Preserve the existing Graphify `PreToolUse` hook entries byte-for-behavior in the merged settings.
- Adapt only from `worldflowai/everything-claude-code` commit `432485ba6b92c14fb357276a98957f348bcff9ee`.
- Support native Windows; do not require tmux, WSL, Bash-only scripts, executable permission bits, or Unix paths.
- Add no npm dependency, MCP server, local-model download, Claude Code binary update, or application source change.
- Hooks may inspect hook input and edited files but must not format, rewrite, start a server, invoke `npx`, or access the network.
- Project model configuration is exactly `"model": "opusplan"` with `"effortLevel": "high"`; user-global model settings remain untouched.
- Project package manager is exactly npm, matching `package-lock.json` and the workspace scripts.
- Preserve all pre-existing staged, unstaged, and untracked user work; every commit stages only the task's listed files.

## Review Focus

- Windows path casing: `.ENV.Local` must be protected exactly like `.env.local`, while `.env.example` remains writable (Task 1 tests).
- Malformed or incomplete hook payloads: both hooks must return success and avoid breaking unrelated Claude operations (Tasks 1 and 2 tests).
- Existing Graphify hooks: the final settings merge must retain both original matchers and commands alongside the new hooks (Task 8 tests).
- Project-scope leakage: adapted components must not write to or instruct writes to `~/.claude`, `%USERPROFILE%`, global sessions, or global learned skills (Tasks 5–8 tests/scans).
- Dirty-worktree isolation: the final porcelain status outside committed toolkit files must match the captured baseline exactly (Tasks 1 and 8 verification).

---

### Task 1: Sensitive environment-file hook

**Files:**

- Create: `.claude/hooks/guard-sensitive-file.cjs`
- Create: `.claude/tests/guard-sensitive-file.test.cjs`

**Interfaces:**

- Consumes: Claude Code hook JSON on standard input with optional `tool_input.file_path`.
- Produces: `isProtectedEnvPath(filePath: string): boolean` and `evaluatePayload(raw: string): { exitCode: number, stderr: string }`; CLI exit code `2` blocks a protected write, `0` allows it.

- [ ] **Step 1: Capture the pre-implementation worktree baseline outside the repository**

Run:

```powershell
git status --porcelain=v1 | Set-Content -LiteralPath "$env:TEMP\learnthrive-claude-toolkit-baseline.txt"
```

Expected: the temp file records all existing user changes without modifying or staging them.

- [ ] **Step 2: Write failing unit and CLI tests**

Create tests named:

- `blocks .env variants case-insensitively` for `.env`, `apps/web/.env.local`, and `D:\repo\.ENV.Production`, expecting exit code `2` and a message naming the protected path;
- `allows environment templates` for `.env.example`, `.env.sample`, and `.env.template`, expecting exit code `0`;
- `allows ordinary files` for `apps/web/src/app/page.tsx`, expecting exit code `0`;
- `fails open for malformed or missing payload data`, covering invalid JSON, `{}`, and a non-string path, expecting exit code `0` and no throw;
- `CLI uses Claude blocking exit semantics`, spawning the script with a protected payload and expecting process status `2` plus a concise stderr warning.

- [ ] **Step 3: Run the test to verify RED**

Run: `node --test .claude/tests/guard-sensitive-file.test.cjs`

Expected: FAIL because `.claude/hooks/guard-sensitive-file.cjs` does not exist.

- [ ] **Step 4: Implement the minimal guard hook**

Use `path.basename(filePath).toLowerCase()` for matching. Protect `.env` and names beginning `.env.` except the exact suffixes `.example`, `.sample`, and `.template`. Parse stdin only in the CLI branch (`require.main === module`), emit only `stderr`, and export both interface functions for tests.

- [ ] **Step 5: Run the test to verify GREEN**

Run: `node --test .claude/tests/guard-sensitive-file.test.cjs`

Expected: all tests PASS.

- [ ] **Step 6: Commit only the hook and its test**

```powershell
git add -- .claude/hooks/guard-sensitive-file.cjs .claude/tests/guard-sensitive-file.test.cjs
git commit -m "feat(claude): guard environment files"
```

### Task 2: Non-blocking console-log hook

**Files:**

- Create: `.claude/hooks/check-edited-file.cjs`
- Create: `.claude/tests/check-edited-file.test.cjs`

**Interfaces:**

- Consumes: Claude Code hook JSON with optional `tool_input.file_path`, then reads that one existing local file when its extension is `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, or `.cjs`.
- Produces: `findConsoleLogLines(source: string): number[]` and `evaluatePayload(raw: string): { exitCode: 0, stderr: string }`; the CLI always exits `0`.

- [ ] **Step 1: Write failing unit and CLI tests**

Create tests named:

- `reports one-based console.log line numbers` for two log calls on distinct lines;
- `does not report console.error or clean source`;
- `ignores unsupported, missing, and deleted files`;
- `fails open for malformed or incomplete payloads`;
- `CLI warns without blocking`, using a temporary `.ts` file and expecting status `0`, the file path, and its one-based line number on stderr;
- `CLI never mutates the inspected file`, comparing content before and after the spawned process.

- [ ] **Step 2: Run the test to verify RED**

Run: `node --test .claude/tests/check-edited-file.test.cjs`

Expected: FAIL because `.claude/hooks/check-edited-file.cjs` does not exist.

- [ ] **Step 3: Implement the minimal edited-file checker**

Match `console.log` with optional whitespace around the dot, read as UTF-8, report at most five matching lines, and catch parse/read errors. Keep all return codes at `0`; this hook is advisory.

- [ ] **Step 4: Run the test to verify GREEN**

Run: `node --test .claude/tests/check-edited-file.test.cjs`

Expected: all tests PASS.

- [ ] **Step 5: Commit only the checker and its test**

```powershell
git add -- .claude/hooks/check-edited-file.cjs .claude/tests/check-edited-file.test.cjs
git commit -m "feat(claude): warn on console logging"
```

### Task 3: LearnThrive orientation and path-scoped rules

**Files:**

- Modify: `.claude/CLAUDE.md`
- Create: `.claude/rules/workspaces.md`
- Create: `.claude/rules/web.md`
- Create: `.claude/rules/classroom-realtime.md`
- Create: `.claude/rules/security.md`
- Create: `.claude/rules/verification.md`
- Create: `.claude/tests/rules.test.cjs`

**Interfaces:**

- Consumes: repository architecture and commands documented in `README.md`, `apps/web/AGENTS.md`, and the approved spec.
- Produces: concise always-on orientation plus path-conditioned instructions loaded by Claude Code when matching files are accessed.

- [ ] **Step 1: Write failing structural and content tests**

Test that:

- `.claude/CLAUDE.md` still names Graphify and adds links to the five rule files plus `/build-fix`, `/checkpoint`, and `/verify`;
- `workspaces.md` names all five workspace boundaries, npm, `npm run check`, and the dirty-worktree preservation rule;
- `web.md` has `paths` for `apps/web/**`, requires local Next.js documentation, names `tsx server.ts`, Node tests, and Playwright;
- `classroom-realtime.md` has paths for classroom, realtime, and shared contracts and distinguishes the production-path classroom from the retained Vite test app;
- `security.md` has only security-sensitive path globs and names authorization, IDOR, environment secrets, classroom tokens, and internal report notes;
- `verification.md` maps each workspace to exact `npm run ... --workspace=...` commands;
- none of the six files contains `80%`, `tmux`, a global Claude path, or an instruction to mutate unrelated code.

- [ ] **Step 2: Run the test to verify RED**

Run: `node --test .claude/tests/rules.test.cjs`

Expected: FAIL because the rule files do not exist and the orientation lacks the toolkit index.

- [ ] **Step 3: Write the minimal orientation and rules**

Keep `.claude/CLAUDE.md` under 40 lines and each rule under 120 lines. Use YAML `paths` arrays only on `web.md`, `classroom-realtime.md`, and `security.md`; keep workspace and verification facts generally available.

- [ ] **Step 4: Run the test to verify GREEN**

Run: `node --test .claude/tests/rules.test.cjs`

Expected: all tests PASS.

- [ ] **Step 5: Commit only orientation, rules, and their test**

```powershell
git add -- .claude/CLAUDE.md .claude/rules/workspaces.md .claude/rules/web.md .claude/rules/classroom-realtime.md .claude/rules/security.md .claude/rules/verification.md .claude/tests/rules.test.cjs
git commit -m "docs(claude): add repository rules"
```

### Task 4: Specialist project agents

**Files:**

- Create: `.claude/agents/architect.md`
- Create: `.claude/agents/security-reviewer.md`
- Create: `.claude/agents/build-error-resolver.md`
- Create: `.claude/agents/e2e-runner.md`
- Create: `.claude/tests/agents.test.cjs`

**Interfaces:**

- Consumes: path-scoped project rules and explicit delegation prompts.
- Produces: project agents named `architect`, `security-reviewer`, `build-error-resolver`, and `e2e-runner` with scoped tools and model aliases.

- [ ] **Step 1: Write failing agent-definition tests**

Assert exact frontmatter and prompt contracts:

- architect: `model: opus`, read-only tools `Read, Grep, Glob, Bash`, architecture evidence before recommendations, no edits;
- security reviewer: `model: opus`, the same read-only tools, findings-first output with severity and file locations, no automatic remediation;
- build-error resolver: `model: sonnet`, includes `Edit` and `Write`, diagnoses the first root cause, limits changes to build/type failures, reruns the failing command;
- E2E runner: `model: sonnet`, includes `Edit` and `Write`, selects the smallest Playwright project/spec, preserves artifacts, and never starts an unmanaged persistent server;
- descriptions contain concrete trigger terms;
- planner, TDD guide, code reviewer, refactor cleaner, and doc updater files are absent.

- [ ] **Step 2: Run the test to verify RED**

Run: `node --test .claude/tests/agents.test.cjs`

Expected: FAIL because the four definitions do not exist.

- [ ] **Step 3: Adapt the four upstream agent definitions**

Retain useful specialist checklists but replace generic examples, old model assumptions, blanket coverage requirements, and global paths with LearnThrive commands and boundaries. Keep each agent focused enough to return a concise result to the main session.

- [ ] **Step 4: Run the test to verify GREEN**

Run: `node --test .claude/tests/agents.test.cjs`

Expected: all tests PASS.

- [ ] **Step 5: Commit only the agents and their test**

```powershell
git add -- .claude/agents/architect.md .claude/agents/security-reviewer.md .claude/agents/build-error-resolver.md .claude/agents/e2e-runner.md .claude/tests/agents.test.cjs
git commit -m "feat(claude): add specialist agents"
```

### Task 5: Verification-loop skill

**Files:**

- Create: `.claude/skills/verification-loop/SKILL.md`
- Create: `.claude/tests/verification-loop-skill.test.cjs`
- Create: `.claude/tests/skill-evals/verification-loop.md`

**Interfaces:**

- Consumes: changed paths, the requested acceptance conditions, actual command output, and workspace scripts.
- Produces: a repeatable `/verification-loop` workflow that selects the narrowest responsible proof, records failures, fixes only in-scope causes, and expands verification only after focused checks pass.

**Required sub-skill:** Use `superpowers:writing-skills` for this task, including its RED/GREEN/REFACTOR evaluation and deployment checklist. Its fresh-context subagent evaluations are explicitly part of this task.

- [ ] **Step 1: Define and run RED pressure scenarios without the skill**

Use fresh-context agents for at least three combined-pressure scenarios covering deadline pressure, a large dirty worktree, a claim that tests passed earlier, a failing check alleged to be pre-existing, and a cross-workspace contract change. Record prompts, verbatim behavior, and failure patterns in the eval file.

- [ ] **Step 2: Micro-test the proposed workflow contract**

Run a no-guidance control and at least five fresh-context samples for each candidate wording. Score whether the agent selects focused commands, reports evidence, refuses to hide failures, and avoids unrelated edits. Record every flagged sample and the selected wording.

- [ ] **Step 3: Write failing static contract tests**

Assert that `SKILL.md` has valid frontmatter, a `Use when...` third-person description, actual LearnThrive commands, the focused-to-broad verification order, failure reporting, dirty-tree isolation, a quick-reference table, and no `80%`, tmux, global Claude paths, or unsupported package managers.

- [ ] **Step 4: Run the static test to verify RED**

Run: `node --test .claude/tests/verification-loop-skill.test.cjs`

Expected: FAIL because the skill does not exist.

- [ ] **Step 5: Write the minimal skill and run GREEN evaluations**

Create the skill from the winning wording, then rerun the pressure scenarios with the skill supplied to fresh agents. Success requires consistent focused verification, explicit evidence, and no false completion claim.

- [ ] **Step 6: Run the static test and close discovered loopholes**

Run: `node --test .claude/tests/verification-loop-skill.test.cjs`

Expected: PASS. Add only counters justified by evaluation failures, rerun affected scenarios, and finalize the eval record.

- [ ] **Step 7: Commit this skill only after its deployment checklist passes**

```powershell
git add -- .claude/skills/verification-loop/SKILL.md .claude/tests/verification-loop-skill.test.cjs .claude/tests/skill-evals/verification-loop.md
git commit -m "feat(claude): add verification workflow"
```

### Task 6: LearnThrive security-review skill

**Files:**

- Create: `.claude/skills/security-review/SKILL.md`
- Create: `.claude/tests/security-review-skill.test.cjs`
- Create: `.claude/tests/skill-evals/security-review.md`

**Interfaces:**

- Consumes: a diff or requested target plus LearnThrive's documented auth, role, classroom-token, signalling, environment-secret, and report-visibility boundaries.
- Produces: a findings-first `/security-review` workflow with severity, exploit path, evidence location, and minimal remediation guidance.

**Required sub-skill:** Use `superpowers:writing-skills` independently for this skill; do not batch its evaluation with Task 5.

- [ ] **Step 1: Define and run RED pressure scenarios without the skill**

Use fresh agents for combined-pressure cases involving a deadline, an apparently internal-only endpoint, a trusted ID from the client, a Parent-visible report containing internal notes, and a classroom token near its validity boundary. Record verbatim misses and rationalizations.

- [ ] **Step 2: Micro-test the findings contract**

Compare a no-guidance control with at least five fresh samples per candidate wording. Score object-level authorization, action-level authorization, secret leakage, token verification, internal-note visibility, severity ordering, and evidence locations.

- [ ] **Step 3: Write failing static contract tests**

Assert valid frontmatter and repository-specific sections for auth/session checks, IDOR, Server Actions/API authorization, classroom tokens, signalling inputs, `.env` handling, report privacy, findings-first output, and explicit non-goals. Reject generic mandates unsupported by the repo, including universal CSRF/rate-limit claims.

- [ ] **Step 4: Run the static test to verify RED**

Run: `node --test .claude/tests/security-review-skill.test.cjs`

Expected: FAIL because the skill does not exist.

- [ ] **Step 5: Write the minimal skill and run GREEN evaluations**

Use the winning positive output recipe. Require ordered findings with severity, file/line evidence, exploitability, and minimal fix; return `No findings` plus residual risks when appropriate.

- [ ] **Step 6: Run static and pressure tests through REFACTOR**

Run: `node --test .claude/tests/security-review-skill.test.cjs`

Expected: PASS. Close only observed gaps, rerun affected scenarios, and finalize the eval record.

- [ ] **Step 7: Commit only after this skill's deployment checklist passes**

```powershell
git add -- .claude/skills/security-review/SKILL.md .claude/tests/security-review-skill.test.cjs .claude/tests/skill-evals/security-review.md
git commit -m "feat(claude): add security review workflow"
```

### Task 7: User-invoked project commands

**Files:**

- Create: `.claude/commands/build-fix.md`
- Create: `.claude/commands/checkpoint.md`
- Create: `.claude/commands/verify.md`
- Create: `.claude/tests/commands.test.cjs`

**Interfaces:**

- Consumes: `$ARGUMENTS`, the four project agents, and the two project skills.
- Produces: user-only `/build-fix`, `/checkpoint`, and `/verify` entry points.

- [ ] **Step 1: Write failing command-definition tests**

Assert that every command has a concrete description and `disable-model-invocation: true`; `/build-fix` routes the failing command/output to `build-error-resolver`; `/verify` invokes the verification-loop skill with optional scope; `/checkpoint` reports intent, git state, completed verification, outstanding failures, and next action in the conversation without creating a file. Reject global paths, session-file writes, tmux, auto-commit, and auto-push instructions.

- [ ] **Step 2: Run the test to verify RED**

Run: `node --test .claude/tests/commands.test.cjs`

Expected: FAIL because the commands do not exist.

- [ ] **Step 3: Adapt the three commands**

Keep each command under 100 lines. Use project agent/skill names exactly as created in Tasks 4–6 and preserve `$ARGUMENTS` for caller context.

- [ ] **Step 4: Run the test to verify GREEN**

Run: `node --test .claude/tests/commands.test.cjs`

Expected: all tests PASS.

- [ ] **Step 5: Commit only the commands and their test**

```powershell
git add -- .claude/commands/build-fix.md .claude/commands/checkpoint.md .claude/commands/verify.md .claude/tests/commands.test.cjs
git commit -m "feat(claude): add project workflows"
```

### Task 8: Settings merge, package manager, source ledger, and integration proof

**Files:**

- Modify: `.claude/settings.json`
- Create: `.claude/package-manager.json`
- Create: `.claude/everything-claude-code.lock.json`
- Create: `.claude/tests/settings.test.cjs`

**Interfaces:**

- Consumes: hook script paths from Tasks 1–2 and every component path from Tasks 3–7.
- Produces: final project model/package/hook configuration plus an auditable upstream component ledger.

- [ ] **Step 1: Write failing settings and ledger tests**

Assert that:

- settings parse as JSON and contain exactly `model: opusplan` and `effortLevel: high`;
- original Graphify entries remain `Bash|Grep -> graphify hook-guard search` and `Read|Glob -> graphify hook-guard read` with timeout `10`;
- a new `Edit|Write` PreToolUse entry invokes `node .claude/hooks/guard-sensitive-file.cjs`;
- a new `Edit|Write` PostToolUse entry invokes `node .claude/hooks/check-edited-file.cjs`;
- package-manager JSON is exactly `{ "packageManager": "npm" }`;
- every planned rule, agent, skill, command, and hook path exists, while the explicitly excluded agents and commands remain absent;
- the ledger records the exact repository, 40-character commit SHA, audit date `2026-10-02`, included/adapted files, excluded component groups with reasons, MIT declaration, local-model advisory, and verification commands;
- settings and the ledger contain no secret placeholders or MCP server entries.

- [ ] **Step 2: Run the settings test to verify RED**

Run: `node --test .claude/tests/settings.test.cjs`

Expected: FAIL because model/package/ledger/new-hook configuration is absent.

- [ ] **Step 3: Merge settings and create project metadata**

Edit the parsed settings structure rather than replacing it. Preserve existing keys and append only the two new hook registrations. Write stable two-space JSON with a final newline.

- [ ] **Step 4: Run all project-toolkit tests**

Run: `node --test .claude/tests/*.test.cjs`

Expected: every hook, rule, agent, skill, command, and settings test PASS.

- [ ] **Step 5: Run static safety checks**

Run:

```powershell
node -e "for (const p of ['.claude/settings.json','.claude/package-manager.json','.claude/everything-claude-code.lock.json']) JSON.parse(require('fs').readFileSync(p,'utf8')); console.log('json: ok')"
git diff --check
rg -n "tmux|npx prettier|~/.claude|%USERPROFILE%|80%" .claude/agents .claude/commands .claude/hooks .claude/rules .claude/skills/verification-loop .claude/skills/security-review
```

Expected: JSON prints `json: ok`; diff check is silent; the forbidden-pattern scan returns no matches.

- [ ] **Step 6: Verify the dirty-worktree boundary before staging**

Compare current `git status --porcelain=v1` with `$env:TEMP\learnthrive-claude-toolkit-baseline.txt` after excluding the Task 8 files that are about to be committed. Expected: every pre-existing user-change line is unchanged and no new path exists outside `.claude/` and the already-reviewed plan/spec documents.

- [ ] **Step 7: Commit final project configuration only**

```powershell
git add -- .claude/settings.json .claude/package-manager.json .claude/everything-claude-code.lock.json .claude/tests/settings.test.cjs
git commit -m "chore(claude): configure project toolkit"
```

- [ ] **Step 8: Run post-commit verification**

Run:

```powershell
node --test .claude/tests/*.test.cjs
git diff --cached --name-only
git status --porcelain=v1
```

Expected: all tests PASS; the index is empty; porcelain status matches the saved pre-implementation user-change baseline exactly.
