import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { cloneRepository, publishSessionChanges } from "./github.mjs";
import {
  addGraphSession,
  createAgentSession,
  deleteGraphSession as deleteStoredGraphSession,
  readGraphData,
  recordAgentSessionProcessOutput,
  recordAgentSessionStatus,
  reservedResultIds,
  sessionRootFor,
  setAgentSessionPrompt,
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
    activeAgentSessionIds: [],
    projectId: project?.id ?? null,
    projectName: project?.name ?? null,
    graphSnapshot: graph,
    agentsSnapshot: state.agents,
    resultsSnapshot: state.results,
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

  let currentAgentNode = firstAgentNodeForPlay(graph, session.playNodeId);
  if (!currentAgentNode) {
    await completeSession(sessionId, "No agent node is connected to the play node.");
    return;
  }

  await continueGraphSessionFromAgent({
    sessionId,
    graph,
    agents,
    results,
    currentAgentNode,
    visitedAgentSessionIds: [],
    currentArrival: null,
    userPrompt: session.prompt,
  });
}

async function continueGraphSessionFromAgent({
  sessionId,
  graph,
  agents,
  results,
  currentAgentNode,
  visitedAgentSessionIds,
  currentArrival,
  userPrompt,
}) {
  visitedAgentSessionIds = [...visitedAgentSessionIds];
  let step = 0;
  for (; step < 50 && currentAgentNode; step += 1) {
    const session = await getSession(sessionId);
    if (!session || session.status === "stopped") return;

    const agentSessionId = await runAgentNode({
      session,
      graph,
      agents,
      results,
      node: currentAgentNode,
      upstreamAgentSessionIds: visitedAgentSessionIds,
      arrival: currentArrival,
      userPrompt,
    });
    userPrompt = session.prompt;
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

    const nextRoute = nextGraphRouteFromOutcome({ graph, currentAgentNode, outcome });
    if (nextRoute?.node.type === "review") {
      await pauseSessionForReview({
        sessionId,
        reviewNode: nextRoute.node,
        agentNode: currentAgentNode,
        agentSession: currentExecution,
        route: nextRoute,
        upstreamAgentSessionIds: visitedAgentSessionIds,
      });
      return;
    }
    currentAgentNode = nextRoute?.node.type === "agent" ? nextRoute.node : null;
    currentArrival = nextRoute ? {
      previousAgentSessionId: agentSessionId,
      incomingExpressionNodeId: nextRoute.expressionNodeId,
      incomingEdgeIds: nextRoute.edgeIds,
      incomingResultId: nextRoute.resultId,
    } : null;
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

async function continueGraphSessionFromReview(sessionId, pendingReview, answer) {
  let session = await getSession(sessionId);
  if (!session) throw new Error(`Graph session not found: ${sessionId}`);
  const graph = session.graphSnapshot;
  const agents = session.agentsSnapshot ?? [];
  const results = session.resultsSnapshot ?? [];
  if (!graph) throw new Error("Graph session is missing its graph snapshot.");
  const agentNode = graph.nodes.find((node) => node.id === pendingReview.agentNodeId && node.type === "agent");
  if (!agentNode) throw new Error("The review response target agent is no longer available.");

  await continueGraphSessionFromAgent({
    sessionId,
    graph,
    agents,
    results,
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

async function runAgentNode({ session, graph, agents, results, node, upstreamAgentSessionIds, arrival }) {
  const created = await createAgentSession(session.id, {
    nodeId: node.id,
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

export function buildAgentPrompt({ session, graph, agents, results, node, agent, agentSession, upstreamAgentSessionIds, userPrompt }) {
  const availableResults = results.filter((result) => !reservedResultIds.has(result.id)).map((result) => ({
    id: result.id,
    description: result.description,
  }));

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

export function agentSessionTranscriptOutput(agentSession) {
  const outcome = agentSession?.terminalOutcome ?? null;
  return stringValue(agentSession?.response) ||
    stringValue(agentSession?.stdout) ||
    stringValue(outcome?.detail) ||
    stringValue(outcome?.summary);
}

function repositorySection(session) {
  const repository = session.repository?.nameWithOwner ? session.repository.nameWithOwner : "None selected";
  const branch = session.repository?.branch || session.branchName || "None selected";
  return [
    `Repository: ${repository}`,
    `Branch: ${branch}`,
    "Work from the current working directory for this agent session.",
  ].join("\n");
}

function behaviorSection(agent) {
  const instructions = stringValue(agent.systemPrompt) || `You are ${agent.name}.`;
  return [
    markdownFence(instructions, "md"),
    "",
    "- Use the History section as context from earlier agent sessions in this graph session.",
    "- Do not repeat completed work unless it is needed to finish the current task.",
    "- Keep changes scoped to the user context and the repository state in front of you.",
    "- When your work is useful to later agent sessions, put the handoff details in your terminal result detail and final response.",
    "- If you are blocked, post a failed terminal result that explains the blocker and what is needed next.",
  ].join("\n");
}

function updatesSection(availableResults) {
  const completedResultId = availableResults[0]?.id ?? "replace-with-result-id";
  return [
    "Append progress and terminal results as one compact JSON object per line to `$RADDUS_GRAPH_STATUS_FILE`.",
    "Do not write Markdown, comments, or pretty-printed JSON to that file.",
    "",
    "Progress update example:",
    markdownFence('{"state":"working","summary":"Short update.","detail":"Optional detail."}', "json"),
    "",
    "Terminal success example:",
    markdownFence(`{"state":"completed","resultId":"${completedResultId}","summary":"Short result.","detail":"What downstream agents need to know."}`, "json"),
    "",
    "Terminal failure example:",
    markdownFence('{"state":"failed","summary":"Short failure.","detail":"Why it failed and what is needed next."}', "json"),
    "",
    "Before your CLI session finishes, append exactly one terminal result with `state` set to `completed` or `failed`.",
    "If that terminal result is meant to pause for user review, put the exact question you want answered in `detail`.",
    "When `state` is `completed`, use one of these result IDs:",
    resultListSection(availableResults),
  ].join("\n");
}

function resultListSection(availableResults) {
  if (availableResults.length === 0) {
    return "- No custom completed result IDs are defined. If you complete successfully, omit `resultId`; the graph will route through `unknown`.";
  }
  return availableResults.map((result) => `- \`${result.id}\`: ${result.description || "No description."}`).join("\n");
}

function historySection({ session, graph, agents, upstreamAgentSessionIds }) {
  const sections = upstreamAgentSessionIds.flatMap((agentSessionId, index) => {
    const upstreamAgentSession = session.agentSessions.find((candidate) => candidate.id === agentSessionId);
    if (!upstreamAgentSession) return [];
    const upstreamNode = graph.nodes.find((candidate) => candidate.id === upstreamAgentSession.nodeId);
    const upstreamAgent = upstreamAgentSession.agentId ? agents.find((candidate) => candidate.id === upstreamAgentSession.agentId) : null;
    const outcome = upstreamAgentSession.terminalOutcome ?? null;
    const agentName = upstreamAgent?.name || upstreamNode?.id || `Agent Session ${index + 1}`;
    return [[
      `### ${index + 1}. ${agentName}`,
      `Result: ${historyResultLabel(outcome, upstreamAgentSession.status)}`,
      outcome?.summary ? `Summary: ${outcome.summary}` : null,
      "",
      markdownFence(agentSessionTranscriptOutput(upstreamAgentSession) || "No output captured.", "md"),
    ].filter(Boolean).join("\n")];
  });

  return sections.length > 0 ? sections.join("\n\n") : "No prior agent session output.";
}

function historyResultLabel(outcome, fallbackStatus) {
  if (!outcome) return fallbackStatus || "unknown";
  const resultId = outcome.emittedResultId || outcome.routedResultId;
  return resultId ? `${outcome.state} / ${resultId}` : outcome.state;
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

function firstAgentNodeForPlay(graph, playNodeId) {
  const edge = graph.edges.find((candidate) => candidate.source === playNodeId && candidate.type === "runs");
  return edge ? graph.nodes.find((node) => node.id === edge.target && node.type === "agent") ?? null : null;
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
  const fallbackRoute = routedResultId !== "unknown" ? routeForResult(graph, expressionEntries, "fallback") : null;
  return matchingRoute ?? fallbackRoute;
}

function routeForResult(graph, expressionEntries, resultId) {
  for (const routeEdge of graph.edges) {
    if (routeEdge.type !== "routes" || routeEdge.resultId !== resultId) continue;
    const expressionEntry = expressionEntries.find((entry) => entry.node.id === routeEdge.source);
    if (!expressionEntry) continue;
    const node = graph.nodes.find((candidate) => (
      candidate.id === routeEdge.target && (candidate.type === "agent" || candidate.type === "review")
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

async function pauseSessionForReview({ sessionId, reviewNode, agentNode, agentSession, route, upstreamAgentSessionIds }) {
  if (!agentSession?.id) throw new Error("Cannot pause for review without a completed agent session.");
  const now = new Date().toISOString();
  await updateGraphSession(sessionId, (current) => ({
    ...current,
    status: "waiting_review",
    activeAgentSessionIds: [],
    pendingReview: {
      id: `pending-review-${globalThis.crypto.randomUUID().slice(0, 8)}`,
      graphSessionId: sessionId,
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

function textValue(value) {
  return typeof value === "string" ? value.trim() : "";
}
