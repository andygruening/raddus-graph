import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { availableResultsForAgent, buildAgentPrompt, cliArgsForRunner, continuationTargetForSession, nextGraphRouteFromOutcome, reviewQuestionFromAgentSession, statusPayloadsFromText } from "../server/graphRuntime.mjs";

test("runAgentNode receives userPrompt before building an agent prompt", async () => {
  const source = await readFile(new URL("../server/graphRuntime.mjs", import.meta.url), "utf8");
  const params = source.match(/async function runAgentNode\(\{(?<params>[\s\S]*?)\}\) \{/)?.groups?.params ?? "";

  assert.match(params, /\buserPrompt\b/);
  assert.match(source, /buildAgentPrompt\(\{[\s\S]*\buserPrompt\b[\s\S]*\}\)/);
});

test("codex runner args use the current noninteractive approval flag", () => {
  const { args, input } = cliArgsForRunner(
    "codex",
    { model: "gpt-5" },
    "/tmp/raddus-workspace",
    "Run the graph.",
  );

  assert.equal(input, "Run the graph.");
  assert.deepEqual(args.slice(0, 2), ["exec", "--model"]);
  assert.ok(args.includes("--approve-for-me"));
  assert.equal(args.includes("--ask-for-approval"), false);
  assert.equal(args.includes("--sandbox"), false);
  assert.equal(args[args.length - 1], "-");
});

test("codex runner args include explicit reasoning effort when selected", () => {
  const { args } = cliArgsForRunner(
    "codex",
    { model: "gpt-5.6-sol", modelReasoningEffort: "xhigh" },
    "/tmp/raddus-workspace",
    "Run the graph.",
  );

  assert.deepEqual(args.slice(0, 6), [
    "exec",
    "--model",
    "gpt-5.6-sol",
    "-c",
    'model_reasoning_effort="xhigh"',
    "--cd",
  ]);
});

test("status file parser accepts newline-delimited JSON callbacks", () => {
  const { payloads, errors } = statusPayloadsFromText([
    '{"state":"working","summary":"Started implementation."}',
    '{"state":"completed","resultId":"approved","summary":"Work completed."}',
  ].join("\n"));

  assert.deepEqual(errors, []);
  assert.equal(payloads.length, 2);
  assert.equal(payloads[0].state, "working");
  assert.equal(payloads[1].state, "completed");
  assert.equal(payloads[1].resultId, "approved");
});

test("status file parser rejects non-object entries without dropping valid lines", () => {
  const { payloads, errors } = statusPayloadsFromText([
    '{"state":"working","summary":"Still running."}',
    'not-json',
    '["bad",{"state":"failed","summary":"Terminal fallback."}]',
  ].join("\n"));

  assert.equal(payloads.length, 2);
  assert.equal(payloads[0].state, "working");
  assert.equal(payloads[1].state, "failed");
  assert.equal(errors.length, 2);
});

test("agent prompt is structured markdown with history output and user context last", () => {
  const prompt = buildAgentPrompt({
    session: {
      id: "graph-session-test",
      prompt: "Ship the requested change.",
      repository: {
        nameWithOwner: "owner/repo",
        url: "https://github.com/owner/repo",
        branch: "feature/session-prompts",
      },
      workspacePath: "/tmp/raddus-workspace",
      agentSessions: [
        {
          id: "agent-session-a",
          sequence: 0,
          nodeId: "node-a",
          agentId: "agent-a",
          previousAgentSessionId: null,
          incomingExpressionNodeId: null,
          incomingEdgeIds: [],
          incomingResultId: null,
          response: "Actual transcript output from Agent A.",
          stdout: "Raw stdout from Agent A.",
          stderr: "",
          statuses: [],
          terminalOutcome: {
            state: "completed",
            emittedResultId: "approved",
            routedResultId: "approved",
            routeReason: "matched_result",
            summary: "Tiny terminal summary.",
            detail: "Detailed terminal handoff.",
          },
        },
      ],
    },
    graph: {
      nodes: [
        { id: "node-a", type: "agent", agentId: "agent-a" },
        { id: "node-b", type: "agent", agentId: "agent-b" },
        { id: "node-c", type: "agent", agentId: "agent-c" },
        { id: "expr-approved", type: "expression", resultId: "approved" },
        { id: "expr-ignored", type: "expression", resultId: "ignored" },
      ],
      edges: [
        { id: "edge-b-approved", source: "node-b", target: "expr-approved", type: "evaluates" },
        { id: "edge-approved-c", source: "expr-approved", target: "node-c", type: "routes", resultId: "approved" },
        { id: "edge-a-ignored", source: "node-a", target: "expr-ignored", type: "evaluates" },
        { id: "edge-ignored-c", source: "expr-ignored", target: "node-c", type: "routes", resultId: "ignored" },
      ],
    },
    agents: [
      { id: "agent-a", name: "Agent A", model: "gpt-5", systemPrompt: "" },
      { id: "agent-b", name: "Agent B", model: "gpt-5", systemPrompt: "" },
      { id: "agent-c", name: "Agent C", model: "gpt-5", systemPrompt: "" },
    ],
    results: [
      { id: "approved", description: "Approved result" },
      { id: "ignored", description: "Ignored result" },
    ],
    node: { id: "node-b", type: "agent", agentId: "agent-b" },
    agent: { id: "agent-b", name: "Agent B", model: "gpt-5", systemPrompt: "" },
    agentSession: {
      id: "agent-session-b",
      previousAgentSessionId: "agent-session-a",
      incomingExpressionNodeId: "expr-1",
      incomingEdgeIds: ["edge-a-expr", "edge-expr-b"],
      incomingResultId: "approved",
    },
    upstreamAgentSessionIds: ["agent-session-a"],
    statusFilePath: "/tmp/raddus-workspace/.raddus-status.jsonl",
  });

  assert.match(prompt, /^# Agent Session\n/);
  assert.match(prompt, /## Repository\nRepo: owner\/repo @ feature\/session-prompts/);
  assert.match(prompt, /## Updates And Session Result\n[\s\S]*\$RADDUS_GRAPH_STATUS_FILE/);
  assert.match(prompt, /"resultId":"approved"/);
  assert.doesNotMatch(prompt, /"resultId":"ask-for-approval"/);
  assert.match(prompt, /`ask-for-approval` pauses the graph and puts the exact user question in `detail`/);
  assert.match(prompt, /Success routes: `approved` \(Approved result\)/);
  assert.match(prompt, /`ask-for-approval` \(Pause the graph and ask the user for approval\.\)/);
  assert.equal(prompt.includes("`ignored`"), false);
  assert.match(prompt, /## History\n### 1\. Agent A\nResult: completed \/ approved - Tiny terminal summary/);
  assert.match(prompt, /Detailed terminal handoff\./);
  assert.equal(prompt.includes("Actual transcript output from Agent A."), false);
  assert.equal(prompt.includes("Raddus Graph execution context:"), false);
  assert.equal(prompt.includes("upstreamExecutionContext"), false);
  assert.equal(prompt.includes("/tmp/raddus-workspace/.raddus-status.jsonl"), false);
  assert.equal(prompt.includes("Raw stdout from Agent A."), false);
  assert.ok(prompt.trim().endsWith([
    "## User Context",
    "```md",
    "Ship the requested change.",
    "```",
  ].join("\n")));
});

test("agent prompt result IDs are limited to reachable expression routes", () => {
  const graph = {
    nodes: [
      { id: "agent-a", type: "agent", agentId: "agent-a" },
      { id: "agent-b", type: "agent", agentId: "agent-b" },
      { id: "expr-ready", type: "expression", resultId: "ready" },
      { id: "expr-blocked", type: "expression", resultId: "blocked" },
      { id: "expr-completed", type: "expression", resultId: "completed" },
      { id: "expr-failed", type: "expression", resultId: "failed" },
      { id: "expr-default", type: "expression", resultId: "default" },
      { id: "expr-loop", type: "expression", resultId: "loop" },
      { id: "play-loop", type: "play" },
      { id: "expr-incomplete", type: "expression", resultId: "incomplete" },
      { id: "expr-disconnected", type: "expression", resultId: "manual" },
    ],
    edges: [
      { id: "edge-a-ready", source: "agent-a", target: "expr-ready", type: "evaluates" },
      { id: "edge-ready-b", source: "expr-ready", target: "agent-b", type: "routes", resultId: "ready" },
      { id: "edge-a-blocked", source: "agent-a", target: "expr-blocked", type: "evaluates" },
      { id: "edge-blocked-b", source: "expr-blocked", target: "agent-b", type: "routes", resultId: "blocked" },
      { id: "edge-a-completed", source: "agent-a", target: "expr-completed", type: "evaluates" },
      { id: "edge-completed-b", source: "expr-completed", target: "agent-b", type: "routes", resultId: "completed" },
      { id: "edge-a-failed", source: "agent-a", target: "expr-failed", type: "evaluates" },
      { id: "edge-failed-b", source: "expr-failed", target: "agent-b", type: "routes", resultId: "failed" },
      { id: "edge-a-default", source: "agent-a", target: "expr-default", type: "evaluates" },
      { id: "edge-default-b", source: "expr-default", target: "agent-b", type: "routes", resultId: "default" },
      { id: "edge-a-loop", source: "agent-a", target: "expr-loop", type: "evaluates" },
      { id: "edge-loop-play", source: "expr-loop", target: "play-loop", type: "routes", resultId: "loop" },
      { id: "edge-a-incomplete", source: "agent-a", target: "expr-incomplete", type: "evaluates" },
      { id: "edge-disconnected-b", source: "expr-disconnected", target: "agent-b", type: "routes", resultId: "manual" },
    ],
  };

  assert.deepEqual(availableResultsForAgent({
    graph,
    results: [
      { id: "ready", description: "Ready route" },
      { id: "blocked", description: "Blocked route" },
      { id: "loop", description: "Loop route" },
      { id: "incomplete", description: "Incomplete route" },
      { id: "manual", description: "Disconnected route" },
      { id: "completed", description: "Built-in completed route", reserved: true },
      { id: "failed", description: "Built-in failed route", reserved: true },
      { id: "default", description: "Built-in default route", reserved: true },
    ],
    node: { id: "agent-a", type: "agent", agentId: "agent-a" },
  }), [
    { id: "ready", description: "Ready route" },
    { id: "blocked", description: "Blocked route" },
    { id: "loop", description: "Loop route" },
    { id: "completed", description: "Built-in completed route" },
    { id: "ask-for-approval", description: "Pause the graph and ask the user for approval." },
  ]);
});

test("any card expressions apply to every agent while direct expressions take precedence", () => {
  const graph = {
    nodes: [
      { id: "any-global", type: "any" },
      { id: "agent-a", type: "agent", agentId: "agent-a" },
      { id: "agent-b", type: "agent", agentId: "agent-b" },
      { id: "agent-c", type: "agent", agentId: "agent-c" },
      { id: "agent-d", type: "agent", agentId: "agent-d" },
      { id: "expr-any-ready", type: "expression", resultId: "ready" },
      { id: "expr-direct-ready", type: "expression", resultId: "ready" },
    ],
    edges: [
      { id: "edge-any-ready", source: "any-global", target: "expr-any-ready", type: "evaluates" },
      { id: "edge-any-ready-agent-d", source: "expr-any-ready", target: "agent-d", type: "routes", resultId: "ready" },
      { id: "edge-agent-a-ready", source: "agent-a", target: "expr-direct-ready", type: "evaluates" },
      { id: "edge-direct-ready-agent-c", source: "expr-direct-ready", target: "agent-c", type: "routes", resultId: "ready" },
    ],
  };

  assert.deepEqual(availableResultsForAgent({
    graph,
    results: [{ id: "ready", description: "Ready route" }],
    node: { id: "agent-b", type: "agent", agentId: "agent-b" },
  }), [
    { id: "ready", description: "Ready route" },
    { id: "ask-for-approval", description: "Pause the graph and ask the user for approval." },
  ]);

  const anyRoute = nextGraphRouteFromOutcome({
    graph,
    currentAgentNode: { id: "agent-b", type: "agent", agentId: "agent-b" },
    outcome: { state: "completed", routedResultId: "ready" },
  });
  assert.equal(anyRoute?.node.id, "agent-d");
  assert.deepEqual(anyRoute?.edgeIds, ["edge-any-ready", "edge-any-ready-agent-d"]);

  const directRoute = nextGraphRouteFromOutcome({
    graph,
    currentAgentNode: { id: "agent-a", type: "agent", agentId: "agent-a" },
    outcome: { state: "completed", routedResultId: "ready" },
  });
  assert.equal(directRoute?.node.id, "agent-c");
  assert.deepEqual(directRoute?.edgeIds, ["edge-agent-a-ready", "edge-direct-ready-agent-c"]);
});

test("approval pauses are global and review answers become the next user context", () => {
  const route = nextGraphRouteFromOutcome({
    graph: {
      nodes: [
        { id: "agent-a", type: "agent", agentId: "agent-a" },
        { id: "expr-review", type: "expression", resultId: "needs-review" },
        { id: "review-a", type: "review" },
      ],
      edges: [
        { id: "edge-agent-expr", source: "agent-a", target: "expr-review", type: "evaluates" },
        { id: "edge-expr-review", source: "expr-review", target: "review-a", type: "routes", resultId: "needs-review" },
      ],
    },
    currentAgentNode: { id: "agent-a", type: "agent", agentId: "agent-a" },
    outcome: {
      state: "completed",
      routedResultId: "needs-review",
    },
  });

  assert.equal(route, null);

  const globalApprovalRoute = nextGraphRouteFromOutcome({
    graph: {
      nodes: [
        { id: "agent-a", type: "agent", agentId: "agent-a" },
      ],
      edges: [],
    },
    currentAgentNode: { id: "agent-a", type: "agent", agentId: "agent-a" },
    outcome: {
      state: "completed",
      routedResultId: "ask-for-approval",
    },
  });

  assert.equal(globalApprovalRoute?.node, null);
  assert.equal(globalApprovalRoute?.reviewPause, true);
  assert.equal(globalApprovalRoute?.expressionNodeId, null);
  assert.deepEqual(globalApprovalRoute?.edgeIds, []);
  assert.equal(globalApprovalRoute?.resultId, "ask-for-approval");

  const question = reviewQuestionFromAgentSession({
    response: "Raw response",
    terminalOutcome: {
      detail: "Should I apply this change?",
      summary: "Review needed.",
    },
  });

  assert.equal(question, "Should I apply this change?");

  const prompt = buildAgentPrompt({
    session: {
      id: "graph-session-review",
      prompt: "Original graph prompt.",
      repository: null,
      workspacePath: "/tmp/raddus-workspace",
      agentSessions: [],
    },
    graph: {
      nodes: [{ id: "agent-a", type: "agent", agentId: "agent-a" }],
      edges: [],
    },
    agents: [{ id: "agent-a", name: "Agent A", model: "gpt-5", systemPrompt: "" }],
    results: [{ id: "approved", description: "Approved result" }],
    node: { id: "agent-a", type: "agent", agentId: "agent-a" },
    agent: { id: "agent-a", name: "Agent A", model: "gpt-5", systemPrompt: "" },
    agentSession: { id: "agent-session-review" },
    upstreamAgentSessionIds: [],
    userPrompt: "Use option B and continue.",
  });

  assert.ok(prompt.trim().endsWith([
    "## User Context",
    "```md",
    "Use option B and continue.",
    "```",
  ].join("\n")));
});

test("completed graph sessions continue from the next routed agent", () => {
  const target = continuationTargetForSession({
    session: {
      id: "graph-session-continue",
      playNodeId: "play-a",
      agentSessions: [
        {
          id: "agent-session-a",
          sequence: 1,
          nodeId: "agent-a",
          status: "completed",
          terminalOutcome: {
            state: "completed",
            routedResultId: "ready",
          },
        },
      ],
    },
    graph: {
      nodes: [
        { id: "play-a", type: "play" },
        { id: "agent-a", type: "agent", agentId: "agent-a" },
        { id: "expr-ready", type: "expression", resultId: "ready" },
        { id: "agent-b", type: "agent", agentId: "agent-b" },
      ],
      edges: [
        { id: "edge-agent-expr", source: "agent-a", target: "expr-ready", type: "evaluates" },
        { id: "edge-expr-agent", source: "expr-ready", target: "agent-b", type: "routes", resultId: "ready" },
      ],
    },
  });

  assert.equal(target.currentAgentNode.id, "agent-b");
  assert.deepEqual(target.visitedAgentSessionIds, ["agent-session-a"]);
  assert.deepEqual(target.currentArrival, {
    previousAgentSessionId: "agent-session-a",
    incomingExpressionNodeId: "expr-ready",
    incomingEdgeIds: ["edge-agent-expr", "edge-expr-agent"],
    incomingResultId: "ready",
  });
  assert.equal(target.reviewPause, null);
});

test("completed graph sessions can route expressions to play cards as new-session loops", () => {
  const graph = {
    nodes: [
      { id: "play-a", type: "play" },
      { id: "agent-a", type: "agent", agentId: "agent-a" },
      { id: "expr-loop", type: "expression", resultId: "loop" },
    ],
    edges: [
      { id: "edge-play-agent", source: "play-a", target: "agent-a", type: "runs" },
      { id: "edge-agent-expr", source: "agent-a", target: "expr-loop", type: "evaluates" },
      { id: "edge-expr-play", source: "expr-loop", target: "play-a", type: "routes", resultId: "loop" },
    ],
  };

  const route = nextGraphRouteFromOutcome({
    graph,
    currentAgentNode: { id: "agent-a", type: "agent", agentId: "agent-a" },
    outcome: {
      state: "completed",
      routedResultId: "loop",
    },
  });

  assert.equal(route?.node.type, "play");
  assert.equal(route?.node.id, "play-a");
  assert.deepEqual(route?.edgeIds, ["edge-agent-expr", "edge-expr-play"]);

  const target = continuationTargetForSession({
    session: {
      id: "graph-session-loop",
      playNodeId: "play-a",
      prompt: "Original graph prompt.",
      agentSessions: [
        {
          id: "agent-session-a",
          sequence: 1,
          nodeId: "agent-a",
          status: "completed",
          terminalOutcome: {
            state: "completed",
            routedResultId: "loop",
          },
        },
      ],
    },
    graph,
  });

  assert.equal(target.currentAgentNode, null);
  assert.equal(target.startPlayNode.id, "play-a");
  assert.deepEqual(target.visitedAgentSessionIds, ["agent-session-a"]);
  assert.deepEqual(target.currentArrival, {
    previousAgentSessionId: "agent-session-a",
    incomingExpressionNodeId: "expr-loop",
    incomingEdgeIds: ["edge-agent-expr", "edge-expr-play"],
    incomingResultId: "loop",
  });
  assert.equal(target.reviewPause, null);
});

test("expression routes can target graph cards", () => {
  const graph = {
    nodes: [
      { id: "play-a", type: "play" },
      { id: "agent-a", type: "agent", agentId: "agent-a" },
      { id: "expr-child", type: "expression", resultId: "child" },
      { id: "graph-child", type: "graph" },
    ],
    edges: [
      { id: "edge-agent-expr", source: "agent-a", target: "expr-child", type: "evaluates" },
      { id: "edge-expr-graph", source: "expr-child", target: "graph-child", type: "routes", resultId: "child" },
    ],
  };

  assert.deepEqual(availableResultsForAgent({
    graph,
    results: [{ id: "child", description: "Start the child graph." }],
    node: { id: "agent-a", type: "agent", agentId: "agent-a" },
  }), [
    { id: "child", description: "Start the child graph." },
    { id: "ask-for-approval", description: "Pause the graph and ask the user for approval." },
  ]);

  const route = nextGraphRouteFromOutcome({
    graph,
    currentAgentNode: { id: "agent-a", type: "agent", agentId: "agent-a" },
    outcome: {
      state: "completed",
      routedResultId: "child",
    },
  });

  assert.equal(route?.node.type, "graph");
  assert.equal(route?.node.id, "graph-child");
});

test("graph cards can start a selected project graph in the same graph session", () => {
  const parentGraph = {
    nodes: [
      { id: "play-parent", type: "play" },
      { id: "agent-parent", type: "agent", agentId: "agent-parent" },
      { id: "expr-child", type: "expression", resultId: "child" },
      { id: "graph-child", type: "graph", graphId: "project-child" },
    ],
    edges: [
      { id: "edge-parent-expr", source: "agent-parent", target: "expr-child", type: "evaluates" },
      { id: "edge-expr-graph", source: "expr-child", target: "graph-child", type: "routes", resultId: "child" },
    ],
  };
  const childGraph = {
    nodes: [
      { id: "play-child", type: "play" },
      { id: "agent-child", type: "agent", agentId: "agent-child" },
    ],
    edges: [
      { id: "edge-child-start", source: "play-child", target: "agent-child", type: "runs" },
    ],
  };

  const target = continuationTargetForSession({
    session: {
      id: "graph-session-selected-child",
      projectId: "project-parent",
      projectName: "Parent Graph",
      playNodeId: "play-parent",
      prompt: "Original graph prompt.",
      agentSessions: [
        {
          id: "agent-session-parent",
          graphId: "project-parent",
          sequence: 1,
          nodeId: "agent-parent",
          status: "completed",
          terminalOutcome: {
            state: "completed",
            routedResultId: "child",
            summary: "Parent graph finished.",
            detail: "Use this parent result as the selected child graph prompt.",
          },
        },
      ],
    },
    graph: parentGraph,
    agents: [{ id: "agent-parent", name: "Parent Agent", model: "gpt-5", systemPrompt: "" }],
    results: [{ id: "child", description: "Start child graph." }],
    projectId: "project-parent",
    projectName: "Parent Graph",
    projects: [
      {
        id: "project-parent",
        name: "Parent Graph",
        graph: parentGraph,
        agents: [{ id: "agent-parent", name: "Parent Agent", model: "gpt-5", systemPrompt: "" }],
        results: [{ id: "child", description: "Start child graph." }],
        lastPlaySelection: null,
      },
      {
        id: "project-child",
        name: "Child Graph",
        graph: childGraph,
        agents: [{ id: "agent-child", name: "Child Agent", model: "gpt-5", systemPrompt: "" }],
        results: [{ id: "done", description: "Done." }],
        lastPlaySelection: null,
      },
    ],
  });

  assert.equal(target.currentDefinition.graphId, "project-child");
  assert.equal(target.currentAgentNode.id, "agent-child");
  assert.equal(target.userPrompt, "Use this parent result as the selected child graph prompt.");
  assert.deepEqual(target.visitedAgentSessionIds, ["agent-session-parent"]);
  assert.deepEqual(target.currentArrival, {
    previousAgentSessionId: "agent-session-parent",
    incomingExpressionNodeId: "expr-child",
    incomingEdgeIds: ["edge-parent-expr", "edge-expr-graph", "edge-child-start"],
    incomingResultId: "child",
  });
  assert.equal(target.reviewPause, null);
});

test("completed child graphs return the last agent result through parent graph-card expressions", () => {
  const parentGraph = {
    nodes: [
      { id: "play-parent", type: "play" },
      { id: "agent-parent", type: "agent", agentId: "agent-parent" },
      { id: "expr-start-a", type: "expression", resultId: "start-a" },
      { id: "graph-a", type: "graph", graphId: "project-a" },
      { id: "expr-completed", type: "expression", resultId: "completed" },
      { id: "graph-b", type: "graph", graphId: "project-b" },
    ],
    edges: [
      { id: "edge-play-agent-parent", source: "play-parent", target: "agent-parent", type: "runs" },
      { id: "edge-parent-expr-a", source: "agent-parent", target: "expr-start-a", type: "evaluates" },
      { id: "edge-expr-graph-a", source: "expr-start-a", target: "graph-a", type: "routes", resultId: "start-a" },
      { id: "edge-graph-a-expr", source: "graph-a", target: "expr-completed", type: "evaluates" },
      { id: "edge-expr-graph-b", source: "expr-completed", target: "graph-b", type: "routes", resultId: "completed" },
    ],
  };
  const graphA = {
    nodes: [
      { id: "play-a", type: "play" },
      { id: "agent-a", type: "agent", agentId: "agent-a" },
    ],
    edges: [
      { id: "edge-a-start", source: "play-a", target: "agent-a", type: "runs" },
    ],
  };
  const graphB = {
    nodes: [
      { id: "play-b", type: "play" },
      { id: "agent-b", type: "agent", agentId: "agent-b" },
    ],
    edges: [
      { id: "edge-b-start", source: "play-b", target: "agent-b", type: "runs" },
    ],
  };

  const target = continuationTargetForSession({
    session: {
      id: "graph-session-graph-chain",
      projectId: "project-parent",
      projectName: "Parent Graph",
      playNodeId: "play-parent",
      prompt: "Original graph prompt.",
      agentSessions: [
        {
          id: "agent-session-a",
          graphId: "project-a",
          sequence: 1,
          nodeId: "agent-a",
          status: "completed",
          previousAgentSessionId: "agent-session-parent",
          incomingExpressionNodeId: null,
          incomingEdgeIds: ["edge-parent-expr-a", "edge-expr-graph-a", "edge-a-start"],
          incomingResultId: "start-a",
          terminalOutcome: {
            state: "completed",
            routedResultId: "completed",
            summary: "Graph A finished.",
            detail: "Use Graph A output for Graph B.",
          },
        },
      ],
    },
    graph: parentGraph,
    agents: [],
    results: [],
    projectId: "project-parent",
    projectName: "Parent Graph",
    projects: [
      {
        id: "project-parent",
        name: "Parent Graph",
        graph: parentGraph,
        agents: [],
        results: [],
        lastPlaySelection: null,
      },
      {
        id: "project-a",
        name: "Graph A",
        graph: graphA,
        agents: [{ id: "agent-a", name: "Agent A", model: "gpt-5", systemPrompt: "" }],
        results: [],
        lastPlaySelection: null,
      },
      {
        id: "project-b",
        name: "Graph B",
        graph: graphB,
        agents: [{ id: "agent-b", name: "Agent B", model: "gpt-5", systemPrompt: "" }],
        results: [],
        lastPlaySelection: null,
      },
    ],
  });

  assert.equal(target.currentDefinition.graphId, "project-b");
  assert.equal(target.currentAgentNode.id, "agent-b");
  assert.equal(target.userPrompt, "Use Graph A output for Graph B.");
  assert.deepEqual(target.visitedAgentSessionIds, ["agent-session-a"]);
  assert.deepEqual(target.currentArrival, {
    previousAgentSessionId: "agent-session-a",
    incomingExpressionNodeId: "expr-completed",
    incomingEdgeIds: ["edge-graph-a-expr", "edge-expr-graph-b", "edge-b-start"],
    incomingResultId: "completed",
  });
  assert.equal(target.reviewPause, null);
});

test("play nodes can start graph cards directly", () => {
  const parentGraph = {
    nodes: [
      { id: "play-parent", type: "play" },
      { id: "graph-child", type: "graph", graphId: "project-child" },
    ],
    edges: [
      { id: "edge-play-graph", source: "play-parent", target: "graph-child", type: "runs" },
    ],
  };
  const childGraph = {
    nodes: [
      { id: "play-child", type: "play" },
      { id: "agent-child", type: "agent", agentId: "agent-child" },
    ],
    edges: [
      { id: "edge-child-start", source: "play-child", target: "agent-child", type: "runs" },
    ],
  };

  const target = continuationTargetForSession({
    session: {
      id: "graph-session-start-graph",
      projectId: "project-parent",
      projectName: "Parent Graph",
      playNodeId: "play-parent",
      prompt: "Run the graph card.",
      agentSessions: [],
    },
    graph: parentGraph,
    projectId: "project-parent",
    projectName: "Parent Graph",
    projects: [
      {
        id: "project-parent",
        name: "Parent Graph",
        graph: parentGraph,
        agents: [],
        results: [],
        lastPlaySelection: null,
      },
      {
        id: "project-child",
        name: "Child Graph",
        graph: childGraph,
        agents: [{ id: "agent-child", name: "Child Agent", model: "gpt-5", systemPrompt: "" }],
        results: [],
        lastPlaySelection: null,
      },
    ],
  });

  assert.equal(target.currentDefinition.graphId, "project-child");
  assert.equal(target.currentAgentNode.id, "agent-child");
  assert.equal(target.userPrompt, "Run the graph card.");
  assert.deepEqual(target.currentArrival, {
    previousAgentSessionId: null,
    incomingExpressionNodeId: null,
    incomingEdgeIds: ["edge-play-graph", "edge-child-start"],
    incomingResultId: null,
  });
  assert.deepEqual(target.visitedAgentSessionIds, []);
  assert.equal(target.currentReturnContinuation.graphNode.id, "graph-child");
  assert.equal(target.reviewPause, null);
});

test("stopped graph sessions continue by rerunning the stopped agent", () => {
  const target = continuationTargetForSession({
    session: {
      id: "graph-session-stopped",
      playNodeId: "play-a",
      agentSessions: [
        {
          id: "agent-session-a",
          sequence: 1,
          nodeId: "agent-a",
          status: "completed",
          terminalOutcome: {
            state: "completed",
            routedResultId: "ready",
          },
        },
        {
          id: "agent-session-b",
          sequence: 2,
          nodeId: "agent-b",
          status: "stopped",
          previousAgentSessionId: "agent-session-a",
          incomingExpressionNodeId: "expr-ready",
          incomingEdgeIds: ["edge-agent-expr", "edge-expr-agent"],
          incomingResultId: "ready",
          terminalOutcome: {
            state: "stopped",
          },
        },
      ],
    },
    graph: {
      nodes: [
        { id: "play-a", type: "play" },
        { id: "agent-a", type: "agent", agentId: "agent-a" },
        { id: "expr-ready", type: "expression", resultId: "ready" },
        { id: "agent-b", type: "agent", agentId: "agent-b" },
      ],
      edges: [
        { id: "edge-agent-expr", source: "agent-a", target: "expr-ready", type: "evaluates" },
        { id: "edge-expr-agent", source: "expr-ready", target: "agent-b", type: "routes", resultId: "ready" },
      ],
    },
  });

  assert.equal(target.currentAgentNode.id, "agent-b");
  assert.deepEqual(target.visitedAgentSessionIds, ["agent-session-a"]);
  assert.deepEqual(target.currentArrival, {
    previousAgentSessionId: "agent-session-a",
    incomingExpressionNodeId: "expr-ready",
    incomingEdgeIds: ["edge-agent-expr", "edge-expr-agent"],
    incomingResultId: "ready",
  });
  assert.equal(target.reviewPause, null);
});

test("completed graph sessions without a next route explain that they cannot continue", () => {
  assert.throws(() => continuationTargetForSession({
    session: {
      id: "graph-session-done",
      playNodeId: "play-a",
      agentSessions: [
        {
          id: "agent-session-a",
          sequence: 1,
          nodeId: "agent-a",
          status: "completed",
          terminalOutcome: {
            state: "completed",
            routedResultId: "completed",
          },
        },
      ],
    },
    graph: {
      nodes: [
        { id: "play-a", type: "play" },
        { id: "agent-a", type: "agent", agentId: "agent-a" },
      ],
      edges: [],
    },
  }), /No next agent, graph card, or play card is connected/);
});

test("agent prompt history uses bounded recent handoffs", () => {
  const agentSessions = Array.from({ length: 8 }, (_, index) => ({
    id: `agent-session-${index + 1}`,
    sequence: index + 1,
    nodeId: `node-${index + 1}`,
    agentId: `agent-${index + 1}`,
    previousAgentSessionId: index === 0 ? null : `agent-session-${index}`,
    incomingExpressionNodeId: null,
    incomingEdgeIds: [],
    incomingResultId: "completed",
    response: `Raw transcript ${index + 1} ${"x".repeat(5000)}`,
    stdout: "",
    stderr: "",
    statuses: [],
    terminalOutcome: {
      state: "completed",
      emittedResultId: "completed",
      routedResultId: "completed",
      routeReason: "default_completed",
      summary: `Summary ${index + 1}`,
      detail: `Handoff ${index + 1} ${"y".repeat(5000)}`,
    },
  }));
  const prompt = buildAgentPrompt({
    session: {
      id: "graph-session-long-history",
      prompt: "Continue the graph.",
      repository: null,
      workspacePath: "/tmp/raddus-workspace",
      agentSessions,
    },
    graph: {
      nodes: agentSessions.map((agentSession) => ({ id: agentSession.nodeId, type: "agent", agentId: agentSession.agentId })),
      edges: [],
    },
    agents: agentSessions.map((agentSession, index) => ({
      id: agentSession.agentId,
      name: `Agent ${index + 1}`,
      model: "gpt-5",
      systemPrompt: "",
    })),
    results: [],
    node: { id: "node-9", type: "agent", agentId: "agent-9" },
    agent: { id: "agent-9", name: "Agent 9", model: "gpt-5", systemPrompt: "" },
    agentSession: { id: "agent-session-9" },
    upstreamAgentSessionIds: agentSessions.map((agentSession) => agentSession.id),
  });

  assert.match(prompt, /2 earlier agent sessions omitted/);
  assert.equal(prompt.includes("### 1. Agent 1"), false);
  assert.equal(prompt.includes("### 2. Agent 2"), false);
  assert.match(prompt, /### 3\. Agent 3/);
  assert.match(prompt, /Handoff 8/);
  assert.match(prompt, /\[truncated \d+ chars\]/);
  assert.equal(prompt.includes("Raw transcript 8"), false);
});
