import test from "node:test";
import assert from "node:assert/strict";
import { availableResultsForAgent, buildAgentPrompt, cliArgsForRunner, nextGraphRouteFromOutcome, reviewQuestionFromAgentSession, statusPayloadsFromText } from "../server/graphRuntime.mjs";

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
  assert.match(prompt, /## Repository\nRepository: owner\/repo\nBranch: feature\/session-prompts/);
  assert.match(prompt, /## Updates And Session Result\n[\s\S]*\$RADDUS_GRAPH_STATUS_FILE/);
  assert.match(prompt, /pause for user review[\s\S]*`detail`/);
  assert.match(prompt, /- `approved`: Approved result/);
  assert.equal(prompt.includes("- `ignored`: Ignored result"), false);
  assert.match(prompt, /## History\n### 1\. Agent A\nResult: completed \/ approved\nSummary: Tiny terminal summary/);
  assert.match(prompt, /Actual transcript output from Agent A\./);
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
      { id: "expr-incomplete", type: "expression", resultId: "incomplete" },
      { id: "expr-disconnected", type: "expression", resultId: "manual" },
    ],
    edges: [
      { id: "edge-a-ready", source: "agent-a", target: "expr-ready", type: "evaluates" },
      { id: "edge-ready-b", source: "expr-ready", target: "agent-b", type: "routes", resultId: "ready" },
      { id: "edge-a-blocked", source: "agent-a", target: "expr-blocked", type: "evaluates" },
      { id: "edge-blocked-b", source: "expr-blocked", target: "agent-b", type: "routes", resultId: "blocked" },
      { id: "edge-a-incomplete", source: "agent-a", target: "expr-incomplete", type: "evaluates" },
      { id: "edge-disconnected-b", source: "expr-disconnected", target: "agent-b", type: "routes", resultId: "manual" },
    ],
  };

  assert.deepEqual(availableResultsForAgent({
    graph,
    results: [
      { id: "ready", description: "Ready route" },
      { id: "blocked", description: "Blocked route" },
      { id: "incomplete", description: "Incomplete route" },
      { id: "manual", description: "Disconnected route" },
      { id: "fallback", description: "Reserved fallback" },
    ],
    node: { id: "agent-a", type: "agent", agentId: "agent-a" },
  }), [
    { id: "ready", description: "Ready route" },
    { id: "blocked", description: "Blocked route" },
  ]);
});

test("review routes pause at a review node and review answers become the next user context", () => {
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

  assert.equal(route?.node.type, "review");
  assert.equal(route?.node.id, "review-a");
  assert.deepEqual(route?.edgeIds, ["edge-agent-expr", "edge-expr-review"]);

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
