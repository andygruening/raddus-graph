import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { graphGeneratorCliArgs, normalizeGeneratedProject, parseGeneratedProjectOutput } from "../server/graphGenerator.mjs";

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
        { key: "start", type: "play", x: 72, y: 96, prompt: "Prepare a release." },
        { key: "plan", type: "agent", agentKey: "planner", x: 340, y: 96 },
        { key: "approval", type: "expression", resultId: "approved", x: 600, y: 96 },
        { key: "ship", type: "agent", agentKey: "shipper", x: 860, y: 96 },
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
  assert.deepEqual(project.results.map((result) => result.id), ["completed", "failed", "default", "approved"]);
  assert.deepEqual(project.graph.nodes.map((node) => node.type), ["play", "agent", "expression", "agent", "any"]);
  assert.equal(project.graph.nodes.find((node) => node.id === "agent-plan")?.agentId, "agent-planner");
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
