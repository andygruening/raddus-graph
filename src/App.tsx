import React from "react";
import { createPortal } from "react-dom";
import {
  Bot,
  Braces,
  CircleDot,
  Database,
  GitPullRequest,
  Info,
  Layers,
  Loader2,
  Menu,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Square,
  Trash2,
  X,
} from "lucide-react";
import {
  type AgentSpec,
  type BranchListResult,
  type CardAnchor,
  type GraphEdge,
  type GraphDocument,
  type GraphNode,
  type GraphNodeType,
  type GraphSession,
  type GraphState,
  type ModelCatalogEntry,
  type NodeStatus,
  type ProjectRecord,
  type RepositoryListResult,
  type RepositoryOption,
  type ResultDefinition,
  RaddusGraphApi,
} from "./api/RaddusGraphApi";

type PaletteTab = "agents" | "expressions";
type OverlayPanel = PaletteTab | null;
type SaveStatus = "idle" | "saving" | "saved" | "error";
type Point = { x: number; y: number };
type CanvasViewport = { x: number; y: number; zoom: number };
type ConnectionState = "idle" | "source" | "valid" | "invalid";
type EdgeEndpoint = "source" | "target";
type EdgeAnchorDrag = { edgeId: string; endpoint: EdgeEndpoint } | null;
type EdgeGeometry = {
  path: string;
  points: Point[];
  handle: Point;
  label: Point;
  arrow: Point & { angle: number };
  sourcePoint: Point;
  targetPoint: Point;
  sourceAnchor: CardAnchor;
  targetAnchor: CardAnchor;
};
type DialogState =
  | { type: "agent-create" }
  | { type: "agent-details"; agentId: string }
  | { type: "play"; nodeId: string }
  | { type: "expression"; nodeId: string }
  | { type: "expression-definition"; resultId: string }
  | { type: "result-create" }
  | { type: "sessions" }
  | { type: "help" }
  | { type: "project-create" }
  | null;
type ConfirmationState = {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
} | null;
type AgentDraft = Pick<AgentSpec, "name" | "model" | "systemPrompt">;
type ProjectDraft = Pick<ProjectRecord, "name">;
type PaletteItem =
  | { type: "agent"; agentId: string }
  | { type: "expression"; resultId: string };
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

const api = new RaddusGraphApi();
const defaultCanvasViewport: CanvasViewport = { x: 0, y: 0, zoom: 1 };
const reservedResultIds = new Set(["unknown", "fallback"]);

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
  const [runningPlayNodeId, setRunningPlayNodeId] = React.useState<string | null>(null);
  const [resultDraft, setResultDraft] = React.useState({ id: "", description: "" });
  const [camera, setCamera] = React.useState<CanvasViewport>(defaultCanvasViewport);
  const [draggingNodeId, setDraggingNodeId] = React.useState<string | null>(null);
  const [draggingEdgeId, setDraggingEdgeId] = React.useState<string | null>(null);
  const [draggingEdgeAnchor, setDraggingEdgeAnchor] = React.useState<EdgeAnchorDrag>(null);
  const [selectedEdgeId, setSelectedEdgeId] = React.useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = React.useState<string | null>(null);
  const [hoveredEdgeControlId, setHoveredEdgeControlId] = React.useState<string | null>(null);
  const [nodeDropTargetId, setNodeDropTargetId] = React.useState<string | null>(null);
  const [connectingFromId, setConnectingFromId] = React.useState<string | null>(null);
  const [draggingPaletteItemKey, setDraggingPaletteItemKey] = React.useState<string | null>(null);
  const [paletteDragPreview, setPaletteDragPreview] = React.useState<PaletteDragPreview | null>(null);
  const canvasRef = React.useRef<HTMLDivElement | null>(null);
  const connectionPreviewPathRef = React.useRef<SVGPathElement | null>(null);
  const cameraRef = React.useRef(camera);
  const cameraFrameRef = React.useRef<number | null>(null);
  const latestState = React.useRef<GraphState | null>(null);
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
    void loadInitial();
  }, []);

  React.useEffect(() => {
    if (!state?.sessions.some((session) => session.status === "running")) return undefined;
    const timer = window.setInterval(() => {
      void refreshSessions();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [state?.sessions]);

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
      setState((current) => {
        const next = current ? { ...saved, sessions: current.sessions } : saved;
        latestState.current = next;
        return next;
      });
      setSaveStatus("saved");
      window.setTimeout(() => setSaveStatus("idle"), 1400);
    } catch (saveError) {
      setSaveStatus("error");
      setError(errorMessage(saveError));
    }
  }

  function mutateState(update: (current: GraphState) => GraphState, persist = true) {
    const current = latestState.current;
    if (!current) return;
    const next = update(current);
    latestState.current = next;
    setState(next);
    if (persist) void persistState(next);
  }

  function selectProject(projectId: string) {
    mutateState((current) => selectProjectInState(current, projectId));
    setCamera(defaultCanvasViewport);
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
      createdAt: now,
      updatedAt: now,
    };
    mutateState((current) => selectProjectInState({
      ...current,
      projects: [...current.projects, project],
    }, project.id));
    setCamera(defaultCanvasViewport);
    return project;
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
      agents: current.agents.map((agent) => (
        agent.id === agentId ? { ...agent, ...patch, updatedAt: new Date().toISOString() } : agent
      )),
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

  function requestConfirmation(nextConfirmation: Exclude<ConfirmationState, null>) {
    setConfirmation(nextConfirmation);
  }

  function addNodeAt(
    type: GraphNodeType,
    x: number,
    y: number,
    options: { agentId?: string | null; resultId?: string } = {},
  ) {
    mutateState((current) => {
      const node: GraphNode = {
        id: newId(type),
        type,
        x,
        y,
        ...(type === "play" ? { prompt: "", repository: null, branch: null } : {}),
        ...(type === "agent" ? { agentId: options.agentId ?? current.agents[0]?.id ?? null } : {}),
        ...(type === "expression" ? { resultId: options.resultId ?? defaultExpressionResultId(current) } : {}),
      };
      return withActiveGraph(current, { ...current.graph, nodes: [...current.graph.nodes, node] });
    });
  }

  function addNodeAtCanvasCenter(type: GraphNodeType) {
    const center = canvasCenterToWorld() ?? { x: 180, y: 140 };
    const size = projectNodeSizeForType(type);
    addNodeAt(type, Math.round(center.x - size.width / 2), Math.round(center.y - size.height / 2));
  }

  function deleteNode(nodeId: string) {
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

  function moveNodeLocally(nodeId: string, x: number, y: number) {
    const current = latestState.current;
    if (!current) return;
    const next = updateNodeInState(current, nodeId, (node) => ({ ...node, x, y }));
    latestState.current = next;
    setState(next);
  }

  function moveEdgeBendLocally(edgeId: string, bend: Point) {
    const current = latestState.current;
    if (!current) return;
    const next = updateEdgeInState(current, edgeId, (edge) => ({
      ...edge,
      bend: { x: Math.round(bend.x), y: Math.round(bend.y) },
    }));
    latestState.current = next;
    setState(next);
  }

  function moveEdgeAnchorLocally(edgeId: string, endpoint: EdgeEndpoint, anchor: CardAnchor) {
    const current = latestState.current;
    if (!current) return;
    const next = updateEdgeInState(current, edgeId, (edge) => ({
      ...edge,
      ...(endpoint === "source" ? { sourceAnchor: anchor } : { targetAnchor: anchor }),
    }));
    latestState.current = next;
    setState(next);
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

  function connectDroppedNodes(draggedId: string, targetId: string) {
    mutateState((current) => {
      const dragged = current.graph.nodes.find((node) => node.id === draggedId);
      const target = current.graph.nodes.find((node) => node.id === targetId);
      const edge = dragged && target ? edgeForDrop(current, dragged, target) : null;
      if (!edge) return current;
      return withGraphEdge(current, edge);
    });
  }

  async function runPlayNode(node: GraphNode) {
    const current = latestState.current;
    if (!current || node.type !== "play") return;
    const freshNode = current.graph.nodes.find((candidate) => candidate.id === node.id && candidate.type === "play") ?? node;
    const prompt = (freshNode.prompt ?? "").trim();
    if (!prompt) {
      setError("Enter a play prompt before running.");
      setDialog({ type: "play", nodeId: node.id });
      return;
    }
    setRunningPlayNodeId(node.id);
    setError(null);
    try {
      const saved = await api.saveState({
        agents: current.agents,
        results: current.results,
        projects: current.projects,
        selectedProjectId: current.selectedProjectId,
        graph: current.graph,
      });
      const repository = freshNode.repository || null;
      const repositoryOption = repositoryResult?.repositories.find((candidate) => candidate.nameWithOwner === repository);
      const payload = await api.createSession({
        playNodeId: freshNode.id,
        projectId: current.selectedProjectId,
        prompt,
        repository,
        repositoryUrl: repositoryOption?.url,
        branch: repository ? freshNode.branch || repositoryOption?.defaultBranch || "main" : null,
      });
      const next = {
        ...saved,
        sessions: [payload.session, ...saved.sessions.filter((session) => session.id !== payload.session.id)],
      };
      latestState.current = next;
      setState(next);
      setDialog({ type: "sessions" });
    } catch (runError) {
      setError(errorMessage(runError));
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

  function scheduleCamera(nextCamera: CanvasViewport) {
    cameraRef.current = nextCamera;
    if (cameraFrameRef.current !== null) return;
    cameraFrameRef.current = window.requestAnimationFrame(() => {
      cameraFrameRef.current = null;
      setCamera(cameraRef.current);
    });
  }

  function resetCanvasViewport() {
    scheduleCamera(defaultCanvasViewport);
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

  function canvasCenterToWorld(): { x: number; y: number } | undefined {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const rect = canvas.getBoundingClientRect();
    return screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  function beginNodeDrag(event: React.PointerEvent<HTMLElement>, nodeId: string) {
    if (eventTargetClosest(event.target, "button, input, select, textarea, .project-connector, .node-editor-control")) return;
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
    setNodeDropTargetId(null);
    event.currentTarget.setPointerCapture(event.pointerId);

    function onMove(moveEvent: PointerEvent) {
      const moved = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > 4;
      if (moved) suppressNodeClickRef.current = true;
      const nextWorld = screenToWorld(moveEvent.clientX, moveEvent.clientY);
      moveNodeLocally(nodeId, Math.round(nextWorld.x - offsetX), Math.round(nextWorld.y - offsetY));
      setNodeDropTargetId(moved ? nodeIdAtPoint(moveEvent.clientX, moveEvent.clientY) : null);
    }

    function onUp(upEvent: PointerEvent) {
      const targetNodeId = suppressNodeClickRef.current ? nodeIdAtPoint(upEvent.clientX, upEvent.clientY) : null;
      setDraggingNodeId(null);
      setNodeDropTargetId(null);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (targetNodeId && targetNodeId !== nodeId) {
        connectDroppedNodes(nodeId, targetNodeId);
        return;
      }
      const latest = latestState.current;
      if (latest) void persistState(latest);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function beginEdgeDrag(event: React.PointerEvent<SVGElement>, edgeId: string, handle: Point) {
    event.preventDefault();
    event.stopPropagation();
    const current = latestState.current;
    if (!current?.graph.edges.some((edge) => edge.id === edgeId)) return;
    const pointerStart = screenToWorld(event.clientX, event.clientY);
    const offsetX = pointerStart.x - handle.x;
    const offsetY = pointerStart.y - handle.y;
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
      moveEdgeBendLocally(edgeId, { x: nextWorld.x - offsetX, y: nextWorld.y - offsetY });
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
  const runningSessions = state?.sessions.filter((session) => session.status === "running").length ?? 0;
  const graph = state?.graph ?? { nodes: [], edges: [] };
  const activeExpressionResultId = state && dialog?.type === "expression"
    ? selectedRouteResultForExpression(state, dialog.nodeId)
    : state && dialog?.type === "expression-definition"
      ? dialog.resultId
      : null;
  const activeExpressionResult = activeExpressionResultId
    ? state?.results.find((result) => result.id === activeExpressionResultId) ?? null
    : null;

  return (
    <main className="app-shell projects-shell">
      <section className="project-window">
        <div className="workspace">
          <section className="projects-view">
            <div
              className={`project-canvas ${connectingFromId ? "connecting" : ""} ${draggingPaletteItemKey ? "palette-dragging" : ""} ${paletteDragPreview ? "palette-drop-ready" : ""} ${draggingNodeId ? "node-dragging" : ""} ${draggingEdgeId || draggingEdgeAnchor ? "edge-dragging" : ""}`}
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
                {saveStatus !== "idle" ? (
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
                        addNodeAtCanvasCenter("play");
                        setActionMenuOpen(false);
                      }}
                    >
                      <Play size={17} aria-hidden="true" />
                      <span>Add play card</span>
                    </button>
                    <button
                      className="project-action-button"
                      type="button"
                      onClick={() => {
                        setDialog({ type: "sessions" });
                        setActionMenuOpen(false);
                      }}
                    >
                      {runningSessions ? <Loader2 className="spin" size={17} aria-hidden="true" /> : <Database size={17} aria-hidden="true" />}
                      <span>Sessions</span>
                    </button>
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
                    return (
                      <g className={`project-edge-group ${edge.type} ${selected ? "selected" : ""} ${dragging ? "dragging" : ""} ${removeHover ? "remove-hover" : ""}`} key={edge.id}>
                        <path
                          className="project-edge-hit"
                          d={geometry.path}
                          onPointerDown={(event) => beginEdgeDrag(event, edge.id, geometry.handle)}
                          onPointerEnter={() => setHoveredEdgeId(edge.id)}
                          onPointerLeave={() => setHoveredEdgeId((current) => current === edge.id ? null : current)}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (!edgeDragMovedRef.current) requestRemoveEdge(edge.id);
                          }}
                        />
                        <path className={`project-edge ${edge.type}`} d={geometry.path} pathLength={1} style={{ animationDelay: `${Math.min(edgeIndex * 18 + 70, 260)}ms` }} />
                        <path
                          className={`project-edge-arrow ${edge.type}`}
                          d="M -5 -5 L 5 0 L -5 5 Z"
                          transform={`translate(${geometry.arrow.x} ${geometry.arrow.y}) rotate(${geometry.arrow.angle})`}
                        />
                        {edge.resultId ? (
                          <text className="project-edge-label" x={geometry.label.x} y={geometry.label.y - 12}>
                            {edge.resultId}
                          </text>
                        ) : null}
                        <circle
                          className={`project-edge-handle ${edge.type}`}
                          cx={geometry.handle.x}
                          cy={geometry.handle.y}
                          r={7}
                          onPointerEnter={() => setHoveredEdgeControlId(edge.id)}
                          onPointerLeave={() => setHoveredEdgeControlId((current) => current === edge.id ? null : current)}
                          onPointerDown={(event) => beginEdgeDrag(event, edge.id, geometry.handle)}
                        />
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
                  const draggingNode = draggingNodeId ? state.graph.nodes.find((item) => item.id === draggingNodeId) : undefined;
                  const connectionState =
                    connectingFrom && connectingFrom.id === node.id
                      ? "source"
                      : connectingFrom
                        ? edgeForConnection(state, connectingFrom, node) ? "valid" : "invalid"
                        : draggingNode && draggingNode.id === node.id
                          ? "source"
                          : draggingNode
                            ? edgeForDrop(state, draggingNode, node) ? "valid" : "invalid"
                            : paletteDragPreview?.connection?.targetNodeId === node.id
                              ? "valid"
                              : "idle";
                  return (
                    <ProjectNodeCard
                      key={node.id}
                      node={node}
                      state={state}
                      dragging={draggingNodeId === node.id}
                      dropTarget={nodeDropTargetId === node.id}
                      connectionState={connectionState}
                      running={runningPlayNodeId === node.id}
                      latestStatus={latestNodeStatus(state, node.id)}
                      onPointerDown={(event) => beginNodeDrag(event, node.id)}
                      onConnectorPointerDown={(event) => beginConnection(event, node.id)}
                      onRemove={() => requestDeleteNode(node.id)}
                      onOpen={() => {
                        if (node.type === "agent" && node.agentId) setDialog({ type: "agent-details", agentId: node.agentId });
                        if (node.type === "play") setDialog({ type: "play", nodeId: node.id });
                        if (node.type === "expression") setDialog({ type: "expression", nodeId: node.id });
                      }}
                      onPlayPromptChange={(prompt) => updateNode(node.id, { prompt })}
                      onRunPlay={() => void runPlayNode(node)}
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
          onUpdate={(patch) => updateNode(dialog.nodeId, patch)}
          onLoadBranches={(repo) => void loadBranches(repo)}
          onRun={(node) => void runPlayNode(node)}
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
          onRefresh={() => void refreshSessions()}
          onStop={requestStopSession}
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
  dropTarget,
  connectionState,
  running,
  latestStatus,
  onPointerDown,
  onConnectorPointerDown,
  onRemove,
  onOpen,
  onPlayPromptChange,
  onRunPlay,
  shouldSuppressClick,
  enterDelayMs,
}: {
  node: GraphNode;
  state: GraphState;
  dragging: boolean;
  dropTarget: boolean;
  connectionState: ConnectionState;
  running: boolean;
  latestStatus: NodeStatus | null;
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onConnectorPointerDown: (event: React.PointerEvent) => void;
  onRemove: () => void;
  onOpen: () => void;
  onPlayPromptChange: (prompt: string) => void;
  onRunPlay: () => void;
  shouldSuppressClick: () => boolean;
  enterDelayMs: number;
}) {
  const agent = node.type === "agent" ? state.agents.find((record) => record.id === node.agentId) : undefined;
  const expressionResultId = node.type === "expression" ? selectedRouteResultForExpression(state, node.id) : "";
  const statusTitle = latestStatus ? `${latestStatus.state}: ${latestStatus.summary || latestStatus.routeReason || "status"}` : "";

  return (
    <article
      className={`project-node ${node.type} ${dragging ? "dragging" : ""} ${dropTarget ? "drop-target" : ""} ${running ? "running" : ""} connect-${connectionState}`}
      style={{ left: node.x, top: node.y, animationDelay: `${enterDelayMs}ms` }}
      onPointerDown={onPointerDown}
      onClick={(event) => {
        if (eventTargetClosest(event.target, "button, input, select, textarea, .project-connector, .node-editor-control")) return;
        if (shouldSuppressClick()) return;
        onOpen();
      }}
      data-project-node-id={node.id}
    >
      {node.type === "agent" ? (
        <>
          <div className="project-node-head">
            <span>Agent</span>
            <button className="project-connector" type="button" onPointerDown={onConnectorPointerDown} title="Drag to connect" aria-label="Drag to connect" />
            <button className="icon-button compact-icon project-card-remove" type="button" onClick={onRemove} title="Remove card" aria-label="Remove card">
              <X size={12} aria-hidden="true" />
            </button>
          </div>
          <div className="agent-node-name">
            <strong>{agent?.name ?? "Unassigned agent"}</strong>
            {latestStatus ? <span className={`node-status-light ${latestStatus.state}`} title={statusTitle} aria-label={statusTitle} /> : null}
          </div>
        </>
      ) : (
        <>
          <div className="project-node-head">
            <span>{node.type === "play" ? "Play" : "Expression"}</span>
            <button className="project-connector" type="button" onPointerDown={onConnectorPointerDown} title="Drag to connect" aria-label="Drag to connect" />
            <button className="icon-button compact-icon project-card-remove" type="button" onClick={onRemove} title="Remove card" aria-label="Remove card">
              <X size={12} aria-hidden="true" />
            </button>
          </div>
          {node.type === "play" ? (
            <div className="project-play-body">
              <input
                className="project-play-prompt"
                value={node.prompt ?? ""}
                onChange={(event) => onPlayPromptChange(event.target.value)}
                placeholder="First prompt"
                onPointerDown={(event) => event.stopPropagation()}
              />
              <button
                className="project-play-button"
                type="button"
                title="Start graph session"
                onClick={(event) => {
                  event.stopPropagation();
                  onRunPlay();
                }}
                disabled={running}
              >
                {running ? <Loader2 className="spin" size={20} aria-hidden="true" /> : <Play size={22} aria-hidden="true" />}
              </button>
            </div>
          ) : (
            <div className="expression-node-body">
              <strong className="expression-result-id">{expressionResultId}</strong>
            </div>
          )}
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
  return (
    <aside className="project-card-palette" aria-label="Card palette" onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
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
    </aside>
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
        <small>{agent.model}</small>
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
    : results.find((record) => record.id === item.resultId)?.id ?? item.resultId;
  return (
    <article
      className={`project-node palette-node-preview ${preview.item.type} ${preview.connection ? "connect-valid" : ""}`}
      style={{ left: preview.x, top: preview.y, width: preview.width, height: preview.height, minHeight: preview.height }}
      aria-hidden="true"
    >
      <div className="palette-node-preview-label">
        {preview.item.type === "agent" ? <Bot size={16} aria-hidden="true" /> : <Braces size={16} aria-hidden="true" />}
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
    model: agent?.model ?? models[0]?.id ?? "gpt-5-codex",
    systemPrompt: agent?.systemPrompt ?? "",
  }));

  React.useEffect(() => {
    setDraft({
      name: agent?.name ?? "",
      model: agent?.model ?? models[0]?.id ?? "gpt-5-codex",
      systemPrompt: agent?.systemPrompt ?? "",
    });
  }, [agent, models]);

  if (editing && !agent) return null;

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
            <select value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} required>
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label} ({model.runner})
                </option>
              ))}
            </select>
          </label>
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
  const branchOptions = repoBranches.length ? repoBranches : [node.branch].filter(Boolean) as string[];

  return (
    <Modal title="Play" onClose={onClose}>
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          onRun(node);
        }}
      >
        <FormSection title="Prompt">
          <label>
            <span>User prompt</span>
            <textarea rows={8} value={node.prompt ?? ""} onChange={(event) => onUpdate({ prompt: event.target.value })} />
          </label>
        </FormSection>
        <FormSection title="Repository">
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
        </FormSection>
        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            <X size={16} aria-hidden="true" />
            Close
          </button>
          <button className="primary-button" type="submit" disabled={running}>
            {running ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
            Run
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
  onRefresh,
  onStop,
  onClose,
}: {
  sessions: GraphSession[];
  onRefresh: () => void;
  onStop: (sessionId: string) => void;
  onClose: () => void;
}) {
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
        <div className="session-list">
          {sessions.map((session) => {
            const latestStatuses = Object.values(session.nodeStatuses).flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6);
            return (
              <article className="session-card" key={session.id}>
                <header>
                  <div>
                    <strong>{session.id}</strong>
                    <span className={`status-pill ${session.status}`}>{session.status}</span>
                  </div>
                  <div className="session-actions">
                    {session.prUrl ? (
                      <a className="secondary-button compact-button" href={session.prUrl} target="_blank" rel="noreferrer">
                        <GitPullRequest size={15} aria-hidden="true" />
                        PR
                      </a>
                    ) : null}
                    {session.status === "running" ? (
                      <button className="secondary-button compact-button" type="button" onClick={() => onStop(session.id)}>
                        <Square size={15} aria-hidden="true" />
                        Stop
                      </button>
                    ) : null}
                  </div>
                </header>
                <div className="session-meta">
                  <span>{session.projectName ?? "Project"}</span>
                  <span>{formatDateTime(session.createdAt)}</span>
                  <span>{session.repository ? `${session.repository.nameWithOwner}@${session.repository.branch}` : "None"}</span>
                  <span>{session.workspacePath}</span>
                </div>
                <p>{session.prompt}</p>
                {session.error ? <div className="notice error">{session.error}</div> : null}
                <div className="status-list">
                  {latestStatuses.map((status) => (
                    <div key={status.id}>
                      <span className={`status-pill ${status.state}`}>{status.state}</span>
                      <strong>{status.nodeId}</strong>
                      <span>{status.summary || status.routeReason || "status"}</span>
                      {status.routedResultId ? <code>{status.routedResultId}</code> : null}
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}

function CanvasHelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Canvas controls" onClose={onClose}>
      <div className="canvas-help">
        <div className="shortcut-list" aria-label="Canvas shortcuts">
          <InfoRow icon={<Play size={15} />} label="Run" value="Use the play card button or open the play card." />
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

function paletteItemKey(item: PaletteItem): string {
  return item.type === "agent" ? `${item.type}:${item.agentId}` : `${item.type}:${item.resultId}`;
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

function edgeForDrop(
  state: GraphState,
  dragged: GraphNode,
  target: GraphNode,
): Omit<GraphEdge, "id"> | null {
  return edgeForConnection(state, dragged, target) ?? edgeForConnection(state, target, dragged);
}

function edgeForConnection(
  state: GraphState,
  source: GraphNode,
  target: GraphNode,
): Omit<GraphEdge, "id"> | null {
  if (source.id === target.id) return null;
  if (source.type === "play" && target.type === "agent") return { source: source.id, target: target.id, type: "runs" };
  if (source.type === "agent" && target.type === "expression") return { source: source.id, target: target.id, type: "evaluates" };
  if (source.type === "expression" && target.type === "agent") {
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
  return [...filtered, { id: newId("edge"), ...edgeWithInitialBend(nodes, filtered, edge) }];
}

function edgeWithInitialBend(nodes: GraphNode[], edges: GraphEdge[], edge: Omit<GraphEdge, "id">): Omit<GraphEdge, "id"> {
  if (edge.bend) return edge;
  const source = nodes.find((node) => node.id === edge.source);
  const target = nodes.find((node) => node.id === edge.target);
  if (!source || !target) return edge;
  const relatedEdgeCount = edges.filter((candidate) => sameUnorderedEndpoints(candidate, edge)).length;
  if (relatedEdgeCount === 0) return edge;
  const bend = separatedEdgeBend(source, target, relatedEdgeCount);
  return { ...edge, bend };
}

function sameUnorderedEndpoints(left: Pick<GraphEdge, "source" | "target">, right: Pick<GraphEdge, "source" | "target">): boolean {
  return (
    (left.source === right.source && left.target === right.target) ||
    (left.source === right.target && left.target === right.source)
  );
}

function separatedEdgeBend(source: GraphNode, target: GraphNode, relatedEdgeCount: number): Point {
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

function edgeGeometry(edge: Pick<GraphEdge, "bend" | "sourceAnchor" | "targetAnchor">, source: GraphNode, target: GraphNode): EdgeGeometry {
  const sourceAnchor = edge.sourceAnchor ?? cardAnchorForPoint(source, edge.bend ?? projectNodeCenter(target));
  const targetAnchor = edge.targetAnchor ?? cardAnchorForPoint(target, edge.bend ?? projectNodeCenter(source));
  const sourcePoint = projectNodeAnchorPoint(source, sourceAnchor);
  const targetPoint = projectNodeAnchorPoint(target, targetAnchor);
  const sourceStub = offsetAnchorPoint(sourcePoint, sourceAnchor, 34);
  const targetStub = offsetAnchorPoint(targetPoint, targetAnchor, 34);
  const bend = edge.bend ?? defaultEdgeBend(sourceStub, targetStub);
  const routePoints = orthogonalRoutePoints(sourceStub, targetStub, bend);
  const points = compactEdgePoints([sourcePoint, ...routePoints, targetPoint]);
  const arrow = pointOnPolyline(points, 0.5);
  return {
    path: edgePathFromPoints(points),
    points,
    handle: bend,
    label: arrow,
    arrow,
    sourcePoint,
    targetPoint,
    sourceAnchor,
    targetAnchor,
  };
}

function edgePath(source: GraphNode, target: GraphNode, bend?: Point | null): string {
  return edgeGeometry({ bend }, source, target).path;
}

function defaultBendForNodes(source: GraphNode, target: GraphNode): Point {
  const sourceAnchor = cardAnchorForPoint(source, projectNodeCenter(target));
  const targetAnchor = cardAnchorForPoint(target, projectNodeCenter(source));
  const sourcePoint = projectNodeAnchorPoint(source, sourceAnchor);
  const targetPoint = projectNodeAnchorPoint(target, targetAnchor);
  return defaultEdgeBend(
    offsetAnchorPoint(sourcePoint, sourceAnchor, 34),
    offsetAnchorPoint(targetPoint, targetAnchor, 34),
  );
}

function connectionPreviewPath(source: GraphNode, target: Point): string {
  const sourceAnchor = cardAnchorForPoint(source, target);
  const sourcePoint = projectNodeAnchorPoint(source, sourceAnchor);
  const sourceStub = offsetAnchorPoint(sourcePoint, sourceAnchor, 34);
  const bend = defaultEdgeBend(sourceStub, target);
  return edgePathFromPoints(compactEdgePoints([sourcePoint, ...orthogonalRoutePoints(sourceStub, target, bend)]));
}

function orthogonalRoutePoints(start: Point, end: Point, bend: Point): Point[] {
  const horizontalFirst = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y);
  return compactEdgePoints(horizontalFirst ? [
    start,
    { x: bend.x, y: start.y },
    bend,
    { x: end.x, y: bend.y },
    end,
  ] : [
    start,
    { x: start.x, y: bend.y },
    bend,
    { x: bend.x, y: end.y },
    end,
  ]);
}

function defaultEdgeBend(source: Point, target: Point): Point {
  return {
    x: (source.x + target.x) / 2,
    y: (source.y + target.y) / 2,
  };
}

function projectNodeAnchorPoint(node: GraphNode, anchor: CardAnchor): Point {
  const size = projectNodeSizeForType(node.type);
  if (anchor === "top") return { x: node.x + size.width / 2, y: node.y };
  if (anchor === "right") return { x: node.x + size.width, y: node.y + size.height / 2 };
  if (anchor === "bottom") return { x: node.x + size.width / 2, y: node.y + size.height };
  return { x: node.x, y: node.y + size.height / 2 };
}

function offsetAnchorPoint(point: Point, anchor: CardAnchor, distance: number): Point {
  const direction = anchorDirection(anchor);
  return {
    x: point.x + direction.x * distance,
    y: point.y + direction.y * distance,
  };
}

function cardAnchorForPoint(node: GraphNode, point: Point): CardAnchor {
  const center = projectNodeCenter(node);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  if (Math.abs(dx) > Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
}

function anchorDirection(anchor: CardAnchor): Point {
  if (anchor === "top") return { x: 0, y: -1 };
  if (anchor === "right") return { x: 1, y: 0 };
  if (anchor === "bottom") return { x: 0, y: 1 };
  return { x: -1, y: 0 };
}

function compactEdgePoints(points: Point[]): Point[] {
  const deduped = points.reduce<Point[]>((result, point) => {
    const previous = result.at(-1);
    if (!previous || Math.abs(previous.x - point.x) > 0.01 || Math.abs(previous.y - point.y) > 0.01) {
      result.push(point);
    }
    return result;
  }, []);
  if (deduped.length <= 2) return deduped;
  return deduped.filter((point, index, list) => {
    if (index === 0 || index === list.length - 1) return true;
    const previous = list[index - 1];
    const next = list[index + 1];
    const horizontal = Math.abs(previous.y - point.y) <= 0.01 && Math.abs(point.y - next.y) <= 0.01;
    const vertical = Math.abs(previous.x - point.x) <= 0.01 && Math.abs(point.x - next.x) <= 0.01;
    return !horizontal && !vertical;
  });
}

function edgePathFromPoints(points: Point[]): string {
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${svgNumber(point.x)} ${svgNumber(point.y)}`).join(" ");
}

function pointOnPolyline(points: Point[], ratio: number): Point & { angle: number } {
  const segments = points.slice(1).map((point, index) => {
    const previous = points[index];
    const dx = point.x - previous.x;
    const dy = point.y - previous.y;
    return { previous, point, dx, dy, length: Math.hypot(dx, dy) };
  }).filter((segment) => segment.length > 0.01);
  const totalLength = segments.reduce((sum, segment) => sum + segment.length, 0);
  if (!segments.length || totalLength <= 0) {
    const first = points[0] ?? { x: 0, y: 0 };
    return { x: first.x, y: first.y, angle: 0 };
  }

  const targetLength = totalLength * ratio;
  let traveled = 0;
  for (const segment of segments) {
    if (traveled + segment.length >= targetLength) {
      const progress = (targetLength - traveled) / segment.length;
      return {
        x: segment.previous.x + segment.dx * progress,
        y: segment.previous.y + segment.dy * progress,
        angle: Math.atan2(segment.dy, segment.dx) * 180 / Math.PI,
      };
    }
    traveled += segment.length;
  }

  const last = segments.at(-1);
  return {
    x: last?.point.x ?? 0,
    y: last?.point.y ?? 0,
    angle: last ? Math.atan2(last.dy, last.dx) * 180 / Math.PI : 0,
  };
}

function svgNumber(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? "0" : String(rounded);
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

function projectNodeSizeForType(type: GraphNodeType): { width: number; height: number } {
  if (type === "play") return { width: 260, height: 132 };
  if (type === "agent") return { width: 180, height: 88 };
  return { width: 220, height: 88 };
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

function withSelectedProjectGraph(state: GraphState): GraphState {
  const project = state.projects.find((candidate) => candidate.id === state.selectedProjectId) ?? state.projects[0];
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

function nodeLabel(node: GraphNode, state: GraphState) {
  if (node.type === "play") return `Play ${shortId(node.id)}`;
  if (node.type === "expression") return `Expression ${shortId(node.id)}`;
  const agent = state.agents.find((candidate) => candidate.id === node.agentId);
  return agent?.name ?? `Agent ${shortId(node.id)}`;
}

function latestNodeStatus(state: GraphState, nodeId: string): NodeStatus | null {
  return state.sessions
    .flatMap((session) => session.nodeStatuses[nodeId] ?? [])
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
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
