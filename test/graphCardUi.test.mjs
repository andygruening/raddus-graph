import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { projectNodeSizeForType } from "../src/edgeRouting.ts";

test("graph cards are available in the canvas UI and styled like orange agent cards", async () => {
  const [app, css, api] = await Promise.all([
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../src/api/RaddusGraphApi.ts", import.meta.url), "utf8"),
  ]);
  const graphBlock = css.match(/\.project-node\.graph\s*\{(?<body>[\s\S]*?)\n\}/)?.groups?.body ?? "";
  const agentSize = projectNodeSizeForType("agent");
  const graphSize = projectNodeSizeForType("graph");

  assert.ok(api.includes('"play" | "agent" | "expression" | "review" | "graph"'), "Graph node types should include graph.");
  assert.deepEqual(graphSize, agentSize);
  assert.deepEqual(graphSize, { width: 168, height: 72 });
  assert.ok(app.includes("function PaletteGraphButton"), "The palette should expose a graph card.");
  assert.ok(app.includes("{projects.map((project) =>"), "The Other tab should expose one graph card per project.");
  assert.ok(app.includes('const item: PaletteItem = { type: "graph", graphId: project.id }'), "Graph cards should keep the selected graph id.");
  assert.ok(app.includes("<strong>{project.name}</strong>"), "Palette graph entries should show each graph name.");
  assert.ok(app.includes("<strong>{graphName}</strong>"), "Graph cards should render the selected graph name.");
  assert.ok(app.includes('node.type === "graph"'), "Canvas graph cards should have a graph-specific click action.");
  assert.ok(app.includes("selectProject(node.graphId)"), "Clicking a graph card should switch to that graph.");
  assert.equal(app.includes("<strong>Graph</strong>"), false, "Graph cards should not render a generic Graph label.");
  assert.ok(app.includes("<GitPullRequest size={16}"), "Graph cards should use a graph-like icon.");
  assert.ok(graphBlock, "graph card CSS block should exist");
  assert.match(graphBlock, /--node-accent:\s*#f97316/);
  assert.match(graphBlock, /width:\s*168px/);
  assert.match(graphBlock, /height:\s*72px/);
  assert.match(graphBlock, /min-height:\s*72px/);
});

test("canvas keyboard shortcuts use graph, palette, sessions, play, create, and session chords", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");

  assert.equal(app.includes("handleProjectShortcut"), false);
  assert.ok(app.includes('shortcutKeys.has("KeyG")'), "Shift+G+Arrow should switch projects.");
  assert.ok(app.includes('shortcutKeys.has("KeyF")'), "Shift+F+Arrow should control the card palette.");
  assert.ok(app.includes('shortcutKeys.has("KeyD")'), "Shift+D+vertical Arrow should switch sessions.");
  assert.ok(app.includes('event.code === "KeyX"'), "Shift+X should open the graph play action.");
  assert.ok(app.includes('event.code === "KeyA"'), "Shift+A should open the active palette create action.");
  assert.ok(app.includes('event.code === "KeyS"'), "Shift+S should open sessions.");
  assert.ok(app.includes("paletteTabByOffset"), "Horizontal palette shortcuts should cycle tabs.");
  assert.ok(app.includes("setPaletteCollapsed(true)"), "Palette up shortcut should collapse the card palette.");
  assert.ok(app.includes("setPaletteCollapsed(false)"), "Palette down shortcut should expand the card palette.");
  assert.ok(app.includes("selectGraphSessionByOffset"), "Session shortcuts should switch followed sessions.");
  assert.ok(app.includes('event.key === "Escape"'), "Escape should close an open window.");
  assert.ok(app.includes("setDialog(null)"), "Escape should close open dialogs.");
  assert.ok(app.includes("setConfirmation(null)"), "Escape should close open confirmations.");
});
