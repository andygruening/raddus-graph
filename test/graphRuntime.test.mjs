import test from "node:test";
import assert from "node:assert/strict";
import { buildAgentPrompt, cliArgsForRunner, statusPayloadsFromText } from "../server/graphRuntime.mjs";

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
      ],
      edges: [],
    },
    agents: [
      { id: "agent-a", name: "Agent A", model: "gpt-5", systemPrompt: "" },
      { id: "agent-b", name: "Agent B", model: "gpt-5", systemPrompt: "" },
    ],
    results: [{ id: "approved", description: "Approved result" }],
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
  assert.match(prompt, /- `approved`: Approved result/);
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
