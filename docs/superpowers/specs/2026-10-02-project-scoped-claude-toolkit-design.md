# Project-scoped Claude toolkit design

**Date:** 2026-10-02

**Status:** Design approved in conversation; awaiting written-spec review

**Upstream source:** `https://github.com/worldflowai/everything-claude-code` at commit `432485ba6b92c14fb357276a98957f348bcff9ee`

## Purpose

Configure Claude Code specifically for the LearnThrive monorepo using the useful parts of Everything Claude Code, while preserving the repository's existing Graphify setup, current project skills, and uncommitted product work.

Success means a Claude session opened in this repository:

- understands the npm workspace boundaries and the single-origin architecture;
- can invoke focused architecture, security, build-error, and Playwright agents;
- has repeatable verification and security-review workflows;
- uses strong hosted-model routing without changing user-global settings;
- receives lightweight, Windows-safe guardrails without automatic source mutation;
- does not load irrelevant MCP servers or duplicate the user's existing global plugins.

## Current context

LearnThrive is an npm workspaces monorepo with these active boundaries:

- `apps/web`: Next.js 16 and React 19, including the production-path classroom UI and the custom single-origin server;
- `apps/classroom`: the retained Vite classroom used primarily for its established test suite;
- `apps/realtime`: Express and Socket.IO signalling/TURN infrastructure;
- `packages/data`: domain and repository interfaces with the current in-memory provider;
- `packages/shared`: shared protocol, host, and classroom-token contracts.

The repository already contains:

- a Graphify knowledge graph and Graphify `PreToolUse` hooks;
- project-local design, Playwright, web-testing, and Vercel/React skills;
- user-global Superpowers, code-review, feature-development, and other plugins;
- a heavily modified working tree that must not be staged, reformatted, or otherwise disturbed by this configuration work.

Claude Code is currently version `2.1.273`. User-global settings select `sonnet` at high effort and must remain unchanged.

## Why the upstream plugin will not be installed unchanged

The upstream marketplace validates, but its unmodified behavior is a poor match for this repository:

- a `PreToolUse` hook blocks `npm run dev` unless `tmux` is present, which is unsuitable for native Windows;
- its Prettier hook can mutate edited files even though this repository does not declare Prettier;
- its TypeScript hook runs broad checks after individual edits, adding high latency in a monorepo;
- its session hooks write to user-global `~/.claude/sessions` and `~/.claude/skills/learned`, violating project scope;
- several agents, skills, and rules duplicate already-enabled planning, TDD, review, and frontend guidance;
- some generic rules impose unsupported requirements, such as blanket 80% coverage and mandatory rate limiting on every endpoint;
- its model guidance names older model generations and would become always-on stale context.

The integration will therefore be a curated project-native adaptation, not a marketplace installation or cache patch.

## Architecture

All new runtime configuration will live under the repository's `.claude/` directory. Claude Code will discover project agents, commands, skills, and rules through its normal project-level loading behavior. Existing settings will be merged in place so Graphify remains active.

The configuration has six isolated parts:

1. **Project orientation**: a short `.claude/CLAUDE.md` index and path-scoped rules.
2. **Specialist agents**: four agents with narrow responsibilities and deliberate model routing.
3. **On-demand workflows**: two skills and three commands rather than more always-on instructions.
4. **Guardrail hooks**: two small Node scripts that inspect hook payloads without modifying source files.
5. **Model and package-manager settings**: project-only `opusplan`, high effort, and npm selection.
6. **Source ledger**: a machine-readable record of the upstream commit and curation decisions.

No application runtime, package dependency, MCP server, or user-global Claude configuration is part of this design.

## Planned files and components

### Project orientation and rules

`.claude/CLAUDE.md` will remain concise. It will retain the Graphify entry and add an index pointing Claude toward the workspace rules and available project workflows.

The following rules will be created under `.claude/rules/`:

- `workspaces.md`: npm-only commands, workspace boundaries, the root verification commands, and the prohibition on changing unrelated dirty files;
- `web.md`: scoped to `apps/web/**`; requires consulting the installed Next.js 16 documentation, respects the custom `tsx server.ts` development path, and maps web unit/E2E commands;
- `classroom-realtime.md`: scoped to `apps/classroom/**`, `apps/realtime/**`, and the relevant shared contracts; distinguishes the production-path classroom from the retained Vite test application;
- `security.md`: scoped to authentication, API, server-action, classroom-token, signalling, and data-boundary paths; focuses on authorization, IDOR, secret handling, input trust boundaries, and private report fields;
- `verification.md`: maps changed areas to the smallest responsible lint, typecheck, unit, build, and Playwright commands.

Rules will describe repository facts rather than generic preferences. Path-specific frontmatter will prevent web, realtime, and security details from consuming context when unrelated files are being handled.

### Specialist agents

Four adapted files will be created under `.claude/agents/`:

- `architect.md`: read-only architecture analysis across workspace boundaries; uses the `opus` alias;
- `security-reviewer.md`: read-only review of auth, authorization, IDOR, token, secret, and sensitive-report boundaries; uses `opus`;
- `build-error-resolver.md`: minimal-diff TypeScript, Next.js, Vite, and workspace build diagnosis; uses `sonnet` and may edit only when explicitly delegated a fix;
- `e2e-runner.md`: Playwright journey selection, execution, artifact inspection, and tightly scoped test maintenance; uses `sonnet`.

The upstream planner, TDD guide, code reviewer, refactor cleaner, and documentation updater will not be copied. They duplicate installed plugins or conflict with Graphify and the existing repository workflow.

### Skills and commands

Two project skills will be adapted under `.claude/skills/`:

- `verification-loop`: chooses checks from the actual workspace scripts, records failures, fixes only in-scope causes, and reruns the narrowest proof before expanding;
- `security-review`: applies the repository's documented auth, role-permission, classroom-token, and Parent-visible/internal-notes boundaries.

Three user-invoked commands will be adapted under `.claude/commands/`:

- `/build-fix`: invoke the build-error workflow with the failing command and output;
- `/checkpoint`: summarize current intent, git state, completed verification, and next action in the conversation without writing global session files;
- `/verify`: invoke the project verification loop for current changes.

The upstream `/plan`, `/tdd`, `/code-review`, `/orchestrate`, `/refactor-clean`, `/learn`, codemap, and documentation commands will not be copied because equivalent or better project/global capabilities already exist.

### Windows-safe hooks

Two CommonJS hook scripts will be created under `.claude/hooks/` and registered by merging into `.claude/settings.json`:

- `guard-sensitive-file.cjs` runs on `PreToolUse` for `Edit|Write`. It rejects writes to real `.env` and `.env.*` files with Claude Code's blocking exit code while allowing `.env.example` templates. Other files pass through unchanged.
- `check-edited-file.cjs` runs on `PostToolUse` for `Edit|Write`. For existing JavaScript or TypeScript files, it warns on `console.log` and exits successfully. It never rewrites the file or blocks work.

Both scripts consume the JSON hook payload on standard input. Missing paths, deleted files, unsupported extensions, and malformed payloads produce at most a concise warning and a successful exit; they must not break unrelated Claude operations. Paths will be normalized case-insensitively for Windows.

The existing Graphify `PreToolUse` entries remain unchanged. The upstream tmux, auto-Prettier, per-edit TypeScript, session persistence, continuous-learning, compaction-counter, PR logging, and Stop hooks are excluded.

### Model and package-manager configuration

Project `.claude/settings.json` will add:

- `"model": "opusplan"` so Plan Mode uses the latest Opus available to the installed client/provider and execution uses Sonnet;
- `"effortLevel": "high"` for complex monorepo work;
- the two project hook registrations described above.

The existing user-global model setting is not changed. Model aliases are preferred over pinned IDs so a future Claude Code update can advance the project to newer compatible releases.

`.claude/package-manager.json` will explicitly select npm, matching `package-lock.json` and the workspace scripts.

No Claude Code binary update is included because it is machine-wide rather than project-scoped. The current `latest` auto-update channel remains the user's mechanism for receiving newer model support.

### Upstream source ledger

`.claude/everything-claude-code.lock.json` will record:

- upstream repository and audited commit;
- audit date;
- included and adapted components;
- excluded components with concise reasons;
- the upstream MIT license declaration;
- the local verification commands.

This file is informational and does not auto-update or execute remote code.

## Model-fit result

`llmfit 1.1.16` detected:

- AMD Ryzen 7 5800H, 16 logical cores;
- 63.34 GB total RAM;
- NVIDIA GeForce RTX 3070 Laptop GPU with 8 GB VRAM;
- CUDA backend;
- LM Studio, Docker Desktop, and Ollama present; llama.cpp binaries not found on `PATH`.

For a trusted, practical local coding model, the recommendation is **Qwen2.5-Coder 7B Instruct at 4-bit quantization**. At a 32K context cap, llmfit estimates approximately 38 tokens/second and 6.06 GB memory use for the AWQ/GPTQ variants. A llama.cpp/Ollama `Q4_K_M` build is the practical Windows equivalent.

This local-model recommendation is advisory only. Claude Code's Anthropic models are hosted and do not consume local GPU memory, so hardware fit does not determine the Claude Code model setting. Downloading or configuring a local model is outside this change.

## Data flow

At session startup, Claude Code loads the short project orientation, project settings, and the descriptions of available skills and agents. Path-scoped rules load only when matching files are accessed.

During a tool call:

1. Existing Graphify guards receive read/search operations.
2. The sensitive-file guard receives Edit/Write metadata and blocks only real environment files.
3. Claude performs the permitted edit.
4. The edited-file checker inspects only that file and emits a warning if it contains `console.log`.

On demand, a command or task invokes one workflow or specialist agent. The main session receives its concise result; unrelated skills and full agent prompts remain unloaded.

## Error handling and safety

- Configuration edits are additive and preserve the existing Graphify hook arrays.
- No existing uncommitted application file will be staged or changed.
- Hook scripts are read-only with respect to product code.
- The environment-file hook allows templates but blocks likely secret-bearing files.
- No hook launches a development server or long-running process.
- No hook invokes `npx` or performs network access.
- No skill or hook writes to the user's global Claude directories.
- No MCP credentials, API keys, or model downloads are introduced.
- Agent prompts require minimal diffs and scoped verification; cleanup and refactoring are not automatic.

## Verification strategy

Implementation will use focused automated checks:

1. Parse `.claude/settings.json`, `.claude/package-manager.json`, and the source ledger as JSON.
2. Validate required frontmatter and instruction bodies for every added agent, skill, command, and path-scoped rule.
3. Run Node fixture tests for both hooks:
   - `.env` and `.env.local` writes are blocked;
   - `.env.example` and ordinary source files are allowed;
   - JavaScript/TypeScript `console.log` is reported without blocking;
   - clean, missing, unsupported, and malformed inputs succeed safely.
4. Confirm existing Graphify hook matchers remain present after the settings merge.
5. Inspect Claude's project component inventory using the installed CLI where supported.
6. Review `git diff -- .claude docs/superpowers/specs` and verify no unrelated path was added to the implementation commit.

Application lint, test, and build commands are not required merely for configuration-only changes, because the hooks do not run during ordinary npm commands and no application source or dependency changes. If any application file is unexpectedly touched, the change is out of scope and must be reverted before completion.

## Acceptance criteria

- Everything added for this integration is project-scoped.
- Existing Graphify behavior is preserved.
- Claude Code defaults to `opusplan` with high effort in this repository only.
- npm is the explicit project package manager.
- The four specialist agents, two skills, and three commands are discoverable.
- Rules reflect actual LearnThrive architecture and commands rather than generic upstream assumptions.
- Real `.env` writes are blocked; `.env.example` writes are allowed.
- `console.log` produces a non-blocking warning and no source mutation.
- No raw marketplace plugin, MCP server, global setting, local-model download, or application dependency is added.
- All configuration and hook tests pass.
- Existing user work remains unstaged and unchanged.

## Explicit non-goals

- Installing every upstream component for completeness.
- Updating the machine-wide Claude Code executable.
- Changing `~/.claude/settings.json`, user plugins, permissions, hooks, agents, commands, or skills.
- Installing Supabase, GitHub, Context7, Playwright, filesystem, memory, or other MCP servers.
- Downloading Qwen or connecting Claude Code to Ollama/LM Studio.
- Adding Prettier, coverage tooling, or an arbitrary coverage threshold.
- Refactoring or validating the current application changes.
- Replacing Graphify, Superpowers, the official code-review plugin, or existing project design/testing skills.
