import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { cloneRepository, publishSessionChanges } from "./github.mjs";
import {
  addGraphSession,
  createAgentSession,
  deleteGraphSession as deleteStoredGraphSession,
  nonCompletionResultIds,
  readGraphData,
  recordAgentSessionProcessOutput,
  recordAgentSessionStatus,
  sessionRootFor,
  setAgentSessionPrompt,
  updateGraphSession,
  worktreePathForSession,
} from "./graphStore.mjs";
import { runnerForModel } from "./modelCatalog.mjs";
import { commandWorks, runProcess } from "./processUtils.mjs";

let graphServerOrigin = "http://127.0.0.1:5174";
const runningProcesses = new Map();
const maxPromptHistoryEntries = 6;
const maxPromptHistoryHandoffChars = 1600;
const maxPromptHistorySummaryChars = 240;
const maxPromptResultDescriptionChars = 120;

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
  const agents = project?.agents ?? state.agents;
  const results = project?.results ?? state.results;
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
    activeAgentSessionIds: [],
    projectId: project?.id ?? null,
    projectName: project?.name ?? null,
    graphSnapshot: graph,
    projectsSnapshot: state.projects ?? [],
    agentsSnapshot: agents,
    resultsSnapshot: results,
    agentSessions: [],
    pendingReview: null,
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

  const definition = graphDefinitionForSession(session, {
    graph,
    agents,
    results,
    projects: session.projectsSnapshot ?? [],
  });
  const startRoute = firstAgentRouteForStart(definition, session.playNodeId);
  if (!startRoute) {
    await completeSession(sessionId, "No agent node or graph card is connected to the play node.");
    return;
  }

  await continueGraphSessionFromAgent({
    sessionId,
    definition: startRoute.definition,
    returnContinuation: startRoute.returnContinuation,
    currentAgentNode: startRoute.node,
    visitedAgentSessionIds: [],
    currentArrival: startRoute.arrival,
    userPrompt: session.prompt,
  });
}

async function continueGraphSessionFromAgent({
  sessionId,
  definition,
  returnContinuation,
  currentAgentNode,
  visitedAgentSessionIds,
  currentArrival,
  userPrompt,
}) {
  visitedAgentSessionIds = [...visitedAgentSessionIds];
  let currentDefinition = definition;
  let currentReturnContinuation = returnContinuation ?? null;
  let step = 0;
  for (; step < 50 && currentAgentNode; step += 1) {
    const session = await getSession(sessionId);
    if (!session || session.status === "stopped") return;

    const agentSessionId = await runAgentNode({
      session,
      graphId: currentDefinition.graphId,
      graph: currentDefinition.graph,
      agents: currentDefinition.agents,
      results: currentDefinition.results,
      node: currentAgentNode,
      upstreamAgentSessionIds: visitedAgentSessionIds,
      arrival: currentArrival,
      userPrompt,
    });
    if (!agentSessionId) return;
    visitedAgentSessionIds.push(agentSessionId);

    const latestSession = await getSession(sessionId);
    const currentExecution = latestSession?.agentSessions.find((agentSession) => agentSession.id === agentSessionId) ?? null;
    const outcome = currentExecution?.terminalOutcome ?? null;
    if (!outcome) {
      await failSession(sessionId, new Error(`Agent node ${currentAgentNode.id} finished without a terminal outcome.`));
      return;
    }
    if (outcome.state === "stopped") {
      await updateGraphSession(sessionId, (current) => ({ ...current, status: "stopped", activeAgentSessionIds: [], updatedAt: new Date().toISOString() }));
      return;
    }

    const nextRoute = nextGraphRouteFromOutcome({ graph: currentDefinition.graph, currentAgentNode, outcome });
    if (!nextRoute) {
      const completionRoute = nextAgentRouteAfterGraphCompletion({
        returnContinuation: currentReturnContinuation,
        previousAgentSession: currentExecution,
        fallbackUserPrompt: userPrompt ?? session.prompt,
      });
      if (!completionRoute) {
        currentAgentNode = null;
        currentArrival = null;
        continue;
      }
      currentDefinition = completionRoute.definition;
      currentReturnContinuation = completionRoute.returnContinuation ?? null;
      currentAgentNode = completionRoute.node;
      currentArrival = completionRoute.arrival;
      userPrompt = completionRoute.userPrompt ?? userPrompt ?? session.prompt;
      continue;
    }

    if (nextRoute?.node.type === "review") {
      await pauseSessionForReview({
        sessionId,
        definition: currentDefinition,
        reviewNode: nextRoute.node,
        agentNode: currentAgentNode,
        agentSession: currentExecution,
        route: nextRoute,
        upstreamAgentSessionIds: visitedAgentSessionIds,
      });
      return;
    }
    const nextAgentRoute = nextAgentRouteFromGraphRoute({
      definition: currentDefinition,
      returnContinuation: currentReturnContinuation,
      route: nextRoute,
      previousAgentSession: currentExecution,
      fallbackUserPrompt: userPrompt ?? session.prompt,
    });
    currentAgentNode = nextAgentRoute?.node ?? null;
    currentArrival = nextAgentRoute?.arrival ?? null;
    currentDefinition = nextAgentRoute?.definition ?? currentDefinition;
    currentReturnContinuation = nextAgentRoute?.returnContinuation ?? currentReturnContinuation;
    userPrompt = nextAgentRoute?.userPrompt ?? userPrompt ?? session.prompt;
  }

  if (currentAgentNode) {
    await failSession(sessionId, new Error("Graph session exceeded the 50-step execution limit."));
    return;
  }

  await completeSession(sessionId, "Graph session finished.");
}

export async function submitReviewResponse(sessionId, body) {
  const payload = asRecord(body);
  const answer = textValue(payload.answer);
  const reviewNodeId = stringValue(payload.reviewNodeId);
  if (!answer) throw new Error("Enter a response before continuing the graph.");

  let pendingReview = null;
  const session = await updateGraphSession(sessionId, (current) => {
    if (current.status !== "waiting_review" || !current.pendingReview) throw new Error("Graph session is not waiting for review.");
    if (reviewNodeId && current.pendingReview.reviewNodeId !== reviewNodeId) throw new Error("This review card is not waiting for input.");
    pendingReview = current.pendingReview;
    return {
      ...current,
      status: "running",
      pendingReview: null,
      error: null,
      updatedAt: new Date().toISOString(),
    };
  });
  if (!session || !pendingReview) throw new Error("Graph session is not waiting for review.");

  queueMicrotask(() => {
    continueGraphSessionFromReview(sessionId, pendingReview, answer).catch(async (error) => {
      await failSession(sessionId, error);
    });
  });

  return session;
}

export async function continueGraphSession(sessionId) {
  const existingSession = await getSession(sessionId);
  if (!existingSession) return null;
  if (existingSession.status === "running") throw new Error("Graph session is already running.");
  if (existingSession.status === "waiting_review") throw new Error("Answer the pending review before continuing this graph session.");

  const plan = await continuationPlanForSession(existingSession);
  const session = await updateGraphSession(sessionId, (current) => {
    if (current.status === "running") throw new Error("Graph session is already running.");
    if (current.status === "waiting_review") throw new Error("Answer the pending review before continuing this graph session.");
    return {
      ...current,
      status: "running",
      activeAgentSessionIds: [],
      pendingReview: null,
      error: null,
      graphSnapshot: plan.graph,
      projectsSnapshot: plan.projects ?? current.projectsSnapshot,
      agentsSnapshot: plan.agents,
      resultsSnapshot: plan.results,
      projectName: plan.projectName ?? current.projectName,
      updatedAt: new Date().toISOString(),
    };
  });

  queueMicrotask(() => {
    continueGraphSessionFromPlan(sessionId, plan).catch(async (error) => {
      await failSession(sessionId, error);
    });
  });

  return session;
}

async function continueGraphSessionFromReview(sessionId, pendingReview, answer) {
  let session = await getSession(sessionId);
  if (!session) throw new Error(`Graph session not found: ${sessionId}`);
  const graph = session.graphSnapshot;
  const agents = session.agentsSnapshot ?? [];
  const results = session.resultsSnapshot ?? [];
  if (!graph) throw new Error("Graph session is missing its graph snapshot.");
  const fallbackDefinition = graphDefinitionForSession(session, {
    graph,
    agents,
    results,
    projects: session.projectsSnapshot ?? [],
  });
  const definition = graphDefinitionForPendingReview(fallbackDefinition, pendingReview);
  const agentNode = definition.graph.nodes.find((node) => node.id === pendingReview.agentNodeId && node.type === "agent");
  if (!agentNode) throw new Error("The review response target agent is no longer available.");

  await continueGraphSessionFromAgent({
    sessionId,
    definition,
    returnContinuation: returnContinuationForAgentSession(
      session,
      fallbackDefinition,
      session.agentSessions.find((agentSession) => agentSession.id === pendingReview.previousAgentSessionId) ?? null,
    ),
    currentAgentNode: agentNode,
    visitedAgentSessionIds: pendingReview.upstreamAgentSessionIds,
    currentArrival: {
      previousAgentSessionId: pendingReview.previousAgentSessionId,
      incomingExpressionNodeId: pendingReview.incomingExpressionNodeId,
      incomingEdgeIds: pendingReview.incomingEdgeIds,
      incomingResultId: pendingReview.incomingResultId,
    },
    userPrompt: answer,
  });
}

async function continueGraphSessionFromPlan(sessionId, plan) {
  if (plan.target.reviewPause) {
    await pauseSessionForReview({ sessionId, ...plan.target.reviewPause });
    return;
  }

  const definition = plan.target.currentDefinition ?? plan;
  await continueGraphSessionFromAgent({
    sessionId,
    definition,
    returnContinuation: plan.target.currentReturnContinuation,
    currentAgentNode: plan.target.currentAgentNode,
    visitedAgentSessionIds: plan.target.visitedAgentSessionIds,
    currentArrival: plan.target.currentArrival,
    userPrompt: plan.userPrompt,
  });
}

export async function stopGraphSession(sessionId) {
  const currentSession = await getSession(sessionId);
  const activeAgentSessionIds = currentSession?.activeAgentSessionIds ?? [];
  for (const agentSessionId of activeAgentSessionIds) {
    const child = runningProcesses.get(agentSessionId);
    if (child && !child.killed) child.kill("SIGTERM");
    runningProcesses.delete(agentSessionId);
    await recordAgentSessionStatus(sessionId, agentSessionId, { state: "stopped", summary: "Stopped by user." }, "server");
  }
  const session = await updateGraphSession(sessionId, (current) => ({
    ...current,
    status: "stopped",
    activeAgentSessionIds: [],
    pendingReview: null,
    updatedAt: new Date().toISOString(),
  }));
  return session;
}

export async function deleteGraphSession(sessionId) {
  const currentSession = await getSession(sessionId);
  if (!currentSession) return null;
  for (const agentSessionId of currentSession.activeAgentSessionIds) {
    const child = runningProcesses.get(agentSessionId);
    if (child && !child.killed) child.kill("SIGTERM");
    runningProcesses.delete(agentSessionId);
  }
  return deleteStoredGraphSession(sessionId);
}

export async function appendCallbackStatus(sessionId, agentSessionId, payload) {
  return recordAgentSessionStatus(sessionId, agentSessionId, payload, "callback");
}

async function runAgentNode({ session, graphId, graph, agents, results, node, upstreamAgentSessionIds, arrival, userPrompt }) {
  const created = await createAgentSession(session.id, {
    nodeId: node.id,
    graphId,
    agentId: node.agentId,
    previousAgentSessionId: arrival?.previousAgentSessionId ?? null,
    incomingExpressionNodeId: arrival?.incomingExpressionNodeId ?? null,
    incomingEdgeIds: arrival?.incomingEdgeIds ?? [],
    incomingResultId: arrival?.incomingResultId ?? null,
    summary: `Queued ${node.id}.`,
  });
  const agentSession = created.agentSession;
  if (!agentSession) {
    await failSession(session.id, new Error(`Could not create an agent session for node ${node.id}.`));
    return null;
  }

  const agent = agents.find((candidate) => candidate.id === node.agentId);
  if (!agent) {
    await recordAgentSessionStatus(session.id, agentSession.id, {
      state: "failed",
      summary: "Agent node is not linked to an agent spec.",
      detail: `Missing agent spec for node ${node.id}.`,
    }, "server");
    return agentSession.id;
  }

  const runner = runnerForModel(agent.model);
  if (!runner) {
    await recordAgentSessionStatus(session.id, agentSession.id, {
      state: "failed",
      summary: "Agent model is not supported.",
      detail: `No CLI runner is mapped for ${agent.model}.`,
    }, "server");
    return agentSession.id;
  }

  const command = runner === "codex" ? "codex" : "claude";
  const commandAvailable = await commandWorks(command, ["--version"], { timeoutMs: 10_000 });
  if (!commandAvailable) {
    await recordAgentSessionStatus(session.id, agentSession.id, {
      state: "failed",
      summary: `${command} CLI is not available.`,
      detail: `Install and authenticate ${command} before running model ${agent.model}.`,
    }, "server");
    return agentSession.id;
  }

  const statusFilePath = statusFilePathForAgentSession(session.workspacePath, agentSession.id);
  await rm(statusFilePath, { force: true }).catch(() => undefined);

  const prompt = buildAgentPrompt({ session, graph, agents, results, node, agent, agentSession, upstreamAgentSessionIds, statusFilePath, userPrompt });
  await setAgentSessionPrompt(session.id, agentSession.id, prompt);
  await recordAgentSessionStatus(session.id, agentSession.id, { state: "started", summary: `Starting ${agent.name}.` }, "server");

  const args = cliArgsForRunner(runner, agent, session.workspacePath, prompt);
  const result = await runProcess(command, args.args, {
    cwd: session.workspacePath,
    input: args.input,
    timeoutMs: 45 * 60_000,
    onChild: (child) => {
      runningProcesses.set(agentSession.id, child);
    },
    env: {
      RADDUS_GRAPH_SESSION_ID: session.id,
      RADDUS_GRAPH_AGENT_SESSION_ID: agentSession.id,
      RADDUS_GRAPH_NODE_ID: node.id,
      RADDUS_GRAPH_STATUS_URL: statusUrlFor(session.id, agentSession.id),
      RADDUS_GRAPH_STATUS_FILE: statusFilePath,
    },
  });
  runningProcesses.delete(agentSession.id);
  await recordAgentSessionProcessOutput(session.id, agentSession.id, {
    stdout: result.stdout,
    stderr: result.stderr,
  });
  await recordStatusFileCallbacks(session.id, agentSession.id, statusFilePath);
  await rm(statusFilePath, { force: true }).catch(() => undefined);

  let current = await getSession(session.id);
  const latestAgentSession = current?.agentSessions.find((candidate) => candidate.id === agentSession.id) ?? null;
  const existingOutcome = latestAgentSession?.terminalOutcome ?? null;
  if (!existingOutcome) {
    await recordAgentSessionStatus(session.id, agentSession.id, {
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
      await recordAgentSessionStatus(session.id, agentSession.id, {
        state: "failed",
        summary: "Agent changes were not published.",
        detail: error instanceof Error ? error.message : String(error),
      }, "server");
    }
  }

  return agentSession.id;
}

async function continuationPlanForSession(session) {
  const data = await readGraphData();
  const candidates = continuationDefinitionCandidates(data, session);
  let lastError = null;

  for (const candidate of candidates) {
    try {
      const target = continuationTargetForSession({
        session,
        graph: candidate.graph,
        agents: candidate.agents,
        results: candidate.results,
        projectId: candidate.graphId,
        projectName: candidate.projectName,
        projects: candidate.projects,
        lastPlaySelection: candidate.lastPlaySelection,
      });
      return {
        ...candidate,
        target,
        userPrompt: target.userPrompt ?? session.prompt,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("Graph session has no graph definition to continue.");
}

function continuationDefinitionCandidates(data, session) {
  const project = data.projects?.find((candidate) => candidate.id === session.projectId) ?? null;
  const projects = data.projects ?? session.projectsSnapshot ?? [];
  const candidates = [];

  if (project?.graph) {
    candidates.push(graphDefinitionForProject(project, projects));
  }

  if (session.graphSnapshot) {
    candidates.push(graphDefinitionForSession(session, {
      graph: session.graphSnapshot,
      agents: session.agentsSnapshot ?? [],
      results: session.resultsSnapshot ?? [],
      projects: session.projectsSnapshot ?? projects,
    }));
  }

  return candidates;
}

function graphDefinitionForProject(project, projects = []) {
  return {
    graphId: nullableString(project?.id),
    projectName: nullableString(project?.name),
    graph: project?.graph,
    agents: Array.isArray(project?.agents) ? project.agents : [],
    results: Array.isArray(project?.results) ? project.results : [],
    lastPlaySelection: project?.lastPlaySelection ?? null,
    projects: Array.isArray(projects) ? projects : [],
  };
}

function graphDefinitionForSession(session, overrides = {}) {
  const projects = Array.isArray(overrides.projects)
    ? overrides.projects
    : Array.isArray(session?.projectsSnapshot)
      ? session.projectsSnapshot
      : [];
  return {
    graphId: nullableString(overrides.projectId ?? session?.projectId),
    projectName: nullableString(overrides.projectName ?? session?.projectName),
    graph: overrides.graph ?? session?.graphSnapshot,
    agents: Array.isArray(overrides.agents) ? overrides.agents : session?.agentsSnapshot ?? [],
    results: Array.isArray(overrides.results) ? overrides.results : session?.resultsSnapshot ?? [],
    lastPlaySelection: overrides.lastPlaySelection ?? null,
    projects,
  };
}

function graphStartNodeId(definition) {
  const nodes = Array.isArray(definition?.graph?.nodes) ? definition.graph.nodes : [];
  const rememberedPlayNodeId = nullableString(definition?.lastPlaySelection?.playNodeId);
  if (rememberedPlayNodeId && nodes.some((node) => node.id === rememberedPlayNodeId && node.type === "play")) {
    return rememberedPlayNodeId;
  }
  return nodes.find((node) => node.type === "play")?.id ?? null;
}

function graphDefinitionForGraphId(graphId, fallbackDefinition) {
  const id = nullableString(graphId);
  if (!id) return null;
  if (id === nullableString(fallbackDefinition?.graphId)) return fallbackDefinition;
  const projects = Array.isArray(fallbackDefinition?.projects) ? fallbackDefinition.projects : [];
  const project = projects.find((candidate) => candidate.id === id);
  return project?.graph ? graphDefinitionForProject(project, projects) : null;
}

function graphDefinitionForGraphNode(graphNode, fallbackDefinition) {
  const graphId = nullableString(graphNode?.graphId ?? graphNode?.projectId);
  if (!graphId) return fallbackDefinition;
  const definition = graphDefinitionForGraphId(graphId, fallbackDefinition);
  if (!definition) throw new Error(`Graph card ${graphNode.id} points to a graph that is no longer available.`);
  return definition;
}

function graphDefinitionForAgentSession(session, fallbackDefinition, agentSession) {
  const explicitDefinition = graphDefinitionForGraphId(agentSession?.graphId, fallbackDefinition);
  if (explicitDefinition) return explicitDefinition;
  if (fallbackDefinition?.graph?.nodes?.some((node) => node.id === agentSession?.nodeId && node.type === "agent")) {
    return fallbackDefinition;
  }
  const projects = Array.isArray(fallbackDefinition?.projects) ? fallbackDefinition.projects : [];
  const project = projects.find((candidate) => (
    candidate.graph?.nodes?.some((node) => node.id === agentSession?.nodeId && node.type === "agent")
  ));
  return project?.graph ? graphDefinitionForProject(project, projects) : fallbackDefinition;
}

function graphDefinitionForPendingReview(fallbackDefinition, pendingReview) {
  const explicitDefinition = graphDefinitionForGraphId(pendingReview?.graphId, fallbackDefinition);
  if (explicitDefinition) return explicitDefinition;
  if (fallbackDefinition?.graph?.nodes?.some((node) => (
    node.id === pendingReview?.agentNodeId || node.id === pendingReview?.reviewNodeId
  ))) {
    return fallbackDefinition;
  }
  const projects = Array.isArray(fallbackDefinition?.projects) ? fallbackDefinition.projects : [];
  const project = projects.find((candidate) => (
    candidate.graph?.nodes?.some((node) => node.id === pendingReview?.agentNodeId || node.id === pendingReview?.reviewNodeId)
  ));
  return project?.graph ? graphDefinitionForProject(project, projects) : fallbackDefinition;
}

function returnContinuationForAgentSession(session, fallbackDefinition, agentSession, seenAgentSessionIds = new Set()) {
  if (!agentSession?.id || seenAgentSessionIds.has(agentSession.id)) return null;
  seenAgentSessionIds.add(agentSession.id);
  const graphId = nullableString(agentSession.graphId);
  if (!graphId || graphId === nullableString(fallbackDefinition?.graphId)) return null;

  const directReturnContinuation = directReturnContinuationForAgentSession(fallbackDefinition, graphId, agentSession);
  if (directReturnContinuation) return directReturnContinuation;

  const previousAgentSession = session?.agentSessions?.find((candidate) => candidate.id === agentSession.previousAgentSessionId);
  return previousAgentSession
    ? returnContinuationForAgentSession(session, fallbackDefinition, previousAgentSession, seenAgentSessionIds)
    : null;
}

function directReturnContinuationForAgentSession(fallbackDefinition, graphId, agentSession) {
  const incomingEdgeIds = new Set(
    Array.isArray(agentSession?.incomingEdgeIds)
      ? agentSession.incomingEdgeIds.map(stringValue).filter(Boolean)
      : [],
  );
  if (incomingEdgeIds.size === 0) return null;

  for (const definition of graphDefinitionsForContinuation(fallbackDefinition)) {
    const graphNode = graphCardNodeForIncomingGraph(definition, graphId, incomingEdgeIds);
    if (graphNode) return { definition, graphNode, parent: null };
  }
  return null;
}

function graphDefinitionsForContinuation(fallbackDefinition) {
  const definitions = [];
  const seen = new Set();
  function addDefinition(definition) {
    if (!definition?.graph) return;
    const key = nullableString(definition.graphId) ?? `graph:${definitions.length}`;
    if (seen.has(key)) return;
    seen.add(key);
    definitions.push(definition);
  }

  addDefinition(fallbackDefinition);
  const projects = Array.isArray(fallbackDefinition?.projects) ? fallbackDefinition.projects : [];
  for (const project of projects) addDefinition(graphDefinitionForProject(project, projects));
  return definitions;
}

function graphCardNodeForIncomingGraph(definition, graphId, incomingEdgeIds) {
  const graph = definition?.graph;
  if (!graph) return null;
  for (const edgeId of incomingEdgeIds) {
    const edge = graph.edges.find((candidate) => (
      candidate.id === edgeId && (candidate.type === "runs" || candidate.type === "routes")
    ));
    if (!edge) continue;
    const node = graph.nodes.find((candidate) => candidate.id === edge.target && candidate.type === "graph");
    if (nullableString(node?.graphId) === graphId) return node;
  }
  return null;
}

export function continuationTargetForSession({
  session,
  graph,
  agents = [],
  results = [],
  projectId = session?.projectId ?? null,
  projectName = session?.projectName ?? null,
  projects = session?.projectsSnapshot ?? [],
  lastPlaySelection = null,
}) {
  const fallbackDefinition = graphDefinitionForSession(session, {
    graph,
    agents,
    results,
    projectId,
    projectName,
    projects,
    lastPlaySelection,
  });
  const orderedSessions = orderedAgentSessionsForRuntime(session);
  if (orderedSessions.length === 0) {
    const startRoute = firstAgentRouteForStart(fallbackDefinition, session.playNodeId);
    if (!startRoute) throw new Error("No agent node or graph card is connected to this session's play node.");
    return {
      currentDefinition: startRoute.definition,
      currentReturnContinuation: startRoute.returnContinuation,
      currentAgentNode: startRoute.node,
      currentArrival: startRoute.arrival,
      visitedAgentSessionIds: [],
      reviewPause: null,
      userPrompt: session.prompt,
    };
  }

  const lastAgentSession = orderedSessions.at(-1);
  const currentDefinition = graphDefinitionForAgentSession(session, fallbackDefinition, lastAgentSession);
  const currentReturnContinuation = returnContinuationForAgentSession(session, fallbackDefinition, lastAgentSession);
  const lastAgentNode = currentDefinition.graph.nodes.find((candidate) => candidate.id === lastAgentSession.nodeId && candidate.type === "agent");
  if (!lastAgentNode) throw new Error("The last agent node is no longer available in this graph.");

  const lastOutcome = lastAgentSession.terminalOutcome;
  if (!lastOutcome || lastOutcome.state === "stopped" || lastAgentSession.status === "stopped") {
    return {
      currentDefinition,
      currentReturnContinuation,
      currentAgentNode: lastAgentNode,
      currentArrival: arrivalForAgentSession(lastAgentSession),
      visitedAgentSessionIds: orderedSessions.slice(0, -1).map((agentSession) => agentSession.id),
      reviewPause: null,
      userPrompt: userPromptForAgentRerun(session, currentDefinition, lastAgentSession),
    };
  }

  const nextRoute = nextGraphRouteFromOutcome({ graph: currentDefinition.graph, currentAgentNode: lastAgentNode, outcome: lastOutcome });
  const visitedAgentSessionIds = orderedSessions.map((agentSession) => agentSession.id);
  const fallbackUserPrompt = userPromptForAgentRerun(session, currentDefinition, lastAgentSession);
  if (!nextRoute) {
    const completedGraphRoute = nextAgentRouteAfterGraphCompletion({
      returnContinuation: currentReturnContinuation,
      previousAgentSession: lastAgentSession,
      fallbackUserPrompt,
    });
    if (!completedGraphRoute) throw new Error("No next agent, graph, or review card is connected to continue from the last result.");
    return {
      currentDefinition: completedGraphRoute.definition,
      currentReturnContinuation: completedGraphRoute.returnContinuation,
      currentAgentNode: completedGraphRoute.node,
      currentArrival: completedGraphRoute.arrival,
      visitedAgentSessionIds,
      reviewPause: null,
      userPrompt: completedGraphRoute.userPrompt ?? fallbackUserPrompt,
    };
  }

  if (nextRoute.node.type === "review") {
    return {
      currentDefinition,
      currentReturnContinuation,
      currentAgentNode: null,
      currentArrival: null,
      visitedAgentSessionIds,
      reviewPause: {
        definition: currentDefinition,
        reviewNode: nextRoute.node,
        agentNode: lastAgentNode,
        agentSession: lastAgentSession,
        route: nextRoute,
        upstreamAgentSessionIds: visitedAgentSessionIds,
      },
      userPrompt: fallbackUserPrompt,
    };
  }

  const nextAgentRoute = nextAgentRouteFromGraphRoute({
    definition: currentDefinition,
    returnContinuation: currentReturnContinuation,
    route: nextRoute,
    previousAgentSession: lastAgentSession,
    fallbackUserPrompt,
  });

  return {
    currentDefinition: nextAgentRoute?.definition ?? currentDefinition,
    currentReturnContinuation: nextAgentRoute?.returnContinuation ?? currentReturnContinuation,
    currentAgentNode: nextAgentRoute?.node ?? null,
    currentArrival: nextAgentRoute?.arrival ?? null,
    visitedAgentSessionIds,
    reviewPause: null,
    userPrompt: nextAgentRoute?.userPrompt ?? fallbackUserPrompt,
  };
}

export function buildAgentPrompt({ session, graph, agents, results, node, agent, agentSession, upstreamAgentSessionIds, userPrompt }) {
  const availableResults = availableResultsForAgent({ graph, results, node });

  return [
    "# Agent Session",
    "",
    "## Repository",
    repositorySection(session),
    "",
    "## Behavior",
    behaviorSection(agent),
    "",
    "## Updates And Session Result",
    updatesSection(availableResults),
    "",
    "## History",
    historySection({ session, graph, agents, upstreamAgentSessionIds }),
    "",
    "## User Context",
    markdownFence(userPrompt ?? session.prompt, "md"),
  ].join("\n");
}

export function availableResultsForAgent({ graph, results, node }) {
  const graphNodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const graphEdges = Array.isArray(graph?.edges) ? graph.edges : [];
  const resultDefinitions = Array.isArray(results) ? results : [];
  const evaluatedExpressionNodeIds = new Set(
    graphEdges
      .filter((edge) => edge.source === node?.id && edge.type === "evaluates")
      .flatMap((edge) => {
        const expressionNode = graphNodes.find((candidate) => candidate.id === edge.target && candidate.type === "expression");
        return expressionNode ? [expressionNode.id] : [];
      }),
  );
  const reachableResultIds = new Set(
    graphEdges
      .filter((edge) => edge.type === "routes" && evaluatedExpressionNodeIds.has(edge.source))
      .flatMap((edge) => {
        const routeTarget = graphNodes.find((candidate) => (
          candidate.id === edge.target && (candidate.type === "agent" || candidate.type === "review" || candidate.type === "graph")
        ));
        return edge.resultId && routeTarget && !nonCompletionResultIds.has(edge.resultId) ? [edge.resultId] : [];
      }),
  );

  return resultDefinitions
    .filter((result) => reachableResultIds.has(result.id) && !nonCompletionResultIds.has(result.id))
    .map((result) => ({
      id: result.id,
      description: result.description,
    }));
}

export function agentSessionTranscriptOutput(agentSession) {
  const outcome = agentSession?.terminalOutcome ?? null;
  return stringValue(agentSession?.response) ||
    stringValue(agentSession?.stdout) ||
    stringValue(outcome?.detail) ||
    stringValue(outcome?.summary);
}

function repositorySection(session) {
  const repository = session.repository?.nameWithOwner ? session.repository.nameWithOwner : "None selected";
  const branch = session.repository?.branch || session.branchName;
  return `Repo: ${branch ? `${repository} @ ${branch}` : repository}\nCwd: current agent session workspace.`;
}

function behaviorSection(agent) {
  const instructions = stringValue(agent.systemPrompt) || `You are ${agent.name}.`;
  return [
    markdownFence(instructions, "md"),
    "Use History as concise handoff context. Keep scope tight, avoid repeat work, and put downstream handoff details in terminal `detail`.",
  ].join("\n");
}

function updatesSection(availableResults) {
  const completedResultId = availableResults[0]?.id ?? "completed";
  return [
    'Write compact JSONL to `$RADDUS_GRAPH_STATUS_FILE`. Progress is optional: {"state":"working","summary":"Short update.","detail":"Optional detail."}',
    `Before exit, append exactly one terminal object: {"state":"completed","resultId":"${completedResultId}","summary":"Short result.","detail":"Downstream handoff."} or {"state":"failed","summary":"Short failure.","detail":"Blocker or next step."}`,
    "Failed terminal results omit `resultId`. Review pauses put the exact user question in `detail`.",
    resultListSection(availableResults),
  ].join("\n");
}

function resultListSection(availableResults) {
  if (availableResults.length === 0) {
    return "Success routes: use `completed` or omit `resultId`.";
  }
  return `Success routes: ${availableResults.map((result) => {
    const description = compactSingleLine(result.description, maxPromptResultDescriptionChars);
    return description ? `\`${result.id}\` (${description})` : `\`${result.id}\``;
  }).join("; ")}`;
}

function historySection({ session, graph, agents, upstreamAgentSessionIds }) {
  const historyAgentSessionIds = upstreamAgentSessionIds.slice(-maxPromptHistoryEntries);
  const omittedCount = upstreamAgentSessionIds.length - historyAgentSessionIds.length;
  const sections = historyAgentSessionIds.flatMap((agentSessionId, index) => {
    const upstreamAgentSession = session.agentSessions.find((candidate) => candidate.id === agentSessionId);
    if (!upstreamAgentSession) return [];
    const upstreamNode = graph.nodes.find((candidate) => candidate.id === upstreamAgentSession.nodeId);
    const upstreamAgent = upstreamAgentSession.agentId ? agents.find((candidate) => candidate.id === upstreamAgentSession.agentId) : null;
    const outcome = upstreamAgentSession.terminalOutcome ?? null;
    const agentName = upstreamAgent?.name || upstreamNode?.id || `Agent Session ${omittedCount + index + 1}`;
    const summary = compactSingleLine(outcome?.summary, maxPromptHistorySummaryChars);
    const handoff = compactText(agentSessionHandoffOutput(upstreamAgentSession), maxPromptHistoryHandoffChars);
    const includeHandoff = handoff && handoff !== summary;
    return [[
      `### ${omittedCount + index + 1}. ${agentName}`,
      `Result: ${historyResultLabel(outcome, upstreamAgentSession.status)}${summary ? ` - ${summary}` : ""}`,
      includeHandoff ? markdownFence(handoff, "md") : null,
    ].filter(Boolean).join("\n")];
  });

  if (omittedCount > 0) {
    sections.unshift(`${omittedCount} earlier agent session${omittedCount === 1 ? "" : "s"} omitted; rely on repository state plus recent handoffs.`);
  }

  return sections.length > 0 ? sections.join("\n\n") : "No prior agent handoff.";
}

function historyResultLabel(outcome, fallbackStatus) {
  if (!outcome) return fallbackStatus || "unavailable";
  const resultId = outcome.emittedResultId || outcome.routedResultId;
  return resultId ? `${outcome.state} / ${resultId}` : outcome.state;
}

function agentSessionHandoffOutput(agentSession) {
  const outcome = agentSession?.terminalOutcome ?? null;
  return stringValue(outcome?.detail) ||
    stringValue(outcome?.summary) ||
    agentSessionTranscriptOutput(agentSession);
}

function compactText(value, maxChars) {
  const text = String(value ?? "")
    .trim()
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n");
  if (!text || text.length <= maxChars) return text;
  const clippedLength = Math.max(0, maxChars - 28);
  const clipped = text.slice(0, clippedLength).trimEnd();
  return `${clipped}\n\n[truncated ${text.length - clipped.length} chars]`;
}

function compactSingleLine(value, maxChars) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!text || text.length <= maxChars) return text;
  const clippedLength = Math.max(0, maxChars - 15);
  return `${text.slice(0, clippedLength).trimEnd()}... [truncated]`;
}

function markdownFence(value, language = "") {
  const text = String(value ?? "").trim();
  const fence = "`".repeat(Math.max(3, longestBacktickRun(text) + 1));
  return `${fence}${language}\n${text}\n${fence}`;
}

function longestBacktickRun(text) {
  return Math.max(0, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
}

async function recordStatusFileCallbacks(sessionId, agentSessionId, statusFilePath) {
  const current = await getSession(sessionId);
  const agentSession = current?.agentSessions.find((candidate) => candidate.id === agentSessionId) ?? null;
  if (!agentSession || agentSession.terminalOutcome) return;

  const { payloads, errors } = await readStatusPayloadsFromFile(statusFilePath);
  if (errors.length > 0) {
    await recordAgentSessionStatus(sessionId, agentSessionId, {
      state: "working",
      summary: "Some local status file entries could not be parsed.",
      detail: errors.slice(0, 5).join("\n"),
    }, "file");
  }

  for (const payload of statusPayloadsUntilTerminal(payloads)) {
    const latest = await getSession(sessionId);
    const latestAgentSession = latest?.agentSessions.find((candidate) => candidate.id === agentSessionId) ?? null;
    if (latestAgentSession?.terminalOutcome) return;
    await recordAgentSessionStatus(sessionId, agentSessionId, payload, "file");
  }
}

async function readStatusPayloadsFromFile(statusFilePath) {
  try {
    return statusPayloadsFromText(await readFile(statusFilePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return { payloads: [], errors: [] };
    return {
      payloads: [],
      errors: [`Could not read local status file: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

export function statusPayloadsFromText(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return { payloads: [], errors: [] };

  const parsedWhole = parseJsonValue(trimmed);
  if (parsedWhole.ok) return statusPayloadsFromValue(parsedWhole.value, "status file");

  const payloads = [];
  const errors = [];
  for (const [index, line] of trimmed.split(/\r?\n/).entries()) {
    const lineText = line.trim();
    if (!lineText) continue;
    const parsedLine = parseJsonValue(lineText);
    if (!parsedLine.ok) {
      errors.push(`Line ${index + 1} is not valid JSON.`);
      continue;
    }
    const linePayloads = statusPayloadsFromValue(parsedLine.value, `line ${index + 1}`);
    payloads.push(...linePayloads.payloads);
    errors.push(...linePayloads.errors);
  }
  return { payloads, errors };
}

function statusPayloadsFromValue(value, label) {
  const errors = [];
  if (isObjectRecord(value)) return { payloads: [value], errors };
  if (!Array.isArray(value)) {
    return { payloads: [], errors: [`${label} must be a JSON object or an array of objects.`] };
  }
  const payloads = [];
  value.forEach((item, index) => {
    if (isObjectRecord(item)) payloads.push(item);
    else errors.push(`${label}[${index}] must be a JSON object.`);
  });
  return { payloads, errors };
}

function statusPayloadsUntilTerminal(payloads) {
  const selected = [];
  for (const payload of payloads) {
    selected.push(payload);
    if (isTerminalStatusPayload(payload)) break;
  }
  return selected;
}

function isTerminalStatusPayload(payload) {
  const state = stringValue(asRecord(payload).state);
  return state === "completed" || state === "failed" || state === "stopped";
}

function parseJsonValue(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, value: null };
  }
}

function statusFilePathForAgentSession(workspacePath, agentSessionId) {
  return join(workspacePath, `.raddus-graph-status-${agentSessionId}.jsonl`);
}

export function cliArgsForRunner(runner, agent, workspacePath, prompt) {
  if (runner === "codex") {
    const args = [
      "exec",
      "--model",
      agent.model,
    ];
    if (agent.modelReasoningEffort) {
      args.push("-c", `model_reasoning_effort="${agent.modelReasoningEffort}"`);
    }
    args.push(
      "--cd",
      workspacePath,
      "--approve-for-me",
      "--skip-git-repo-check",
      "-",
    );
    return {
      args,
      input: prompt,
    };
  }

  return {
    args: ["-p", prompt, "--model", agent.model],
    input: undefined,
  };
}

function firstAgentRouteForStart(definition, startNodeId, visitedStartNodeIds = new Set(), prefixEdgeIds = [], returnContinuation = null) {
  const graph = definition?.graph;
  if (!graph) return null;
  const sourceNodeId = stringValue(startNodeId);
  if (!sourceNodeId) return null;
  const visitKey = `${nullableString(definition.graphId) ?? "__session"}:${sourceNodeId}`;
  if (visitedStartNodeIds.has(visitKey)) return null;
  const edge = graph.edges.find((candidate) => candidate.source === sourceNodeId && candidate.type === "runs");
  if (!edge) return null;
  const targetNode = graph.nodes.find((node) => node.id === edge.target);
  const edgeIds = [...prefixEdgeIds, edge.id];
  if (targetNode?.type === "agent") {
    return {
      definition,
      returnContinuation,
      node: targetNode,
      edgeIds,
      arrival: prefixEdgeIds.length > 0 || visitedStartNodeIds.size > 0 ? {
        previousAgentSessionId: null,
        incomingExpressionNodeId: null,
        incomingEdgeIds: edgeIds,
        incomingResultId: null,
      } : null,
    };
  }
  if (targetNode?.type !== "graph") return null;
  const nextVisitedStartNodeIds = new Set([...visitedStartNodeIds, visitKey]);
  const nextDefinition = graphDefinitionForGraphNode(targetNode, definition);
  const targetGraphId = nullableString(targetNode.graphId);
  const nextStartNodeId = targetGraphId ? graphStartNodeId(nextDefinition) : targetNode.id;
  if (!nextStartNodeId) throw new Error(`Graph card ${targetNode.id} points to a graph without a play node.`);
  const nextReturnContinuation = targetGraphId
    ? { definition, graphNode: targetNode, parent: returnContinuation }
    : returnContinuation;
  return firstAgentRouteForStart(nextDefinition, nextStartNodeId, nextVisitedStartNodeIds, edgeIds, nextReturnContinuation);
}

function nextAgentRouteFromGraphRoute({ definition, returnContinuation, route, previousAgentSession, fallbackUserPrompt }) {
  if (!route) return null;
  if (!previousAgentSession?.id) throw new Error("Cannot route from a graph card without a completed parent agent session.");
  if (route.node.type === "agent") {
    return {
      definition,
      returnContinuation,
      node: route.node,
      arrival: arrivalForGraphRoute(route, previousAgentSession.id),
      userPrompt: fallbackUserPrompt,
    };
  }
  if (route.node.type !== "graph") return null;
  const graphStartRoute = agentRouteFromGraphNode({
    definition,
    returnContinuation,
    graphNode: route.node,
  });
  if (!graphStartRoute) throw new Error(`Graph card ${route.node.id} is not connected to an agent node.`);
  return {
    definition: graphStartRoute.definition,
    returnContinuation: graphStartRoute.returnContinuation,
    node: graphStartRoute.node,
    arrival: arrivalForGraphRoute(route, previousAgentSession.id, graphStartRoute.edgeIds),
    userPrompt: graphPromptFromAgentSession(previousAgentSession) || fallbackUserPrompt,
  };
}

function nextAgentRouteAfterGraphCompletion({ returnContinuation, previousAgentSession, fallbackUserPrompt }) {
  if (!returnContinuation || !previousAgentSession?.id) return null;
  const route = nextRunRouteFromCompletedGraphCard(returnContinuation);
  if (!route) {
    return nextAgentRouteAfterGraphCompletion({
      returnContinuation: returnContinuation.parent,
      previousAgentSession,
      fallbackUserPrompt,
    });
  }

  const userPrompt = graphPromptFromAgentSession(previousAgentSession) || fallbackUserPrompt;
  if (route.node.type === "agent") {
    return {
      definition: returnContinuation.definition,
      returnContinuation: returnContinuation.parent,
      node: route.node,
      arrival: {
        previousAgentSessionId: previousAgentSession.id,
        incomingExpressionNodeId: null,
        incomingEdgeIds: route.edgeIds,
        incomingResultId: null,
      },
      userPrompt,
    };
  }

  const graphStartRoute = agentRouteFromGraphNode({
    definition: returnContinuation.definition,
    returnContinuation: returnContinuation.parent,
    graphNode: route.node,
  });
  if (!graphStartRoute) throw new Error(`Graph card ${route.node.id} is not connected to an agent node.`);
  return {
    definition: graphStartRoute.definition,
    returnContinuation: graphStartRoute.returnContinuation,
    node: graphStartRoute.node,
    arrival: {
      previousAgentSessionId: previousAgentSession.id,
      incomingExpressionNodeId: null,
      incomingEdgeIds: [...route.edgeIds, ...graphStartRoute.edgeIds],
      incomingResultId: null,
    },
    userPrompt,
  };
}

function nextRunRouteFromCompletedGraphCard(returnContinuation) {
  const graph = returnContinuation?.definition?.graph;
  const graphNodeId = returnContinuation?.graphNode?.id;
  if (!graph || !graphNodeId) return null;
  const edge = graph.edges.find((candidate) => candidate.source === graphNodeId && candidate.type === "runs");
  if (!edge) return null;
  const node = graph.nodes.find((candidate) => (
    candidate.id === edge.target && (candidate.type === "agent" || candidate.type === "graph")
  ));
  if (!node) return null;
  return { node, edgeIds: [edge.id] };
}

function agentRouteFromGraphNode({ definition, returnContinuation, graphNode }) {
  const nextDefinition = graphDefinitionForGraphNode(graphNode, definition);
  const targetGraphId = nullableString(graphNode.graphId);
  const nextStartNodeId = targetGraphId ? graphStartNodeId(nextDefinition) : graphNode.id;
  if (!nextStartNodeId) throw new Error(`Graph card ${graphNode.id} points to a graph without a play node.`);
  const nextReturnContinuation = targetGraphId
    ? { definition, graphNode, parent: returnContinuation ?? null }
    : returnContinuation ?? null;
  return firstAgentRouteForStart(nextDefinition, nextStartNodeId, new Set(), [], nextReturnContinuation);
}

function arrivalForGraphRoute(route, previousAgentSessionId, extraEdgeIds = []) {
  return {
    previousAgentSessionId,
    incomingExpressionNodeId: route.expressionNodeId,
    incomingEdgeIds: [...route.edgeIds, ...extraEdgeIds],
    incomingResultId: route.resultId,
  };
}

function userPromptForAgentRerun(session, definition, agentSession) {
  const graphPrompt = inheritedGraphPromptForAgentSession(session, definition, agentSession);
  if (graphPrompt) return graphPrompt;
  return session.prompt;
}

function inheritedGraphPromptForAgentSession(session, definition, agentSession, seenAgentSessionIds = new Set()) {
  if (!agentSession?.id || seenAgentSessionIds.has(agentSession.id)) return null;
  seenAgentSessionIds.add(agentSession.id);
  const incomingEdges = Array.isArray(agentSession?.incomingEdgeIds) ? agentSession.incomingEdgeIds : [];
  const enteredFromGraphCard = incomingEdges.some((edgeId) => {
    const edge = definition?.graph?.edges?.find((candidate) => candidate.id === edgeId && candidate.type === "runs");
    const source = edge ? definition.graph.nodes.find((node) => node.id === edge.source) : null;
    return source?.type === "graph";
  });
  if (!agentSession.previousAgentSessionId) return null;
  const parentAgentSession = session.agentSessions.find((candidate) => candidate.id === agentSession.previousAgentSessionId);
  const movedBetweenGraphs = nullableString(agentSession.graphId) &&
    nullableString(agentSession.graphId) !== nullableString(parentAgentSession?.graphId);
  if (enteredFromGraphCard) return graphPromptFromAgentSession(parentAgentSession);
  if (movedBetweenGraphs) return graphPromptFromAgentSession(parentAgentSession);
  const parentDefinition = graphDefinitionForAgentSession(session, definition, parentAgentSession);
  return inheritedGraphPromptForAgentSession(session, parentDefinition, parentAgentSession, seenAgentSessionIds);
}

function graphPromptFromAgentSession(agentSession) {
  return agentSessionHandoffOutput(agentSession);
}

export function nextGraphRouteFromOutcome({ graph, currentAgentNode, outcome }) {
  const routedResultId = outcome.routedResultId;
  if (!routedResultId || outcome.state === "stopped") return null;

  const expressionEntries = graph.edges
    .filter((edge) => edge.source === currentAgentNode.id && edge.type === "evaluates")
    .flatMap((edge) => {
      const node = graph.nodes.find((candidate) => candidate.id === edge.target && candidate.type === "expression");
      return node ? [{ edge, node }] : [];
    });
  if (expressionEntries.length === 0) return null;

  const matchingRoute = routeForResult(graph, expressionEntries, routedResultId);
  const defaultRoute = routedResultId !== "default" ? routeForResult(graph, expressionEntries, "default") : null;
  return matchingRoute ?? defaultRoute;
}

function routeForResult(graph, expressionEntries, resultId) {
  for (const routeEdge of graph.edges) {
    if (routeEdge.type !== "routes" || routeEdge.resultId !== resultId) continue;
    const expressionEntry = expressionEntries.find((entry) => entry.node.id === routeEdge.source);
    if (!expressionEntry) continue;
    const node = graph.nodes.find((candidate) => (
      candidate.id === routeEdge.target && (candidate.type === "agent" || candidate.type === "review" || candidate.type === "graph")
    ));
    if (!node) continue;
    return {
      node,
      expressionNodeId: expressionEntry.node.id,
      edgeIds: [expressionEntry.edge.id, routeEdge.id],
      resultId: routeEdge.resultId ?? resultId,
    };
  }
  return null;
}

function orderedAgentSessionsForRuntime(session) {
  const agentSessions = Array.isArray(session?.agentSessions) ? session.agentSessions : [];
  return [...agentSessions].sort((a, b) => {
    const sequenceComparison = numberValue(a?.sequence, 0) - numberValue(b?.sequence, 0);
    return sequenceComparison || stringValue(a?.startedAt).localeCompare(stringValue(b?.startedAt));
  });
}

function arrivalForAgentSession(agentSession) {
  return {
    previousAgentSessionId: nullableString(agentSession?.previousAgentSessionId),
    incomingExpressionNodeId: nullableString(agentSession?.incomingExpressionNodeId),
    incomingEdgeIds: Array.isArray(agentSession?.incomingEdgeIds) ? agentSession.incomingEdgeIds.map(stringValue).filter(Boolean) : [],
    incomingResultId: nullableString(agentSession?.incomingResultId),
  };
}

async function pauseSessionForReview({ sessionId, definition, reviewNode, agentNode, agentSession, route, upstreamAgentSessionIds }) {
  if (!agentSession?.id) throw new Error("Cannot pause for review without a completed agent session.");
  const now = new Date().toISOString();
  await updateGraphSession(sessionId, (current) => ({
    ...current,
    status: "waiting_review",
    activeAgentSessionIds: [],
    pendingReview: {
      id: `pending-review-${globalThis.crypto.randomUUID().slice(0, 8)}`,
      graphSessionId: sessionId,
      graphId: nullableString(definition?.graphId),
      reviewNodeId: reviewNode.id,
      agentNodeId: agentNode.id,
      previousAgentSessionId: agentSession.id,
      incomingExpressionNodeId: route.expressionNodeId,
      incomingEdgeIds: route.edgeIds,
      incomingResultId: route.resultId,
      upstreamAgentSessionIds,
      question: reviewQuestionFromAgentSession(agentSession),
      createdAt: now,
    },
    error: null,
    updatedAt: now,
  }));
}

export function reviewQuestionFromAgentSession(agentSession) {
  const outcome = agentSession?.terminalOutcome ?? null;
  return stringValue(outcome?.detail) ||
    stringValue(outcome?.summary) ||
    stringValue(agentSession?.response) ||
    stringValue(agentSession?.stdout) ||
    "Review requested.";
}

async function getSession(sessionId) {
  const data = await readGraphData();
  return data.sessions.find((session) => session.id === sessionId) ?? null;
}

async function completeSession(sessionId, summary) {
  await updateGraphSession(sessionId, (current) => ({
    ...current,
    status: current.status === "stopped" ? "stopped" : "completed",
    activeAgentSessionIds: [],
    pendingReview: null,
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
    activeAgentSessionIds: [],
    pendingReview: null,
    error: message,
    updatedAt: new Date().toISOString(),
  }));
}

function statusUrlFor(sessionId, agentSessionId) {
  return `${graphServerOrigin}/api/graph/sessions/${encodeURIComponent(sessionId)}/agent-sessions/${encodeURIComponent(agentSessionId)}/status`;
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function isObjectRecord(value) {
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
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function textValue(value) {
  return typeof value === "string" ? value.trim() : "";
}
