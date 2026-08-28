---
status: proposed
date: 2026-08-28
project: Raddus Graph
local_path: docs/adr/0001-migrate-to-raddus-graph-local-cli-agent-graphs.md
gist: pending explicit approval
---

# Migrate to Raddus Graph local CLI agent graphs

## Issue

Raddus Canvas is currently a local Anthropic managed-agent canvas. Its server authenticates with an Anthropic API key, proxies Anthropic SDK calls, and exposes resources for hosted agents, sessions, deployments, environments, vaults, MCP servers, skills, integrations, API keys, and automation triggers. The next product direction is different: Raddus Graph should be a canvas for designing local agentic execution graphs where graph nodes define agents, play prompts, result definitions, conditional expressions, graph sessions, and session workspaces.

This decision is being recorded before implementation because the migration changes the product identity, server integration boundary, persistence model, and graph semantics.

## Decision

Rename the product direction from Raddus Canvas to Raddus Graph and migrate the app away from Anthropic managed-agent SDK orchestration. Raddus Graph will use a local server as the execution and persistence boundary for graph-defined CLI agent sessions, initially supporting Codex CLI and Claude CLI runners.

Created agent specs will contain only:

- `name`
- `model`
- `system_prompt`

Agent specs, graph sessions, node status records, session workspaces, and session pull request mappings will be stored by the server in a local hidden `.raddus-graph/` directory. The exact root resolution is left for implementation, but the store must be server-side and filesystem-backed rather than browser-only or hosted-provider-backed.

The graph model will remove MCP server and skill connections, hosted integrations, hosted API resources, and automation trigger nodes. The Integrations tab will be removed. Agent execution will be launched from play nodes and will construct each CLI session prompt from:

- the upstream execution path context leading to the current node
- high-level graph context
- the play node prompt used by the user
- the graph's result catalog
- the local server callback contract for status and terminal outcome updates

Running a graph from a play node creates a graph session with a unique id. A play node can select a GitHub repository and branch, or select `None`. The server will use the authenticated local GitHub CLI user to list available repositories. If `gh` is unavailable or unauthenticated, the play node still runs but only offers `None` for repository selection. When a repository and branch are selected, the server clones that branch into a per-session worktree. Session worktrees are retained as durable artifacts.

Raddus Graph will add a graph-scoped result catalog and expression cards. A result definition has an `id` value and a human-readable `description`. Result IDs are reusable labels and are not unique per agent; two agents may both produce `approved` if the graph author wants that shared meaning. Expression cards compare a selected upstream node's terminal outcome to result IDs and route execution to at most one next agent for each branch.

The result catalog includes two reserved system-owned result IDs:

- `unknown`: used when an agent emits an unrecognized result ID, omits a terminal outcome, or exits without posting the required terminal outcome.
- `fallback`: used by expression cards when an agent emits a recognized result ID but the expression card has no explicit branch for that result.

Agents are not allowed to emit `unknown` or `fallback` directly. Execution logs must distinguish why routing used `unknown`, even when those cases share the same branch behavior.

Expression cards route only after a selected upstream node reaches a terminal state. `completed` routes by the emitted valid result ID. Invalid, missing, or absent terminal results route through `unknown`. A recognized result with no matching expression branch routes through `fallback`. `stopped` ends the graph session path without expression routing. Failed CLI execution routes through `unknown` for now while preserving the failure reason in the execution log.

Agent sessions report progress and terminal outcomes by posting JSON to the local server with the graph session id and node id. WebSockets may be added for live UI updates, but durable routing is based on server-persisted status and terminal outcome records, not transient socket events.

The model field in an agent spec determines which CLI runner the server uses. The model catalog maps models to Codex CLI or Claude CLI. Unknown models are rejected. Ambiguous model-to-runner mapping is out of scope for the first migration.

If an agent modifies files in the session worktree, Raddus Graph creates one branch and pull request for the graph session after the first file changes need publishing. All modifying agents in the same graph session use the same session branch and pull request. Graph execution is sequential for the first migration so multiple agents do not concurrently mutate the shared worktree or PR branch.

## Status

Proposed.

## Group

Product architecture, local execution, graph runtime.

## Assumptions

- Raddus Graph remains a local loopback web app with a local Node.js server and React frontend.
- Users who install Raddus Graph are expected to have the selected CLI runner available locally when they run a graph.
- Codex CLI and Claude CLI execution can be represented behind a small runner abstraction without preserving the Anthropic SDK data model.
- The server is the right boundary for process execution and local filesystem persistence.
- Result matching should use stable result IDs rather than free-form model text when graph routing decisions are made.
- A graph session has exactly one active execution path at a time in the first migration.
- A model catalog can map supported model IDs to the correct local CLI runner.
- The local GitHub CLI is the source of repository discovery and pull request publication when repository-backed graph sessions are used.

## Constraints

- The migration should not keep Anthropic API key sign-in, Anthropic SDK proxy routes, or hosted Anthropic managed-agent resources as core runtime dependencies.
- The graph editor should not expose MCP server cards, skill cards, hosted integration templates, API trigger nodes, or automation trigger nodes in the target experience.
- Agent creation should stay intentionally small: model, name, and system prompt only.
- The local `.raddus-graph/` store must avoid placing secrets or runner credentials in browser storage.
- Result IDs `unknown` and `fallback` are reserved system-owned IDs.
- Expression cards route only from terminal agent outcomes.
- Each expression branch targets at most one next agent in the first migration.
- Session worktrees are retained after graph sessions finish.
- One graph session maps to at most one pull request.
- If repository discovery is unavailable because `gh` is missing or unauthenticated, the play node must still allow sessions with repository selection set to `None`.
- The first implementation phase should be documentation and design only; runtime integration is out of scope for this ADR-writing task.

## Positions

1. Keep Raddus Canvas as an Anthropic managed-agent canvas and add conditional result routing on top.
2. Keep the existing UI shape but replace only the Anthropic SDK calls with CLI calls.
3. Migrate to Raddus Graph as a local CLI-backed agentic graph designer with a simplified graph model, graph sessions, retained session workspaces, and explicit terminal-result routing.

## Argument

Position 3 best matches the new product direction. The current Anthropic managed-agent model brings hosted resources, API key profile scoping, deployments, environments, vaults, MCP servers, skills, integrations, and automation triggers into the center of the app. Those concepts now distract from the core workflow: engineering a graph of local agent sessions and conditional terminal-result routing.

Replacing the SDK boundary with a server-managed CLI runner boundary keeps process execution out of the browser, allows multiple runner implementations, and makes Codex CLI and Claude CLI sessions first-class runtime targets. Simplifying agent specs to name, model, and system prompt reduces coupling to hosted provider resource shapes and keeps the canvas focused on graph behavior.

Graph sessions provide the durable execution unit that the current ADR was missing. They give every play-node run a unique id, bind node statuses and outcomes to that run, retain the worktree that agents used, and provide the unit for branch and pull request publication when code changes occur.

Result definitions and expression cards make routing explicit. Instead of relying on hidden workflow triggers or implicit natural-language branching, graph authors can design branches around stable result IDs with descriptions that explain what each outcome means. Restricting expression routing to terminal outcomes keeps the first runtime deterministic and avoids branches firing from progress states that may later be contradicted.

Using `unknown` and `fallback` as reserved system-owned results separates two important cases: an agent did not provide a recognized outcome, or an expression card did not define a branch for a recognized outcome. This keeps graph design inspectable without forcing every graph author to handle every result explicitly.

Sequential graph execution is a deliberate first-version constraint. A single retained worktree and one shared session pull request are simpler to reason about than concurrent mutation across branches of the same graph.

## Implications

- The existing Anthropic authentication flow, keychain profile handling, SDK proxy, and API client surface will need to be removed or replaced.
- The server will need new local filesystem storage for agent specs, graph sessions, status records, terminal outcomes, worktrees, and pull request mappings under `.raddus-graph/`.
- The frontend domain model will need to drop or migrate away from tabs and node types for MCP servers, skills, integrations, API triggers, email triggers, Slack triggers, schedules, deployments, environments, vaults, and API keys where they no longer fit the target product.
- Existing saved Raddus Canvas projects may need a migration path or a deliberate "new product, new storage" boundary.
- CLI execution introduces process lifecycle concerns: runner discovery, working directory provisioning, environment handling, cancellation, output capture, status callback validation, result extraction, and session context persistence.
- Expression cards introduce graph-runtime ordering and routing semantics that should be specified before implementation.
- The server will need an HTTP callback endpoint for node status and terminal outcome updates.
- The graph runtime will need to mark active nodes as `stopped` after interruption or server restart rather than attempting resume in the first migration.
- GitHub-backed sessions add a local `gh` dependency for repository discovery, cloning, branch creation, push, and pull request creation.
- Retained worktrees will need cleanup or archive controls later, even though automatic deletion is not part of the first migration.

## Related Decisions

None yet.

## Related Requirements

- The app is renamed to Raddus Graph.
- The server no longer depends on Anthropic SDK orchestration.
- The server can run Codex CLI or Claude CLI agent sessions.
- Agent specs are locally persisted by the server.
- Agent specs consist of model, name, and system prompt.
- The selected model maps to the CLI runner; unknown models are rejected.
- MCP server and skill connections are removed.
- API and automation triggers are removed.
- The Integrations tab is removed.
- Result definitions are available through a graph-scoped result catalog.
- The result catalog includes reserved `unknown` and `fallback` result IDs.
- Agents cannot emit reserved result IDs.
- Running a play node creates a graph session id.
- Agent sessions POST progress status and terminal outcome JSON to the local server with graph session id and node id.
- Durable routing is based on persisted terminal outcomes.
- Expression cards route agent execution based on selected upstream node terminal result IDs.
- Expression cards route only after terminal states and target at most one next agent per branch.
- Agent prompts are assembled from upstream execution path context, high-level graph context, the play node prompt, result catalog instructions, and the local callback contract.
- Play nodes can select a repository and branch from repositories visible to the authenticated local GitHub CLI user, or `None`.
- If `gh` is unavailable or unauthenticated, play nodes only offer `None`.
- Repository-backed graph sessions clone the selected branch into a retained per-session worktree.
- A graph session maps to one branch and one pull request, created after file changes need publishing.
- All modifying agents in a graph session push to the session pull request.
- Graph execution is sequential in the first migration.
- Interrupted active nodes are marked `stopped` without expression routing.

## Related Artifacts

- `README.md`
- `package.json`
- `server/`
- `src/App.tsx`
- `src/domain/types.ts`
- `src/storage/localCanvasStore.ts`
- future `.raddus-graph/` local store
- local `gh` CLI
- Codex CLI
- Claude CLI

## Related Principles

- Keep local process execution server-side, not browser-side.
- Make graph routing explicit and inspectable.
- Persist graph design data locally in a project-owned format.
- Prefer stable IDs for runtime control flow over parsing arbitrary prose.
- Separate progress status from terminal outcome.
- Treat graph sessions as the unit of execution, workspace retention, and pull request publication.

## Notes

- This ADR intentionally does not implement the migration.
- A follow-up design should define the `.raddus-graph/` directory layout, CLI runner contract, status callback schema, terminal outcome schema, upstream execution path context schema, session worktree layout, pull request mapping schema, and project migration strategy.
