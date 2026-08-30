import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("saving state applies the top-level graph to the selected project", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "raddus-graph-store-"));
  process.env.RADDUS_GRAPH_DIR = dataDir;
  try {
    const store = await import(`../server/graphStore.mjs?graph-store-test=${Date.now()}`);
    await store.initializeGraphStore();

    const staleGraph = {
      nodes: [
        { id: "source", type: "agent", x: 0, y: 0, agentId: null },
        { id: "target", type: "agent", x: 300, y: 160, agentId: null },
      ],
      edges: [
        { id: "edge-1", source: "source", target: "target", type: "evaluates" },
      ],
    };
    const editedGraph = {
      ...staleGraph,
      edges: [
        {
          id: "edge-1",
          source: "source",
          target: "target",
          type: "evaluates",
          routingMode: "manual",
          waypoints: [{ x: 240, y: 210 }],
          bend: null,
        },
      ],
    };

    const saved = await store.replaceGraphState({
      selectedProjectId: "project-1",
      projects: [{
        id: "project-1",
        name: "Project",
        graph: staleGraph,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }],
      graph: editedGraph,
      agents: [],
      results: [],
    });

    assert.equal(saved.graph.edges[0].routingMode, "manual");
    assert.deepEqual(saved.graph.edges[0].waypoints, [{ x: 240, y: 210 }]);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
    delete process.env.RADDUS_GRAPH_DIR;
  }
});
