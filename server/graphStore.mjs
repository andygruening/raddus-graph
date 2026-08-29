import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { graphDataDir } from "./config.mjs";

export const graphStateFile = join(graphDataDir, "state.json");
export const graphSessionsDir = join(graphDataDir, "sessions");
export const reservedResultIds = new Set(["unknown", "fallback"]);

let writeQueue = Promise.resolve();

export async function initializeGraphStore() {
  await mkdir(graphSessionsDir, { recursive: true });
  await updateGraphData((data) => markRunningSessionsStopped(data, "server_start"));
}

export async function readGraphData() {
  try {
    const text = await readFile(graphStateFile, "utf8");
    return normalizeGraphData(JSON.parse(text));
  } catch (error) {
    if (error?.code === "ENOENT") return defaultGraphData();
    throw error;
  }
}

export async function replaceGraphState(payload) {
  return updateGraphData((current) => {
    const body = asRecord(payload);
    const selectedProjectId = stringValue(body.selectedProjectId) || current.selectedProjectId;
    const projects = Array.isArray(body.projects)
      ? body.projects
      : current.projects.map((project) => (
        project.id === selectedProjectId && isPlainRecord(body.graph)
          ? { ...project, graph: body.graph, updatedAt: new Date().toISOString() }
          : project
      ));
    const incoming = normalizeGraphData({
      ...current,
      ...body,
      projects,
      sessions: current.sessions,
    });
    return {
      ...incoming,
      sessions: current.sessions,
    };
  });
}

export async function updateGraphData(update) {
  const run = writeQueue.then(async () => {
    const current = await readGraphData();
    const next = normalizeGraphData(await update(current));
    await writeGraphData(next);
    return next;
  });
  writeQueue = run.catch(() => undefined);
  return run;
}

export async function addGraphSession(session) {
  const data = await updateGraphData((current) => ({
    ...current,
    sessions: [normalizeGraphSession(session), ...current.sessions],
  }));
  return data.sessions.find((item) => item.id === session.id) ?? normalizeGraphSession(session);
}

export async function updateGraphSession(sessionId, update) {
  const data = await updateGraphData(async (current) => {
    const sessions = await Promise.all(current.sessions.map(async (session) => (
      session.id === sessionId ? normalizeGraphSession(await update(session)) : session
    )));
    return { ...current, sessions };
  });
  return data.sessions.find((session) => session.id === sessionId) ?? null;
}

export async function recordNodeStatus(sessionId, nodeId, payload, source = "callback") {
  const data = await readGraphData();
  const resultIds = new Set(data.results.map((result) => result.id));
  const status = normalizeNodeStatus(payload, nodeId, resultIds, source);
  const session = await updateGraphSession(sessionId, (current) => {
    const currentStatuses = current.nodeStatuses[nodeId] ?? [];
    const nextStatuses = [...currentStatuses, status];
    const nodeStatuses = { ...current.nodeStatuses, [nodeId]: nextStatuses };
    const nodeOutcomes = isTerminalState(status.state)
      ? { ...current.nodeOutcomes, [nodeId]: terminalOutcomeFromStatus(status) }
      : current.nodeOutcomes;
    return {
      ...current,
      activeNodeId: isTerminalState(status.state) && current.activeNodeId === nodeId ? null : current.activeNodeId,
      nodeStatuses,
      nodeOutcomes,
      updatedAt: status.createdAt,
    };
  });
  return { status, session };
}

export function defaultResultDefinitions() {
  return [
    {
      id: "unknown",
      description: "System fallback when an agent omits a terminal outcome, exits without one, or emits an unrecognized result.",
      reserved: true,
    },
    {
      id: "fallback",
      description: "System routing fallback when an expression card has no explicit branch for a recognized result.",
      reserved: true,
    },
  ];
}

export function isTerminalState(state) {
  return state === "completed" || state === "failed" || state === "stopped";
}

export function normalizeResultId(value) {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") : "";
}

export function worktreePathForSession(sessionId) {
  return join(graphSessionsDir, sessionId, "worktree");
}

export function sessionRootFor(sessionId) {
  return join(graphSessionsDir, sessionId);
}

async function writeGraphData(data) {
  await mkdir(dirname(graphStateFile), { recursive: true });
  const tempFile = `${graphStateFile}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempFile, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  await rename(tempFile, graphStateFile);
}

function defaultGraphData() {
  const now = new Date().toISOString();
  const graph = defaultGraphDocument();
  const project = defaultProjectRecord({
    id: "project-default",
    name: "Default Project",
    graph,
    now,
  });
  return {
    version: 1,
    agents: [],
    results: defaultResultDefinitions(),
    projects: [project],
    selectedProjectId: project.id,
    graph,
    sessions: [],
    updatedAt: now,
  };
}

function normalizeGraphData(value) {
  const record = asRecord(value);
  const projects = normalizeProjects(record.projects, record.graph);
  const selectedProjectId = selectedProjectIdValue(record.selectedProjectId, projects);
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? projects[0];
  return {
    version: 1,
    agents: normalizeAgents(record.agents),
    results: normalizeResults(record.results),
    projects,
    selectedProjectId: selectedProject.id,
    graph: selectedProject.graph,
    sessions: Array.isArray(record.sessions) ? record.sessions.map(normalizeGraphSession).filter(Boolean) : [],
    updatedAt: typeof record.updatedAt === "string" && record.updatedAt ? record.updatedAt : new Date().toISOString(),
  };
}

function defaultGraphDocument() {
  return {
    nodes: [
      {
        id: "play-start",
        type: "play",
        x: 72,
        y: 96,
        prompt: "Describe the graph session you want to run.",
        repository: null,
        branch: null,
      },
    ],
    edges: [],
  };
}

function defaultProjectRecord({ id, name, graph, now }) {
  return {
    id,
    name,
    graph,
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeProjects(value, legacyGraph) {
  const now = new Date().toISOString();
  const seen = new Set();
  const projects = Array.isArray(value)
    ? value.flatMap((project) => {
      const record = asRecord(project);
      const id = stringValue(record.id) || cryptoId("project");
      if (seen.has(id)) return [];
      seen.add(id);
      return [defaultProjectRecord({
        id,
        name: stringValue(record.name) || "Untitled Project",
        graph: normalizeGraph(record.graph),
        now,
      })];
    })
    : [];

  if (projects.length > 0) {
    return projects.map((project, index) => {
      const record = asRecord(value[index]);
      return {
        ...project,
        createdAt: stringValue(record.createdAt) || project.createdAt,
        updatedAt: stringValue(record.updatedAt) || project.updatedAt,
      };
    });
  }

  return [defaultProjectRecord({
    id: "project-default",
    name: "Default Project",
    graph: normalizeGraph(legacyGraph),
    now,
  })];
}

function selectedProjectIdValue(value, projects) {
  const id = stringValue(value);
  if (id && projects.some((project) => project.id === id)) return id;
  return projects[0]?.id ?? "project-default";
}

function normalizeAgents(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.flatMap((agent) => {
    const record = asRecord(agent);
    const id = stringValue(record.id) || cryptoId("agent");
    if (seen.has(id)) return [];
    seen.add(id);
    return [{
      id,
      name: stringValue(record.name) || "Untitled agent",
      model: stringValue(record.model) || "gpt-5-codex",
      systemPrompt: stringValue(record.systemPrompt ?? record.system_prompt),
      createdAt: stringValue(record.createdAt) || new Date().toISOString(),
      updatedAt: stringValue(record.updatedAt) || new Date().toISOString(),
    }];
  });
}

function normalizeResults(value) {
  const reserved = defaultResultDefinitions();
  const seen = new Set(reserved.map((result) => result.id));
  const custom = Array.isArray(value)
    ? value.flatMap((result) => {
      const record = asRecord(result);
      const id = normalizeResultId(record.id);
      if (!id || reservedResultIds.has(id) || seen.has(id)) return [];
      seen.add(id);
      return [{
        id,
        description: stringValue(record.description) || id,
        reserved: false,
      }];
    })
    : [];
  return [...reserved, ...custom];
}

function normalizeGraph(value) {
  const record = asRecord(value);
  const nodes = Array.isArray(record.nodes) ? record.nodes.map(normalizeGraphNode).filter(Boolean) : defaultGraphDocument().nodes;
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = Array.isArray(record.edges)
    ? record.edges.map((edge) => normalizeGraphEdge(edge, nodeIds)).filter(Boolean)
    : [];
  return { nodes, edges };
}

function normalizeGraphNode(value) {
  const record = asRecord(value);
  const type = stringValue(record.type);
  if (type !== "play" && type !== "agent" && type !== "expression") return null;
  const id = stringValue(record.id) || cryptoId(type);
  return {
    id,
    type,
    x: numberValue(record.x, 80),
    y: numberValue(record.y, 80),
    ...(type === "play" ? {
      prompt: stringValue(record.prompt),
      repository: nullableString(record.repository),
      branch: nullableString(record.branch),
    } : {}),
    ...(type === "agent" ? {
      agentId: nullableString(record.agentId),
    } : {}),
  };
}

function normalizeGraphEdge(value, nodeIds) {
  const record = asRecord(value);
  const source = stringValue(record.source);
  const target = stringValue(record.target);
  if (!source || !target || !nodeIds.has(source) || !nodeIds.has(target)) return null;
  const type = stringValue(record.type);
  if (type !== "runs" && type !== "evaluates" && type !== "routes") return null;
  const resultId = normalizeResultId(record.resultId);
  const bend = normalizePoint(record.bend);
  const sourceAnchor = cardAnchorValue(record.sourceAnchor);
  const targetAnchor = cardAnchorValue(record.targetAnchor);
  return {
    id: stringValue(record.id) || cryptoId("edge"),
    source,
    target,
    type,
    ...(type === "routes" && resultId ? { resultId } : {}),
    ...(bend ? { bend } : {}),
    ...(sourceAnchor ? { sourceAnchor } : {}),
    ...(targetAnchor ? { targetAnchor } : {}),
  };
}

function normalizePoint(value) {
  const record = asRecord(value);
  const x = numberValue(record.x, Number.NaN);
  const y = numberValue(record.y, Number.NaN);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function cardAnchorValue(value) {
  const text = stringValue(value);
  return text === "top" || text === "right" || text === "bottom" || text === "left" ? text : null;
}

function normalizeGraphSession(value) {
  const record = asRecord(value);
  const id = stringValue(record.id) || cryptoId("graph-session");
  const now = new Date().toISOString();
  const status = sessionStatusValue(record.status);
  const nodeStatuses = normalizeStatusMap(record.nodeStatuses);
  const nodeOutcomes = normalizeOutcomeMap(record.nodeOutcomes);
  return {
    id,
    status,
    playNodeId: stringValue(record.playNodeId),
    prompt: stringValue(record.prompt),
    repository: normalizeSessionRepository(record.repository),
    workspacePath: stringValue(record.workspacePath),
    branchName: nullableString(record.branchName),
    prUrl: nullableString(record.prUrl),
    activeNodeId: nullableString(record.activeNodeId),
    projectId: nullableString(record.projectId),
    projectName: nullableString(record.projectName),
    graphSnapshot: isPlainRecord(record.graphSnapshot) ? normalizeGraph(record.graphSnapshot) : null,
    agentsSnapshot: Array.isArray(record.agentsSnapshot) ? normalizeAgents(record.agentsSnapshot) : null,
    resultsSnapshot: Array.isArray(record.resultsSnapshot) ? normalizeResults(record.resultsSnapshot) : null,
    nodeStatuses,
    nodeOutcomes,
    error: nullableString(record.error),
    createdAt: stringValue(record.createdAt) || now,
    updatedAt: stringValue(record.updatedAt) || now,
  };
}

function normalizeSessionRepository(value) {
  const record = asRecord(value);
  const nameWithOwner = stringValue(record.nameWithOwner);
  if (!nameWithOwner) return null;
  return {
    nameWithOwner,
    url: stringValue(record.url),
    branch: stringValue(record.branch),
  };
}

function normalizeStatusMap(value) {
  const record = asRecord(value);
  return Object.fromEntries(Object.entries(record).map(([nodeId, statuses]) => [
    nodeId,
    Array.isArray(statuses) ? statuses.map((status) => normalizeStoredNodeStatus(status, nodeId)).filter(Boolean) : [],
  ]));
}

function normalizeOutcomeMap(value) {
  const record = asRecord(value);
  return Object.fromEntries(Object.entries(record).flatMap(([nodeId, outcome]) => {
    const normalized = normalizeTerminalOutcome(outcome, nodeId);
    return normalized ? [[nodeId, normalized]] : [];
  }));
}

function normalizeStoredNodeStatus(value, nodeId) {
  const record = asRecord(value);
  const state = nodeStateValue(record.state);
  if (!state) return null;
  return {
    id: stringValue(record.id) || cryptoId("status"),
    nodeId,
    state,
    summary: stringValue(record.summary),
    detail: stringValue(record.detail),
    emittedResultId: nullableString(record.emittedResultId),
    routedResultId: nullableString(record.routedResultId),
    routeReason: nullableString(record.routeReason),
    source: stringValue(record.source) || "server",
    stdout: stringValue(record.stdout),
    stderr: stringValue(record.stderr),
    createdAt: stringValue(record.createdAt) || new Date().toISOString(),
  };
}

function normalizeNodeStatus(value, nodeId, resultIds, source) {
  const record = asRecord(value);
  const state = nodeStateValue(record.state) || "working";
  const emittedResultId = normalizeResultId(record.resultId ?? record.emittedResultId);
  const result = routeResultForStatus(state, emittedResultId, resultIds);
  return {
    id: cryptoId("status"),
    nodeId,
    state,
    summary: stringValue(record.summary),
    detail: stringValue(record.detail),
    emittedResultId: emittedResultId || null,
    routedResultId: result.routedResultId,
    routeReason: result.routeReason,
    source,
    stdout: stringValue(record.stdout),
    stderr: stringValue(record.stderr),
    createdAt: stringValue(record.createdAt) || new Date().toISOString(),
  };
}

function normalizeTerminalOutcome(value, nodeId) {
  const status = normalizeStoredNodeStatus(value, nodeId);
  return status && isTerminalState(status.state) ? terminalOutcomeFromStatus(status) : null;
}

function terminalOutcomeFromStatus(status) {
  return {
    id: status.id,
    nodeId: status.nodeId,
    state: status.state,
    emittedResultId: status.emittedResultId,
    routedResultId: status.routedResultId,
    routeReason: status.routeReason,
    summary: status.summary,
    detail: status.detail,
    stdout: status.stdout,
    stderr: status.stderr,
    createdAt: status.createdAt,
  };
}

function routeResultForStatus(state, emittedResultId, resultIds) {
  if (state === "stopped") return { routedResultId: null, routeReason: "stopped" };
  if (state === "failed") return { routedResultId: "unknown", routeReason: "failed" };
  if (state !== "completed") return { routedResultId: null, routeReason: null };
  if (!emittedResultId) return { routedResultId: "unknown", routeReason: "missing_terminal_result" };
  if (reservedResultIds.has(emittedResultId)) return { routedResultId: "unknown", routeReason: "reserved_result_emitted" };
  if (!resultIds.has(emittedResultId)) return { routedResultId: "unknown", routeReason: "unrecognized_result" };
  return { routedResultId: emittedResultId, routeReason: "matched_result" };
}

function markRunningSessionsStopped(data, reason) {
  const now = new Date().toISOString();
  return {
    ...data,
    sessions: data.sessions.map((session) => {
      if (session.status !== "running") return session;
      const nodeId = session.activeNodeId || "session";
      const status = {
        id: cryptoId("status"),
        nodeId,
        state: "stopped",
        summary: "Marked stopped after server restart.",
        detail: reason,
        emittedResultId: null,
        routedResultId: null,
        routeReason: "stopped",
        source: "server",
        stdout: "",
        stderr: "",
        createdAt: now,
      };
      return {
        ...session,
        status: "stopped",
        activeNodeId: null,
        nodeStatuses: {
          ...session.nodeStatuses,
          [nodeId]: [...(session.nodeStatuses[nodeId] ?? []), status],
        },
        nodeOutcomes: {
          ...session.nodeOutcomes,
          [nodeId]: terminalOutcomeFromStatus(status),
        },
        updatedAt: now,
      };
    }),
  };
}

function sessionStatusValue(value) {
  return value === "running" || value === "completed" || value === "failed" || value === "stopped" ? value : "completed";
}

function nodeStateValue(value) {
  return value === "queued" ||
    value === "started" ||
    value === "working" ||
    value === "blocked" ||
    value === "completed" ||
    value === "failed" ||
    value === "stopped"
    ? value
    : null;
}

function asRecord(value) {
  return isPlainRecord(value) ? value : {};
}

function isPlainRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function nullableString(value) {
  const text = stringValue(value);
  return text || null;
}

function numberValue(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function cryptoId(prefix) {
  return `${prefix}-${globalThis.crypto.randomUUID()}`;
}
