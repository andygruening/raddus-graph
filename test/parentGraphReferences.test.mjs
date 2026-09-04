import test from "node:test";
import assert from "node:assert/strict";
import {
  graphWithParentGraphReferencePosition,
  parentGraphReferencesForState,
} from "../src/parentGraphReferences.ts";

test("parent graph references use moved positions and auto line anchors", () => {
  const childGraph = {
    nodes: [
      { id: "play-child", type: "play", x: 72, y: 96, prompt: "", repository: null, branch: null },
      { id: "any-child", type: "any", x: 72, y: 176 },
    ],
    edges: [],
  };
  const movedChildGraph = graphWithParentGraphReferencePosition(childGraph, "project-parent:graph-child", { x: 640, y: 128 });
  const childProject = {
    id: "project-child",
    name: "Child Graph",
    graph: movedChildGraph,
    agents: [],
    results: [],
    lastPlaySelection: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const parentProject = {
    id: "project-parent",
    name: "Parent Graph",
    graph: {
      nodes: [
        { id: "play-parent", type: "play", x: 0, y: 0, prompt: "", repository: null, branch: null },
        { id: "agent-parent", type: "agent", x: 180, y: 0, agentId: "agent-parent" },
        { id: "expr-child", type: "expression", x: 380, y: 0, resultId: "child" },
        { id: "graph-child", type: "graph", x: 180, y: 0, graphId: "project-child" },
      ],
      edges: [
        { id: "edge-parent-agent", source: "play-parent", target: "agent-parent", type: "runs" },
        { id: "edge-parent-expr", source: "agent-parent", target: "expr-child", type: "evaluates" },
        { id: "edge-expr-child", source: "expr-child", target: "graph-child", type: "routes", resultId: "child" },
      ],
    },
    agents: [],
    results: [],
    lastPlaySelection: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const state = {
    version: 1,
    agents: [],
    results: [],
    projects: [childProject, parentProject],
    selectedProjectId: childProject.id,
    graph: movedChildGraph,
    sessions: [],
    updatedAt: "2026-01-01T00:00:00.000Z",
    dataDir: "/tmp/raddus-graph-test",
  };

  const references = parentGraphReferencesForState(state, childProject);

  assert.equal(references.length, 1);
  assert.equal(references[0].id, "project-parent:graph-child");
  assert.deepEqual({ x: references[0].node.x, y: references[0].node.y }, { x: 640, y: 128 });
  assert.equal(references[0].edge.source, references[0].node.id);
  assert.equal(references[0].edge.target, "play-child");
  assert.equal(references[0].edge.type, "runs");
  assert.equal(references[0].edge.routingMode, "auto");
  assert.equal("sourceAnchor" in references[0].edge, false);
  assert.equal("targetAnchor" in references[0].edge, false);

  const disconnectedParentProject = {
    ...parentProject,
    graph: {
      ...parentProject.graph,
      edges: parentProject.graph.edges.filter((edge) => edge.id !== "edge-parent-expr"),
    },
  };
  assert.equal(parentGraphReferencesForState({
    ...state,
    projects: [childProject, disconnectedParentProject],
  }, childProject).length, 0);

  const directParentProject = {
    ...parentProject,
    graph: {
      ...parentProject.graph,
      edges: [
        { id: "edge-play-graph", source: "play-parent", target: "graph-child", type: "runs" },
      ],
    },
  };
  assert.equal(parentGraphReferencesForState({
    ...state,
    projects: [childProject, directParentProject],
  }, childProject).length, 1);
});
