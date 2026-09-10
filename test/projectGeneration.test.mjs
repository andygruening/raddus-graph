import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildGraphGenerationPrompt, buildGraphReviewPrompt, graphGeneratorCliArgs, normalizeGeneratedProject, parseGeneratedProjectOutput } from "../server/graphGenerator.mjs";

test("project generation parser accepts fenced JSON output", () => {
  const parsed = parseGeneratedProjectOutput([
    "```json",
    '{"name":"Generated Review Flow","agents":[],"graph":{"nodes":[],"edges":[]}}',
    "```",
  ].join("\n"));

  assert.equal(parsed.name, "Generated Review Flow");
});

test("project generation normalizes key-based graph drafts", () => {
  const project = normalizeGeneratedProject({
    name: "Release Flow",
    agents: [
      { key: "planner", name: "Planner", systemPrompt: "Plan the release." },
      { key: "shipper", name: "Shipper", systemPrompt: "Ship approved releases." },
    ],
    results: [
      { id: "approved", description: "The plan is approved." },
      { id: "failed", description: "Reserved result should not be duplicated." },
    ],
    graph: {
      nodes: [
        { key: "start", type: "play", x: 9999, y: 9999, prompt: "Prepare a release." },
        { key: "plan", type: "agent", agentKey: "planner", x: 9999, y: 9999 },
        { key: "approval", type: "expression", resultId: "approved", x: 9999, y: 9999 },
        { key: "ship", type: "agent", agentKey: "shipper", x: 9999, y: 9999 },
      ],
      edges: [
        { source: "start", target: "plan", type: "runs" },
        { source: "plan", target: "approval", type: "evaluates" },
        { source: "approval", target: "ship", type: "routes", resultId: "approved" },
      ],
    },
  }, { prompt: "Generate a release workflow.", model: "gpt-5.5" });

  assert.equal(project.name, "Release Flow");
  assert.deepEqual(project.agents.map((agent) => agent.name), ["Planner", "Shipper"]);
  assert.deepEqual(project.agents.map((agent) => agent.model), ["gpt-5.5", "gpt-5.5"]);
  assert.deepEqual(project.results.map((result) => result.id), ["completed", "failed", "max-runs-reached", "default", "approved"]);
  assert.deepEqual(project.graph.nodes.map((node) => node.type), ["play", "agent", "expression", "agent", "any"]);
  assert.equal(project.graph.nodes.find((node) => node.id === "agent-plan")?.agentId, "agent-planner");
  assert.deepEqual(project.graph.nodes.map((node) => [node.id, node.x, node.y]), [
    ["play-start", 72, 96],
    ["agent-plan", 340, 96],
    ["expression-approval", 608, 96],
    ["agent-ship", 876, 96],
    ["any-global", 72, 224],
  ]);
  assert.deepEqual(project.graph.edges.map((edge) => [edge.source, edge.target, edge.type, edge.resultId ?? null]), [
    ["play-start", "agent-plan", "runs", null],
    ["agent-plan", "expression-approval", "evaluates", null],
    ["expression-approval", "agent-ship", "routes", "approved"],
  ]);
});

test("project generation normalizer falls back to a runnable start graph", () => {
  const project = normalizeGeneratedProject({}, { prompt: "Make a triage workflow.", model: "missing-model" });

  assert.equal(project.name, "Make A Triage Workflow");
  assert.equal(project.graph.nodes.some((node) => node.type === "play"), true);
  assert.equal(project.graph.nodes.some((node) => node.type === "any"), true);
  assert.equal(project.graph.nodes.some((node) => node.type === "agent"), true);
  assert.equal(project.graph.edges.some((edge) => edge.type === "runs"), true);
});

test("project generation auto-layouts branched topology", () => {
  const project = normalizeGeneratedProject({
    name: "Triage Flow",
    agents: [
      { key: "triage", name: "Triage", systemPrompt: "Classify the request." },
      { key: "fixer", name: "Fixer", systemPrompt: "Fix defects." },
      { key: "writer", name: "Writer", systemPrompt: "Write docs." },
    ],
    results: [
      { id: "bug", description: "A defect should be fixed." },
      { id: "docs", description: "Documentation should be written." },
    ],
    graph: {
      nodes: [
        { key: "start", type: "play", prompt: "Triage this work.", x: -100, y: -100 },
        { key: "any", type: "any", x: -100, y: -100 },
        { key: "triage-card", type: "agent", agentKey: "triage", x: -100, y: -100 },
        { key: "bug-route", type: "expression", resultId: "bug", x: -100, y: -100 },
        { key: "docs-route", type: "expression", resultId: "docs", x: -100, y: -100 },
        { key: "fix-card", type: "agent", agentKey: "fixer", x: -100, y: -100 },
        { key: "write-card", type: "agent", agentKey: "writer", x: -100, y: -100 },
      ],
      edges: [
        { source: "start", target: "triage-card", type: "runs" },
        { source: "triage-card", target: "bug-route", type: "evaluates" },
        { source: "triage-card", target: "docs-route", type: "evaluates" },
        { source: "bug-route", target: "fix-card", type: "routes", resultId: "bug" },
        { source: "docs-route", target: "write-card", type: "routes", resultId: "docs" },
      ],
    },
  }, { prompt: "Generate a triage workflow.", model: "gpt-5.5" });

  assert.deepEqual(project.graph.nodes.map((node) => [node.id, node.x, node.y]), [
    ["play-start", 72, 96],
    ["any-any", 72, 224],
    ["agent-triage-card", 340, 96],
    ["expression-bug-route", 608, 96],
    ["expression-docs-route", 608, 224],
    ["agent-fix-card", 876, 96],
    ["agent-write-card", 876, 224],
  ]);
});

test("project generation auto-layout keeps feedback loops readable", () => {
  const project = normalizeGeneratedProject({
    name: "ADR Confidence Loop",
    agents: [
      { key: "architect", name: "Architect", systemPrompt: "Draft ADRs." },
      { key: "griller", name: "Griller", systemPrompt: "Challenge weak reasoning." },
      { key: "confidence", name: "Confidence Analyst", systemPrompt: "Score confidence." },
      { key: "handoff", name: "Handoff", systemPrompt: "Prepare handoff." },
      { key: "reviser", name: "Reviser", systemPrompt: "Revise drafts." },
    ],
    results: [
      { id: "draft-ready", description: "Draft is ready." },
      { id: "more-grilling", description: "Needs more challenge." },
      { id: "confident", description: "Confidence is sufficient." },
      { id: "needs-revision", description: "Needs revision." },
      { id: "approved", description: "Approved." },
      { id: "revised", description: "Revision is complete." },
    ],
    graph: {
      nodes: [
        { key: "start", type: "play", prompt: "Start ADR work." },
        { key: "any", type: "any" },
        { key: "architect-card", type: "agent", agentKey: "architect" },
        { key: "draft-ready-route", type: "expression", resultId: "draft-ready" },
        { key: "griller-card", type: "agent", agentKey: "griller" },
        { key: "griller-more-route", type: "expression", resultId: "more-grilling" },
        { key: "griller-confident-route", type: "expression", resultId: "confident" },
        { key: "confidence-card", type: "agent", agentKey: "confidence" },
        { key: "confidence-more-route", type: "expression", resultId: "more-grilling" },
        { key: "confidence-confident-route", type: "expression", resultId: "confident" },
        { key: "handoff-card", type: "agent", agentKey: "handoff" },
        { key: "needs-revision-route", type: "expression", resultId: "needs-revision" },
        { key: "approved-route", type: "expression", resultId: "approved" },
        { key: "reviser-card", type: "agent", agentKey: "reviser" },
        { key: "revised-route", type: "expression", resultId: "revised" },
      ],
      edges: [
        { source: "start", target: "architect-card", type: "runs" },
        { source: "architect-card", target: "draft-ready-route", type: "evaluates" },
        { source: "draft-ready-route", target: "griller-card", type: "routes", resultId: "draft-ready" },
        { source: "griller-card", target: "griller-more-route", type: "evaluates" },
        { source: "griller-card", target: "griller-confident-route", type: "evaluates" },
        { source: "griller-more-route", target: "confidence-card", type: "routes", resultId: "more-grilling" },
        { source: "griller-confident-route", target: "handoff-card", type: "routes", resultId: "confident" },
        { source: "confidence-card", target: "confidence-more-route", type: "evaluates" },
        { source: "confidence-card", target: "confidence-confident-route", type: "evaluates" },
        { source: "confidence-more-route", target: "griller-card", type: "routes", resultId: "more-grilling" },
        { source: "confidence-confident-route", target: "handoff-card", type: "routes", resultId: "confident" },
        { source: "handoff-card", target: "needs-revision-route", type: "evaluates" },
        { source: "handoff-card", target: "approved-route", type: "evaluates" },
        { source: "needs-revision-route", target: "reviser-card", type: "routes", resultId: "needs-revision" },
        { source: "reviser-card", target: "revised-route", type: "evaluates" },
        { source: "revised-route", target: "handoff-card", type: "routes", resultId: "revised" },
      ],
    },
  }, { prompt: "Generate an ADR confidence loop.", model: "gpt-5.5" });

  assert.deepEqual(project.graph.nodes.map((node) => [node.id, node.x, node.y]), [
    ["play-start", 72, 96],
    ["any-any", 72, 224],
    ["agent-architect-card", 340, 96],
    ["expression-draft-ready-route", 608, 96],
    ["agent-griller-card", 876, 96],
    ["expression-griller-more-route", 1144, 96],
    ["expression-griller-confident-route", 1144, 224],
    ["agent-confidence-card", 1412, 96],
    ["expression-confidence-more-route", 1680, 352],
    ["expression-confidence-confident-route", 1680, 96],
    ["agent-handoff-card", 1948, 224],
    ["expression-needs-revision-route", 2216, 224],
    ["expression-approved-route", 2216, 96],
    ["agent-reviser-card", 2484, 224],
    ["expression-revised-route", 2752, 480],
  ]);
});

test("project generator asks for topology instead of model-authored layout", () => {
  const prompt = buildGraphGenerationPrompt("Generate a release flow.", "gpt-5.5");
  const reviewPrompt = buildGraphReviewPrompt({
    userPrompt: "Improve the flow.",
    model: "gpt-5.5",
    project: {
      name: "Current",
      agents: [],
      results: [],
      graph: {
        nodes: [{ id: "agent-a", type: "agent", x: 123, y: 456, agentId: "agent-a" }],
        edges: [{ id: "edge-a", source: "agent-a", target: "expression-a", type: "evaluates", bend: { x: 1, y: 2 }, routingMode: "manual" }],
      },
    },
  });

  assert.equal(prompt.includes('"x"'), false);
  assert.equal(prompt.includes('"y"'), false);
  assert.ok(prompt.includes("The app calculates node layout from the graph topology."));
  assert.ok(reviewPrompt.includes("The app calculates node layout from the graph topology."));
  assert.equal(reviewPrompt.includes('"x":'), false);
  assert.equal(reviewPrompt.includes('"y":'), false);
  assert.equal(reviewPrompt.includes('"bend":'), false);
  assert.equal(reviewPrompt.includes('"routingMode":'), false);
});

test("project generator codex args are noninteractive and read prompt from stdin", () => {
  const { args, input } = graphGeneratorCliArgs("codex", "gpt-5.5", "/tmp/raddus-generator", "Generate JSON.");

  assert.equal(input, "Generate JSON.");
  assert.deepEqual(args.slice(0, 3), ["exec", "--model", "gpt-5.5"]);
  assert.ok(args.includes("--approve-for-me"));
  assert.ok(args.includes("--skip-git-repo-check"));
  assert.equal(args.at(-1), "-");
});

test("new project UI exposes generated project flow", async () => {
  const [app, api, graphApi] = await Promise.all([
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/api/RaddusGraphApi.ts", import.meta.url), "utf8"),
    readFile(new URL("../server/graphApi.mjs", import.meta.url), "utf8"),
  ]);

  assert.ok(app.includes('type: "project-generate"'), "App should have a project generation dialog state.");
  assert.ok(app.includes("function ProjectGenerateDialog"), "App should render a generated project prompt form.");
  assert.ok(app.includes("api.generateProject({ prompt })"), "App should request server-side graph generation.");
  assert.ok(app.includes("className=\"secondary-button project-generate-button\""), "New Project should expose a Generate action.");
  assert.ok(api.includes("generateProject(payload: { prompt: string })"), "Frontend API should expose project generation.");
  assert.ok(graphApi.includes('resource === "project-generations"'), "Server API should route project generation.");
});
