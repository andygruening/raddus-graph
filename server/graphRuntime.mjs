import { mkdir } from "node:fs/promises";
import { cloneRepository, publishSessionChanges } from "./github.mjs";
import {
  addGraphSession,
  readGraphData,
  recordNodeStatus,
  reservedResultIds,
  sessionRootFor,
  updateGraphSession,
  worktreePathForSession,
} from "./graphStore.mjs";
import { runnerForModel } from "./modelCatalog.mjs";
import { commandWorks, runProcess } from "./processUtils.mjs";

let graphServerOrigin = "http://127.0.0.1:5174";
const runningProcesses = new Map();

export function setGraphServerOrigin(origin) {
  graphServerOrigin = origin;
}

export async function createGraphSession(body) {
  const state = await readGraphData();
  const payload = asRecord(body);
  const playNodeId = stringValue(payload.playNodeId);
  const prompt = stringValue(payload.prompt);
  const projectId = nullableString(payload.projectId) ?? state.selectedProjectId;
  const project = state.projects?.find((candidate) => candidate.id === projectId) ?? state.projects?.[0] ?? null;
  const graph = project?.graph ?? state.graph;
  const playNode = graph.nodes.find((node) => node.id === playNodeId && node.type === "play");
  if (!playNode) throw new Error("Select a play node before running the graph.");
  if (!prompt) throw new Error("Enter a play prompt before running the graph.");

  const repositoryName = nullableString(payload.repository);
  const branch = repositoryName ? nullableString(payload.branch) : null;
  const sessionId = `graph-session-${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}-${globalThis.crypto.randomUUID().slice(0, 8)}`;
  const workspacePath = worktreePathForSession(sessionId);
  await mkdir(sessionRootFor(sessionId), { recursive: true });

  const repository = repositoryName
    ? {
      nameWithOwner: repositoryName,
      url: stringValue(payload.repositoryUrl),
      branch: branch || "main",
    }
    : null;

  if (repository) {
    await cloneRepository({
      nameWithOwner: repository.nameWithOwner,
      branch: repository.branch,
      worktreePath: workspacePath,
    });
  } else {
    await mkdir(workspacePath, { recursive: true });
  }

  const session = await addGraphSession({
    id: sessionId,
    status: "running",
    playNodeId,
    prompt,
    repository,
    workspacePath,
    branchName: null,
    prUrl: null,
    activeNodeId: null,
    projectId: project?.id ?? null,
    projectName: project?.name ?? null,
    graphSnapshot: graph,
    agentsSnapshot: state.agents,
    resultsSnapshot: state.results,
    nodeStatuses: {},
    nodeOutcomes: {},
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  queueMicrotask(() => {
    runGraphSession(session.id).catch(async (error) => {
      await failSession(session.id, error);
    });
  });

  return session;
}

export async function runGraphSession(sessionId) {
  let session = await getSession(sessionId);
  if (!session) throw new Error(`Graph session not found: ${sessionId}`);

  const graph = session.graphSnapshot;
  const agents = session.agentsSnapshot ?? [];
  const results = session.resultsSnapshot ?? [];
  if (!graph) throw new Error("Graph session is missing its graph snapshot.");

  let currentAgentNode = firstAgentNodeForPlay(graph, session.playNodeId);
  if (!currentAgentNode) {
    await completeSession(sessionId, "No agent node is connected to the play node.");
    return;
  }

  const visitedAgentNodes = [];
  let step = 0;
  for (; step < 50 && currentAgentNode; step += 1) {
    session = await getSession(sessionId);
    if (!session || session.status === "stopped") return;

    await runAgentNode({ session, graph, agents, results, node: currentAgentNode, upstreamNodeIds: visitedAgentNodes });
    visitedAgentNodes.push(currentAgentNode.id);

    session = await getSession(sessionId);
    const outcome = session?.nodeOutcomes[currentAgentNode.id] ?? null;
    if (!outcome) {
      await failSession(sessionId, new Error(`Agent node ${currentAgentNode.id} finished without a terminal outcome.`));
      return;
    }
    if (outcome.state === "stopped") {
      await updateGraphSession(sessionId, (current) => ({ ...current, status: "stopped", activeNodeId: null, updatedAt: new Date().toISOString() }));
      return;
    }

    currentAgentNode = nextAgentNodeFromOutcome({ graph, currentAgentNode, outcome });
  }

  if (currentAgentNode) {
    await failSession(sessionId, new Error("Graph session exceeded the 50-step execution limit."));
    return;
  }

  await completeSession(sessionId, "Graph session finished.");
}

export async function stopGraphSession(sessionId) {
  const child = runningProcesses.get(sessionId);
  if (child && !child.killed) child.kill("SIGTERM");
  const currentSession = await getSession(sessionId);
  const activeNodeId = currentSession?.activeNodeId ?? null;
  if (activeNodeId) {
    await recordNodeStatus(sessionId, activeNodeId, { state: "stopped", summary: "Stopped by user." }, "server");
  }
  const session = await updateGraphSession(sessionId, (current) => ({
    ...current,
    status: "stopped",
    activeNodeId: null,
    updatedAt: new Date().toISOString(),
  }));
  return session;
}

export async function appendCallbackStatus(sessionId, nodeId, payload) {
  return recordNodeStatus(sessionId, nodeId, payload, "callback");
}

async function runAgentNode({ session, graph, agents, results, node, upstreamNodeIds }) {
  const agent = agents.find((candidate) => candidate.id === node.agentId);
  if (!agent) {
    await recordNodeStatus(session.id, node.id, {
      state: "failed",
      summary: "Agent node is not linked to an agent spec.",
      detail: `Missing agent spec for node ${node.id}.`,
    }, "server");
    return;
  }

  const runner = runnerForModel(agent.model);
  if (!runner) {
    await recordNodeStatus(session.id, node.id, {
      state: "failed",
      summary: "Agent model is not supported.",
      detail: `No CLI runner is mapped for ${agent.model}.`,
    }, "server");
    return;
  }

  const command = runner === "codex" ? "codex" : "claude";
  const commandAvailable = await commandWorks(command, ["--version"], { timeoutMs: 10_000 });
  if (!commandAvailable) {
    await recordNodeStatus(session.id, node.id, {
      state: "failed",
      summary: `${command} CLI is not available.`,
      detail: `Install and authenticate ${command} before running model ${agent.model}.`,
    }, "server");
    return;
  }

  await updateGraphSession(session.id, (current) => ({
    ...current,
    activeNodeId: node.id,
    updatedAt: new Date().toISOString(),
  }));
  await recordNodeStatus(session.id, node.id, { state: "started", summary: `Starting ${agent.name}.` }, "server");

  const prompt = buildAgentPrompt({ session, graph, agents, results, node, agent, upstreamNodeIds });
  const args = cliArgsForRunner(runner, agent, session.workspacePath, prompt);
  const result = await runProcess(command, args.args, {
    cwd: session.workspacePath,
    input: args.input,
    timeoutMs: 45 * 60_000,
    onChild: (child) => {
      runningProcesses.set(session.id, child);
    },
    env: {
      RADDUS_GRAPH_SESSION_ID: session.id,
      RADDUS_GRAPH_NODE_ID: node.id,
      RADDUS_GRAPH_STATUS_URL: statusUrlFor(session.id, node.id),
    },
  });
  runningProcesses.delete(session.id);

  let current = await getSession(session.id);
  const existingOutcome = current?.nodeOutcomes[node.id] ?? null;
  if (!existingOutcome) {
    await recordNodeStatus(session.id, node.id, {
      state: result.ok ? "completed" : "failed",
      summary: result.ok ? "CLI process finished without posting a terminal result." : "CLI process failed before posting a terminal result.",
      detail: result.timedOut ? "CLI process timed out." : "",
      stdout: result.stdout,
      stderr: result.stderr,
    }, "server");
  }

  current = await getSession(session.id);
  if (current?.repository && current.status !== "stopped") {
    try {
      const publish = await publishSessionChanges({
        cwd: current.workspacePath,
        sessionId: current.id,
        currentBranchName: current.branchName,
        prUrl: current.prUrl,
        nodeName: agent.name,
      });
      if (publish.changed || publish.branchName !== current.branchName || publish.prUrl !== current.prUrl) {
        await updateGraphSession(current.id, (latest) => ({
          ...latest,
          branchName: publish.branchName ?? latest.branchName,
          prUrl: publish.prUrl ?? latest.prUrl,
          updatedAt: new Date().toISOString(),
        }));
      }
    } catch (error) {
      await recordNodeStatus(session.id, node.id, {
        state: "failed",
        summary: "Agent changes were not published.",
        detail: error instanceof Error ? error.message : String(error),
      }, "server");
    }
  }
}

function buildAgentPrompt({ session, graph, agents, results, node, agent, upstreamNodeIds }) {
  const upstreamContext = upstreamNodeIds.map((nodeId) => {
    const upstreamNode = graph.nodes.find((candidate) => candidate.id === nodeId);
    const upstreamAgent = upstreamNode?.type === "agent" ? agents.find((candidate) => candidate.id === upstreamNode.agentId) : null;
    const statuses = session.nodeStatuses[nodeId] ?? [];
    const outcome = session.nodeOutcomes[nodeId] ?? null;
    return {
      nodeId,
      agentName: upstreamAgent?.name ?? upstreamNode?.id ?? nodeId,
      statuses: statuses.slice(-5).map((status) => ({
        state: status.state,
        summary: status.summary,
        emittedResultId: status.emittedResultId,
        routedResultId: status.routedResultId,
        routeReason: status.routeReason,
      })),
      terminalOutcome: outcome ? {
        state: outcome.state,
        emittedResultId: outcome.emittedResultId,
        routedResultId: outcome.routedResultId,
        routeReason: outcome.routeReason,
        summary: outcome.summary,
      } : null,
    };
  });

  const availableResults = results.filter((result) => !reservedResultIds.has(result.id)).map((result) => ({
    id: result.id,
    description: result.description,
  }));

  const callbackExample = {
    state: "completed",
    resultId: availableResults[0]?.id ?? "replace-with-result-id",
    summary: "Short terminal summary.",
    detail: "Optional details for the graph execution log.",
  };

  return [
    agent.systemPrompt ? `System prompt for ${agent.name}:\n${agent.systemPrompt}` : `You are ${agent.name}.`,
    "",
    "Raddus Graph execution context:",
    JSON.stringify({
      graphSessionId: session.id,
      nodeId: node.id,
      playPrompt: session.prompt,
      repository: session.repository,
      workspacePath: session.workspacePath,
      upstreamExecutionContext: upstreamContext,
    }, null, 2),
    "",
    "Allowed result IDs for terminal outcomes:",
    JSON.stringify(availableResults, null, 2),
    "",
    "Local server callback contract:",
    `Post progress and terminal JSON to ${statusUrlFor(session.id, node.id)}.`,
    `Use: curl -sS -X POST ${statusUrlFor(session.id, node.id)} -H 'content-type: application/json' -d '<json>'`,
    "Progress statuses may use state values like started, working, or blocked.",
    "Before your CLI session finishes, you must POST exactly one terminal outcome with state completed or failed.",
    "When state is completed, include resultId from the allowed result IDs. Do not emit reserved result IDs unknown or fallback.",
    "If no valid result is posted before the process exits, Raddus Graph routes this node through unknown.",
    "",
    "Example terminal POST body:",
    JSON.stringify(callbackExample, null, 2),
    "",
    "User prompt from the play node:",
    session.prompt,
  ].join("\n");
}

function cliArgsForRunner(runner, agent, workspacePath, prompt) {
  if (runner === "codex") {
    return {
      args: [
        "exec",
        "--model",
        agent.model,
        "--cd",
        workspacePath,
        "--sandbox",
        "workspace-write",
        "--ask-for-approval",
        "never",
        "--skip-git-repo-check",
        "-",
      ],
      input: prompt,
    };
  }

  return {
    args: ["-p", prompt, "--model", agent.model],
    input: undefined,
  };
}

function firstAgentNodeForPlay(graph, playNodeId) {
  const edge = graph.edges.find((candidate) => candidate.source === playNodeId && candidate.type === "runs");
  return edge ? graph.nodes.find((node) => node.id === edge.target && node.type === "agent") ?? null : null;
}

function nextAgentNodeFromOutcome({ graph, currentAgentNode, outcome }) {
  const routedResultId = outcome.routedResultId;
  if (!routedResultId || outcome.state === "stopped") return null;

  const expressionNodes = graph.edges
    .filter((edge) => edge.source === currentAgentNode.id && edge.type === "evaluates")
    .flatMap((edge) => {
      const node = graph.nodes.find((candidate) => candidate.id === edge.target && candidate.type === "expression");
      return node ? [node] : [];
    });
  if (expressionNodes.length === 0) return null;

  const expressionIds = new Set(expressionNodes.map((node) => node.id));
  const matchingRoute = graph.edges.find((edge) =>
    expressionIds.has(edge.source) &&
    edge.type === "routes" &&
    edge.resultId === routedResultId
  );
  const fallbackRoute = graph.edges.find((edge) =>
    expressionIds.has(edge.source) &&
    edge.type === "routes" &&
    edge.resultId === "fallback"
  );
  const route = matchingRoute ?? (routedResultId !== "unknown" ? fallbackRoute : null);
  return route ? graph.nodes.find((node) => node.id === route.target && node.type === "agent") ?? null : null;
}

async function getSession(sessionId) {
  const data = await readGraphData();
  return data.sessions.find((session) => session.id === sessionId) ?? null;
}

async function completeSession(sessionId, summary) {
  await updateGraphSession(sessionId, (current) => ({
    ...current,
    status: current.status === "stopped" ? "stopped" : "completed",
    activeNodeId: null,
    error: null,
    updatedAt: new Date().toISOString(),
    completionSummary: summary,
  }));
}

async function failSession(sessionId, error) {
  const message = error instanceof Error ? error.message : String(error);
  await updateGraphSession(sessionId, (current) => ({
    ...current,
    status: "failed",
    activeNodeId: null,
    error: message,
    updatedAt: new Date().toISOString(),
  }));
}

function statusUrlFor(sessionId, nodeId) {
  return `${graphServerOrigin}/api/graph/sessions/${encodeURIComponent(sessionId)}/nodes/${encodeURIComponent(nodeId)}/status`;
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function nullableString(value) {
  const text = stringValue(value);
  return text || null;
}
