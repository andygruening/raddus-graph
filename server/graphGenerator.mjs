import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultResultDefinitions, normalizeResultId, reservedResultIds } from "./graphStore.mjs";
import { defaultCodexModelId, modelCatalog, runnerForModel } from "./modelCatalog.mjs";
import { commandWorks, runProcess } from "./processUtils.mjs";

const generatorTimeoutMs = 5 * 60_000;
const maxAgents = 10;
const maxResults = 12;
const maxNodes = 36;
const allowedNodeTypes = new Set(["play", "agent", "expression", "graph", "any"]);
const allowedEdgeTypes = new Set(["runs", "evaluates", "routes"]);

export async function generateProjectFromPrompt(body) {
  const payload = asRecord(body);
  const prompt = textValue(payload.prompt).trim();
  if (!prompt) throw new Error("Enter a generation prompt before generating a graph.");

  const generator = await selectGraphGenerator();
  const workspacePath = await mkdtemp(join(tmpdir(), "raddus-graph-generate-"));
  try {
    const agentPrompt = buildGraphGenerationPrompt(prompt, generator.model);
    const args = graphGeneratorCliArgs(generator.runner, generator.model, workspacePath, agentPrompt);
    const result = await runProcess(generator.command, args.args, {
      cwd: workspacePath,
      input: args.input,
      timeoutMs: generatorTimeoutMs,
      maxOutputBytes: 2_000_000,
    });
    if (!result.ok) {
      throw new Error(generatorFailureMessage(generator.command, result));
    }
    const parsed = parseGeneratedProjectOutput(result.stdout || result.stderr);
    return normalizeGeneratedProject(parsed, { prompt, model: generator.model });
  } finally {
    await rm(workspacePath, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function reviewProjectFromPrompt(body) {
  const payload = asRecord(body);
  const prompt = textValue(payload.prompt).trim();
  if (!prompt) throw new Error("Enter a review prompt before reviewing the graph.");
  const currentProject = currentProjectForReview(payload.project);
  if (!currentProject) throw new Error("Select a project before reviewing the graph.");

  const generator = await selectGraphGenerator();
  const workspacePath = await mkdtemp(join(tmpdir(), "raddus-graph-review-"));
  try {
    const agentPrompt = buildGraphReviewPrompt({ userPrompt: prompt, project: currentProject, model: generator.model });
    const args = graphGeneratorCliArgs(generator.runner, generator.model, workspacePath, agentPrompt);
    const result = await runProcess(generator.command, args.args, {
      cwd: workspacePath,
      input: args.input,
      timeoutMs: generatorTimeoutMs,
      maxOutputBytes: 2_000_000,
    });
    if (!result.ok) {
      throw new Error(generatorFailureMessage(generator.command, result));
    }
    const parsed = parseGeneratedProjectOutput(result.stdout || result.stderr);
    return normalizeGraphReviewResult(parsed, { prompt, model: generator.model, currentProject });
  } finally {
    await rm(workspacePath, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function selectGraphGenerator() {
  const codexModel = modelCatalog.find((model) => model.runner === "codex")?.id ?? defaultCodexModelId;
  const claudeModel = modelCatalog.find((model) => model.runner === "claude")?.id ?? null;
  const [codexAvailable, claudeAvailable] = await Promise.all([
    commandWorks("codex", ["--version"], { timeoutMs: 5_000 }),
    claudeModel ? commandWorks("claude", ["--version"], { timeoutMs: 5_000 }) : Promise.resolve(false),
  ]);

  if (codexAvailable && codexModel) {
    return { runner: "codex", command: "codex", model: codexModel };
  }
  if (claudeAvailable && claudeModel) {
    return { runner: "claude", command: "claude", model: claudeModel };
  }
  throw new Error("Install and authenticate Codex or Claude before generating a graph.");
}

export function graphGeneratorCliArgs(runner, model, workspacePath, prompt) {
  if (runner === "codex") {
    return {
      args: [
        "exec",
        "--model",
        model,
        "--cd",
        workspacePath,
        "--approve-for-me",
        "--skip-git-repo-check",
        "-",
      ],
      input: prompt,
    };
  }

  return {
    args: ["-p", prompt, "--model", model],
    input: undefined,
  };
}

export function buildGraphGenerationPrompt(userPrompt, model) {
  return [
    "# Raddus Graph Project Generator",
    "",
    "Create a runnable Raddus Graph project from the user's prompt.",
    "",
    "Return only one JSON object. Do not include Markdown, prose, comments, or trailing text.",
    "",
    "Schema:",
    "{",
    '  "name": "Short project name",',
    '  "agents": [{"key": "planner", "name": "Planner", "systemPrompt": "Precise role instructions"}, {"key": "shipper", "name": "Shipper", "systemPrompt": "Precise role instructions"}],',
    '  "results": [{"id": "approved", "description": "What this terminal result means"}],',
    '  "graph": {',
    '    "nodes": [',
    '      {"key": "start", "type": "play", "x": 72, "y": 96, "prompt": "Starter prompt shown on the play card"},',
    '      {"key": "any", "type": "any", "x": 72, "y": 176},',
    '      {"key": "planner-card", "type": "agent", "agentKey": "planner", "x": 340, "y": 96},',
    '      {"key": "approved-route", "type": "expression", "resultId": "approved", "x": 600, "y": 96},',
    '      {"key": "shipper-card", "type": "agent", "agentKey": "shipper", "x": 860, "y": 96}',
    "    ],",
    '    "edges": [',
    '      {"source": "start", "target": "planner-card", "type": "runs"},',
    '      {"source": "planner-card", "target": "approved-route", "type": "evaluates"},',
    '      {"source": "approved-route", "target": "shipper-card", "type": "routes", "resultId": "approved"}',
    "    ]",
    "  }",
    "}",
    "",
    "Rules:",
    `- Use model ${model} implicitly; do not put model IDs in the JSON.`,
    "- Use one play node as the graph start and one any node for global result routing.",
    "- Do not create review nodes or routes to review nodes. Agents can emit ask-for-approval to pause the graph globally without an expression node or route edge.",
    "- Use expression nodes only when a preceding agent can emit a named result that changes routing.",
    "- Route play starts with runs edges to agents or graph cards, agent/graph/any-to-expression with evaluates edges, and expression-to-agent/graph/play with routes edges.",
    "- Graph cards can be started directly by play nodes; otherwise connect graph cards only through expression routes. A graph card returns the result from the last agent node inside that graph through graph-card expression routes.",
    "- Connect the any node only to expression nodes. Expressions connected from any apply to every agent in the graph.",
    "- Keep the graph compact: 2-6 agents, at most 3 custom results, and readable left-to-right coordinates.",
    "- Do not create graph-card nodes or references to other projects for new project generation.",
    "- Custom result IDs must be lowercase kebab-case or snake_case and must not be completed, failed, default, unknown, fallback, or ask-for-approval.",
    "",
    "User prompt:",
    markdownFence(userPrompt, "md"),
  ].join("\n");
}

export function buildGraphReviewPrompt({ userPrompt, project, model }) {
  return [
    "# Raddus Graph Reviewer",
    "",
    "Review the current Raddus Graph project and return an improved replacement project.",
    "",
    "Return only one JSON object. Do not include Markdown, prose, comments, or trailing text.",
    "",
    "Schema:",
    "{",
    '  "changes": [{"summary": "Short user-visible change summary", "detail": "Optional implementation detail"}],',
    '  "project": {',
    '    "name": "Project name",',
    '    "agents": [{"key": "planner", "name": "Planner", "systemPrompt": "Precise role instructions"}],',
    '    "results": [{"id": "approved", "description": "What this terminal result means"}],',
    '    "graph": {"nodes": [], "edges": []}',
    "  }",
    "}",
    "",
    "Rules:",
    `- Use model ${model} implicitly; do not put model IDs in the JSON.`,
    "- Return a full replacement project, not a partial patch.",
    "- Preserve useful existing agents, result IDs, coordinates, and routes unless the review prompt gives a reason to change them.",
    "- Use one play node as the graph start and one any node for global result routing.",
    "- Do not create review nodes or routes to review nodes. Agents can emit ask-for-approval to pause the graph globally without an expression node or route edge.",
    "- Use expression nodes only when a preceding agent can emit a named result that changes routing.",
    "- Route play starts with runs edges to agents or graph cards, agent/graph/any-to-expression with evaluates edges, and expression-to-agent/graph/play with routes edges.",
    "- Graph cards can be started directly by play nodes; otherwise connect graph cards only through expression routes. A graph card returns the result from the last agent node inside that graph through graph-card expression routes.",
    "- Connect the any node only to expression nodes. Expressions connected from any apply to every agent in the graph.",
    "- Keep the graph compact: 2-8 agents, at most 5 custom results, and readable left-to-right coordinates.",
    "- Preserve existing valid graph-card nodes when useful, but do not invent references to unknown projects.",
    "- Custom result IDs must be lowercase kebab-case or snake_case and must not be completed, failed, default, unknown, fallback, or ask-for-approval.",
    "- Include one change summary for every meaningful graph, agent, or result change.",
    "- If no changes are useful, return the current project unchanged and one summary saying no graph changes are recommended.",
    "",
    "Current project JSON:",
    markdownFence(JSON.stringify(project, null, 2), "json"),
    "",
    "Review prompt:",
    markdownFence(userPrompt, "md"),
  ].join("\n");
}

export function parseGeneratedProjectOutput(output) {
  const text = String(output ?? "").trim();
  if (!text) throw new Error("The graph generator returned no output.");
  const direct = parseJson(text);
  if (direct.ok) return direct.value;

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    const parsedFence = parseJson(fenced[1].trim());
    if (parsedFence.ok) return parsedFence.value;
  }

  const extracted = extractFirstJsonObject(text);
  if (extracted) {
    const parsedExtracted = parseJson(extracted);
    if (parsedExtracted.ok) return parsedExtracted.value;
  }

  throw new Error("The graph generator did not return valid project JSON.");
}

export function normalizeGeneratedProject(value, { prompt, model } = {}) {
  const record = asRecord(value);
  const now = new Date().toISOString();
  const selectedModel = runnerForModel(model) ? model : defaultCodexModelId;
  const agents = normalizeGeneratedAgents(record.agents, selectedModel, now);
  const resultList = normalizeGeneratedResults(record.results);
  const normalized = normalizeGeneratedGraph(record.graph ?? record, {
    agents,
    results: resultList,
    fallbackPrompt: prompt,
  });
  return {
    name: stringValue(record.name) || generatedProjectName(prompt),
    agents: normalized.agents,
    results: normalized.results,
    graph: normalized.graph,
  };
}

export function normalizeGraphReviewResult(value, { prompt, model, currentProject } = {}) {
  const record = asRecord(value);
  const explicitProject = asRecord(record.project);
  const candidateProject = Object.keys(explicitProject).length > 0 ? explicitProject : record;
  const normalizedProject = hasGeneratedProjectDraft(candidateProject)
    ? normalizeGeneratedProject({
      ...candidateProject,
      name: stringValue(candidateProject.name) || currentProject?.name || generatedProjectName(prompt),
    }, { prompt: currentProject?.name || prompt, model })
    : currentProjectForReview(currentProject);
  const changes = normalizeGraphReviewChanges(record.changes ?? record.changeSummaries ?? record.summaries);
  return {
    changes: changes.length > 0 ? changes : [{
      summary: "Reviewed and rebuilt the graph.",
      detail: "",
    }],
    project: normalizedProject ?? normalizeGeneratedProject({}, { prompt, model }),
  };
}

function hasGeneratedProjectDraft(value) {
  const record = asRecord(value);
  const graph = asRecord(record.graph);
  return Array.isArray(record.agents) ||
    Array.isArray(record.results) ||
    Array.isArray(record.nodes) ||
    Array.isArray(graph.nodes);
}

function normalizeGeneratedAgents(value, model, now) {
  const source = Array.isArray(value) ? value.slice(0, maxAgents) : [];
  const seenKeys = new Set();
  const seenIds = new Set();
  const agents = source.flatMap((agent, index) => {
    const record = asRecord(agent);
    const key = uniqueKey(stringValue(record.key) || stringValue(record.id) || stringValue(record.name) || `agent-${index + 1}`, seenKeys);
    const id = uniqueId("agent", key, seenIds);
    return [{
      id,
      key,
      name: stringValue(record.name) || titleFromKey(key),
      model,
      modelReasoningEffort: null,
      systemPrompt: textValue(record.systemPrompt ?? record.system_prompt) || `You are ${titleFromKey(key)}. Complete your assigned graph step and report a terminal result.`,
      createdAt: now,
      updatedAt: now,
    }];
  });

  if (agents.length > 0) return agents;
  return [{
    id: "agent-generated-agent",
    key: "generated-agent",
    name: "Generated Agent",
    model,
    modelReasoningEffort: null,
    systemPrompt: "Complete the requested graph workflow and report a concise terminal result.",
    createdAt: now,
    updatedAt: now,
  }];
}

function normalizeGeneratedResults(value) {
  const results = defaultResultDefinitions();
  const seen = new Set(results.map((result) => result.id));
  for (const result of Array.isArray(value) ? value.slice(0, maxResults) : []) {
    const record = asRecord(result);
    const id = normalizeCustomResultId(record.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    results.push({
      id,
      description: stringValue(record.description) || titleFromKey(id),
      reserved: false,
    });
  }
  return results;
}

function normalizeGeneratedGraph(value, { agents, results, fallbackPrompt }) {
  const record = asRecord(value);
  const sourceNodes = Array.isArray(record.nodes) ? record.nodes.slice(0, maxNodes) : [];
  const seenKeys = new Set();
  const seenNodeIds = new Set();
  const agentByKey = new Map(agents.flatMap((agent) => [
    [agent.key, agent],
    [normalizeResultId(agent.name), agent],
    [agent.id, agent],
  ]));
  const resultIds = new Set(results.map((result) => result.id));
  const customResults = [...results];
  const nodes = [];
  const nodeIdByKey = new Map();

  for (const node of sourceNodes) {
    const record = asRecord(node);
    const type = stringValue(record.type);
    if (!allowedNodeTypes.has(type)) continue;
    if (type === "any" && nodes.some((node) => node.type === type)) continue;
    const key = uniqueKey(stringValue(record.key) || stringValue(record.id) || `${type}-${nodes.length + 1}`, seenKeys);
    const id = uniqueId(type, key, seenNodeIds);
    const normalized = normalizeGeneratedNode(record, {
      id,
      key,
      type,
      agents,
      agentByKey,
      resultIds,
      customResults,
      fallbackPrompt,
      index: nodes.length,
    });
    if (!normalized) continue;
    nodes.push(normalized);
    nodeIdByKey.set(key, id);
    nodeIdByKey.set(id, id);
    if (record.id) nodeIdByKey.set(stringValue(record.id), id);
  }

  if (!nodes.some((node) => node.type === "play")) {
    const id = uniqueId("play", "start", seenNodeIds);
    const key = nodeIdByKey.has("start") ? id : "start";
    nodes.unshift({
      id,
      type: "play",
      x: 72,
      y: 96,
      prompt: playPromptValue(fallbackPrompt),
      repository: null,
      branch: null,
    });
    nodeIdByKey.set(key, id);
    nodeIdByKey.set(id, id);
  }

  if (!nodes.some((node) => node.type === "any")) {
    const id = uniqueId("any", "global", seenNodeIds);
    const key = nodeIdByKey.has("any") ? id : "any";
    nodes.push({
      id,
      key,
      type: "any",
      x: 72,
      y: 176,
    });
    nodeIdByKey.set(key, id);
    nodeIdByKey.set(id, id);
  }

  if (!nodes.some((node) => node.type === "agent")) {
    const id = uniqueId("agent", "generated-agent-card", seenNodeIds);
    nodes.push({
      id,
      type: "agent",
      x: 340,
      y: 96,
      agentId: agents[0].id,
    });
    nodeIdByKey.set("generated-agent-card", id);
    nodeIdByKey.set(id, id);
  }

  const edges = normalizeGeneratedEdges(record.edges, {
    nodes,
    nodeIdByKey,
    resultIds: new Set(customResults.map((result) => result.id)),
    customResults,
  });

  ensureStartEdge(nodes, edges);

  const graph = {
    nodes: nodes.map((node) => stripInternalKeys(node)),
    edges,
  };
  return {
    graph,
    agents: agents.map((agent) => stripInternalKeys(agent)),
    results: customResults,
  };
}

function normalizeGeneratedNode(record, context) {
  const x = numberValue(record.x, 72 + context.index * 260);
  const y = numberValue(record.y, 96 + (context.index % 3) * 128);
  if (context.type === "play") {
    return {
      id: context.id,
      key: context.key,
      type: "play",
      x,
      y,
      prompt: stringValue(record.prompt) || playPromptValue(context.fallbackPrompt),
      repository: null,
      branch: null,
    };
  }
  if (context.type === "agent") {
    const agentKey = stringValue(record.agentKey ?? record.agent_key ?? record.agentId ?? record.agent_id ?? record.agent);
    const agent = context.agentByKey.get(agentKey) ?? context.agentByKey.get(normalizeResultId(agentKey)) ?? context.agents[0];
    return {
      id: context.id,
      key: context.key,
      type: "agent",
      x,
      y,
      agentId: agent.id,
    };
  }
  if (context.type === "any") {
    return {
      id: context.id,
      key: context.key,
      type: "any",
      x,
      y,
    };
  }
  if (context.type === "expression") {
    const requestedResultId = normalizeResultId(record.resultId ?? record.result_id);
    if (requestedResultId === "ask-for-approval") return null;
    const resultId = normalizeRoutableResultId(requestedResultId, context.resultIds, context.customResults);
    return {
      id: context.id,
      key: context.key,
      type: "expression",
      x,
      y,
      resultId,
    };
  }
  if (context.type === "graph") {
    const graphId = stringValue(record.graphId ?? record.graph_id ?? record.projectId ?? record.project_id);
    if (!graphId) return null;
    return {
      id: context.id,
      key: context.key,
      type: "graph",
      x,
      y,
      graphId,
    };
  }
  return null;
}

function normalizeGeneratedEdges(value, { nodes, nodeIdByKey, resultIds, customResults }) {
  const edges = [];
  const seen = new Set();
  const seenEdgeIds = new Set();
  const seenRunsBySource = new Set();
  const seenRoutesBySourceAndResult = new Set();
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  for (const edge of Array.isArray(value) ? value : []) {
    const record = asRecord(edge);
    const source = nodeIdByKey.get(stringValue(record.source));
    const target = nodeIdByKey.get(stringValue(record.target));
    const sourceNode = source ? nodeById.get(source) : null;
    const targetNode = target ? nodeById.get(target) : null;
    if (!sourceNode || !targetNode || sourceNode.id === targetNode.id) continue;
    const type = edgeTypeForNodes(sourceNode, targetNode, stringValue(record.type));
    if (!type) continue;
    const resultId = type === "routes"
      ? normalizeRoutableResultId(record.resultId ?? record.result_id ?? sourceNode.resultId, resultIds, customResults)
      : null;
    if (type === "runs" && seenRunsBySource.has(source)) continue;
    if (type === "routes" && seenRoutesBySourceAndResult.has(`${source}:${resultId ?? ""}`)) continue;
    const key = `${source}:${target}:${type}:${resultId ?? ""}`;
    if (seen.has(key)) continue;
    if (type === "runs") seenRunsBySource.add(source);
    if (type === "routes") seenRoutesBySourceAndResult.add(`${source}:${resultId ?? ""}`);
    seen.add(key);
    edges.push({
      id: uniqueId("edge", stringValue(record.id) || key, seenEdgeIds),
      source,
      target,
      type,
      ...(resultId ? { resultId } : {}),
    });
  }
  return edges;
}

function ensureStartEdge(nodes, edges) {
  const playNode = nodes.find((node) => node.type === "play");
  const agentNode = nodes.find((node) => node.type === "agent");
  if (!playNode || !agentNode) return;
  if (edges.some((edge) => edge.source === playNode.id && edge.type === "runs")) return;
  const seenEdgeIds = new Set(edges.map((edge) => edge.id));
  edges.unshift({
    id: uniqueId("edge", "start-agent", seenEdgeIds),
    source: playNode.id,
    target: agentNode.id,
    type: "runs",
  });
}

function edgeTypeForNodes(source, target, requestedType) {
  const inferred =
    (source.type === "play" && (target.type === "agent" || target.type === "graph")) ? "runs" :
      (source.type === "any" && target.type === "expression") ? "evaluates" :
      ((source.type === "agent" || source.type === "graph") && target.type === "expression") ? "evaluates" :
        (source.type === "expression" && (target.type === "agent" || target.type === "graph" || target.type === "play")) ? "routes" :
          null;
  if (requestedType && allowedEdgeTypes.has(requestedType) && requestedType === inferred) return requestedType;
  return inferred;
}

function normalizeRoutableResultId(value, resultIds, customResults) {
  const id = normalizeResultId(value);
  if (!id) return customResults.find((result) => !result.reserved)?.id ?? "completed";
  if (resultIds.has(id)) return id;
  const customId = normalizeCustomResultId(id);
  if (!customId) return "completed";
  customResults.push({
    id: customId,
    description: titleFromKey(customId),
    reserved: false,
  });
  resultIds.add(customId);
  return customId;
}

function normalizeCustomResultId(value) {
  const id = normalizeResultId(value);
  if (!id || reservedResultIds.has(id) || id === "unknown" || id === "fallback") return "";
  return id;
}

function currentProjectForReview(value) {
  const record = asRecord(value);
  const graph = asRecord(record.graph);
  const hasProject = stringValue(record.name) || Array.isArray(record.agents) || Array.isArray(record.results) || Array.isArray(graph.nodes);
  if (!hasProject) return null;
  return {
    name: stringValue(record.name) || "Current Project",
    agents: Array.isArray(record.agents) ? record.agents : [],
    results: Array.isArray(record.results) ? record.results : defaultResultDefinitions(),
    graph: {
      nodes: Array.isArray(graph.nodes) ? graph.nodes : [],
      edges: Array.isArray(graph.edges) ? graph.edges : [],
    },
  };
}

function normalizeGraphReviewChanges(value) {
  return (Array.isArray(value) ? value : []).slice(0, 20).flatMap((change) => {
    if (typeof change === "string") {
      const summary = compactSingleLine(change, 160);
      return summary ? [{ summary, detail: "" }] : [];
    }
    const record = asRecord(change);
    const detail = textValue(record.detail ?? record.description);
    const summary = compactSingleLine(record.summary ?? record.title ?? detail, 160);
    if (!summary) return [];
    return [{
      summary,
      detail: compactSingleLine(detail, 320),
    }];
  });
}

function stripInternalKeys(record) {
  const { key, ...publicRecord } = record;
  return publicRecord;
}

function generatedProjectName(prompt) {
  const words = String(prompt ?? "")
    .replace(/[`*_#[\](){}]/g, " ")
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z0-9-]/gi, ""))
    .filter(Boolean)
    .slice(0, 5);
  return words.length > 0 ? titleFromKey(words.join("-")) : "Generated Project";
}

function playPromptValue(prompt) {
  return stringValue(prompt) || "Run this generated graph.";
}

function generatorFailureMessage(command, result) {
  if (result.timedOut) return `${command} timed out while generating the graph.`;
  const detail = compactSingleLine(result.stderr || result.stdout || "");
  return detail ? `${command} could not generate the graph: ${detail}` : `${command} could not generate the graph.`;
}

function compactSingleLine(value, maxChars = 320) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 15).trimEnd()}... [truncated]`;
}

function parseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, value: null };
  }
}

function extractFirstJsonObject(text) {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

function uniqueKey(value, seen) {
  const base = normalizeResultId(value) || "item";
  let key = base;
  let suffix = 2;
  while (seen.has(key)) {
    key = `${base}-${suffix}`;
    suffix += 1;
  }
  seen.add(key);
  return key;
}

function uniqueId(prefix, value, seen) {
  const base = normalizeResultId(`${prefix}-${value}`) || `${prefix}-item`;
  let id = base;
  let suffix = 2;
  while (seen.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  seen.add(id);
  return id;
}

function titleFromKey(key) {
  const words = String(key ?? "")
    .split(/[-_\s]+/)
    .map((word) => word ? `${word[0].toUpperCase()}${word.slice(1)}` : "")
    .filter(Boolean);
  return words.join(" ") || "Generated";
}

function markdownFence(value, language = "") {
  const text = String(value ?? "").trim();
  const fence = "`".repeat(Math.max(3, longestBacktickRun(text) + 1));
  return `${fence}${language}\n${text}\n${fence}`;
}

function longestBacktickRun(text) {
  return Math.max(0, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function textValue(value) {
  return typeof value === "string" ? value : "";
}

function numberValue(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
