import React from "react";
import { createPortal } from "react-dom";
import {
  Bot,
  Braces,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleDot,
  GitPullRequest,
  Info,
  Layers,
  List,
  Loader2,
  Menu,
  MessageSquareText,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Settings as SettingsIcon,
  Square,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  type AgentCliStatusResult,
  type AgentSession,
  type AgentSessionStatus,
  type AgentSpec,
  type BranchListResult,
  type CardAnchor,
  type GraphEdge,
  type GraphDocument,
  type GraphNode,
  type GraphSession,
  type GraphState,
  type ModelCatalogEntry,
  type PendingReview,
  type PlayLaunchSelection,
  type ProjectRecord,
  type ReasoningEffortOption,
  type RepositoryListResult,
  type RepositoryOption,
  type ResultDefinition,
  RaddusGraphApi,
} from "./api/RaddusGraphApi";
import {
  cardAnchorForPoint,
  connectionPreviewPath,
  defaultBendForNodes,
  edgeGeometry,
  edgePath,
  edgeWithManualWaypoint,
  type Point,
  projectNodeSizeForType,
} from "./edgeRouting";
import {
  defaultCanvasViewport,
  readCanvasViewport,
  type CanvasViewport,
  writeCanvasViewport,
} from "./canvasViewportStorage";

type PaletteTab = "agents" | "expressions";
type OverlayPanel = PaletteTab | null;
type SettingsTab = "projects" | "agents";
type SaveStatus = "idle" | "saving" | "saved" | "error";
type ConnectionState = "idle" | "source" | "valid" | "invalid";
type EdgeEndpoint = "source" | "target";
type EdgeAnchorDrag = { edgeId: string; endpoint: EdgeEndpoint } | null;
type DialogState =
  | { type: "agent-create" }
  | { type: "agent-details"; agentId: string }
  | { type: "play"; nodeId: string }
  | { type: "graph-play" }
  | { type: "review"; nodeId: string }
  | { type: "expression"; nodeId: string }
  | { type: "expression-definition"; resultId: string }
  | { type: "result-create" }
  | { type: "sessions" }
  | { type: "settings" }
  | { type: "help" }
  | { type: "project-create" }
  | null;
type ConfirmationState = {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
} | null;
type AgentDraft = Pick<AgentSpec, "name" | "model" | "modelReasoningEffort" | "systemPrompt">;
type ProjectDraft = Pick<ProjectRecord, "name">;
type PaletteItem =
  | { type: "agent"; agentId: string }
  | { type: "expression"; resultId: string }
  | { type: "review" };
type PaletteDropConnection = {
  source: GraphNode;
  target: GraphNode;
  type: GraphEdge["type"];
  resultId?: string;
  targetNodeId: string;
};
type PaletteDragPreview = {
  item: PaletteItem;
  x: number;
  y: number;
  width: number;
  height: number;
  connection: PaletteDropConnection | null;
};
type GraphExecutionView = {
  graphSessionId: string;
  status: GraphSession["status"];
  activeAgentSessionIds: Set<string>;
  activeNodeIds: Set<string>;
  previousAgentSessionIds: Set<string>;
  previousNodeIds: Set<string>;
  activeExpressionNodeIds: Set<string>;
  activeReviewNodeIds: Set<string>;
  activeRouteEdgeIds: Set<string>;
  visitedNodeIds: Set<string>;
  visitedExpressionNodeIds: Set<string>;
  visitedRouteEdgeIds: Set<string>;
  latestAgentSessionByNodeId: Map<string, AgentSession>;
  executionBadgesByNodeId: Map<string, string>;
  primaryActiveAgentSession: AgentSession | null;
  primaryPreviousAgentSession: AgentSession | null;
};

const api = new RaddusGraphApi();
const reservedResultIds = new Set(["unknown", "fallback"]);
const paletteCollapsedStorageKey = "raddus-graph:card-palette-collapsed";

export default function App() {
  const [state, setState] = React.useState<GraphState | null>(null);
  const [models, setModels] = React.useState<ModelCatalogEntry[]>([]);
  const [repositoryResult, setRepositoryResult] = React.useState<RepositoryListResult | null>(null);
  const [branchesByRepo, setBranchesByRepo] = React.useState<Record<string, BranchListResult>>({});
  const [overlayPanel, setOverlayPanel] = React.useState<OverlayPanel>("agents");
  const [actionMenuOpen, setActionMenuOpen] = React.useState(false);
  const [dialog, setDialog] = React.useState<DialogState>(null);
  const [confirmation, setConfirmation] = React.useState<ConfirmationState>(null);
  const [loading, setLoading] = React.useState(true);
  const [saveStatus, setSaveStatus] = React.useState<SaveStatus>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [followedSessionId, setFollowedSessionId] = React.useState<string | null>(null);
  const [focusedAgentSessionId, setFocusedAgentSessionId] = React.useState<string | null>(null);
  const [runningPlayNodeId, setRunningPlayNodeId] = React.useState<string | null>(null);
  const [resultDraft, setResultDraft] = React.useState({ id: "", description: "" });
  const [camera, setCamera] = React.useState<CanvasViewport>(defaultCanvasViewport);
  const [draggingNodeId, setDraggingNodeId] = React.useState<string | null>(null);
  const [draggingEdgeId, setDraggingEdgeId] = React.useState<string | null>(null);
  const [draggingEdgeAnchor, setDraggingEdgeAnchor] = React.useState<EdgeAnchorDrag>(null);
  const [selectedEdgeId, setSelectedEdgeId] = React.useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = React.useState<string | null>(null);
  const [hoveredEdgeControlId, setHoveredEdgeControlId] = React.useState<string | null>(null);
  const [connectingFromId, setConnectingFromId] = React.useState<string | null>(null);
  const [draggingPaletteItemKey, setDraggingPaletteItemKey] = React.useState<string | null>(null);
  const [paletteDragPreview, setPaletteDragPreview] = React.useState<PaletteDragPreview | null>(null);
  const canvasRef = React.useRef<HTMLDivElement | null>(null);
  const connectionPreviewPathRef = React.useRef<SVGPathElement | null>(null);
  const cameraRef = React.useRef(camera);
  const cameraFrameRef = React.useRef<number | null>(null);
  const persistCameraFrameRef = React.useRef(false);
  const persistCameraProjectIdFrameRef = React.useRef<string | null>(null);
  const persistCameraValueFrameRef = React.useRef<CanvasViewport | null>(null);
  const latestState = React.useRef<GraphState | null>(null);
  const localEditVersionRef = React.useRef(0);
  const saveRequestIdRef = React.useRef(0);
  const suppressNodeClickRef = React.useRef(false);
  const edgeDragMovedRef = React.useRef(false);
  const edgeAnchorDragChangedRef = React.useRef(false);

  React.useEffect(() => {
    latestState.current = state;
  }, [state]);

  React.useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);

  React.useEffect(() => {
    const projectId = state?.selectedProjectId;
    if (!projectId) return;
    restoreCanvasViewport(projectId);
  }, [state?.selectedProjectId]);

  React.useEffect(() => {
    void loadInitial();
  }, []);

  React.useEffect(() => {
    if (!state?.sessions.some((session) => session.status === "running")) return undefined;
    const timer = window.setInterval(() => {
      void refreshSessions();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [state?.sessions]);

  React.useEffect(() => {
    if (!followedSessionId || !state) return;
    const followedSession = state.sessions.find((session) => session.id === followedSessionId);
    if (!followedSession || (followedSession.projectId && followedSession.projectId !== state.selectedProjectId)) {
      setFollowedSessionId(null);
      setFocusedAgentSessionId(null);
    }
  }, [followedSessionId, state]);

  async function loadInitial() {
    setLoading(true);
    setError(null);
    try {
      const [nextState, modelPayload, repositories] = await Promise.all([
        api.getState(),
        api.getModels(),
        api.listRepositories(),
      ]);
      latestState.current = nextState;
      setState(nextState);
      setFollowedSessionId(latestSessionForProject(nextState.sessions, nextState.selectedProjectId)?.id ?? null);
      setFocusedAgentSessionId(null);
      setModels(modelPayload.models);
      setRepositoryResult(repositories);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }

  async function refreshSessions() {
    try {
      const payload = await api.listSessions();
      setState((current) => {
        const next = current ? { ...current, sessions: payload.sessions } : current;
        latestState.current = next;
        return next;
      });
    } catch (sessionError) {
      setError(errorMessage(sessionError));
    }
  }

  async function loadBranches(repo: string) {
    if (!repo || branchesByRepo[repo]) return;
    try {
      const branches = await api.listBranches(repo);
      setBranchesByRepo((current) => ({ ...current, [repo]: branches }));
    } catch (branchError) {
      setBranchesByRepo((current) => ({
        ...current,
        [repo]: { available: false, authenticated: false, error: errorMessage(branchError), branches: [] },
      }));
    }
  }

  async function persistState(nextState: GraphState) {
    const saveRequestId = saveRequestIdRef.current + 1;
    const localEditVersion = localEditVersionRef.current;
    saveRequestIdRef.current = saveRequestId;
    setSaveStatus("saving");
    setError(null);
    try {
      const saved = await api.saveState({
        agents: nextState.agents,
        results: nextState.results,
        projects: nextState.projects,
        selectedProjectId: nextState.selectedProjectId,
        graph: nextState.graph,
      });
      if (saveRequestId !== saveRequestIdRef.current || localEditVersion !== localEditVersionRef.current) return;
      setState((current) => {
        const next = current ? { ...saved, sessions: current.sessions } : saved;
        latestState.current = next;
        return next;
      });
      setSaveStatus("saved");
      window.setTimeout(() => {
        if (saveRequestId === saveRequestIdRef.current) setSaveStatus("idle");
      }, 1400);
    } catch (saveError) {
      if (saveRequestId !== saveRequestIdRef.current || localEditVersion !== localEditVersionRef.current) return;
      setSaveStatus("error");
      setError(errorMessage(saveError));
    }
  }

  function markLocalEdit() {
    localEditVersionRef.current += 1;
  }

  function mutateState(update: (current: GraphState) => GraphState, persist = true) {
    const current = latestState.current;
    if (!current) return;
    const next = update(current);
    markLocalEdit();
    latestState.current = next;
    setState(next);
    if (persist) void persistState(next);
  }

  function selectProject(projectId: string, options: { followLatestSession?: boolean } = {}) {
    const current = latestState.current;
    const selectedProjectId = current?.projects.find((project) => project.id === projectId)?.id ?? current?.projects[0]?.id ?? projectId;
    mutateState((current) => selectProjectInState(current, projectId));
    if (options.followLatestSession !== false) {
      setFollowedSessionId(current ? latestSessionForProject(current.sessions, selectedProjectId)?.id ?? null : null);
      setFocusedAgentSessionId(null);
    }
    restoreCanvasViewport(selectedProjectId);
  }

  function followGraphSession(sessionId: string) {
    const current = latestState.current;
    const session = current?.sessions.find((candidate) => candidate.id === sessionId);
    if (!session?.agentSessions.some((agentSession) => agentSession.id === focusedAgentSessionId)) {
      setFocusedAgentSessionId(null);
    }
    setFollowedSessionId(sessionId);
    if (session?.projectId && current?.selectedProjectId !== session.projectId && current?.projects.some((project) => project.id === session.projectId)) {
      selectProject(session.projectId, { followLatestSession: false });
    }
  }

  function stopFollowingSession() {
    setFollowedSessionId(null);
    setFocusedAgentSessionId(null);
  }

  function createProject(draft: ProjectDraft): ProjectRecord | null {
    const name = draft.name.trim();
    if (!name) {
      setError("Project name is required.");
      return null;
    }
    const now = new Date().toISOString();
    const project: ProjectRecord = {
      id: newId("project"),
      name,
      graph: defaultProjectGraph(),
      lastPlaySelection: null,
      createdAt: now,
      updatedAt: now,
    };
    mutateState((current) => selectProjectInState({
      ...current,
      projects: [...current.projects, project],
    }, project.id));
    restoreCanvasViewport(project.id);
    return project;
  }

  function updateProjectName(projectId: string, name: string) {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Project name is required.");
      return;
    }
    mutateState((current) => ({
      ...current,
      projects: current.projects.map((project) => (
        project.id === projectId ? { ...project, name: trimmedName, updatedAt: new Date().toISOString() } : project
      )),
    }));
  }

  function createAgent(draft: AgentDraft): AgentSpec | null {
    const name = draft.name.trim();
    const model = draft.model.trim();
    if (!name || !model) {
      setError("Agent name and model are required.");
      return null;
    }
    const now = new Date().toISOString();
    const agent: AgentSpec = {
      id: newId("agent"),
      name,
      model,
      modelReasoningEffort: normalizeDraftModelReasoningEffort(model, draft.modelReasoningEffort, models),
      systemPrompt: draft.systemPrompt.trim(),
      createdAt: now,
      updatedAt: now,
    };
    mutateState((current) => ({
      ...current,
      agents: [...current.agents, agent],
    }));
    return agent;
  }

  function updateAgent(agentId: string, patch: Partial<AgentSpec>) {
    mutateState((current) => ({
      ...current,
      agents: current.agents.map((agent) => {
        if (agent.id !== agentId) return agent;
        const model = (patch.model ?? agent.model).trim();
        return {
          ...agent,
          ...patch,
          model,
          modelReasoningEffort: normalizeDraftModelReasoningEffort(
            model,
            "modelReasoningEffort" in patch ? patch.modelReasoningEffort : agent.modelReasoningEffort,
            models,
          ),
          updatedAt: new Date().toISOString(),
        };
      }),
    }));
  }

  function deleteAgent(agentId: string) {
    mutateState((current) => {
      const projects = current.projects.map((project) => ({
        ...project,
        graph: {
          ...project.graph,
          nodes: project.graph.nodes.map((node) => (
            node.type === "agent" && node.agentId === agentId ? { ...node, agentId: null } : node
          )),
        },
        updatedAt: new Date().toISOString(),
      }));
      return withSelectedProjectGraph({
        ...current,
        agents: current.agents.filter((agent) => agent.id !== agentId),
        projects,
      });
    });
    if (dialog?.type === "agent-details" && dialog.agentId === agentId) setDialog(null);
  }

  function addResult(): ResultDefinition | null {
    const id = normalizeResultId(resultDraft.id);
    if (!id || !resultDraft.description.trim()) {
      setError("Result id and description are required.");
      return null;
    }
    if (reservedResultIds.has(id)) {
      setError(`${id} is a reserved system result.`);
      return null;
    }
    if (latestState.current?.results.some((item) => item.id === id)) {
      setError(`${id} already exists.`);
      return null;
    }
    const result: ResultDefinition = { id, description: resultDraft.description.trim(), reserved: false };
    mutateState((current) => {
      return {
        ...current,
        results: [...current.results, result],
      };
    });
    setResultDraft({ id: "", description: "" });
    return result;
  }

  function updateResult(resultId: string, description: string) {
    mutateState((current) => ({
      ...current,
      results: current.results.map((result) => result.id === resultId ? { ...result, description } : result),
    }));
  }

  function deleteResult(resultId: string) {
    if (reservedResultIds.has(resultId)) return;
    mutateState((current) => {
      const now = new Date().toISOString();
      const projects = current.projects.map((project) => {
        const expressionNodeIds = new Set(project.graph.nodes
          .filter((node) => node.type === "expression" && normalizeResultId(node.resultId ?? "") === resultId)
          .map((node) => node.id));
        return {
          ...project,
          graph: {
            nodes: project.graph.nodes.filter((node) => !expressionNodeIds.has(node.id)),
            edges: project.graph.edges.filter((edge) => (
              edge.resultId !== resultId &&
              !expressionNodeIds.has(edge.source) &&
              !expressionNodeIds.has(edge.target)
            )),
          },
          updatedAt: now,
        };
      });
      const selectedProject = projects.find((project) => project.id === current.selectedProjectId) ?? projects[0];
      return {
        ...current,
        results: current.results.filter((result) => result.id !== resultId),
        projects,
        graph: selectedProject.graph,
      };
    });
    if (dialog?.type === "expression-definition" && dialog.resultId === resultId) setDialog(null);
  }

  function requestDeleteAgent(agentId: string) {
    const agent = latestState.current?.agents.find((candidate) => candidate.id === agentId);
    requestConfirmation({
      title: "Delete Agent",
      message: `Delete ${agent?.name ?? "this agent"}? Existing cards using this agent will become unassigned.`,
      confirmLabel: "Delete",
      onConfirm: () => deleteAgent(agentId),
    });
  }

  function requestDeleteResult(resultId: string) {
    const expressionCount = latestState.current?.projects.reduce((count, project) => (
      count + project.graph.nodes.filter((node) => node.type === "expression" && normalizeResultId(node.resultId ?? "") === resultId).length
    ), 0) ?? 0;
    requestConfirmation({
      title: "Remove Expression",
      message: `Remove ${resultId}? This also removes ${expressionCount === 1 ? "1 expression card" : `${expressionCount} expression cards`} using it.`,
      confirmLabel: "Remove",
      onConfirm: () => deleteResult(resultId),
    });
  }

  function requestDeleteNode(nodeId: string) {
    const current = latestState.current;
    const node = current?.graph.nodes.find((candidate) => candidate.id === nodeId);
    if (node?.type === "play") return;
    requestConfirmation({
      title: "Remove Card",
      message: `Remove ${node && current ? nodeLabel(node, current) : "this card"} from the canvas? Connected lines will also be removed.`,
      confirmLabel: "Remove",
      onConfirm: () => deleteNode(nodeId),
    });
  }

  function requestRemoveEdge(edgeId: string) {
    requestConfirmation({
      title: "Remove Line",
      message: "Remove this connection from the canvas?",
      confirmLabel: "Remove",
      onConfirm: () => removeEdge(edgeId),
    });
  }

  function requestStopSession(sessionId: string) {
    requestConfirmation({
      title: "Stop Session",
      message: `Stop session ${sessionId}? This cannot be resumed.`,
      confirmLabel: "Stop",
      onConfirm: () => void stopSession(sessionId),
    });
  }

  function requestRemoveSession(sessionId: string) {
    const session = latestState.current?.sessions.find((candidate) => candidate.id === sessionId);
    requestConfirmation({
      title: "Remove Session",
      message: `Remove session ${sessionId}?${session?.status === "running" ? " The running agent process will be stopped." : ""} Its retained workspace will also be deleted.`,
      confirmLabel: "Remove",
      onConfirm: () => void removeSession(sessionId),
    });
  }

  function requestConfirmation(nextConfirmation: Exclude<ConfirmationState, null>) {
    setConfirmation(nextConfirmation);
  }

  function deleteNode(nodeId: string) {
    if (latestState.current?.graph.nodes.some((node) => node.id === nodeId && node.type === "play")) return;
    mutateState((current) => (
      withActiveGraph(current, {
        nodes: current.graph.nodes.filter((node) => node.id !== nodeId),
        edges: current.graph.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
      })
    ));
    if (dialog && "nodeId" in dialog && dialog.nodeId === nodeId) setDialog(null);
  }

  function updateNode(nodeId: string, patch: Partial<GraphNode>) {
    mutateState((current) => updateNodeInState(current, nodeId, (node) => ({ ...node, ...patch })));
  }

  function updatePlayNode(nodeId: string, patch: Partial<GraphNode>) {
    mutateState((current) => {
      const node = current.graph.nodes.find((candidate) => candidate.id === nodeId && candidate.type === "play");
      if (!node) return current;
      const repository = "repository" in patch ? patch.repository ?? null : node.repository ?? null;
      return withPlayLaunchSelection(current, {
        playNodeId: nodeId,
        prompt: "prompt" in patch ? patch.prompt ?? "" : node.prompt ?? "",
        repository,
        branch: repository ? ("branch" in patch ? patch.branch ?? null : node.branch ?? null) : null,
      });
    });
  }

  function moveNodeLocally(nodeId: string, x: number, y: number) {
    const current = latestState.current;
    if (!current) return;
    const next = updateNodeInState(current, nodeId, (node) => ({ ...node, x, y }));
    markLocalEdit();
    latestState.current = next;
    setState(next);
  }

  function moveEdgeWaypointLocally(edgeId: string, waypoint: Point) {
    const current = latestState.current;
    if (!current) return;
    const next = updateEdgeInState(current, edgeId, (edge) => edgeWithManualWaypoint(edge, waypoint));
    markLocalEdit();
    latestState.current = next;
    setState(next);
  }

  function moveEdgeAnchorLocally(edgeId: string, endpoint: EdgeEndpoint, anchor: CardAnchor) {
    const current = latestState.current;
    if (!current) return;
    const next = updateEdgeInState(current, edgeId, (edge) => ({
      ...edge,
      routingMode: "manual",
      ...(endpoint === "source" ? { sourceAnchor: anchor } : { targetAnchor: anchor }),
    }));
    markLocalEdit();
    latestState.current = next;
    setState(next);
  }

  function resetEdgeRouting(edgeId: string) {
    mutateState((current) => updateEdgeInState(current, edgeId, (edge) => ({
      ...edge,
      routingMode: "auto",
      waypoints: [],
      bend: null,
      sourceAnchor: null,
      targetAnchor: null,
    })));
  }

  function removeEdge(edgeId: string) {
    mutateState((current) => (
      withActiveGraph(current, {
        ...current.graph,
        edges: current.graph.edges.filter((edge) => edge.id !== edgeId),
      })
    ));
    if (selectedEdgeId === edgeId) setSelectedEdgeId(null);
  }

  function connectExplicitNodes(sourceId: string, targetId: string) {
    mutateState((current) => {
      const source = current.graph.nodes.find((node) => node.id === sourceId);
      const target = current.graph.nodes.find((node) => node.id === targetId);
      const edge = source && target ? edgeForConnection(current, source, target) : null;
      if (!edge) return current;
      return withGraphEdge(current, edge);
    });
  }

  async function runPlayLaunch(selection: PlayLaunchSelection): Promise<boolean> {
    const current = latestState.current;
    const node = current?.graph.nodes.find((candidate) => candidate.id === selection.playNodeId && candidate.type === "play");
    if (!node) {
      setError("Select a play prompt before running.");
      setDialog({ type: "graph-play" });
      return false;
    }
    return runPlayNode(node, selection);
  }

  async function runPlayNode(node: GraphNode, launchSelection?: PlayLaunchSelection): Promise<boolean> {
    const current = latestState.current;
    if (!current || node.type !== "play") return false;
    const freshNode = current.graph.nodes.find((candidate) => candidate.id === node.id && candidate.type === "play") ?? node;
    const nextSelection: PlayLaunchSelection = {
      playNodeId: freshNode.id,
      prompt: launchSelection?.prompt ?? freshNode.prompt ?? "",
      repository: launchSelection ? launchSelection.repository : freshNode.repository ?? null,
      branch: launchSelection ? launchSelection.branch : freshNode.branch ?? null,
    };
    const prompt = nextSelection.prompt.trim();
    if (!prompt) {
      setError("Enter a play prompt before running.");
      setDialog(launchSelection ? { type: "graph-play" } : { type: "play", nodeId: node.id });
      return false;
    }
    setRunningPlayNodeId(node.id);
    setError(null);
    try {
      const launchState = withPlayLaunchSelection(current, {
        ...nextSelection,
        prompt,
        repository: nextSelection.repository || null,
        branch: nextSelection.repository ? nextSelection.branch : null,
      });
      markLocalEdit();
      latestState.current = launchState;
      setState(launchState);
      const saved = await api.saveState({
        agents: launchState.agents,
        results: launchState.results,
        projects: launchState.projects,
        selectedProjectId: launchState.selectedProjectId,
        graph: launchState.graph,
      });
      const repository = nextSelection.repository || null;
      const repositoryOption = repositoryResult?.repositories.find((candidate) => candidate.nameWithOwner === repository);
      const payload = await api.createSession({
        playNodeId: freshNode.id,
        projectId: launchState.selectedProjectId,
        prompt,
        repository,
        repositoryUrl: repositoryOption?.url,
        branch: repository ? nextSelection.branch || repositoryOption?.defaultBranch || "main" : null,
      });
      const next = {
        ...saved,
        sessions: [payload.session, ...saved.sessions.filter((session) => session.id !== payload.session.id)],
      };
      latestState.current = next;
      setState(next);
      setFollowedSessionId(payload.session.id);
      setFocusedAgentSessionId(null);
      return true;
    } catch (runError) {
      setError(errorMessage(runError));
      return false;
    } finally {
      setRunningPlayNodeId(null);
    }
  }

  async function stopSession(sessionId: string) {
    try {
      const payload = await api.stopSession(sessionId);
      setState((current) => {
        const next = current ? {
          ...current,
          sessions: current.sessions.map((session) => session.id === sessionId ? payload.session : session),
        } : current;
        latestState.current = next;
        return next;
      });
    } catch (stopError) {
      setError(errorMessage(stopError));
    }
  }

  async function submitPendingReview(reviewNodeId: string, answer: string): Promise<boolean> {
    const sessionId = selectedGraphSession?.id;
    if (!sessionId) {
      setError("Select a waiting session before responding.");
      return false;
    }
    setError(null);
    try {
      const payload = await api.submitReviewResponse(sessionId, { reviewNodeId, answer });
      setState((current) => {
        const next = current ? {
          ...current,
          sessions: current.sessions.map((session) => session.id === payload.session.id ? payload.session : session),
        } : current;
        latestState.current = next;
        return next;
      });
      setFollowedSessionId(payload.session.id);
      setFocusedAgentSessionId(null);
      return true;
    } catch (reviewError) {
      setError(errorMessage(reviewError));
      return false;
    }
  }

  async function removeSession(sessionId: string) {
    const currentState = latestState.current;
    const removedFocusedAgentSession = currentState?.sessions
      .find((session) => session.id === sessionId)
      ?.agentSessions.some((agentSession) => agentSession.id === focusedAgentSessionId) ?? false;
    try {
      const payload = await api.deleteSession(sessionId);
      setState((current) => {
        const next = current ? {
          ...current,
          sessions: payload.sessions,
        } : current;
        latestState.current = next;
        return next;
      });
      if (removedFocusedAgentSession) setFocusedAgentSessionId(null);
      setFollowedSessionId((currentFollowedSessionId) => {
        if (currentFollowedSessionId && payload.sessions.some((session) => session.id === currentFollowedSessionId)) return currentFollowedSessionId;
        const projectId = currentState?.selectedProjectId ?? latestState.current?.selectedProjectId ?? null;
        return latestSessionForProject(payload.sessions, projectId)?.id ?? null;
      });
    } catch (removeError) {
      setError(errorMessage(removeError));
    }
  }

  function scheduleCamera(nextCamera: CanvasViewport) {
    cameraRef.current = nextCamera;
    const projectId = latestState.current?.selectedProjectId ?? null;
    if (projectId) {
      persistCameraFrameRef.current = true;
      persistCameraProjectIdFrameRef.current = projectId;
      persistCameraValueFrameRef.current = nextCamera;
    }
    if (cameraFrameRef.current !== null) return;
    cameraFrameRef.current = window.requestAnimationFrame(() => {
      cameraFrameRef.current = null;
      const nextCamera = cameraRef.current;
      const shouldPersist = persistCameraFrameRef.current;
      const persistProjectId = persistCameraProjectIdFrameRef.current;
      const persistCamera = persistCameraValueFrameRef.current;
      persistCameraFrameRef.current = false;
      persistCameraProjectIdFrameRef.current = null;
      persistCameraValueFrameRef.current = null;
      setCamera(nextCamera);
      if (shouldPersist && persistProjectId && persistCamera) writeCanvasViewport(persistProjectId, persistCamera);
    });
  }

  function resetCanvasViewport() {
    scheduleCamera(defaultCanvasViewport);
  }

  function restoreCanvasViewport(projectId: string) {
    const nextCamera = readCanvasViewport(projectId);
    cameraRef.current = nextCamera;
    setCamera(nextCamera);
  }

  function persistCanvasViewport(nextCamera = cameraRef.current) {
    const projectId = latestState.current?.selectedProjectId;
    if (!projectId) return;
    writeCanvasViewport(projectId, nextCamera);
  }

  function screenToWorld(clientX: number, clientY: number, viewCamera = cameraRef.current): { x: number; y: number } {
    const canvas = canvasRef.current;
    if (!canvas) return { x: clientX, y: clientY };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left - viewCamera.x) / viewCamera.zoom,
      y: (clientY - rect.top - viewCamera.y) / viewCamera.zoom,
    };
  }

  function beginNodeDrag(event: React.PointerEvent<HTMLElement>, nodeId: string) {
    if (eventTargetClosest(event.target, "button, input, select, textarea, .node-editor-control")) return;
    if (event.shiftKey) {
      beginConnection(event, nodeId);
      return;
    }
    const current = latestState.current;
    const node = current?.graph.nodes.find((item) => item.id === nodeId);
    if (!node) return;
    const startWorld = screenToWorld(event.clientX, event.clientY);
    const offsetX = startWorld.x - node.x;
    const offsetY = startWorld.y - node.y;
    const startX = event.clientX;
    const startY = event.clientY;
    suppressNodeClickRef.current = false;
    setSelectedEdgeId(null);
    setDraggingNodeId(nodeId);
    event.currentTarget.setPointerCapture(event.pointerId);

    function onMove(moveEvent: PointerEvent) {
      const moved = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > 4;
      if (moved) suppressNodeClickRef.current = true;
      const nextWorld = screenToWorld(moveEvent.clientX, moveEvent.clientY);
      moveNodeLocally(nodeId, Math.round(nextWorld.x - offsetX), Math.round(nextWorld.y - offsetY));
    }

    function onUp() {
      setDraggingNodeId(null);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const latest = latestState.current;
      if (latest) void persistState(latest);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function beginEdgeDrag(event: React.PointerEvent<SVGElement>, edgeId: string, handle: Point, mode: "handle" | "line" = "handle") {
    event.preventDefault();
    event.stopPropagation();
    const current = latestState.current;
    if (!current?.graph.edges.some((edge) => edge.id === edgeId)) return;
    const pointerStart = screenToWorld(event.clientX, event.clientY);
    const offsetX = mode === "handle" ? pointerStart.x - handle.x : 0;
    const offsetY = mode === "handle" ? pointerStart.y - handle.y : 0;
    const startX = event.clientX;
    const startY = event.clientY;
    edgeDragMovedRef.current = false;
    setSelectedEdgeId(edgeId);
    setDraggingEdgeId(edgeId);
    event.currentTarget.setPointerCapture(event.pointerId);

    function onMove(moveEvent: PointerEvent) {
      const moved = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > 3;
      if (moved) edgeDragMovedRef.current = true;
      if (!edgeDragMovedRef.current) return;
      const nextWorld = screenToWorld(moveEvent.clientX, moveEvent.clientY);
      moveEdgeWaypointLocally(edgeId, { x: nextWorld.x - offsetX, y: nextWorld.y - offsetY });
    }

    function onUp() {
      setDraggingEdgeId(null);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (!edgeDragMovedRef.current) return;
      const latest = latestState.current;
      if (latest) void persistState(latest);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function beginEdgeAnchorDrag(
    event: React.PointerEvent<SVGElement>,
    edgeId: string,
    endpoint: EdgeEndpoint,
    node: GraphNode,
    currentAnchor: CardAnchor,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const current = latestState.current;
    if (!current?.graph.edges.some((edge) => edge.id === edgeId)) return;
    let activeAnchor = currentAnchor;
    edgeAnchorDragChangedRef.current = false;
    setSelectedEdgeId(edgeId);
    setHoveredEdgeControlId(edgeId);
    setDraggingEdgeAnchor({ edgeId, endpoint });
    event.currentTarget.setPointerCapture(event.pointerId);

    function onMove(moveEvent: PointerEvent) {
      const nextAnchor = cardAnchorForPoint(node, screenToWorld(moveEvent.clientX, moveEvent.clientY));
      if (nextAnchor === activeAnchor) return;
      activeAnchor = nextAnchor;
      edgeAnchorDragChangedRef.current = true;
      moveEdgeAnchorLocally(edgeId, endpoint, nextAnchor);
    }

    function onUp() {
      setDraggingEdgeAnchor(null);
      setHoveredEdgeControlId(null);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (!edgeAnchorDragChangedRef.current) return;
      const latest = latestState.current;
      if (latest) void persistState(latest);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function beginConnection(event: React.PointerEvent, nodeId: string) {
    event.preventDefault();
    event.stopPropagation();
    suppressNodeClickRef.current = true;
    setSelectedEdgeId(null);
    setConnectingFromId(nodeId);
    updateConnectionPreview(event.clientX, event.clientY);

    function updateConnectionPreview(clientX: number, clientY: number) {
      const current = latestState.current;
      const source = current?.graph.nodes.find((node) => node.id === nodeId);
      const path = connectionPreviewPathRef.current;
      if (!source || !path) return;
      path.setAttribute("d", connectionPreviewPath(source, screenToWorld(clientX, clientY)));
      path.style.display = "block";
    }

    function onMove(moveEvent: PointerEvent) {
      updateConnectionPreview(moveEvent.clientX, moveEvent.clientY);
    }

    function onUp(upEvent: PointerEvent) {
      const targetNodeId = nodeIdAtPoint(upEvent.clientX, upEvent.clientY);
      if (targetNodeId && targetNodeId !== nodeId) connectExplicitNodes(nodeId, targetNodeId);
      setConnectingFromId(null);
      if (connectionPreviewPathRef.current) {
        connectionPreviewPathRef.current.style.display = "none";
        connectionPreviewPathRef.current.setAttribute("d", "");
      }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function beginPaletteItemDrag(event: React.PointerEvent<HTMLElement>, item: PaletteItem, onOpen?: () => void) {
    event.preventDefault();
    event.stopPropagation();

    const itemKey = paletteItemKey(item);
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;
    setDraggingPaletteItemKey(itemKey);
    setPaletteDragPreview(null);
    event.currentTarget.setPointerCapture(event.pointerId);

    function onMove(moveEvent: PointerEvent) {
      if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > 4) moved = true;
      setPaletteDragPreview(moved ? paletteDragPreviewForPoint(item, moveEvent.clientX, moveEvent.clientY) : null);
    }

    function onUp(upEvent: PointerEvent) {
      if (moved) {
        const preview = paletteDragPreviewForPoint(item, upEvent.clientX, upEvent.clientY);
        if (preview) addPaletteItemAt(item, preview.x, preview.y, preview.connection?.targetNodeId);
      } else {
        onOpen?.();
      }
      setDraggingPaletteItemKey(null);
      setPaletteDragPreview(null);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function addPaletteItemAt(item: PaletteItem, x: number, y: number, targetNodeId?: string) {
    mutateState((current) => {
      const node = nodeFromPaletteItem(item, x, y);
      const targetNode = targetNodeId ? current.graph.nodes.find((candidate) => candidate.id === targetNodeId) : undefined;
      const connection = targetNode ? paletteConnectionForTarget(current, node, targetNode) : null;
      const nextEdges = connection
        ? upsertGraphEdge(current.graph.edges, [...current.graph.nodes, node], edgeFromDropConnection(connection))
        : current.graph.edges;
      return withActiveGraph(current, {
        nodes: [...current.graph.nodes, node],
        edges: nextEdges,
      });
    });
  }

  function paletteDragPreviewForPoint(item: PaletteItem, clientX: number, clientY: number): PaletteDragPreview | null {
    const current = latestState.current;
    if (!current || !isPaletteDropPoint(clientX, clientY)) return null;
    const size = projectNodeSizeForType(item.type);
    const point = screenToWorld(clientX, clientY);
    let x = Math.round(point.x - size.width / 2);
    let y = Math.round(point.y - size.height / 2);
    let connection: PaletteDropConnection | null = null;
    const targetNode = paletteTargetNodeAt(clientX, clientY);

    if (targetNode) {
      const connectedPosition = paletteConnectedDropPosition(current, targetNode, size);
      const connectedCandidate = nodeFromPaletteItem(item, connectedPosition.x, connectedPosition.y, "palette-preview");
      connection = paletteConnectionForTarget(current, connectedCandidate, targetNode);
      if (connection) {
        x = connectedPosition.x;
        y = connectedPosition.y;
      }
    }

    return { item, x, y, width: size.width, height: size.height, connection };
  }

  function isPaletteDropPoint(clientX: number, clientY: number): boolean {
    const canvas = canvasRef.current;
    if (!canvas) return false;
    const rect = canvas.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return false;
    const target = document.elementFromPoint(clientX, clientY);
    if (target instanceof Element && target.closest(".project-card-palette, .project-controls-overlay, .project-workspace-overlay")) return false;
    return true;
  }

  function paletteTargetNodeAt(clientX: number, clientY: number): GraphNode | null {
    const current = latestState.current;
    if (!current) return null;
    const targetNodeId = nodeIdAtPoint(clientX, clientY);
    return targetNodeId ? current.graph.nodes.find((node) => node.id === targetNodeId) ?? null : null;
  }

  function nodeIdAtPoint(clientX: number, clientY: number): string | null {
    const target = document.elementFromPoint(clientX, clientY);
    if (!(target instanceof Element)) return null;
    const nodeElement = target.closest<HTMLElement>("[data-project-node-id]");
    return nodeElement?.dataset.projectNodeId ?? null;
  }

  function handleCanvasPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (eventTargetClosest(event.target, ".project-node, .project-edge-hit, .project-edge-handle, .project-edge-endpoint, .project-controls-overlay, .project-workspace-overlay, .project-card-palette, .project-action-menu")) return;
    setSelectedEdgeId(null);
    const startX = event.clientX;
    const startY = event.clientY;
    const startCamera = cameraRef.current;

    function onMove(moveEvent: PointerEvent) {
      scheduleCamera({
        ...startCamera,
        x: startCamera.x + moveEvent.clientX - startX,
        y: startCamera.y + moveEvent.clientY - startY,
      });
    }

    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      persistCanvasViewport();
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function handleCanvasWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    if (event.metaKey || event.ctrlKey) {
      const zoomFactor = Math.exp(-event.deltaY * 0.001);
      const current = cameraRef.current;
      const nextZoom = Math.min(2.2, Math.max(0.35, current.zoom * zoomFactor));
      const worldPoint = screenToWorld(event.clientX, event.clientY, current);
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      scheduleCamera({
        x: event.clientX - rect.left - worldPoint.x * nextZoom,
        y: event.clientY - rect.top - worldPoint.y * nextZoom,
        zoom: nextZoom,
      });
      return;
    }

    const current = cameraRef.current;
    scheduleCamera({
      ...current,
      x: current.x - event.deltaX,
      y: current.y - event.deltaY,
    });
  }

  function suppressesNodeClick(): boolean {
    if (!suppressNodeClickRef.current) return false;
    window.setTimeout(() => {
      suppressNodeClickRef.current = false;
    }, 0);
    return true;
  }

  const repositories = repositoryResult?.repositories ?? [];
  const graph: GraphDocument = state?.graph ?? { nodes: [], edges: [] };
  const selectedProject = state ? selectedProjectForState(state) : null;
  const playNodes = graph.nodes.filter(isPlayNode);
  const graphSessions = state?.sessions.filter((session) => session.projectId === state.selectedProjectId) ?? [];
  const activeExpressionResultId = state && dialog?.type === "expression"
    ? selectedRouteResultForExpression(state, dialog.nodeId)
    : state && dialog?.type === "expression-definition"
      ? dialog.resultId
      : null;
  const activeExpressionResult = activeExpressionResultId
    ? state?.results.find((result) => result.id === activeExpressionResultId) ?? null
    : null;
  const followedSession = followedSessionId ? state?.sessions.find((session) => session.id === followedSessionId) ?? null : null;
  const selectedGraphSession = followedSession && graphSessions.some((session) => session.id === followedSession.id) ? followedSession : null;
  const pendingReview = selectedGraphSession?.pendingReview ?? null;
  const executionView = selectedGraphSession ? graphExecutionViewForSession(selectedGraphSession) : null;

  return (
    <main className="app-shell projects-shell">
      <section className="project-window">
        <div className="workspace">
          <section className="projects-view">
            <div
              className={`project-canvas ${connectingFromId ? "connecting" : ""} ${draggingPaletteItemKey ? "palette-dragging" : ""} ${paletteDragPreview ? "palette-drop-ready" : ""} ${draggingEdgeId || draggingEdgeAnchor ? "edge-dragging" : ""}`}
              ref={canvasRef}
              onPointerDown={handleCanvasPointerDown}
              onWheel={handleCanvasWheel}
            >
              <div className="grid-field" aria-hidden="true" />
              <div className="project-controls-overlay">
                <div className="canvas-control-group project-select-group">
                  <select
                    className="project-select"
                    value={state?.selectedProjectId ?? ""}
                    onChange={(event) => selectProject(event.target.value)}
                    onPointerDown={(event) => event.stopPropagation()}
                    aria-label="Project"
                    disabled={!state}
                  >
                    {state?.projects.map((project) => (
                      <option value={project.id} key={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                  <button className="icon-button" type="button" onClick={() => setDialog({ type: "project-create" })} title="Create project" aria-label="Create project">
                    <Plus size={16} aria-hidden="true" />
                  </button>
                </div>
                {state ? (
                  <div className="canvas-control-group project-session-actions-group" aria-label="Session actions">
                    <button
                      className="icon-button"
                      type="button"
                      onClick={() => setDialog({ type: "sessions" })}
                      title="Open sessions"
                      aria-label="Open sessions"
                    >
                      <List size={17} aria-hidden="true" />
                    </button>
                    <button
                      className="icon-button project-start-action-button"
                      type="button"
                      onClick={() => setDialog({ type: "graph-play" })}
                      title="Start graph"
                      aria-label="Start graph"
                    >
                      {runningPlayNodeId ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <Play size={17} aria-hidden="true" />}
                    </button>
                  </div>
                ) : null}
                {saveStatus === "saving" || saveStatus === "error" ? (
                  <div className={`canvas-control-group save-status ${saveStatus}`}>
                    {saveStatus === "saving" ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
                    <span>{saveStatus}</span>
                  </div>
                ) : null}
              </div>
              <div className="project-action-menu" onPointerDown={(event) => event.stopPropagation()}>
                <button
                  className="project-menu-button"
                  type="button"
                  onClick={() => setActionMenuOpen((open) => !open)}
                  title="Canvas menu"
                  aria-label="Canvas menu"
                  aria-expanded={actionMenuOpen}
                >
                  <Menu size={18} aria-hidden="true" />
                  <span>Menu</span>
                </button>
                {actionMenuOpen ? (
                  <div className="project-action-stack">
                    <button
                      className="project-action-button"
                      type="button"
                      onClick={() => {
                        setDialog({ type: "help" });
                        setActionMenuOpen(false);
                      }}
                    >
                      <Info size={17} aria-hidden="true" />
                      <span>Canvas controls</span>
                    </button>
                    <button
                      className="project-action-button"
                      type="button"
                      onClick={() => {
                        setDialog({ type: "settings" });
                        setActionMenuOpen(false);
                      }}
                    >
                      <SettingsIcon size={17} aria-hidden="true" />
                      <span>Settings</span>
                    </button>
                  </div>
                ) : null}
              </div>

              {error ? <div className="project-error-overlay notice error">{error}</div> : null}
              {loading ? (
                <div className="canvas-loading">
                  <Loader2 className="spin" size={24} aria-hidden="true" />
                  <span>Loading Raddus Graph</span>
                </div>
              ) : null}

              {state && overlayPanel ? (
                <CardPalette
                  activeTab={overlayPanel}
                  agents={state.agents}
                  results={state.results}
                  draggingItemKey={draggingPaletteItemKey}
                  onActiveTabChange={setOverlayPanel}
                  onBeginDrag={beginPaletteItemDrag}
                  onCreateAgent={() => setDialog({ type: "agent-create" })}
                  onCreateExpression={() => setDialog({ type: "result-create" })}
                  onOpenAgent={(agent) => setDialog({ type: "agent-details", agentId: agent.id })}
                  onRemoveAgent={requestDeleteAgent}
                  onOpenExpression={(result) => setDialog({ type: "expression-definition", resultId: result.id })}
                  onRemoveExpression={requestDeleteResult}
                />
              ) : null}

              <div className="project-world" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}>
                <svg className="project-edges" aria-hidden="true">
                  {graph.edges.map((edge, edgeIndex) => {
                    const source = graph.nodes.find((node) => node.id === edge.source);
                    const target = graph.nodes.find((node) => node.id === edge.target);
                    if (!source || !target) return null;
                    const geometry = edgeGeometry(edge, source, target);
                    const selected = selectedEdgeId === edge.id;
                    const dragging = draggingEdgeId === edge.id || draggingEdgeAnchor?.edgeId === edge.id;
                    const removeHover = hoveredEdgeId === edge.id && hoveredEdgeControlId !== edge.id && !dragging;
                    const executionClassName = edgeExecutionClass(edge.id, executionView);
                    return (
                      <g className={`project-edge-group ${edge.type} ${executionClassName} ${selected ? "selected" : ""} ${dragging ? "dragging" : ""} ${removeHover ? "remove-hover" : ""}`} key={edge.id}>
                        <path
                          className="project-edge-hit"
                          d={geometry.path}
                          onPointerDown={(event) => beginEdgeDrag(event, edge.id, geometry.handle, "line")}
                          onPointerEnter={() => setHoveredEdgeId(edge.id)}
                          onPointerLeave={() => setHoveredEdgeId((current) => current === edge.id ? null : current)}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (!edgeDragMovedRef.current) requestRemoveEdge(edge.id);
                          }}
                        />
                        <path
                          className={`project-edge ${edge.type}`}
                          d={geometry.path}
                          style={{
                            "--edge-path-length": `${Math.max(geometry.length, 1)}`,
                            animationDelay: `${Math.min(edgeIndex * 18 + 70, 260)}ms`,
                          } as React.CSSProperties}
                        />
                        <path
                          className={`project-edge-arrow ${edge.type}`}
                          d="M -5 -5 L 5 0 L -5 5 Z"
                          transform={`translate(${geometry.arrow.x} ${geometry.arrow.y}) rotate(${geometry.arrow.angle})`}
                        />
                        <circle
                          className={`project-edge-handle ${edge.type}`}
                          cx={geometry.handle.x}
                          cy={geometry.handle.y}
                          r={7}
                          onPointerEnter={() => setHoveredEdgeControlId(edge.id)}
                          onPointerLeave={() => setHoveredEdgeControlId((current) => current === edge.id ? null : current)}
                          onPointerDown={(event) => beginEdgeDrag(event, edge.id, geometry.handle)}
                          onDoubleClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            resetEdgeRouting(edge.id);
                          }}
                        >
                          <title>Drag to edit route. Double-click to reset.</title>
                        </circle>
                        <circle
                          className={`project-edge-endpoint source ${edge.type}`}
                          cx={geometry.sourcePoint.x}
                          cy={geometry.sourcePoint.y}
                          r={7}
                          onPointerEnter={() => setHoveredEdgeControlId(edge.id)}
                          onPointerLeave={() => setHoveredEdgeControlId((current) => current === edge.id ? null : current)}
                          onPointerDown={(event) => beginEdgeAnchorDrag(event, edge.id, "source", source, geometry.sourceAnchor)}
                        />
                        <circle
                          className={`project-edge-endpoint target ${edge.type}`}
                          cx={geometry.targetPoint.x}
                          cy={geometry.targetPoint.y}
                          r={7}
                          onPointerEnter={() => setHoveredEdgeControlId(edge.id)}
                          onPointerLeave={() => setHoveredEdgeControlId((current) => current === edge.id ? null : current)}
                          onPointerDown={(event) => beginEdgeAnchorDrag(event, edge.id, "target", target, geometry.targetAnchor)}
                        />
                      </g>
                    );
                  })}
                  <path className="project-edge-preview" ref={connectionPreviewPathRef} style={{ display: "none" }} />
                  {paletteDragPreview?.connection ? (
                    <path className="project-edge-preview palette-edge-preview" d={edgePath(paletteDragPreview.connection.source, paletteDragPreview.connection.target)} />
                  ) : null}
                </svg>

                {state?.graph.nodes.map((node, nodeIndex) => {
                  const connectingFrom = connectingFromId ? state.graph.nodes.find((item) => item.id === connectingFromId) : undefined;
                  const connectionState =
                    connectingFrom && connectingFrom.id === node.id
                      ? "source"
                      : connectingFrom
                        ? edgeForConnection(state, connectingFrom, node) ? "valid" : "invalid"
                        : paletteDragPreview?.connection?.targetNodeId === node.id
                          ? "valid"
                          : "idle";
                  const latestAgentSession = executionView?.latestAgentSessionByNodeId.get(node.id) ?? null;
                  return (
                    <ProjectNodeCard
                      key={node.id}
                      node={node}
                      state={state}
                      dragging={draggingNodeId === node.id}
                      connectionState={connectionState}
                      running={runningPlayNodeId === node.id}
                      executionClassName={nodeExecutionClass(node.id, executionView)}
                      executionBadge={executionView?.executionBadgesByNodeId.get(node.id) ?? null}
                      onPointerDown={(event) => beginNodeDrag(event, node.id)}
                      onRemove={() => requestDeleteNode(node.id)}
                      onOpen={() => {
                        if (followedSession && latestAgentSession) {
                          setFocusedAgentSessionId(latestAgentSession.id);
                          setDialog({ type: "sessions" });
                          return;
                        }
                        if (node.type === "agent" && node.agentId) setDialog({ type: "agent-details", agentId: node.agentId });
                        if (node.type === "play") setDialog({ type: "play", nodeId: node.id });
                        if (node.type === "review") setDialog({ type: "review", nodeId: node.id });
                        if (node.type === "expression") setDialog({ type: "expression", nodeId: node.id });
                      }}
                      shouldSuppressClick={suppressesNodeClick}
                      enterDelayMs={Math.min(nodeIndex * 24, 180)}
                    />
                  );
                })}
                {paletteDragPreview ? <PaletteNodePreview preview={paletteDragPreview} agents={state?.agents ?? []} results={state?.results ?? []} /> : null}
              </div>
            </div>
          </section>
        </div>
      </section>

      {state && dialog?.type === "agent-create" ? (
        <AgentDialog
          models={models}
          onClose={() => setDialog(null)}
          onSave={(draft) => {
            const agent = createAgent(draft);
            if (agent) setDialog({ type: "agent-details", agentId: agent.id });
          }}
        />
      ) : null}
      {state && dialog?.type === "project-create" ? (
        <ProjectCreateDialog
          onClose={() => setDialog(null)}
          onCreate={(draft) => {
            const project = createProject(draft);
            if (project) setDialog(null);
          }}
        />
      ) : null}
      {state && dialog?.type === "agent-details" ? (
        <AgentDialog
          agent={state.agents.find((agent) => agent.id === dialog.agentId) ?? null}
          models={models}
          onClose={() => setDialog(null)}
          onSave={(draft) => {
            updateAgent(dialog.agentId, draft);
            setDialog(null);
          }}
          onDelete={() => requestDeleteAgent(dialog.agentId)}
        />
      ) : null}
      {state && dialog?.type === "play" ? (
        <PlayDialog
          node={state.graph.nodes.find((node) => node.id === dialog.nodeId && node.type === "play") ?? null}
          repositories={repositories}
          repositoryResult={repositoryResult}
          branchesByRepo={branchesByRepo}
          running={runningPlayNodeId === dialog.nodeId}
          onClose={() => setDialog(null)}
          onUpdate={(patch) => updatePlayNode(dialog.nodeId, patch)}
          onLoadBranches={(repo) => void loadBranches(repo)}
          onRun={(node) => {
            void (async () => {
              const started = await runPlayNode(node);
              if (started) setDialog(null);
            })();
          }}
        />
      ) : null}
      {state && dialog?.type === "graph-play" ? (
        <GraphPlayDialog
          project={selectedProject}
          playNodes={playNodes}
          repositories={repositories}
          repositoryResult={repositoryResult}
          branchesByRepo={branchesByRepo}
          runningPlayNodeId={runningPlayNodeId}
          onClose={() => setDialog(null)}
          onLoadBranches={(repo) => void loadBranches(repo)}
          onRun={(selection) => {
            void (async () => {
              const started = await runPlayLaunch(selection);
              if (started) setDialog(null);
            })();
          }}
        />
      ) : null}
      {state && dialog?.type === "review" ? (
        <ReviewDialog
          pendingReview={pendingReview?.reviewNodeId === dialog.nodeId ? pendingReview : null}
          onClose={() => setDialog(null)}
          onSubmit={async (answer) => {
            const started = await submitPendingReview(dialog.nodeId, answer);
            if (started) setDialog(null);
            return started;
          }}
        />
      ) : null}
      {state && activeExpressionResultId && (dialog?.type === "expression" || dialog?.type === "expression-definition") ? (
        <ExpressionDetailsDialog
          resultId={activeExpressionResultId}
          result={activeExpressionResult}
          onClose={() => setDialog(null)}
          onUpdate={updateResult}
        />
      ) : null}
      {state && dialog?.type === "result-create" ? (
        <ResultCreateDialog
          draft={resultDraft}
          onDraftChange={setResultDraft}
          onCreate={() => {
            const result = addResult();
            if (result) setDialog({ type: "expression-definition", resultId: result.id });
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {state && dialog?.type === "sessions" ? (
        <SessionsDialog
          sessions={state.sessions}
          followedSessionId={followedSessionId}
          focusedAgentSessionId={focusedAgentSessionId}
          onRefresh={() => void refreshSessions()}
          onFollowSession={followGraphSession}
          onStop={requestStopSession}
          onRemoveSession={requestRemoveSession}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {state && dialog?.type === "settings" ? (
        <SettingsDialog
          projects={state.projects}
          selectedProjectId={state.selectedProjectId}
          onSelectProject={selectProject}
          onRenameProject={updateProjectName}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.type === "help" ? <CanvasHelpDialog onClose={() => setDialog(null)} /> : null}
      {confirmation ? (
        <ConfirmationDialog
          title={confirmation.title}
          message={confirmation.message}
          confirmLabel={confirmation.confirmLabel}
          onCancel={() => setConfirmation(null)}
          onConfirm={() => {
            const action = confirmation.onConfirm;
            setConfirmation(null);
            action();
          }}
        />
      ) : null}
    </main>
  );
}

function ProjectNodeCard({
  node,
  state,
  dragging,
  connectionState,
  running,
  executionClassName,
  executionBadge,
  onPointerDown,
  onRemove,
  onOpen,
  shouldSuppressClick,
  enterDelayMs,
}: {
  node: GraphNode;
  state: GraphState;
  dragging: boolean;
  connectionState: ConnectionState;
  running: boolean;
  executionClassName: string;
  executionBadge: string | null;
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onRemove: () => void;
  onOpen: () => void;
  shouldSuppressClick: () => boolean;
  enterDelayMs: number;
}) {
  const agent = node.type === "agent" ? state.agents.find((record) => record.id === node.agentId) : undefined;
  const expressionResultId = node.type === "expression" ? selectedRouteResultForExpression(state, node.id) : "";

  return (
    <article
      className={`project-node ${node.type} ${executionClassName} ${dragging ? "dragging" : ""} ${running ? "running" : ""} connect-${connectionState}`}
      style={{ left: node.x, top: node.y, animationDelay: `${enterDelayMs}ms` }}
      onPointerDown={onPointerDown}
      onClick={(event) => {
        if (eventTargetClosest(event.target, "button, input, select, textarea, .node-editor-control")) return;
        if (shouldSuppressClick()) return;
        onOpen();
      }}
      data-project-node-id={node.id}
    >
      {executionBadge ? <span className="execution-badge">{executionBadge}</span> : null}
      {node.type === "agent" ? (
        <>
          <button className="icon-button compact-icon project-card-remove" type="button" onClick={onRemove} title="Remove card" aria-label="Remove card">
            <X size={12} aria-hidden="true" />
          </button>
          <div className="project-node-identity">
            <span className="project-node-identity-main">
              <Bot size={16} aria-hidden="true" />
              <strong>{agent?.name ?? "Unassigned agent"}</strong>
            </span>
          </div>
        </>
      ) : node.type === "play" ? (
        <>
          <div className="project-node-identity">
            <span className="project-node-identity-main">
              {running ? <Loader2 className="spin" size={20} aria-hidden="true" /> : <Play size={20} aria-hidden="true" />}
            </span>
          </div>
        </>
      ) : node.type === "expression" ? (
        <>
          <button className="icon-button compact-icon project-card-remove" type="button" onClick={onRemove} title="Remove card" aria-label="Remove card">
            <X size={12} aria-hidden="true" />
          </button>
          <div className="project-node-identity">
            <span className="project-node-identity-main">
              <Braces size={16} aria-hidden="true" />
              <strong>{expressionResultId}</strong>
            </span>
          </div>
        </>
      ) : (
        <>
          <button className="icon-button compact-icon project-card-remove" type="button" onClick={onRemove} title="Remove card" aria-label="Remove card">
            <X size={12} aria-hidden="true" />
          </button>
          <div className="project-node-identity">
            <span className="project-node-identity-main">
              <MessageSquareText size={20} aria-hidden="true" />
            </span>
          </div>
        </>
      )}
    </article>
  );
}

function CardPalette({
  activeTab,
  agents,
  results,
  draggingItemKey,
  onActiveTabChange,
  onBeginDrag,
  onCreateAgent,
  onCreateExpression,
  onOpenAgent,
  onRemoveAgent,
  onOpenExpression,
  onRemoveExpression,
}: {
  activeTab: PaletteTab;
  agents: AgentSpec[];
  results: ResultDefinition[];
  draggingItemKey: string | null;
  onActiveTabChange: (tab: PaletteTab) => void;
  onBeginDrag: (event: React.PointerEvent<HTMLElement>, item: PaletteItem, onOpen?: () => void) => void;
  onCreateAgent: () => void;
  onCreateExpression: () => void;
  onOpenAgent: (agent: AgentSpec) => void;
  onRemoveAgent: (agentId: string) => void;
  onOpenExpression: (result: ResultDefinition) => void;
  onRemoveExpression: (resultId: string) => void;
}) {
  const addButtonTitle = activeTab === "agents" ? "Create agent" : "Create expression";
  const [collapsed, setCollapsed] = React.useState(readPaletteCollapsedState);

  React.useEffect(() => {
    writePaletteCollapsedState(collapsed);
  }, [collapsed]);

  return (
    <aside className={`project-card-palette ${collapsed ? "collapsed" : ""}`} aria-label="Card palette" onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
      <div className="palette-header">
        <div className="palette-tabs" role="tablist" aria-label="Cards">
          <button
            className={activeTab === "agents" ? "active" : ""}
            type="button"
            role="tab"
            aria-selected={activeTab === "agents"}
            onClick={() => onActiveTabChange("agents")}
          >
            <Bot size={14} aria-hidden="true" />
            <span>Agents</span>
          </button>
          <button
            className={activeTab === "expressions" ? "active" : ""}
            type="button"
            role="tab"
            aria-selected={activeTab === "expressions"}
            onClick={() => onActiveTabChange("expressions")}
          >
            <Braces size={14} aria-hidden="true" />
            <span>Expressions</span>
          </button>
        </div>
        <button className="palette-tab-add-button" type="button" onClick={activeTab === "agents" ? onCreateAgent : onCreateExpression} title={addButtonTitle} aria-label={addButtonTitle}>
          <Plus size={13} aria-hidden="true" />
        </button>
      </div>
      {!collapsed ? (
        <div className="palette-list">
          {activeTab === "agents" ? (
            <>
              {agents.length === 0 ? <div className="palette-empty">No agents available</div> : null}
              {agents.map((agent) => (
                <PaletteAgentButton
                  agent={agent}
                  draggingItemKey={draggingItemKey}
                  onBeginDrag={onBeginDrag}
                  onOpen={() => onOpenAgent(agent)}
                  onRemove={() => onRemoveAgent(agent.id)}
                  key={agent.id}
                />
              ))}
            </>
          ) : (
            <>
              <PaletteReviewButton draggingItemKey={draggingItemKey} onBeginDrag={onBeginDrag} />
              {results.length === 0 ? <div className="palette-empty">No expressions available</div> : null}
              {results.map((result) => (
                <PaletteExpressionButton
                  result={result}
                  draggingItemKey={draggingItemKey}
                  onBeginDrag={onBeginDrag}
                  onOpen={() => onOpenExpression(result)}
                  onRemove={result.reserved ? undefined : () => onRemoveExpression(result.id)}
                  key={result.id}
                />
              ))}
            </>
          )}
        </div>
      ) : null}
      <div className="palette-collapse-bar">
        <button
          className="palette-collapse-button"
          type="button"
          onClick={() => setCollapsed((current) => !current)}
          title={collapsed ? "Expand cards" : "Collapse cards"}
          aria-label={collapsed ? "Expand cards" : "Collapse cards"}
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronUp size={16} aria-hidden="true" />}
        </button>
      </div>
    </aside>
  );
}

function PaletteReviewButton({
  draggingItemKey,
  onBeginDrag,
}: {
  draggingItemKey: string | null;
  onBeginDrag: (event: React.PointerEvent<HTMLElement>, item: PaletteItem, onOpen?: () => void) => void;
}) {
  const item: PaletteItem = { type: "review" };
  const itemKey = paletteItemKey(item);
  return (
    <div
      className={draggingItemKey === itemKey ? "palette-drag-item dragging" : "palette-drag-item"}
      role="button"
      tabIndex={0}
      onPointerDown={(event) => onBeginDrag(event, item)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
      }}
      title="Review"
      aria-label="Review. Drag to canvas."
    >
      <MessageSquareText size={16} aria-hidden="true" />
      <span>
        <strong>Review</strong>
        <small>Wait for user input</small>
      </span>
    </div>
  );
}

function PaletteAgentButton({
  agent,
  draggingItemKey,
  onBeginDrag,
  onOpen,
  onRemove,
}: {
  agent: AgentSpec;
  draggingItemKey: string | null;
  onBeginDrag: (event: React.PointerEvent<HTMLElement>, item: PaletteItem, onOpen?: () => void) => void;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const item: PaletteItem = { type: "agent", agentId: agent.id };
  const itemKey = paletteItemKey(item);
  return (
    <div
      className={`${draggingItemKey === itemKey ? "palette-drag-item dragging" : "palette-drag-item"} has-action`}
      role="button"
      tabIndex={0}
      onPointerDown={(event) => onBeginDrag(event, item, onOpen)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onOpen();
      }}
      title={agent.name}
      aria-label={`${agent.name}. Drag to canvas or open details.`}
    >
      <Bot size={16} aria-hidden="true" />
      <span>
        <strong>{agent.name}</strong>
        <small>{agentModelSummary(agent)}</small>
      </span>
      <button
        className="icon-button compact-icon palette-remove-button"
        type="button"
        title="Remove agent"
        aria-label="Remove agent"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
      >
        <Trash2 size={12} aria-hidden="true" />
      </button>
    </div>
  );
}

function PaletteExpressionButton({
  result,
  draggingItemKey,
  onBeginDrag,
  onOpen,
  onRemove,
}: {
  result: ResultDefinition;
  draggingItemKey: string | null;
  onBeginDrag: (event: React.PointerEvent<HTMLElement>, item: PaletteItem, onOpen?: () => void) => void;
  onOpen: () => void;
  onRemove?: () => void;
}) {
  const item: PaletteItem = { type: "expression", resultId: result.id };
  const itemKey = paletteItemKey(item);
  return (
    <div
      className={`${draggingItemKey === itemKey ? "palette-drag-item dragging" : "palette-drag-item"}${onRemove ? " has-action" : ""}`}
      role="button"
      tabIndex={0}
      onPointerDown={(event) => onBeginDrag(event, item, onOpen)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onOpen();
      }}
      title={result.id}
      aria-label={`${result.id}. Drag expression to canvas.`}
    >
      <Braces size={16} aria-hidden="true" />
      <span>
        <strong>{result.id}</strong>
        <small>{result.description}</small>
      </span>
      {onRemove ? (
        <button
          className="icon-button compact-icon palette-remove-button"
          type="button"
          title="Remove expression"
          aria-label="Remove expression"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
        >
          <Trash2 size={12} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

function PaletteNodePreview({ preview, agents, results }: { preview: PaletteDragPreview; agents: AgentSpec[]; results: ResultDefinition[] }) {
  const item = preview.item;
  const previewLabel = item.type === "agent"
    ? agents.find((record) => record.id === item.agentId)?.name ?? "Agent"
    : item.type === "expression"
      ? results.find((record) => record.id === item.resultId)?.id ?? item.resultId
      : "Review";
  return (
    <article
      className={`project-node palette-node-preview ${preview.item.type} ${preview.connection ? "connect-valid" : ""}`}
      style={{ left: preview.x, top: preview.y, width: preview.width, height: preview.height, minHeight: preview.height }}
      aria-hidden="true"
    >
      <div className="palette-node-preview-label">
        {preview.item.type === "agent" ? <Bot size={16} aria-hidden="true" /> : preview.item.type === "expression" ? <Braces size={16} aria-hidden="true" /> : <MessageSquareText size={16} aria-hidden="true" />}
        <span>{previewLabel}</span>
      </div>
    </article>
  );
}

function ProjectCreateDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (draft: ProjectDraft) => void;
}) {
  const [draft, setDraft] = React.useState<ProjectDraft>({ name: "" });

  return (
    <Modal title="New Project" onClose={onClose} plainHeader>
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          onCreate(draft);
        }}
      >
        <FormSection title="Project">
          <label>
            <span>Name</span>
            <input value={draft.name} onChange={(event) => setDraft({ name: event.target.value })} required autoFocus />
          </label>
        </FormSection>
        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            <X size={16} aria-hidden="true" />
            Close
          </button>
          <button className="primary-button" type="submit">
            <Plus size={16} aria-hidden="true" />
            Create
          </button>
        </div>
      </form>
    </Modal>
  );
}

function SettingsDialog({
  projects,
  selectedProjectId,
  onSelectProject,
  onRenameProject,
  onClose,
}: {
  projects: ProjectRecord[];
  selectedProjectId: string;
  onSelectProject: (projectId: string) => void;
  onRenameProject: (projectId: string, name: string) => void;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = React.useState<SettingsTab>("projects");
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? projects[0] ?? null;
  const [projectNameDraft, setProjectNameDraft] = React.useState(selectedProject?.name ?? "");
  const [cliStatus, setCliStatus] = React.useState<AgentCliStatusResult | null>(null);
  const [cliStatusLoading, setCliStatusLoading] = React.useState(false);
  const [cliStatusError, setCliStatusError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setProjectNameDraft(selectedProject?.name ?? "");
  }, [selectedProject?.id, selectedProject?.name]);

  React.useEffect(() => {
    void refreshCliStatus();
  }, []);

  async function refreshCliStatus() {
    setCliStatusLoading(true);
    setCliStatusError(null);
    try {
      setCliStatus(await api.getCliStatus());
    } catch (statusError) {
      setCliStatusError(errorMessage(statusError));
    } finally {
      setCliStatusLoading(false);
    }
  }

  function commitProjectName() {
    if (!selectedProject) return;
    const nextName = projectNameDraft.trim();
    if (!nextName) {
      setProjectNameDraft(selectedProject.name);
      return;
    }
    if (nextName !== selectedProject.name) onRenameProject(selectedProject.id, nextName);
  }

  return (
    <Modal title="Settings" onClose={onClose} className="settings-modal">
      <div className="settings-panel">
        <nav className="settings-tab-list" role="tablist" aria-label="Settings">
          <button
            className={activeTab === "projects" ? "active" : ""}
            type="button"
            role="tab"
            aria-selected={activeTab === "projects"}
            onClick={() => setActiveTab("projects")}
          >
            Projects
          </button>
          <button
            className={activeTab === "agents" ? "active" : ""}
            type="button"
            role="tab"
            aria-selected={activeTab === "agents"}
            onClick={() => setActiveTab("agents")}
          >
            Agents
          </button>
        </nav>
        <section className="settings-content">
          {activeTab === "projects" ? (
            <div className="settings-project-form">
              <label>
                <span>Project</span>
                <select value={selectedProject?.id ?? ""} onChange={(event) => onSelectProject(event.target.value)}>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Name</span>
                <input
                  value={projectNameDraft}
                  onChange={(event) => setProjectNameDraft(event.target.value)}
                  onBlur={commitProjectName}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    commitProjectName();
                    event.currentTarget.blur();
                  }}
                  disabled={!selectedProject}
                />
              </label>
            </div>
          ) : (
            <div className="agent-cli-status-list" aria-label="Agent CLI status">
              {cliStatusError ? <div className="notice compact error">{cliStatusError}</div> : null}
              <AgentCliStatusRow
                label="Codex"
                loading={cliStatusLoading && !cliStatus}
                available={cliStatus?.agents.find((agent) => agent.id === "codex")?.available ?? false}
              />
              <AgentCliStatusRow
                label="Claude"
                loading={cliStatusLoading && !cliStatus}
                available={cliStatus?.agents.find((agent) => agent.id === "claude")?.available ?? false}
              />
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}

function AgentCliStatusRow({ label, loading, available }: { label: string; loading: boolean; available: boolean }) {
  const statusLabel = loading ? "Checking" : available ? "Installed" : "Not Installed";
  return (
    <div className={`agent-cli-status-row ${loading ? "checking" : available ? "available" : "warning"}`}>
      <span>{label}</span>
      <span className="agent-cli-status-state" title={statusLabel} aria-label={`${label} ${statusLabel}`}>
        <span>{statusLabel}</span>
        <span className="agent-cli-status-icon" aria-hidden="true">
          {loading ? (
            <Loader2 className="spin" size={18} />
          ) : available ? (
            <CheckCircle2 size={18} />
          ) : (
            <TriangleAlert size={18} />
          )}
        </span>
      </span>
    </div>
  );
}

function AgentDialog({
  agent,
  models,
  onClose,
  onSave,
  onDelete,
}: {
  agent?: AgentSpec | null;
  models: ModelCatalogEntry[];
  onClose: () => void;
  onSave: (draft: AgentDraft) => void;
  onDelete?: () => void;
}) {
  const editing = Boolean(agent);
  const [draft, setDraft] = React.useState<AgentDraft>(() => ({
    name: agent?.name ?? "",
    model: agent?.model ?? models[0]?.id ?? "gpt-5.5",
    modelReasoningEffort: agent?.modelReasoningEffort ?? null,
    systemPrompt: agent?.systemPrompt ?? "",
  }));

  React.useEffect(() => {
    setDraft({
      name: agent?.name ?? "",
      model: agent?.model ?? models[0]?.id ?? "gpt-5.5",
      modelReasoningEffort: agent?.modelReasoningEffort ?? null,
      systemPrompt: agent?.systemPrompt ?? "",
    });
  }, [agent, models]);

  if (editing && !agent) return null;

  const selectedModel = modelEntryForId(models, draft.model);
  const reasoningEfforts = selectedModel?.runner === "codex" ? selectedModel.reasoningEfforts ?? [] : [];
  const selectedReasoningEffort = reasoningEfforts.some((option) => option.id === draft.modelReasoningEffort) ? draft.modelReasoningEffort ?? "" : "";

  function setModel(modelId: string) {
    const nextModel = modelEntryForId(models, modelId);
    setDraft({
      ...draft,
      model: modelId,
      modelReasoningEffort: nextModel?.runner === "codex"
        ? normalizeDraftModelReasoningEffort(modelId, draft.modelReasoningEffort, models)
        : null,
    });
  }

  return (
    <Modal title={editing ? "Agent details" : "Create agent"} onClose={onClose}>
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(draft);
        }}
      >
        <FormSection title="Agent">
          <label>
            <span>Name</span>
            <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required />
          </label>
          <label>
            <span>Model</span>
            <select value={draft.model} onChange={(event) => setModel(event.target.value)} required>
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label} ({model.runner})
                </option>
              ))}
            </select>
          </label>
          {reasoningEfforts.length > 0 ? (
            <label>
              <span>Reasoning</span>
              <select value={selectedReasoningEffort} onChange={(event) => setDraft({ ...draft, modelReasoningEffort: event.target.value || null })}>
                <option value="">Default</option>
                {reasoningEfforts.map((option) => (
                  <option key={option.id} value={option.id}>
                    {reasoningEffortOptionLabel(option)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            <span>System prompt</span>
            <textarea rows={9} value={draft.systemPrompt} onChange={(event) => setDraft({ ...draft, systemPrompt: event.target.value })} />
          </label>
        </FormSection>
        <div className="dialog-actions">
          {onDelete ? (
            <button className="danger-button" type="button" onClick={onDelete}>
              <Trash2 size={16} aria-hidden="true" />
              Delete
            </button>
          ) : null}
          <button className="secondary-button" type="button" onClick={onClose}>
            <X size={16} aria-hidden="true" />
            Close
          </button>
          <button className="primary-button" type="submit">
            <Save size={16} aria-hidden="true" />
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}

function PlayDialog({
  node,
  repositories,
  repositoryResult,
  branchesByRepo,
  running,
  onClose,
  onUpdate,
  onLoadBranches,
  onRun,
}: {
  node: GraphNode | null;
  repositories: RepositoryOption[];
  repositoryResult: RepositoryListResult | null;
  branchesByRepo: Record<string, BranchListResult>;
  running: boolean;
  onClose: () => void;
  onUpdate: (patch: Partial<GraphNode>) => void;
  onLoadBranches: (repo: string) => void;
  onRun: (node: GraphNode) => void;
}) {
  if (!node || node.type !== "play") return null;
  const repoBranches = node.repository ? branchesByRepo[node.repository]?.branches ?? [] : [];
  const branchOptions = repoBranches.length ? repoBranches : ([node.branch].filter(Boolean) as string[]);

  return (
    <Modal title="Start" onClose={onClose}>
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          onRun(node);
        }}
      >
        <div className="form-section">
          <label>
            <span>Prompt</span>
            <input value={node.prompt ?? ""} onChange={(event) => onUpdate({ prompt: event.target.value })} autoFocus />
          </label>
        </div>
        <div className="form-section">
          <div className="form-grid two">
            <label>
              <span>Repository</span>
              <select
                value={node.repository ?? ""}
                onChange={(event) => {
                  const repo = event.target.value || null;
                  const selected = repositories.find((candidate) => candidate.nameWithOwner === repo);
                  onUpdate({ repository: repo, branch: selected?.defaultBranch ?? null });
                  if (repo) onLoadBranches(repo);
                }}
              >
                <option value="">None</option>
                {repositories.map((repo) => (
                  <option key={repo.nameWithOwner} value={repo.nameWithOwner}>
                    {repo.nameWithOwner}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Branch</span>
              <select value={node.branch ?? ""} disabled={!node.repository} onChange={(event) => onUpdate({ branch: event.target.value || null })}>
                <option value="">None</option>
                {branchOptions.map((branch) => (
                  <option key={branch} value={branch}>
                    {branch}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {repositoryResult && !repositoryResult.authenticated ? <div className="notice compact">GitHub is unavailable, so only None is available.</div> : null}
        </div>
        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            <X size={16} aria-hidden="true" />
            Close
          </button>
          <button className="primary-button" type="submit" disabled={running}>
            {running ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
            Start
          </button>
        </div>
      </form>
    </Modal>
  );
}

function GraphPlayDialog({
  project,
  playNodes,
  repositories,
  repositoryResult,
  branchesByRepo,
  runningPlayNodeId,
  onClose,
  onLoadBranches,
  onRun,
}: {
  project: ProjectRecord | null;
  playNodes: GraphNode[];
  repositories: RepositoryOption[];
  repositoryResult: RepositoryListResult | null;
  branchesByRepo: Record<string, BranchListResult>;
  runningPlayNodeId: string | null;
  onClose: () => void;
  onLoadBranches: (repo: string) => void;
  onRun: (selection: PlayLaunchSelection) => void;
}) {
  const [draft, setDraft] = React.useState<PlayLaunchSelection | null>(() => playLaunchSelectionForProject(project, playNodes));
  const repoBranches = draft?.repository ? branchesByRepo[draft.repository]?.branches ?? [] : [];
  const branchOptions = repoBranches.length ? repoBranches : ([draft?.branch].filter(Boolean) as string[]);
  const running = Boolean(runningPlayNodeId);

  function setRepository(repositoryName: string) {
    if (!draft) return;
    const repository = repositoryName || null;
    const selectedRepository = repositories.find((candidate) => candidate.nameWithOwner === repository);
    setDraft({
      ...draft,
      repository,
      branch: repository ? selectedRepository?.defaultBranch ?? null : null,
    });
    if (repository) onLoadBranches(repository);
  }

  if (!draft || playNodes.length === 0) {
    return (
      <Modal title="Start" onClose={onClose}>
        <div className="confirmation-dialog">
          <div className="empty-state">
            <CircleDot size={24} aria-hidden="true" />
            <strong>No start cards</strong>
          </div>
          <div className="dialog-actions">
            <button className="secondary-button" type="button" onClick={onClose}>
              <X size={16} aria-hidden="true" />
              Close
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Start" onClose={onClose}>
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          onRun(draft);
        }}
      >
        <div className="form-section">
          <label>
            <span>Prompt</span>
            <input value={draft.prompt} onChange={(event) => setDraft({ ...draft, prompt: event.target.value })} autoFocus />
          </label>
        </div>
        <div className="form-section">
          <div className="form-grid two">
            <label>
              <span>Repository</span>
              <select value={draft.repository ?? ""} onChange={(event) => setRepository(event.target.value)}>
                <option value="">None</option>
                {repositories.map((repo) => (
                  <option key={repo.nameWithOwner} value={repo.nameWithOwner}>
                    {repo.nameWithOwner}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Branch</span>
              <select value={draft.branch ?? ""} disabled={!draft.repository} onChange={(event) => setDraft({ ...draft, branch: event.target.value || null })}>
                <option value="">None</option>
                {branchOptions.map((branch) => (
                  <option key={branch} value={branch}>
                    {branch}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {repositoryResult && !repositoryResult.authenticated ? <div className="notice compact">GitHub is unavailable, so only None is available.</div> : null}
        </div>
        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            <X size={16} aria-hidden="true" />
            Close
          </button>
          <button className="primary-button" type="submit" disabled={running}>
            {running ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
            Start
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ReviewDialog({
  pendingReview,
  onClose,
  onSubmit,
}: {
  pendingReview: PendingReview | null;
  onClose: () => void;
  onSubmit: (answer: string) => Promise<boolean>;
}) {
  const [answer, setAnswer] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    setAnswer("");
    setSubmitting(false);
  }, [pendingReview?.id]);

  if (!pendingReview) {
    return (
      <Modal title="Review" onClose={onClose}>
        <div className="confirmation-dialog">
          <div className="empty-state">
            <MessageSquareText size={24} aria-hidden="true" />
            <strong>No review waiting</strong>
          </div>
          <div className="dialog-actions">
            <button className="secondary-button" type="button" onClick={onClose}>
              <X size={16} aria-hidden="true" />
              Close
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Review" onClose={onClose}>
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmedAnswer = answer.trim();
          if (!trimmedAnswer || submitting) return;
          setSubmitting(true);
          void (async () => {
            const started = await onSubmit(trimmedAnswer);
            if (!started) setSubmitting(false);
          })();
        }}
      >
        <div className="form-section">
          <div className="review-question">
            <span>Question</span>
            <p>{pendingReview.question}</p>
          </div>
          <label>
            <span>Answer</span>
            <textarea value={answer} onChange={(event) => setAnswer(event.target.value)} rows={5} autoFocus required />
          </label>
        </div>
        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={onClose} disabled={submitting}>
            <X size={16} aria-hidden="true" />
            Close
          </button>
          <button className="primary-button" type="submit" disabled={submitting || !answer.trim()}>
            {submitting ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <MessageSquareText size={16} aria-hidden="true" />}
            Continue
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ExpressionDetailsDialog({
  resultId,
  result,
  onClose,
  onUpdate,
}: {
  resultId: string;
  result: ResultDefinition | null;
  onClose: () => void;
  onUpdate: (resultId: string, description: string) => void;
}) {
  const editable = Boolean(result && !result.reserved);
  const [description, setDescription] = React.useState(result?.description ?? "");

  React.useEffect(() => {
    setDescription(result?.description ?? "");
  }, [result]);

  return (
    <Modal title="Expression" onClose={onClose}>
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          if (!editable) return;
          onUpdate(resultId, description.trim() || resultId);
          onClose();
        }}
      >
        <FormSection title="Details">
          <label>
            <span>Result ID</span>
            <input value={resultId} readOnly />
          </label>
          <label>
            <span>Description</span>
            <textarea
              rows={5}
              value={description}
              readOnly={!editable}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
        </FormSection>
        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            <X size={16} aria-hidden="true" />
            Close
          </button>
          {editable ? (
            <button className="primary-button" type="submit">
              <Save size={16} aria-hidden="true" />
              Save
            </button>
          ) : null}
        </div>
      </form>
    </Modal>
  );
}

function ResultCreateDialog({
  draft,
  onDraftChange,
  onCreate,
  onClose,
}: {
  draft: { id: string; description: string };
  onDraftChange: (draft: { id: string; description: string }) => void;
  onCreate: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title="New Expression" onClose={onClose}>
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          onCreate();
        }}
      >
        <FormSection title="Expression">
          <label>
            <span>ID</span>
            <input value={draft.id} onChange={(event) => onDraftChange({ ...draft, id: event.target.value })} placeholder="approved" />
          </label>
          <label>
            <span>Description</span>
            <textarea rows={4} value={draft.description} onChange={(event) => onDraftChange({ ...draft, description: event.target.value })} />
          </label>
          <button className="primary-button" type="submit">
            <Plus size={16} aria-hidden="true" />
            Create
          </button>
        </FormSection>
        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            <X size={16} aria-hidden="true" />
            Close
          </button>
        </div>
      </form>
    </Modal>
  );
}

function SessionsDialog({
  sessions,
  followedSessionId,
  focusedAgentSessionId,
  onRefresh,
  onFollowSession,
  onStop,
  onRemoveSession,
  onClose,
}: {
  sessions: GraphSession[];
  followedSessionId: string | null;
  focusedAgentSessionId: string | null;
  onRefresh: () => void;
  onFollowSession: (sessionId: string) => void;
  onStop: (sessionId: string) => void;
  onRemoveSession: (sessionId: string) => void;
  onClose: () => void;
}) {
  const focusedSessionId = focusedAgentSessionId
    ? sessions.find((session) => session.agentSessions.some((agentSession) => agentSession.id === focusedAgentSessionId))?.id ?? null
    : null;
  const [selectedSessionId, setSelectedSessionId] = React.useState<string | null>(focusedSessionId ?? followedSessionId ?? sessions[0]?.id ?? null);

  React.useEffect(() => {
    if (sessions.length === 0) {
      setSelectedSessionId(null);
      return;
    }
    const preferredSessionId = focusedSessionId ??
      (followedSessionId && sessions.some((session) => session.id === followedSessionId)
      ? followedSessionId
      : sessions[0].id);
    if (focusedSessionId && selectedSessionId !== focusedSessionId) {
      setSelectedSessionId(focusedSessionId);
      return;
    }
    if (!selectedSessionId || !sessions.some((session) => session.id === selectedSessionId)) {
      setSelectedSessionId(preferredSessionId);
    }
  }, [focusedSessionId, followedSessionId, selectedSessionId, sessions]);

  const selectedSession = sessions.find((session) => session.id === selectedSessionId) ?? sessions[0] ?? null;
  const selectedAgentSessions = selectedSession ? orderedAgentSessions(selectedSession) : [];

  return (
    <Modal title="Sessions" onClose={onClose} className="sessions-modal">
      <div className="play-sessions-panel">
        <div className="modal-action-row">
          <button className="secondary-button" type="button" onClick={onRefresh}>
            <RefreshCw size={16} aria-hidden="true" />
            Refresh
          </button>
        </div>
        {sessions.length === 0 ? (
          <div className="empty-state">
            <CircleDot size={24} aria-hidden="true" />
            <strong>No graph sessions</strong>
          </div>
        ) : null}
        {sessions.length > 0 ? (
          <div className="sessions-browser">
            <div className="session-list" role="list" aria-label="Graph sessions">
              {sessions.map((session) => {
                const isSelected = selectedSession?.id === session.id;
                const lastAgentSession = orderedAgentSessions(session).at(-1);
                const latestStatus = lastAgentSession ? latestAgentSessionStatus(lastAgentSession) : null;
                return (
                  <article
                    className={`session-card session-selector ${isSelected ? "selected" : ""}`}
                    key={session.id}
                  >
                    <button
                      className="session-card-select-button"
                      type="button"
                      onClick={() => {
                        setSelectedSessionId(session.id);
                        onFollowSession(session.id);
                      }}
                    >
                      <span className="session-card-header">
                        <span>
                          <strong>{session.id}</strong>
                          <span className={`status-pill ${session.status}`}>{session.status}</span>
                        </span>
                      </span>
                      <span className="session-meta">
                        <span>{session.projectName ?? "Project"}</span>
                        <span>{formatDateTime(session.createdAt)}</span>
                        <span>{session.agentSessions.length} agent sessions</span>
                      </span>
                      <span className="session-card-prompt">{session.prompt}</span>
                      {latestStatus ? (
                        <span className="session-card-footer">
                          <span className={`status-pill ${latestStatus.state}`}>{latestStatus.state}</span>
                          <span>{latestStatus.summary || latestStatus.routeReason || "status"}</span>
                        </span>
                      ) : null}
                    </button>
                    <button
                      className="icon-button compact-icon danger session-remove-button"
                      type="button"
                      onClick={() => onRemoveSession(session.id)}
                      title="Remove session"
                      aria-label={`Remove session ${session.id}`}
                    >
                      <Trash2 size={13} aria-hidden="true" />
                    </button>
                  </article>
                );
              })}
            </div>
            {selectedSession ? (
              <section className="session-transcript" aria-label="Selected graph session transcript">
                <header className="session-transcript-header">
                  <div>
                    <strong>{selectedSession.id}</strong>
                    <span className={`status-pill ${selectedSession.status}`}>{selectedSession.status}</span>
                  </div>
                  <div className="session-actions">
                    {selectedSession.prUrl ? (
                      <a className="secondary-button compact-button" href={selectedSession.prUrl} target="_blank" rel="noreferrer">
                        <GitPullRequest size={15} aria-hidden="true" />
                        PR
                      </a>
                    ) : null}
                    {selectedSession.status === "running" || selectedSession.status === "waiting_review" ? (
                      <button className="secondary-button compact-button" type="button" onClick={() => onStop(selectedSession.id)}>
                        <Square size={15} aria-hidden="true" />
                        Stop
                      </button>
                    ) : null}
                    <button className="danger-button compact-button" type="button" onClick={() => onRemoveSession(selectedSession.id)}>
                      <Trash2 size={15} aria-hidden="true" />
                      Remove
                    </button>
                  </div>
                </header>
                <div className="session-meta transcript-meta">
                  <span>{selectedSession.projectName ?? "Project"}</span>
                  <span>{formatDateTime(selectedSession.createdAt)}</span>
                  <span>{selectedSession.repository ? `${selectedSession.repository.nameWithOwner}@${selectedSession.repository.branch}` : "None"}</span>
                  <span>{selectedSession.workspacePath}</span>
                </div>
                {selectedSession.error ? <div className="notice error">{selectedSession.error}</div> : null}
                <div className="transcript-list">
                  <article className="transcript-turn play-turn">
                    <div className="transcript-turn-head">
                      <span className="turn-icon">
                        <Play size={15} aria-hidden="true" />
                      </span>
                      <div>
                        <strong>Start prompt</strong>
                        <span>{formatDateTime(selectedSession.createdAt)}</span>
                      </div>
                    </div>
                    <p>{selectedSession.prompt}</p>
                  </article>
                  {selectedAgentSessions.length === 0 ? (
                    <div className="empty-state transcript-empty">
                      <CircleDot size={24} aria-hidden="true" />
                      <strong>No agent sessions</strong>
                    </div>
                  ) : null}
                  {selectedAgentSessions.map((agentSession) => (
                    <AgentSessionTurn
                      key={agentSession.id}
                      graphSession={selectedSession}
                      agentSession={agentSession}
                      focused={focusedAgentSessionId === agentSession.id}
                    />
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function AgentSessionTurn({
  graphSession,
  agentSession,
  focused,
}: {
  graphSession: GraphSession;
  agentSession: AgentSession;
  focused: boolean;
}) {
  const outcome = agentSession.terminalOutcome;
  const response = agentSession.response || agentSession.stdout || outcome?.detail || outcome?.summary || "";
  return (
    <article className={`transcript-turn agent-turn ${focused ? "focused" : ""}`}>
      <div className="transcript-turn-head">
        <span className="turn-icon">
          <Bot size={15} aria-hidden="true" />
        </span>
        <div>
          <strong>{agentSessionAgentName(graphSession, agentSession)}</strong>
          <span>{agentSession.id} · Node {shortId(agentSession.nodeId)}</span>
        </div>
        <span className={`status-pill ${agentSession.status}`}>{agentSession.status}</span>
      </div>
      {agentSession.previousAgentSessionId || agentSession.incomingExpressionNodeId || agentSession.incomingResultId ? (
        <div className="transcript-route">
          {agentSession.previousAgentSessionId ? <span>After {shortId(agentSession.previousAgentSessionId)}</span> : null}
          {agentSession.incomingExpressionNodeId ? <span>Via {shortId(agentSession.incomingExpressionNodeId)}</span> : null}
          {agentSession.incomingResultId ? <code>{agentSession.incomingResultId}</code> : null}
        </div>
      ) : null}
      {outcome ? (
        <div className="transcript-result">
          <span className={`status-pill ${outcome.state}`}>{outcome.state}</span>
          {outcome.routedResultId ? <code>{outcome.routedResultId}</code> : null}
          <span>{outcome.summary || outcome.routeReason || "Terminal outcome"}</span>
        </div>
      ) : null}
      {response ? <pre className="transcript-response">{response}</pre> : null}
      {agentSession.prompt ? (
        <details className="transcript-details">
          <summary>Prompt</summary>
          <pre>{agentSession.prompt}</pre>
        </details>
      ) : null}
      {agentSession.statuses.length > 0 ? (
        <details className="transcript-details">
          <summary>Status timeline</summary>
          <div className="status-list transcript-status-list">
            {agentSession.statuses.map((status) => (
              <div key={status.id}>
                <span className={`status-pill ${status.state}`}>{status.state}</span>
                <strong>{formatDateTime(status.createdAt)}</strong>
                <span>{status.summary || status.routeReason || "status"}</span>
                {status.routedResultId ? <code>{status.routedResultId}</code> : null}
              </div>
            ))}
          </div>
        </details>
      ) : null}
      {agentSession.stderr ? (
        <details className="transcript-details">
          <summary>Stderr</summary>
          <pre>{agentSession.stderr}</pre>
        </details>
      ) : null}
    </article>
  );
}

function CanvasHelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Canvas controls" onClose={onClose}>
      <div className="canvas-help">
        <div className="shortcut-list" aria-label="Canvas shortcuts">
          <InfoRow icon={<Play size={15} />} label="Run" value="Use the top start button or open a start card." />
          <InfoRow icon={<Layers size={15} />} label="Agents" value="Drag agent specs from the side panel onto the canvas." />
          <InfoRow icon={<CircleDot size={15} />} label="Connect" value="Drag the connector dot or drag one card onto another." />
          <InfoRow icon={<RotateCcw size={15} />} label="View" value="Drag empty canvas to pan. Use ctrl or command wheel to zoom." />
        </div>
      </div>
    </Modal>
  );
}

function ConfirmationDialog({
  title,
  message,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal title={title} onClose={onCancel}>
      <div className="confirmation-dialog">
        <p>{message}</p>
        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>
            <X size={16} aria-hidden="true" />
            Cancel
          </button>
          <button className="danger-button" type="button" onClick={onConfirm}>
            <Trash2 size={16} aria-hidden="true" />
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Modal({
  title,
  children,
  onClose,
  wide,
  plainHeader,
  className: extraClassName,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
  plainHeader?: boolean;
  className?: string;
}) {
  const className = `${wide ? "modal wide" : "modal"}${extraClassName ? ` ${extraClassName}` : ""}`;
  return createPortal(
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className={className} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <header className={plainHeader ? "modal-header plain" : "modal-header"}>
          <h1>{title}</h1>
          {!plainHeader ? (
            <button className="icon-button" type="button" onClick={onClose} title="Close" aria-label="Close">
              <X size={18} aria-hidden="true" />
            </button>
          ) : (
            <button className="icon-button modal-close-button" type="button" onClick={onClose} title="Close" aria-label="Close">
              <X size={18} aria-hidden="true" />
            </button>
          )}
        </header>
        {children}
      </section>
    </div>,
    document.body,
  );
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="form-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="info-row">
      <div>{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function readPaletteCollapsedState() {
  try {
    return window.localStorage.getItem(paletteCollapsedStorageKey) === "true";
  } catch {
    return false;
  }
}

function writePaletteCollapsedState(collapsed: boolean) {
  try {
    window.localStorage.setItem(paletteCollapsedStorageKey, String(collapsed));
  } catch {
    // Ignore unavailable storage; collapse still works for the current session.
  }
}

function isPlayNode(node: GraphNode): boolean {
  return node.type === "play";
}

function playLaunchSelectionForProject(project: ProjectRecord | null, playNodes: GraphNode[]): PlayLaunchSelection | null {
  if (playNodes.length === 0) return null;
  const remembered = project?.lastPlaySelection ?? null;
  const rememberedNode = remembered
    ? playNodes.find((node) => node.id === remembered.playNodeId && node.type === "play") ?? null
    : null;
  if (remembered && rememberedNode) {
    return {
      playNodeId: remembered.playNodeId,
      prompt: remembered.prompt,
      repository: remembered.repository,
      branch: remembered.repository ? remembered.branch : null,
    };
  }
  return playLaunchSelectionForNode(playNodes[0]);
}

function playLaunchSelectionForNode(node: GraphNode): PlayLaunchSelection {
  const repository = node.repository ?? null;
  return {
    playNodeId: node.id,
    prompt: node.prompt ?? "",
    repository,
    branch: repository ? node.branch ?? null : null,
  };
}

function paletteItemKey(item: PaletteItem): string {
  if (item.type === "agent") return `${item.type}:${item.agentId}`;
  if (item.type === "expression") return `${item.type}:${item.resultId}`;
  return item.type;
}

function nodeFromPaletteItem(item: PaletteItem, x: number, y: number, id = newId(item.type)): GraphNode {
  if (item.type === "agent") {
    return {
      id,
      type: "agent",
      agentId: item.agentId,
      x,
      y,
    };
  }
  if (item.type === "review") {
    return {
      id,
      type: "review",
      x,
      y,
    };
  }
  return {
    id,
    type: "expression",
    resultId: item.resultId,
    x,
    y,
  };
}

function paletteConnectionForTarget(
  state: GraphState,
  sourceCandidate: GraphNode,
  target: GraphNode,
): PaletteDropConnection | null {
  if (sourceCandidate.type === "agent" && target.type === "play") {
    return { source: target, target: sourceCandidate, type: "runs", targetNodeId: target.id };
  }
  if (sourceCandidate.type === "agent" && target.type === "expression") {
    return {
      source: target,
      target: sourceCandidate,
      type: "routes",
      resultId: selectedRouteResultForExpression(state, target.id),
      targetNodeId: target.id,
    };
  }
  if (sourceCandidate.type === "review" && target.type === "expression") {
    return {
      source: target,
      target: sourceCandidate,
      type: "routes",
      resultId: selectedRouteResultForExpression(state, target.id),
      targetNodeId: target.id,
    };
  }
  if (sourceCandidate.type === "expression" && target.type === "agent") {
    return { source: target, target: sourceCandidate, type: "evaluates", targetNodeId: target.id };
  }
  return null;
}

function paletteConnectedDropPosition(state: GraphState, target: GraphNode, size: { width: number; height: number }): { x: number; y: number } {
  const targetCenter = projectNodeCenter(target);
  const targetSize = projectNodeSizeForType(target.type);
  const horizontalGap = 88;
  const x = target.x + targetSize.width + horizontalGap;
  const preferredY = targetCenter.y - size.height / 2;
  return paletteAvailableNeighborPosition(state, Math.round(x), Math.round(preferredY), size);
}

function paletteAvailableNeighborPosition(state: GraphState, x: number, preferredY: number, size: { width: number; height: number }): { x: number; y: number } {
  const padding = 26;
  const slotStep = Math.max(size.height + padding, 84);
  const slotOffsets = [0];
  for (let index = 1; index <= 18; index += 1) {
    slotOffsets.push(index, -index);
  }

  for (const offset of slotOffsets) {
    const candidate = { x, y: Math.round(preferredY + offset * slotStep), width: size.width, height: size.height };
    const collides = state.graph.nodes.some((node) => canvasRectsOverlap(candidate, projectNodeRect(node), padding));
    if (!collides) return { x: candidate.x, y: candidate.y };
  }

  return { x, y: Math.round(preferredY + slotStep * (slotOffsets.length + 1)) };
}

function edgeForConnection(
  state: GraphState,
  source: GraphNode,
  target: GraphNode,
): Omit<GraphEdge, "id"> | null {
  if (source.id === target.id) return null;
  if (source.type === "play" && target.type === "agent") return { source: source.id, target: target.id, type: "runs" };
  if (source.type === "agent" && target.type === "expression") return { source: source.id, target: target.id, type: "evaluates" };
  if (source.type === "expression" && (target.type === "agent" || target.type === "review")) {
    return {
      source: source.id,
      target: target.id,
      type: "routes",
      resultId: selectedRouteResultForExpression(state, source.id),
    };
  }
  return null;
}

function edgeFromDropConnection(connection: PaletteDropConnection): Omit<GraphEdge, "id"> {
  return {
    source: connection.source.id,
    target: connection.target.id,
    type: connection.type,
    ...(connection.resultId ? { resultId: connection.resultId } : {}),
  };
}

function withGraphEdge(state: GraphState, edge: Omit<GraphEdge, "id">): GraphState {
  return withActiveGraph(state, {
    ...state.graph,
    edges: upsertGraphEdge(state.graph.edges, state.graph.nodes, edge),
  });
}

function upsertGraphEdge(edges: GraphEdge[], nodes: GraphNode[], edge: Omit<GraphEdge, "id">): GraphEdge[] {
  const duplicate = edges.some((candidate) =>
    candidate.source === edge.source &&
    candidate.target === edge.target &&
    candidate.type === edge.type &&
    candidate.resultId === edge.resultId
  );
  if (duplicate) return edges;
  const filtered = edges.filter((candidate) => {
    if (edge.type === "runs") {
      return !(candidate.source === edge.source && candidate.type === edge.type);
    }
    if (edge.type === "routes") {
      return !(candidate.source === edge.source && candidate.type === "routes" && candidate.resultId === edge.resultId);
    }
    return true;
  });
  return [...filtered, { id: newId("edge"), ...edgeWithInitialRoute(nodes, filtered, edge) }];
}

function edgeWithInitialRoute(nodes: GraphNode[], edges: GraphEdge[], edge: Omit<GraphEdge, "id">): Omit<GraphEdge, "id"> {
  if (edge.waypoints?.length || edge.bend) return edge;
  const source = nodes.find((node) => node.id === edge.source);
  const target = nodes.find((node) => node.id === edge.target);
  if (!source || !target) return edge;
  const relatedEdgeCount = edges.filter((candidate) => sameUnorderedEndpoints(candidate, edge)).length;
  if (relatedEdgeCount === 0) return edge;
  const waypoint = separatedEdgeWaypoint(source, target, relatedEdgeCount);
  return { ...edge, routingMode: "manual", waypoints: [waypoint], bend: null };
}

function sameUnorderedEndpoints(left: Pick<GraphEdge, "source" | "target">, right: Pick<GraphEdge, "source" | "target">): boolean {
  return (
    (left.source === right.source && left.target === right.target) ||
    (left.source === right.target && left.target === right.source)
  );
}

function separatedEdgeWaypoint(source: GraphNode, target: GraphNode, relatedEdgeCount: number): Point {
  const sourceCenter = projectNodeCenter(source);
  const targetCenter = projectNodeCenter(target);
  const baseBend = defaultBendForNodes(source, target);
  const dx = targetCenter.x - sourceCenter.x;
  const dy = targetCenter.y - sourceCenter.y;
  const length = Math.hypot(dx, dy) || 1;
  const normal = { x: -dy / length, y: dx / length };
  const slot = edgeBendSlot(relatedEdgeCount);
  const offset = slot * 58;
  return {
    x: Math.round(baseBend.x + normal.x * offset),
    y: Math.round(baseBend.y + normal.y * offset),
  };
}

function edgeBendSlot(relatedEdgeCount: number): number {
  const slotIndex = Math.max(0, relatedEdgeCount - 1);
  const magnitude = Math.floor(slotIndex / 2) + 1;
  return slotIndex % 2 === 0 ? magnitude : -magnitude;
}

function selectedRouteResultForExpression(
  state: GraphState,
  expressionId: string,
): string {
  const node = state.graph.nodes.find((candidate) => candidate.id === expressionId && candidate.type === "expression");
  if (!node) return defaultExpressionResultId(state);
  return expressionResultIdForNode(state, node);
}

function expressionResultIdForNode(state: GraphState, node: GraphNode): string {
  if (node.type !== "expression") return defaultExpressionResultId(state);
  const fixedResultId = normalizeResultId(node.resultId ?? "");
  if (fixedResultId) return fixedResultId;
  const existingRoute = state.graph.edges.find((edge) => (
    edge.source === node.id &&
    edge.type === "routes" &&
    edge.resultId
  ));
  return existingRoute?.resultId ?? defaultExpressionResultId(state);
}

function defaultExpressionResultId(state: Pick<GraphState, "results">): string {
  return state.results.find((result) => !result.reserved)?.id ?? state.results[0]?.id ?? "unknown";
}

function projectNodeCenter(node: GraphNode): { x: number; y: number } {
  const size = projectNodeSizeForType(node.type);
  return { x: node.x + size.width / 2, y: node.y + size.height / 2 };
}

function projectNodeBoundaryPoint(node: GraphNode, toward: { x: number; y: number }, padding = 0): { x: number; y: number } {
  const center = projectNodeCenter(node);
  const size = projectNodeSizeForType(node.type);
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (dx === 0 && dy === 0) return center;
  const scaleX = dx === 0 ? Number.POSITIVE_INFINITY : (size.width / 2 + padding) / Math.abs(dx);
  const scaleY = dy === 0 ? Number.POSITIVE_INFINITY : (size.height / 2 + padding) / Math.abs(dy);
  const scale = Math.min(scaleX, scaleY);
  return {
    x: center.x + dx * scale,
    y: center.y + dy * scale,
  };
}

function projectNodeRect(node: GraphNode): { x: number; y: number; width: number; height: number } {
  return { x: node.x, y: node.y, ...projectNodeSizeForType(node.type) };
}

function canvasRectsOverlap(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
  padding = 0,
): boolean {
  return !(
    left.x + left.width + padding < right.x ||
    right.x + right.width + padding < left.x ||
    left.y + left.height + padding < right.y ||
    right.y + right.height + padding < left.y
  );
}

function updateNodeInState(state: GraphState, nodeId: string, update: (node: GraphNode) => GraphNode): GraphState {
  return withActiveGraph(state, {
    ...state.graph,
    nodes: state.graph.nodes.map((node) => node.id === nodeId ? update(node) : node),
  });
}

function updateEdgeInState(state: GraphState, edgeId: string, update: (edge: GraphEdge) => GraphEdge): GraphState {
  return withActiveGraph(state, {
    ...state.graph,
    edges: state.graph.edges.map((edge) => edge.id === edgeId ? update(edge) : edge),
  });
}

function withPlayLaunchSelection(state: GraphState, selection: PlayLaunchSelection): GraphState {
  const repository = selection.repository || null;
  const lastPlaySelection: PlayLaunchSelection = {
    playNodeId: selection.playNodeId,
    prompt: selection.prompt,
    repository,
    branch: repository ? selection.branch : null,
  };
  const graph = {
    ...state.graph,
    nodes: state.graph.nodes.map((node) => (
      node.id === selection.playNodeId && node.type === "play"
        ? {
          ...node,
          prompt: lastPlaySelection.prompt,
          repository: lastPlaySelection.repository,
          branch: lastPlaySelection.branch,
        }
        : node
    )),
  };
  const now = new Date().toISOString();
  return {
    ...state,
    graph,
    projects: state.projects.map((project) => (
      project.id === state.selectedProjectId
        ? { ...project, graph, lastPlaySelection, updatedAt: now }
        : project
    )),
  };
}

function withActiveGraph(state: GraphState, graph: GraphDocument): GraphState {
  const now = new Date().toISOString();
  return {
    ...state,
    graph,
    projects: state.projects.map((project) => (
      project.id === state.selectedProjectId ? { ...project, graph, updatedAt: now } : project
    )),
  };
}

function selectedProjectForState(state: GraphState): ProjectRecord | null {
  return state.projects.find((candidate) => candidate.id === state.selectedProjectId) ?? state.projects[0] ?? null;
}

function withSelectedProjectGraph(state: GraphState): GraphState {
  const project = selectedProjectForState(state);
  if (!project) return state;
  return {
    ...state,
    selectedProjectId: project.id,
    graph: project.graph,
  };
}

function selectProjectInState(state: GraphState, projectId: string): GraphState {
  const project = state.projects.find((candidate) => candidate.id === projectId) ?? state.projects[0];
  return {
    ...state,
    selectedProjectId: project.id,
    graph: project.graph,
  };
}

function defaultProjectGraph(): GraphDocument {
  return {
    nodes: [
      {
        id: newId("play"),
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

function eventTargetClosest(target: EventTarget | null, selector: string): Element | null {
  return target instanceof Element ? target.closest(selector) : null;
}

function modelEntryForId(models: ModelCatalogEntry[], modelId: string): ModelCatalogEntry | null {
  return models.find((model) => model.id === modelId) ?? null;
}

function normalizeDraftModelReasoningEffort(modelId: string, effort: string | null | undefined, models: ModelCatalogEntry[]): string | null {
  const normalized = typeof effort === "string" ? effort.trim() : "";
  const model = modelEntryForId(models, modelId);
  if (!normalized || model?.runner !== "codex") return null;
  return model.reasoningEfforts?.some((option) => option.id === normalized) ? normalized : null;
}

function reasoningEffortOptionLabel(option: ReasoningEffortOption) {
  return option.description ? `${option.label} - ${option.description}` : option.label;
}

function reasoningEffortName(effort: string) {
  switch (effort) {
    case "minimal":
      return "Minimal";
    case "low":
      return "Low";
    case "medium":
      return "Medium";
    case "high":
      return "High";
    case "xhigh":
      return "Extra high";
    case "max":
      return "Max";
    case "ultra":
      return "Ultra";
    default:
      return effort;
  }
}

function agentModelSummary(agent: AgentSpec) {
  return agent.modelReasoningEffort ? `${agent.model} · ${reasoningEffortName(agent.modelReasoningEffort)}` : agent.model;
}

function nodeLabel(node: GraphNode, state: GraphState) {
  if (node.type === "play") return `Start ${shortId(node.id)}`;
  if (node.type === "review") return `Review ${shortId(node.id)}`;
  if (node.type === "expression") return `Expression ${shortId(node.id)}`;
  const agent = state.agents.find((candidate) => candidate.id === node.agentId);
  return agent?.name ?? `Agent ${shortId(node.id)}`;
}

function orderedAgentSessions(session: GraphSession) {
  return [...session.agentSessions].sort((a, b) => a.sequence - b.sequence || a.startedAt.localeCompare(b.startedAt));
}

function latestAgentSessionStatus(agentSession: AgentSession): AgentSessionStatus | null {
  return [...agentSession.statuses].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

function agentSessionAgentName(session: GraphSession, agentSession: AgentSession) {
  const agent = session.agentsSnapshot?.find((candidate) => candidate.id === agentSession.agentId);
  if (agent) return agent.name;
  const node = session.graphSnapshot?.nodes.find((candidate) => candidate.id === agentSession.nodeId);
  return node?.type === "agent" ? `Agent ${shortId(node.id)}` : `Agent ${shortId(agentSession.nodeId)}`;
}

function latestSessionForProject(sessions: GraphSession[], projectId: string | null | undefined) {
  return sessions
    .map((session, index) => ({ session, index }))
    .filter(({ session }) => session.projectId === projectId)
    .sort((left, right) => {
      const dateComparison = right.session.createdAt.localeCompare(left.session.createdAt);
      return dateComparison || left.index - right.index;
    })[0]?.session ?? null;
}

function graphSessionOptionLabel(session: GraphSession) {
  return `${session.status} · ${formatDateTime(session.createdAt)}`;
}

function graphExecutionViewForSession(session: GraphSession): GraphExecutionView {
  const orderedSessions = orderedAgentSessions(session);
  const sessionById = new Map(orderedSessions.map((agentSession) => [agentSession.id, agentSession]));
  const activeAgentSessions = orderedSessions.filter((agentSession) =>
    session.activeAgentSessionIds.includes(agentSession.id) && !isTerminalAgentSession(agentSession)
  );
  const latestAgentSessionByNodeId = new Map<string, AgentSession>();
  const executionBadgesByNodeId = new Map<string, string>();
  const sessionsByNodeId = new Map<string, AgentSession[]>();
  const activeAgentSessionIds = new Set(activeAgentSessions.map((agentSession) => agentSession.id));
  const activeNodeIds = new Set(activeAgentSessions.map((agentSession) => agentSession.nodeId));
  const previousAgentSessionIds = new Set<string>();
  const previousNodeIds = new Set<string>();
  const activeExpressionNodeIds = new Set<string>();
  const activeReviewNodeIds = new Set<string>();
  const activeRouteEdgeIds = new Set<string>();
  const visitedNodeIds = new Set<string>();
  const visitedExpressionNodeIds = new Set<string>();
  const visitedRouteEdgeIds = new Set<string>();

  for (const agentSession of orderedSessions) {
    latestAgentSessionByNodeId.set(agentSession.nodeId, agentSession);
    visitedNodeIds.add(agentSession.nodeId);
    if (agentSession.incomingExpressionNodeId) visitedExpressionNodeIds.add(agentSession.incomingExpressionNodeId);
    for (const edgeId of agentSession.incomingEdgeIds) visitedRouteEdgeIds.add(edgeId);
    const sessionsForNode = sessionsByNodeId.get(agentSession.nodeId) ?? [];
    sessionsForNode.push(agentSession);
    sessionsByNodeId.set(agentSession.nodeId, sessionsForNode);
  }

  for (const [nodeId, sessionsForNode] of sessionsByNodeId) {
    executionBadgesByNodeId.set(nodeId, sessionsForNode.length > 1 ? `${sessionsForNode.length}x` : String(sessionsForNode[0].sequence));
  }

  for (const agentSession of activeAgentSessions) {
    if (agentSession.previousAgentSessionId) previousAgentSessionIds.add(agentSession.previousAgentSessionId);
    if (agentSession.incomingExpressionNodeId) activeExpressionNodeIds.add(agentSession.incomingExpressionNodeId);
    for (const edgeId of agentSession.incomingEdgeIds) activeRouteEdgeIds.add(edgeId);
  }

  if (session.pendingReview) {
    activeReviewNodeIds.add(session.pendingReview.reviewNodeId);
    visitedNodeIds.add(session.pendingReview.reviewNodeId);
    if (session.pendingReview.incomingExpressionNodeId) activeExpressionNodeIds.add(session.pendingReview.incomingExpressionNodeId);
    if (session.pendingReview.previousAgentSessionId) previousAgentSessionIds.add(session.pendingReview.previousAgentSessionId);
    for (const edgeId of session.pendingReview.incomingEdgeIds) activeRouteEdgeIds.add(edgeId);
    executionBadgesByNodeId.set(session.pendingReview.reviewNodeId, "!");
  }

  for (const agentSessionId of previousAgentSessionIds) {
    const previousAgentSession = sessionById.get(agentSessionId);
    if (previousAgentSession) previousNodeIds.add(previousAgentSession.nodeId);
  }

  const primaryActiveAgentSession = activeAgentSessions[0] ?? null;
  let primaryPreviousAgentSession = primaryActiveAgentSession?.previousAgentSessionId
    ? sessionById.get(primaryActiveAgentSession.previousAgentSessionId) ?? null
    : null;
  if (!primaryPreviousAgentSession && primaryActiveAgentSession) {
    const activeIndex = orderedSessions.findIndex((agentSession) => agentSession.id === primaryActiveAgentSession.id);
    primaryPreviousAgentSession = orderedSessions.slice(0, activeIndex).reverse().find(isTerminalAgentSession) ?? null;
    if (primaryPreviousAgentSession) previousNodeIds.add(primaryPreviousAgentSession.nodeId);
  }
  if (!primaryActiveAgentSession && orderedSessions.length > 0) {
    primaryPreviousAgentSession = orderedSessions.at(-1) ?? null;
    if (primaryPreviousAgentSession) previousNodeIds.add(primaryPreviousAgentSession.nodeId);
  }

  return {
    graphSessionId: session.id,
    status: session.status,
    activeAgentSessionIds,
    activeNodeIds,
    previousAgentSessionIds,
    previousNodeIds,
    activeExpressionNodeIds,
    activeReviewNodeIds,
    activeRouteEdgeIds,
    visitedNodeIds,
    visitedExpressionNodeIds,
    visitedRouteEdgeIds,
    latestAgentSessionByNodeId,
    executionBadgesByNodeId,
    primaryActiveAgentSession,
    primaryPreviousAgentSession,
  };
}

function nodeExecutionClass(nodeId: string, executionView: GraphExecutionView | null): string {
  if (!executionView) return "";
  const classes = [];
  if (executionView.visitedNodeIds.has(nodeId) || executionView.visitedExpressionNodeIds.has(nodeId)) classes.push("execution-visited");
  if (executionView.previousNodeIds.has(nodeId)) classes.push("execution-previous");
  if (executionView.activeExpressionNodeIds.has(nodeId)) classes.push("execution-expression");
  if (executionView.activeReviewNodeIds.has(nodeId)) classes.push("execution-review", "execution-active");
  if (executionView.activeNodeIds.has(nodeId)) classes.push("execution-active");
  const latestAgentSession = executionView.latestAgentSessionByNodeId.get(nodeId);
  if (latestAgentSession?.terminalOutcome?.state === "failed") classes.push("execution-failed");
  if (latestAgentSession?.terminalOutcome?.state === "stopped") classes.push("execution-stopped");
  return classes.join(" ");
}

function edgeExecutionClass(edgeId: string, executionView: GraphExecutionView | null): string {
  if (!executionView) return "";
  if (executionView.activeRouteEdgeIds.has(edgeId)) return "execution-active-route";
  if (executionView.visitedRouteEdgeIds.has(edgeId)) return "execution-visited-route";
  return "";
}

function isTerminalAgentSession(agentSession: AgentSession): boolean {
  return agentSession.status === "completed" || agentSession.status === "failed" || agentSession.status === "stopped";
}

function formatElapsedTime(startValue: string, endValue?: string) {
  const start = new Date(startValue).getTime();
  const end = endValue ? new Date(endValue).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "0s";
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function normalizeResultId(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

function newId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function shortId(id: string) {
  return id.split("-").at(-1)?.slice(0, 6) || id.slice(0, 6);
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
