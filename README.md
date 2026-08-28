# Raddus Canvas

## Overview

Raddus Canvas is a local web app for building, configuring, and running Claude managed-agent projects from a visual canvas.

The app is designed to run on your own machine. Your Anthropic API key is handled by the local server instead of being sent to a hosted Raddus backend, so you can use the canvas while keeping key storage under your control.

[![npmjs.com](https://img.shields.io/badge/View%20on%20npmjs.com-6d9abf)](https://www.npmjs.com/package/@raddus/canvas)

<img width="1233" height="527" alt="Raddus Canvas project canvas screenshot" src="https://github.com/user-attachments/assets/ffaf909c-a194-4254-96fc-aaaa4ef2018f" />

## Features

- Create and manage Claude agents from a canvas UI.
- Connect agents to trigger cards, MCP servers, skills, vaults, and environments.
- Start sessions from the canvas and inspect recent messages and status updates.
- Store project settings locally so projects, canvas position, and app preferences persist across localhost ports.
- Run as a local loopback app with a small Node.js server and React frontend.

## Setup

Install the package globally:

```shell
npm i -g @raddus/canvas
```

Start Raddus Canvas:

```shell
raddus-canvas
```

The server prints the local URL when it starts, for example:

```text
Raddus Canvas listening at http://127.0.0.1:5174
```

It also opens that URL in your default browser. To start the server without opening a browser:

```shell
raddus-canvas --no-open
```

You can also run it without a global install:

```shell
npx @raddus/canvas
```

When the app opens, enter a valid Anthropic API key. On macOS, the key is saved to Keychain. On other platforms, the key is kept in memory for the current server process.

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

## Security

Raddus Canvas is intended to be run locally. The server binds to `127.0.0.1` and rejects non-loopback API requests. Requests with an `Origin` header must also match the local server origin.

API key handling:

- macOS: Anthropic API keys are stored in macOS Keychain, one item per local Anthropic profile.
- Other platforms: the Anthropic API key is memory-only for now and is lost when the server exits.
- The browser receives an HTTP-only local session cookie. It does not need to keep the Anthropic API key in browser storage.
- Signing out clears the local session and deletes the active profile's stored macOS Keychain item.

Local app data:

- Projects, MCP server records, selected project, canvas viewport, and UI preferences are stored in a local JSON file.
- Local records are partitioned by Anthropic API key profile because Anthropic agents, vaults, environments, and related resource IDs are scoped to the API key's workspace/account context.
- On macOS, the default path is `~/Library/Application Support/Raddus Canvas/data.json`.
- On Windows, the default path is `%APPDATA%/Raddus Canvas/data.json`.
- On Linux, the default path is `$XDG_CONFIG_HOME/raddus-canvas/data.json`, or `~/.config/raddus-canvas/data.json` when `XDG_CONFIG_HOME` is not set.
- You can override the data file location with `RADDUS_CANVAS_DATA_FILE`.

The app still runs code in your browser and uses npm dependencies, so treat it like any other local development tool that can access a user-provided API key at runtime. Only run versions you trust.

## Architecture

Raddus Canvas has two main parts:

- `bin/raddus-canvas.mjs`: the CLI entrypoint used by the published `raddus-canvas` command.
- `server/`: local Node.js runtime modules that serve the app, proxy Anthropic API requests, manage the local session, store the Anthropic API key, and persist local app data.
- `server.mjs`: a small compatibility launcher for running the server from the repository root.
- `src/main.tsx`: the React mount entrypoint.
- `src/App.tsx`: the frontend app controller and remaining feature views.
- `src/auth/`, `src/domain/`, and `src/theme/`: extracted frontend feature, domain, and design-token helpers.
- `src/generated/`: generated frontend support files consumed by the app.

At runtime:

1. The user starts the local Node.js server.
2. The server serves the frontend over localhost.
3. The frontend signs in through the local server.
4. The local server validates the Anthropic API key, maps it to a local profile using a non-secret fingerprint, and stores the key according to the current platform.
5. Anthropic API calls go through `/api/anthropic/*`.
6. Local project data and app settings go through `/api/local-store/*` and are scoped to the active local profile.

Older browser-local project and MCP data is migrated into the active profile's server-backed local JSON store when the app loads.

## Publishing

Use npm to publish a new version of `@raddus/canvas`:

```shell
npm run publish:patch
```

Use `npm run publish:minor` or `npm run publish:major` when publishing a larger version bump.
