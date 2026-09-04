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

  assert.ok(api.includes('"play" | "agent" | "expression" | "graph" | "any"'), "Graph node types should include graph.");
  assert.deepEqual(graphSize, agentSize);
  assert.deepEqual(graphSize, { width: 168, height: 72 });
  assert.ok(app.includes("function PaletteGraphButton"), "The palette should expose a graph card.");
  assert.ok(app.includes("{projects.map((project) =>"), "The Other tab should expose one graph card per project.");
  assert.ok(app.includes('const item: PaletteItem = { type: "graph", graphId: project.id }'), "Graph cards should keep the selected graph id.");
  assert.ok(app.includes("<strong>{project.name}</strong>"), "Palette graph entries should show each graph name.");
  assert.ok(app.includes("<strong>{graphName}</strong>"), "Graph cards should render the selected graph name.");
  assert.ok(app.includes('node.type === "graph"'), "Canvas graph cards should have a graph-specific click action.");
  assert.ok(app.includes("selectProject(node.graphId)"), "Clicking a graph card should switch to that graph.");
  assert.equal(app.includes('sourceCandidate.type === "graph" && target.type === "graph"'), false, "Graph cards should not directly connect to graph cards.");
  assert.equal(app.includes('source.type === "graph" && target.type === "graph"'), false, "Graph cards should not be directly connectable to graph cards.");
  assert.ok(app.includes('(sourceCandidate.type === "agent" || sourceCandidate.type === "graph") && target.type === "play"'), "Dropping graph cards onto play cards should create start routes.");
  assert.ok(app.includes('source.type === "play" && (target.type === "agent" || target.type === "graph")'), "Play cards should directly connect to agents and graph cards.");
  assert.equal(app.includes('source.type === "graph" && target.type === "agent"'), false, "Graph cards should not directly connect to agents.");
  assert.ok(app.includes('source.type === "graph" && target.type === "expression"'), "Graph cards should evaluate expression branches.");
  assert.ok(app.includes('target.type === "agent" || target.type === "graph" || target.type === "play"'), "Expressions should route to agents, graph cards, and play cards.");
  assert.ok(app.includes("sourceCandidate.resultId ?? selectedRouteResultForExpression"), "New expression cards dropped onto play cards should keep their result route.");
  assert.equal(app.includes("<strong>Graph</strong>"), false, "Graph cards should not render a generic Graph label.");
  assert.ok(app.includes("<GitPullRequest size={16}"), "Graph cards should use a graph-like icon.");
  assert.ok(graphBlock, "graph card CSS block should exist");
  assert.match(graphBlock, /--node-accent:\s*#f97316/);
  assert.match(graphBlock, /width:\s*168px/);
  assert.match(graphBlock, /height:\s*72px/);
  assert.match(graphBlock, /min-height:\s*72px/);
});

test("child graphs show non-removable parent graph references", async () => {
  const [app, css, parentReferences] = await Promise.all([
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../src/parentGraphReferences.ts", import.meta.url), "utf8"),
  ]);
  const parentCardBlock = css.match(/\.project-node\.parent-graph-reference\s*\{(?<body>[\s\S]*?)\n\}/)?.groups?.body ?? "";
  const parentEdgeBlock = css.match(/\.project-parent-reference-edge\s*\{(?<body>[\s\S]*?)\n\}/)?.groups?.body ?? "";

  assert.ok(parentReferences.includes("type ParentGraphReference"), "The canvas should model derived parent graph references.");
  assert.ok(app.includes("parentGraphReferencesForState(state, selectedProject)"), "Parent graph references should be derived from project state.");
  assert.ok(parentReferences.includes("parentGraphReferencePositions"), "Parent graph reference positions should persist as graph metadata.");
  assert.ok(app.includes("beginParentGraphReferenceDrag"), "Parent graph reference cards should be draggable.");
  assert.ok(app.includes("moveParentGraphReferenceLocally"), "Dragging a parent graph reference should update its position locally.");
  assert.ok(app.includes("updateParentGraphReferencePositionInState"), "Dragging a parent graph reference should save into graph metadata.");
  assert.ok(parentReferences.includes("firstExecutableGraphNodeForProject(parentProject.graph, selectedProject.id)"), "Only executable parent graph cards should render as parent references.");
  assert.ok(parentReferences.includes("isExecutableIncomingGraphEdge"), "Executable parent references should require an incoming expression route.");
  assert.ok(app.includes('<g className="project-edge-group parent-reference"'), "The parent route should render as a dedicated ghost edge.");
  assert.ok(app.includes("project-node graph parent-graph-reference"), "The parent graph card should render as a ghost graph card.");
  assert.ok(app.includes("data-parent-graph-reference-node-id={node.id}"), "The parent graph card should be a derived node, not a normal canvas node.");
  assert.equal(app.includes("requestDeleteNode(reference.node.id)"), false, "Parent graph reference cards should not be manually removable.");
  assert.equal(app.includes("requestRemoveEdge(reference.edge.id)"), false, "Parent graph reference edges should not be manually removable.");
  assert.ok(parentCardBlock, "Parent graph reference card CSS block should exist.");
  assert.match(parentCardBlock, /border-style:\s*dashed/);
  assert.match(parentCardBlock, /opacity:\s*0\.56/);
  assert.match(parentCardBlock, /cursor:\s*grab/);
  assert.ok(parentEdgeBlock, "Parent graph reference edge CSS block should exist.");
  assert.match(parentEdgeBlock, /stroke-dasharray:\s*4 8/);
  assert.match(parentEdgeBlock, /pointer-events:\s*none/);
  assert.match(css, /\.project-node\.parent-graph-reference\.dragging/);
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
