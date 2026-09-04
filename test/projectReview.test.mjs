import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildGraphReviewPrompt, normalizeGraphReviewResult } from "../server/graphGenerator.mjs";

test("graph review prompt asks for summaries and a full replacement graph", () => {
  const prompt = buildGraphReviewPrompt({
    userPrompt: "Make this graph easier to approve.",
    model: "gpt-5.5",
    project: {
      name: "Current Graph",
      agents: [{ id: "agent-a", name: "Agent A", systemPrompt: "Do work." }],
      results: [{ id: "ready", description: "Ready." }],
      graph: {
        nodes: [
          { id: "play-start", type: "play", x: 72, y: 96, prompt: "Run it." },
          { id: "agent-a-card", type: "agent", x: 340, y: 96, agentId: "agent-a" },
        ],
        edges: [{ id: "edge-start", source: "play-start", target: "agent-a-card", type: "runs" }],
      },
    },
  });

  assert.match(prompt, /# Raddus Graph Reviewer/);
  assert.match(prompt, /Return a full replacement project, not a partial patch/);
  assert.match(prompt, /"changes": \[/);
  assert.match(prompt, /Include one change summary/);
  assert.match(prompt, /Do not create review nodes or routes to review nodes/);
  assert.match(prompt, /ask-for-approval to pause the graph globally without an expression node/);
  assert.match(prompt, /Current project JSON:/);
  assert.match(prompt, /Make this graph easier to approve/);
});

test("graph review normalizes returned changes and replacement project", () => {
  const review = normalizeGraphReviewResult({
    changes: [
      { summary: "Added approval path.", detail: "Agents can now ask for approval." },
      "Tightened handoff routing.",
    ],
    project: {
      name: "Reviewed Project",
      agents: [{ key: "planner", name: "Planner", systemPrompt: "Plan." }],
      results: [
        { id: "ready", description: "Ready to continue." },
        { id: "ask-for-approval", description: "Should not persist." },
      ],
      graph: {
        nodes: [
          { key: "start", type: "play", x: 72, y: 96, prompt: "Run." },
          { key: "planner", type: "agent", agentKey: "planner", x: 340, y: 96 },
          { key: "approval", type: "expression", resultId: "ask-for-approval", x: 600, y: 96 },
        ],
        edges: [
          { source: "start", target: "planner", type: "runs" },
          { source: "planner", target: "approval", type: "evaluates" },
        ],
      },
    },
  }, {
    prompt: "Review it.",
    model: "gpt-5.5",
    currentProject: { name: "Current Project" },
  });

  assert.deepEqual(review.changes.map((change) => change.summary), ["Added approval path.", "Tightened handoff routing."]);
  assert.equal(review.project.name, "Reviewed Project");
  assert.deepEqual(review.project.results.map((result) => result.id), ["completed", "failed", "default", "ready"]);
  assert.equal(review.project.graph.nodes.some((node) => node.type === "review"), false);
  assert.equal(review.project.graph.nodes.some((node) => node.type === "any"), true);
  assert.equal(review.project.graph.nodes.some((node) => node.type === "expression" && node.resultId === "ask-for-approval"), false);
});

test("graph review UI and API expose the review-confirm-apply flow", async () => {
  const [app, api, graphApi, css] = await Promise.all([
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/api/RaddusGraphApi.ts", import.meta.url), "utf8"),
    readFile(new URL("../server/graphApi.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
  ]);
  const sessionsIndex = app.indexOf('title="Open sessions"');
  const reviewIndex = app.indexOf('title="Review graph"');
  const playIndex = app.indexOf('title="Start graph"');

  assert.ok(sessionsIndex >= 0 && reviewIndex > sessionsIndex && playIndex > reviewIndex, "Review graph should sit between sessions and start controls.");
  assert.ok(app.includes('type: "graph-review"'), "App should have a graph review prompt dialog state.");
  assert.ok(app.includes('type: "graph-review-changes"'), "App should have a review changes confirmation state.");
  assert.ok(app.includes("function GraphReviewDialog"), "App should render a graph review prompt form.");
  assert.ok(app.includes("function ReviewChangesDialog"), "App should render a review changes confirmation dialog.");
  assert.ok(app.includes("api.reviewProject({"), "App should call the graph review API.");
  assert.ok(app.includes("applyGraphReview"), "App should apply reviewed graph drafts after confirmation.");
  assert.ok(api.includes("reviewProject(payload: { prompt: string; project: ProjectRecord })"), "Frontend API should expose graph review.");
  assert.ok(graphApi.includes('resource === "project-reviews"'), "Server API should route graph review.");
  assert.ok(css.includes(".review-changes-list"), "Review changes should have a scannable list style.");
});
