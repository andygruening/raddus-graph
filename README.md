# Raddus Graph

Raddus Graph is a local web app for designing and running CLI-backed agent graphs. It lets you define agent specs, result IDs, play nodes, and expression cards, then run graph sessions through local Codex or Claude CLI processes.

[![npmjs.com](https://img.shields.io/badge/View%20on%20npmjs.com-6d9abf)](https://www.npmjs.com/package/@raddus/graph)

<img width="1233" height="527" alt="Raddus Graph canvas screenshot" src="https://github.com/user-attachments/assets/ffaf909c-a194-4254-96fc-aaaa4ef2018f" />

## Features

- Create local agent specs from a model, name, and system prompt.
- Build graph sessions from play nodes, agent nodes, and expression cards.
- Define graph-scoped result IDs and route terminal outcomes through expression cards.
- Persist graph data, agent specs, sessions, status records, retained worktrees, and PR mappings under `.raddus-graph/`.
- Run Codex CLI or Claude CLI sessions from the local Node.js server based on the selected model.
- Select a GitHub repository and branch from the authenticated local `gh` user, or run with no repository.
- Retain one worktree per graph session and publish file changes to one session branch and pull request.

## Requirements

- Node.js 20.19 or newer, or Node.js 22.12 or newer.
- npm.
- Codex CLI for models mapped to the Codex runner.
- Claude CLI for models mapped to the Claude runner.
- GitHub CLI (`gh`) authenticated with a GitHub account for repository and pull request workflows.

If `gh` is unavailable or unauthenticated, Raddus Graph still runs and the play-card repository selector only offers `None`.

## Setup

Install the package globally:

```shell
npm i -g @raddus/graph
```

Start Raddus Graph:

```shell
raddus-graph
```

The server prints the local URL when it starts, for example:

```text
Raddus Graph listening at http://127.0.0.1:5174
```

It also opens that URL in your default browser. To start the server without opening a browser:

```shell
raddus-graph --no-open
```

The old `raddus-canvas` binary remains as a compatibility alias for now.

## Local Development

Clone the repository and install dependencies:

```shell
npm install
```

Run the app in development mode:

```shell
npm run dev
```

Build the production bundle:

```shell
npm run build
```

## Local Data

By default, Raddus Graph stores local runtime data in `.raddus-graph/` under the directory where the server command is launched. Override this with:

```shell
RADDUS_GRAPH_DIR=/path/to/.raddus-graph raddus-graph
```

The store contains:

- `state.json`: graph design data, agent specs, result definitions, session metadata, node statuses, terminal outcomes, and PR mappings.
- `sessions/<graph-session-id>/worktree`: the retained workspace for a graph session.

## Runtime Model

Running a play node creates a graph session id. The server snapshots the current graph, provisions a retained session worktree, and executes one graph path at a time.

Agent prompts are assembled from:

- the upstream execution context that led to the current node
- high-level graph session context
- the original play-node prompt
- the graph result catalog
- the local status callback contract

Agent sessions post progress and terminal outcome JSON to:

```text
POST /api/graph/sessions/:graphSessionId/nodes/:nodeId/status
```

Expression cards route only after terminal outcomes. `completed` routes by a valid emitted result ID. Invalid, missing, or absent terminal results route through reserved `unknown`. A recognized result with no matching branch routes through reserved `fallback`. `stopped` ends without routing.

If a repository-backed session changes files, Raddus Graph creates one session branch and pull request after changes first need publishing. Later modifying agents in the same graph session push to the same branch and pull request.

## Architecture

Raddus Graph has two main parts:

- `bin/raddus-graph.mjs`: the CLI entrypoint used by the published commands.
- `server/`: local Node.js runtime modules that serve the app, manage graph persistence, launch CLI runners, discover GitHub repositories, and publish session pull requests.
- `server.mjs`: a small compatibility launcher for running the server from the repository root.
- `src/main.tsx`: the React mount entrypoint.
- `src/App.tsx`: the Raddus Graph frontend controller.
- `src/api/RaddusGraphApi.ts`: the frontend API client for `/api/graph/*`.
- `docs/adr/`: architecture decision records.

At runtime:

1. The user starts the local Node.js server.
2. The server initializes `.raddus-graph/` and serves the frontend over localhost.
3. The frontend loads graph state through `/api/graph/state`.
4. The server lists GitHub repositories through `gh` when available.
5. A play node creates a graph session.
6. The server runs CLI agents sequentially, receives node status callbacks, routes expression cards, and persists outcomes.

## Publishing

Use npm to publish a new version of `@raddus/graph`:

```shell
npm run publish:patch
```

Use `npm run publish:minor` or `npm run publish:major` when publishing a larger version bump.
