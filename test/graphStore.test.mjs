import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

function customResultIds(results) {
  return (results ?? []).filter((result) => !result.reserved).map((result) => result.id);
}

function resultIds(results) {
  return (results ?? []).map((result) => result.id);
}

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

test("saving project state preserves the last play selection", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "raddus-graph-store-"));
  process.env.RADDUS_GRAPH_DIR = dataDir;
  try {
    const store = await import(`../server/graphStore.mjs?graph-store-test=${Date.now()}`);
    await store.initializeGraphStore();

    const graph = {
      nodes: [
        { id: "play-a", type: "play", x: 0, y: 0, prompt: "First", repository: null, branch: null },
        { id: "play-b", type: "play", x: 240, y: 0, prompt: "Second", repository: "owner/repo", branch: "main" },
      ],
      edges: [],
    };
    const lastPlaySelection = {
      playNodeId: "play-b",
      prompt: "Ship this change",
      repository: "owner/repo",
      branch: "feature/play-launch",
    };

    const saved = await store.replaceGraphState({
      selectedProjectId: "project-1",
      projects: [{
        id: "project-1",
        name: "Project",
        graph,
        lastPlaySelection,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }],
      graph,
      agents: [],
      results: [],
    });

    assert.deepEqual(saved.projects[0].lastPlaySelection, lastPlaySelection);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
    delete process.env.RADDUS_GRAPH_DIR;
  }
});

test("saving agents preserves supported Codex reasoning effort", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "raddus-graph-store-"));
  process.env.RADDUS_GRAPH_DIR = dataDir;
  try {
    const store = await import(`../server/graphStore.mjs?graph-store-test=${Date.now()}`);
    await store.initializeGraphStore();

    const saved = await store.replaceGraphState({
      agents: [
        {
          id: "agent-codex",
          name: "Codex Agent",
          model: "gpt-5.5",
          modelReasoningEffort: "high",
          systemPrompt: "",
        },
        {
          id: "agent-claude",
          name: "Claude Agent",
          model: "claude-sonnet-4-6",
          modelReasoningEffort: "high",
          systemPrompt: "",
        },
      ],
      results: [],
    });

    assert.equal(saved.agents.find((agent) => agent.id === "agent-codex")?.modelReasoningEffort, "high");
    assert.equal(saved.agents.find((agent) => agent.id === "agent-claude")?.modelReasoningEffort, null);
    assert.equal(saved.projects[0].agents.find((agent) => agent.id === "agent-codex")?.modelReasoningEffort, "high");
    assert.equal(saved.projects[0].agents.find((agent) => agent.id === "agent-claude")?.modelReasoningEffort, null);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
    delete process.env.RADDUS_GRAPH_DIR;
  }
});

test("reserved result definitions include built-in terminal routes", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "raddus-graph-store-"));
  process.env.RADDUS_GRAPH_DIR = dataDir;
  try {
    const store = await import(`../server/graphStore.mjs?graph-store-test=${Date.now()}-reserved-results`);
    await store.initializeGraphStore();

    const saved = await store.readGraphData();

    assert.deepEqual(resultIds(saved.results), ["completed", "failed", "ask-for-approval", "default"]);
    assert.deepEqual(saved.results.map((result) => result.reserved), [true, true, true, true]);
    assert.deepEqual(resultIds(saved.projects[0].results), ["completed", "failed", "ask-for-approval", "default"]);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
    delete process.env.RADDUS_GRAPH_DIR;
  }
});

test("terminal statuses route through built-in reserved results", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "raddus-graph-store-"));
  process.env.RADDUS_GRAPH_DIR = dataDir;
  try {
    const store = await import(`../server/graphStore.mjs?graph-store-test=${Date.now()}-terminal-routes`);
    await store.initializeGraphStore();

    await store.addGraphSession({
      id: "graph-session-results",
      status: "running",
      playNodeId: "play-start",
      prompt: "Run the graph.",
      repository: null,
      workspacePath: join(dataDir, "sessions", "graph-session-results", "worktree"),
      activeAgentSessionIds: [],
      projectId: "project-default",
      projectName: "Default Project",
      graphSnapshot: { nodes: [], edges: [] },
      agentsSnapshot: [],
      resultsSnapshot: store.defaultResultDefinitions(),
      agentSessions: [],
      pendingReview: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const completedSession = await store.createAgentSession("graph-session-results", { nodeId: "agent-completed" });
    const completed = await store.recordAgentSessionStatus("graph-session-results", completedSession.agentSession.id, {
      state: "completed",
      summary: "Done.",
    }, "test");
    assert.equal(completed.status.routedResultId, "completed");
    assert.equal(completed.status.routeReason, "default_completed");

    const approvalSession = await store.createAgentSession("graph-session-results", { nodeId: "agent-approval" });
    const approval = await store.recordAgentSessionStatus("graph-session-results", approvalSession.agentSession.id, {
      state: "completed",
      resultId: "ask-for-approval",
      summary: "Needs approval.",
    }, "test");
    assert.equal(approval.status.routedResultId, "ask-for-approval");
    assert.equal(approval.status.routeReason, "matched_result");

    const failedSession = await store.createAgentSession("graph-session-results", { nodeId: "agent-failed" });
    const failed = await store.recordAgentSessionStatus("graph-session-results", failedSession.agentSession.id, {
      state: "failed",
      summary: "Failed.",
    }, "test");
    assert.equal(failed.status.routedResultId, "failed");
    assert.equal(failed.status.routeReason, "failed");

    const invalidSession = await store.createAgentSession("graph-session-results", { nodeId: "agent-invalid" });
    const invalid = await store.recordAgentSessionStatus("graph-session-results", invalidSession.agentSession.id, {
      state: "completed",
      resultId: "failed",
      summary: "Contradictory.",
    }, "test");
    assert.equal(invalid.status.routedResultId, "default");
    assert.equal(invalid.status.routeReason, "invalid_completion_result");

    const unrecognizedSession = await store.createAgentSession("graph-session-results", { nodeId: "agent-unrecognized" });
    const unrecognized = await store.recordAgentSessionStatus("graph-session-results", unrecognizedSession.agentSession.id, {
      state: "completed",
      resultId: "made-up",
      summary: "Unknown result.",
    }, "test");
    assert.equal(unrecognized.status.routedResultId, "default");
    assert.equal(unrecognized.status.routeReason, "unrecognized_result");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
    delete process.env.RADDUS_GRAPH_DIR;
  }
});

test("agent sessions route custom results through their graph snapshot", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "raddus-graph-store-"));
  process.env.RADDUS_GRAPH_DIR = dataDir;
  try {
    const store = await import(`../server/graphStore.mjs?graph-store-test=${Date.now()}-graph-session-results`);
    await store.initializeGraphStore();

    await store.addGraphSession({
      id: "graph-session-child-results",
      status: "running",
      playNodeId: "play-parent",
      prompt: "Run parent graph.",
      repository: null,
      workspacePath: join(dataDir, "sessions", "graph-session-child-results", "worktree"),
      activeAgentSessionIds: [],
      projectId: "project-parent",
      projectName: "Parent Graph",
      graphSnapshot: { nodes: [], edges: [] },
      projectsSnapshot: [
        {
          id: "project-child",
          name: "Child Graph",
          graph: { nodes: [], edges: [] },
          agents: [],
          results: [{ id: "child-result", description: "Child-only result." }],
        },
      ],
      agentsSnapshot: [],
      resultsSnapshot: store.defaultResultDefinitions(),
      agentSessions: [],
      pendingReview: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const childSession = await store.createAgentSession("graph-session-child-results", {
      nodeId: "agent-child",
      graphId: "project-child",
    });
    const completed = await store.recordAgentSessionStatus("graph-session-child-results", childSession.agentSession.id, {
      state: "completed",
      resultId: "child-result",
      summary: "Child graph completed.",
    }, "test");

    assert.equal(childSession.agentSession.graphId, "project-child");
    assert.equal(completed.status.routedResultId, "child-result");
    assert.equal(completed.status.routeReason, "matched_result");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
    delete process.env.RADDUS_GRAPH_DIR;
  }
});

test("legacy unknown and fallback result routes normalize to default", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "raddus-graph-store-"));
  process.env.RADDUS_GRAPH_DIR = dataDir;
  try {
    const store = await import(`../server/graphStore.mjs?graph-store-test=${Date.now()}-legacy-result-routes`);
    await store.initializeGraphStore();

    const graph = {
      nodes: [
        { id: "play-a", type: "play", x: -200, y: 0, prompt: "Start", repository: null, branch: null },
        { id: "agent-a", type: "agent", x: 0, y: 0, agentId: "agent-a" },
        { id: "expr-unknown", type: "expression", x: 220, y: 0, resultId: "unknown" },
        { id: "expr-fallback", type: "expression", x: 220, y: 100, resultId: "fallback" },
      ],
      edges: [
        { id: "edge-unknown", source: "expr-unknown", target: "agent-a", type: "routes", resultId: "unknown" },
        { id: "edge-fallback", source: "expr-fallback", target: "agent-a", type: "routes", resultId: "fallback" },
      ],
    };

    const saved = await store.replaceGraphState({
      selectedProjectId: "project-legacy",
      projects: [{
        id: "project-legacy",
        name: "Legacy Project",
        graph,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }],
      graph,
      results: [
        { id: "unknown", description: "Legacy unknown.", reserved: true },
        { id: "fallback", description: "Legacy fallback.", reserved: true },
      ],
    });

    assert.deepEqual(saved.graph.nodes.filter((node) => node.type === "expression").map((node) => node.resultId), ["default", "default"]);
    assert.deepEqual(saved.graph.edges.map((edge) => edge.resultId), ["default", "default"]);
    assert.equal(saved.results.some((result) => result.id === "unknown" || result.id === "fallback"), false);
    assert.ok(saved.results.some((result) => result.id === "default" && result.reserved));
  } finally {
    await rm(dataDir, { recursive: true, force: true });
    delete process.env.RADDUS_GRAPH_DIR;
  }
});

test("project agents and custom expressions stay isolated by selected project", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "raddus-graph-store-"));
  process.env.RADDUS_GRAPH_DIR = dataDir;
  try {
    const store = await import(`../server/graphStore.mjs?graph-store-test=${Date.now()}-project-catalogs`);
    await store.initializeGraphStore();

    const projectOneGraph = {
      nodes: [
        { id: "play-one", type: "play", x: 0, y: 0, prompt: "One", repository: null, branch: null },
        { id: "agent-one-node", type: "agent", x: 180, y: 0, agentId: "agent-one" },
      ],
      edges: [],
    };
    const projectTwoGraph = {
      nodes: [
        { id: "play-two", type: "play", x: 0, y: 0, prompt: "Two", repository: null, branch: null },
        { id: "agent-two-node", type: "agent", x: 180, y: 0, agentId: "agent-two" },
        { id: "expr-two", type: "expression", x: 380, y: 0, resultId: "two-result" },
      ],
      edges: [
        { id: "edge-two", source: "agent-two-node", target: "expr-two", type: "evaluates" },
      ],
    };

    const saved = await store.replaceGraphState({
      selectedProjectId: "project-two",
      projects: [
        {
          id: "project-one",
          name: "Project One",
          graph: projectOneGraph,
          agents: [{ id: "agent-one", name: "Agent One", model: "gpt-5.5", systemPrompt: "" }],
          results: [{ id: "one-result", description: "Project one result." }],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "project-two",
          name: "Project Two",
          graph: projectTwoGraph,
          agents: [{ id: "agent-two", name: "Agent Two", model: "gpt-5.5", systemPrompt: "" }],
          results: [{ id: "two-result", description: "Project two result." }],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      graph: projectTwoGraph,
      agents: [{ id: "agent-two-edited", name: "Agent Two Edited", model: "gpt-5.5", systemPrompt: "" }],
      results: [
        { id: "two-result", description: "Project two result." },
        { id: "two-extra", description: "Project two extra result." },
      ],
    });

    assert.deepEqual(saved.agents.map((agent) => agent.id), ["agent-two-edited"]);
    assert.deepEqual(saved.projects.find((project) => project.id === "project-one")?.agents.map((agent) => agent.id), ["agent-one"]);
    assert.deepEqual(saved.projects.find((project) => project.id === "project-two")?.agents.map((agent) => agent.id), ["agent-two-edited"]);
    assert.deepEqual(customResultIds(saved.results), ["two-result", "two-extra"]);
    assert.deepEqual(customResultIds(saved.projects.find((project) => project.id === "project-one")?.results), ["one-result"]);
    assert.deepEqual(customResultIds(saved.projects.find((project) => project.id === "project-two")?.results), ["two-result", "two-extra"]);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
    delete process.env.RADDUS_GRAPH_DIR;
  }
});

test("legacy global agents and custom expressions are migrated into projects", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "raddus-graph-store-"));
  process.env.RADDUS_GRAPH_DIR = dataDir;
  try {
    const store = await import(`../server/graphStore.mjs?graph-store-test=${Date.now()}-legacy-catalogs`);
    await store.initializeGraphStore();

    const graph = {
      nodes: [{ id: "play-a", type: "play", x: 0, y: 0, prompt: "Start", repository: null, branch: null }],
      edges: [],
    };
    const saved = await store.replaceGraphState({
      selectedProjectId: "project-a",
      projects: [
        {
          id: "project-a",
          name: "Project A",
          graph,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "project-b",
          name: "Project B",
          graph,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      graph,
      agents: [{ id: "legacy-agent", name: "Legacy Agent", model: "gpt-5.5", systemPrompt: "" }],
      results: [{ id: "legacy-result", description: "Legacy expression." }],
    });

    assert.deepEqual(saved.projects.map((project) => project.agents.map((agent) => agent.id)), [["legacy-agent"], ["legacy-agent"]]);
    assert.deepEqual(saved.projects.map((project) => customResultIds(project.results)), [["legacy-result"], ["legacy-result"]]);
    assert.deepEqual(saved.agents.map((agent) => agent.id), ["legacy-agent"]);
    assert.deepEqual(customResultIds(saved.results), ["legacy-result"]);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
    delete process.env.RADDUS_GRAPH_DIR;
  }
});

test("graph store preserves review cards and pending review state", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "raddus-graph-store-"));
  process.env.RADDUS_GRAPH_DIR = dataDir;
  try {
    const store = await import(`../server/graphStore.mjs?graph-store-test=${Date.now()}-review`);
    await store.initializeGraphStore();

    const graph = {
      nodes: [
        { id: "agent-a", type: "agent", x: 0, y: 0, agentId: "agent-a" },
        { id: "expr-review", type: "expression", x: 220, y: 0, resultId: "needs-review" },
        { id: "review-a", type: "review", x: 440, y: 0 },
      ],
      edges: [
        { id: "edge-agent-expr", source: "agent-a", target: "expr-review", type: "evaluates" },
        { id: "edge-expr-review", source: "expr-review", target: "review-a", type: "routes", resultId: "needs-review" },
      ],
    };

    await store.replaceGraphState({
      selectedProjectId: "project-review",
      projects: [{
        id: "project-review",
        name: "Review Project",
        graph,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }],
      graph,
      agents: [{ id: "agent-a", name: "Agent A", model: "gpt-5", systemPrompt: "" }],
      results: [{ id: "needs-review", description: "Ask the user." }],
    });

    await store.addGraphSession({
      id: "graph-session-review",
      status: "waiting_review",
      playNodeId: "play-start",
      prompt: "Original prompt",
      repository: null,
      workspacePath: join(dataDir, "sessions", "graph-session-review", "worktree"),
      activeAgentSessionIds: [],
      projectId: "project-review",
      projectName: "Review Project",
      graphSnapshot: graph,
      agentsSnapshot: [{ id: "agent-a", name: "Agent A", model: "gpt-5", systemPrompt: "" }],
      resultsSnapshot: [{ id: "needs-review", description: "Ask the user." }],
      agentSessions: [],
      pendingReview: {
        id: "pending-review-a",
        reviewNodeId: "review-a",
        agentNodeId: "agent-a",
        previousAgentSessionId: "agent-session-a",
        incomingExpressionNodeId: "expr-review",
        incomingEdgeIds: ["edge-agent-expr", "edge-expr-review"],
        incomingResultId: "needs-review",
        upstreamAgentSessionIds: ["agent-session-a"],
        question: "Should I continue?",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const saved = await store.readGraphData();
    assert.equal(saved.graph.nodes.find((node) => node.id === "review-a")?.type, "review");
    assert.equal(saved.graph.edges.find((edge) => edge.id === "edge-expr-review")?.target, "review-a");
    assert.equal(saved.sessions[0].status, "waiting_review");
    assert.deepEqual(saved.sessions[0].pendingReview, {
      id: "pending-review-a",
      graphSessionId: "graph-session-review",
      graphId: null,
      reviewNodeId: "review-a",
      agentNodeId: "agent-a",
      previousAgentSessionId: "agent-session-a",
      incomingExpressionNodeId: "expr-review",
      incomingEdgeIds: ["edge-agent-expr", "edge-expr-review"],
      incomingResultId: "needs-review",
      upstreamAgentSessionIds: ["agent-session-a"],
      question: "Should I continue?",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  } finally {
    await rm(dataDir, { recursive: true, force: true });
    delete process.env.RADDUS_GRAPH_DIR;
  }
});

test("graph store preserves graph cards and their start routes", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "raddus-graph-store-"));
  process.env.RADDUS_GRAPH_DIR = dataDir;
  try {
    const store = await import(`../server/graphStore.mjs?graph-store-test=${Date.now()}-graph-card`);
    await store.initializeGraphStore();

    const graph = {
      nodes: [
        { id: "play-a", type: "play", x: 0, y: 0, prompt: "Start", repository: null, branch: null },
        { id: "graph-a", type: "graph", x: 180, y: 0, graphId: "project-child" },
        { id: "agent-a", type: "agent", x: 380, y: 0, agentId: "agent-a" },
      ],
      edges: [
        { id: "edge-play-graph", source: "play-a", target: "graph-a", type: "runs" },
        { id: "edge-graph-agent", source: "graph-a", target: "agent-a", type: "runs" },
      ],
    };

    const saved = await store.replaceGraphState({
      selectedProjectId: "project-graph-card",
      projects: [{
        id: "project-graph-card",
        name: "Graph Card Project",
        graph,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }],
      graph,
      agents: [{ id: "agent-a", name: "Agent A", model: "gpt-5", systemPrompt: "" }],
      results: [],
    });

    assert.equal(saved.graph.nodes.find((node) => node.id === "graph-a")?.type, "graph");
    assert.equal(saved.graph.nodes.find((node) => node.id === "graph-a")?.graphId, "project-child");
    assert.deepEqual(saved.graph.edges.map((edge) => [edge.source, edge.target, edge.type]), [
      ["play-a", "graph-a", "runs"],
      ["graph-a", "agent-a", "runs"],
    ]);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
    delete process.env.RADDUS_GRAPH_DIR;
  }
});
