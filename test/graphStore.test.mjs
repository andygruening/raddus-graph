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
