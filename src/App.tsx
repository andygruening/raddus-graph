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
  type GraphEdge,
  type GraphNode,
  type GraphNodeType,
  type GraphSession,
  type GraphState,
  type ModelCatalogEntry,
  type NodeStatus,
  type RepositoryListResult,
  type RepositoryOption,
  type ResultDefinition,
  RaddusGraphApi,
} from "./api/RaddusGraphApi";

type OverlayPanel = "agents" | null;
type SaveStatus = "idle" | "saving" | "saved" | "error";
type CanvasViewport = { x: number; y: number; zoom: number };
type ConnectionState = "idle" | "source" | "valid" | "invalid";
type DialogState =
  | { type: "agent-create" }
  | { type: "agent-details"; agentId: string }
  | { type: "play"; nodeId: string }
  | { type: "expression"; nodeId: string }
  | { type: "results" }
  | { type: "sessions" }
  | { type: "help" }
  | null;
type AgentDraft = Pick<AgentSpec, "name" | "model" | "systemPrompt">;
type PaletteItem = { type: "agent"; agentId: string };
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
  const [dialog, setDialog] = React.useState<DialogState>(null);
  const [loading, setLoading] = React.useState(true);
  const [saveStatus, setSaveStatus] = React.useState<SaveStatus>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [runningPlayNodeId, setRunningPlayNodeId] = React.useState<string | null>(null);
  const [resultDraft, setResultDraft] = React.useState({ id: "", description: "" });
  const [routeResultByExpressionId, setRouteResultByExpressionId] = React.useState<Record<string, string>>({});
  const [camera, setCamera] = React.useState<CanvasViewport>(defaultCanvasViewport);
  const [draggingNodeId, setDraggingNodeId] = React.useState<string | null>(null);
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
    mutateState((current) => ({
      ...current,
      agents: current.agents.filter((agent) => agent.id !== agentId),
      graph: {
        nodes: current.graph.nodes.map((node) => (
          node.type === "agent" && node.agentId === agentId ? { ...node, agentId: null } : node
        )),
        edges: current.graph.edges,
      },
    }));
    if (dialog?.type === "agent-details" && dialog.agentId === agentId) setDialog(null);
  }

  function addResult() {
    const id = normalizeResultId(resultDraft.id);
    if (!id || !resultDraft.description.trim()) {
      setError("Result id and description are required.");
      return;
    }
    if (reservedResultIds.has(id)) {
      setError(`${id} is a reserved system result.`);
      return;
    }
    mutateState((current) => {
      const result: ResultDefinition = { id, description: resultDraft.description.trim(), reserved: false };
      const exists = current.results.some((item) => item.id === id);
      return {
        ...current,
        results: exists ? current.results.map((item) => item.id === id ? result : item) : [...current.results, result],
      };
    });
    setResultDraft({ id: "", description: "" });
  }

  function updateResult(resultId: string, description: string) {
    mutateState((current) => ({
      ...current,
      results: current.results.map((result) => result.id === resultId ? { ...result, description } : result),
    }));
  }

  function deleteResult(resultId: string) {
    if (reservedResultIds.has(resultId)) return;
    mutateState((current) => ({
      ...current,
      results: current.results.filter((result) => result.id !== resultId),
      graph: {
        nodes: current.graph.nodes,
        edges: current.graph.edges.filter((edge) => edge.resultId !== resultId),
      },
    }));
  }

  function addNodeAt(type: GraphNodeType, x: number, y: number, agentId?: string | null) {
    mutateState((current) => {
      const node: GraphNode = {
        id: newId(type),
        type,
        x,
        y,
        ...(type === "play" ? { prompt: "", repository: null, branch: null } : {}),
        ...(type === "agent" ? { agentId: agentId ?? current.agents[0]?.id ?? null } : {}),
      };
      return {
        ...current,
        graph: { ...current.graph, nodes: [...current.graph.nodes, node] },
      };
    });
  }

  function addNodeAtCanvasCenter(type: GraphNodeType) {
    const center = canvasCenterToWorld() ?? { x: 180, y: 140 };
    const size = projectNodeSizeForType(type);
    addNodeAt(type, Math.round(center.x - size.width / 2), Math.round(center.y - size.height / 2));
  }

  function deleteNode(nodeId: string) {
    mutateState((current) => ({
      ...current,
      graph: {
        nodes: current.graph.nodes.filter((node) => node.id !== nodeId),
        edges: current.graph.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
      },
    }));
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

  function removeEdge(edgeId: string) {
    mutateState((current) => ({
      ...current,
      graph: {
        ...current.graph,
        edges: current.graph.edges.filter((edge) => edge.id !== edgeId),
      },
    }));
  }

  function connectExplicitNodes(sourceId: string, targetId: string) {
    mutateState((current) => {
      const source = current.graph.nodes.find((node) => node.id === sourceId);
      const target = current.graph.nodes.find((node) => node.id === targetId);
      const edge = source && target ? edgeForConnection(current, source, target, routeResultByExpressionId) : null;
      if (!edge) return current;
      return withGraphEdge(current, edge);
    });
  }

  function connectDroppedNodes(draggedId: string, targetId: string) {
    mutateState((current) => {
      const dragged = current.graph.nodes.find((node) => node.id === draggedId);
      const target = current.graph.nodes.find((node) => node.id === targetId);
      const edge = dragged && target ? edgeForDrop(current, dragged, target, routeResultByExpressionId) : null;
      if (!edge) return current;
      return withGraphEdge(current, edge);
    });
  }

  function connectRoute(source: string, resultId: string, target: string | null) {
    mutateState((current) => ({
      ...current,
      graph: {
        nodes: current.graph.nodes,
        edges: [
          ...current.graph.edges.filter((edge) => !(edge.source === source && edge.type === "routes" && edge.resultId === resultId)),
          ...(target ? [{ id: newId("edge"), source, target, type: "routes" as const, resultId }] : []),
        ],
      },
    }));
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
      const saved = await api.saveState({ agents: current.agents, results: current.results, graph: current.graph });
      const repository = freshNode.repository || null;
      const repositoryOption = repositoryResult?.repositories.find((candidate) => candidate.nameWithOwner === repository);
      const payload = await api.createSession({
        playNodeId: freshNode.id,
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

  function beginConnection(event: React.PointerEvent, nodeId: string) {
    event.preventDefault();
    event.stopPropagation();
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
      const node: GraphNode = {
        id: newId("agent"),
        type: "agent",
        agentId: item.agentId,
        x,
        y,
      };
      const targetNode = targetNodeId ? current.graph.nodes.find((candidate) => candidate.id === targetNodeId) : undefined;
      const connection = targetNode ? paletteConnectionForTarget(current, node, targetNode, routeResultByExpressionId) : null;
      const nextEdges = connection
        ? upsertEdges(current.graph.edges, edgeFromDropConnection(connection))
        : current.graph.edges;
      return {
        ...current,
        graph: {
          nodes: [...current.graph.nodes, node],
          edges: nextEdges,
        },
      };
    });
  }

  function paletteDragPreviewForPoint(item: PaletteItem, clientX: number, clientY: number): PaletteDragPreview | null {
    const current = latestState.current;
    if (!current || !isPaletteDropPoint(clientX, clientY)) return null;
    const size = projectNodeSizeForType("agent");
    const point = screenToWorld(clientX, clientY);
    let x = Math.round(point.x - size.width / 2);
    let y = Math.round(point.y - size.height / 2);
    let connection: PaletteDropConnection | null = null;
    const targetNode = paletteTargetNodeAt(clientX, clientY);

    if (targetNode) {
      const connectedPosition = paletteConnectedDropPosition(current, targetNode, size);
      const connectedCandidate: GraphNode = {
        id: "palette-preview",
        type: "agent",
        agentId: item.agentId,
        x: connectedPosition.x,
        y: connectedPosition.y,
      };
      connection = paletteConnectionForTarget(current, connectedCandidate, targetNode, routeResultByExpressionId);
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
    if (eventTargetClosest(event.target, ".project-node, .project-controls-overlay, .project-workspace-overlay, .project-card-palette")) return;
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

  return (
    <main className="app-shell projects-shell">
      <section className="project-window">
        <div className="workspace">
          <section className="projects-view">
            <div
              className={`project-canvas ${connectingFromId ? "connecting" : ""} ${draggingPaletteItemKey ? "palette-dragging" : ""} ${paletteDragPreview ? "palette-drop-ready" : ""} ${draggingNodeId ? "node-dragging" : ""}`}
              ref={canvasRef}
              onPointerDown={handleCanvasPointerDown}
              onWheel={handleCanvasWheel}
            >
              <div className="grid-field" aria-hidden="true" />
              <div className="project-controls-overlay">
                <div className="canvas-control-group project-brand-group">
                  <img src="/raddus-logo.png" alt="" />
                  <span>
                    <strong>Raddus Graph</strong>
                    <small>{state?.dataDir ?? ".raddus-graph"}</small>
                  </span>
                </div>
                <div className="canvas-control-group">
                  <button className="icon-button" type="button" onClick={() => setOverlayPanel((panel) => panel === "agents" ? null : "agents")} title="Agent specs" aria-label="Agent specs">
                    <Layers size={18} aria-hidden="true" />
                  </button>
                  <button className="icon-button" type="button" onClick={() => setDialog({ type: "agent-create" })} title="Create agent" aria-label="Create agent">
                    <Bot size={18} aria-hidden="true" />
                  </button>
                  <button className="icon-button" type="button" onClick={() => addNodeAtCanvasCenter("play")} title="Add play card" aria-label="Add play card">
                    <Play size={18} aria-hidden="true" />
                  </button>
                  <button className="icon-button" type="button" onClick={() => addNodeAtCanvasCenter("expression")} title="Add expression card" aria-label="Add expression card">
                    <Braces size={18} aria-hidden="true" />
                  </button>
                  <button className="icon-button" type="button" onClick={() => setDialog({ type: "results" })} title="Results" aria-label="Results">
                    <CircleDot size={18} aria-hidden="true" />
                  </button>
                  <button className="icon-button" type="button" onClick={() => setDialog({ type: "sessions" })} title="Sessions" aria-label="Sessions">
                    {runningSessions ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <Database size={18} aria-hidden="true" />}
                  </button>
                  <button className="icon-button" type="button" onClick={() => void loadInitial()} title="Refresh" aria-label="Refresh">
                    <RefreshCw size={18} aria-hidden="true" />
                  </button>
                  <button className="icon-button" type="button" onClick={resetCanvasViewport} title="Reset view" aria-label="Reset view">
                    <RotateCcw size={18} aria-hidden="true" />
                  </button>
                  <button className="icon-button" type="button" onClick={() => setDialog({ type: "help" })} title="Canvas controls" aria-label="Canvas controls">
                    <Info size={18} aria-hidden="true" />
                  </button>
                </div>
                {saveStatus !== "idle" ? (
                  <div className={`canvas-control-group save-status ${saveStatus}`}>
                    {saveStatus === "saving" ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
                    <span>{saveStatus}</span>
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

              {state && overlayPanel === "agents" ? (
                <AgentSpecPalette
                  agents={state.agents}
                  draggingItemKey={draggingPaletteItemKey}
                  onBeginDrag={beginPaletteItemDrag}
                  onCreateAgent={() => setDialog({ type: "agent-create" })}
                  onOpenAgent={(agent) => setDialog({ type: "agent-details", agentId: agent.id })}
                  onRemoveAgent={deleteAgent}
                />
              ) : null}

              <div className="project-world" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}>
                <svg className="project-edges" aria-hidden="true">
                  {graph.edges.map((edge, edgeIndex) => {
                    const source = graph.nodes.find((node) => node.id === edge.source);
                    const target = graph.nodes.find((node) => node.id === edge.target);
                    if (!source || !target) return null;
                    const path = edgePath(source, target);
                    const labelPoint = edgeStatusPoint(source, target);
                    return (
                      <g key={edge.id}>
                        <path
                          className="project-edge-hit"
                          d={path}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            removeEdge(edge.id);
                          }}
                        />
                        <path className={`project-edge ${edge.type}`} d={path} pathLength={1} style={{ animationDelay: `${Math.min(edgeIndex * 18 + 70, 260)}ms` }} />
                        {edge.resultId ? (
                          <text className="project-edge-label" x={labelPoint.x} y={labelPoint.y - 10}>
                            {edge.resultId}
                          </text>
                        ) : null}
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
                        ? edgeForConnection(state, connectingFrom, node, routeResultByExpressionId) ? "valid" : "invalid"
                        : draggingNode && draggingNode.id === node.id
                          ? "source"
                          : draggingNode
                            ? edgeForDrop(state, draggingNode, node, routeResultByExpressionId) ? "valid" : "invalid"
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
                      selectedRouteResult={selectedRouteResultForExpression(state, node.id, routeResultByExpressionId)}
                      running={runningPlayNodeId === node.id}
                      latestStatus={latestNodeStatus(state, node.id)}
                      onPointerDown={(event) => beginNodeDrag(event, node.id)}
                      onConnectorPointerDown={(event) => beginConnection(event, node.id)}
                      onRemove={() => deleteNode(node.id)}
                      onOpen={() => {
                        if (node.type === "agent" && node.agentId) setDialog({ type: "agent-details", agentId: node.agentId });
                        if (node.type === "play") setDialog({ type: "play", nodeId: node.id });
                        if (node.type === "expression") setDialog({ type: "expression", nodeId: node.id });
                      }}
                      onPlayPromptChange={(prompt) => updateNode(node.id, { prompt })}
                      onRunPlay={() => void runPlayNode(node)}
                      onRouteResultChange={(resultId) => setRouteResultByExpressionId((current) => ({ ...current, [node.id]: resultId }))}
                      shouldSuppressClick={suppressesNodeClick}
                      enterDelayMs={Math.min(nodeIndex * 24, 180)}
                    />
                  );
                })}
                {paletteDragPreview ? <PaletteNodePreview preview={paletteDragPreview} agents={state?.agents ?? []} /> : null}
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
      {state && dialog?.type === "agent-details" ? (
        <AgentDialog
          agent={state.agents.find((agent) => agent.id === dialog.agentId) ?? null}
          models={models}
          onClose={() => setDialog(null)}
          onSave={(draft) => {
            updateAgent(dialog.agentId, draft);
            setDialog(null);
          }}
          onDelete={() => deleteAgent(dialog.agentId)}
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
      {state && dialog?.type === "expression" ? (
        <ExpressionDialog
          node={state.graph.nodes.find((node) => node.id === dialog.nodeId && node.type === "expression") ?? null}
          state={state}
          selectedResult={selectedRouteResultForExpression(state, dialog.nodeId, routeResultByExpressionId)}
          onSelectedResultChange={(resultId) => setRouteResultByExpressionId((current) => ({ ...current, [dialog.nodeId]: resultId }))}
          onClose={() => setDialog(null)}
          onConnectRoute={(resultId, target) => connectRoute(dialog.nodeId, resultId, target)}
        />
      ) : null}
      {state && dialog?.type === "results" ? (
        <ResultsDialog
          results={state.results}
          draft={resultDraft}
          onDraftChange={setResultDraft}
          onCreate={addResult}
          onUpdate={updateResult}
          onDelete={deleteResult}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {state && dialog?.type === "sessions" ? (
        <SessionsDialog
          sessions={state.sessions}
          onRefresh={() => void refreshSessions()}
          onStop={(sessionId) => void stopSession(sessionId)}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.type === "help" ? <CanvasHelpDialog onClose={() => setDialog(null)} /> : null}
    </main>
  );
}

function ProjectNodeCard({
  node,
  state,
  dragging,
  dropTarget,
  connectionState,
  selectedRouteResult,
  running,
  latestStatus,
  onPointerDown,
  onConnectorPointerDown,
  onRemove,
  onOpen,
  onPlayPromptChange,
  onRunPlay,
  onRouteResultChange,
  shouldSuppressClick,
  enterDelayMs,
}: {
  node: GraphNode;
  state: GraphState;
  dragging: boolean;
  dropTarget: boolean;
  connectionState: ConnectionState;
  selectedRouteResult: string;
  running: boolean;
  latestStatus: NodeStatus | null;
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onConnectorPointerDown: (event: React.PointerEvent) => void;
  onRemove: () => void;
  onOpen: () => void;
  onPlayPromptChange: (prompt: string) => void;
  onRunPlay: () => void;
  onRouteResultChange: (resultId: string) => void;
  shouldSuppressClick: () => boolean;
  enterDelayMs: number;
}) {
  const agent = node.type === "agent" ? state.agents.find((record) => record.id === node.agentId) : undefined;
  const statusTitle = latestStatus ? `${latestStatus.state}: ${latestStatus.summary || latestStatus.routeReason || "status"}` : "";
  const routeCount = state.graph.edges.filter((edge) => edge.source === node.id && edge.type === "routes").length;

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
          <div className="agent-node-actions">
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
              <Braces size={20} aria-hidden="true" />
              <strong>Expression</strong>
              <label className="node-editor-control expression-route-picker">
                <span>Drag route</span>
                <select
                  value={selectedRouteResult}
                  onChange={(event) => onRouteResultChange(event.target.value)}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  {state.results.map((result) => (
                    <option key={result.id} value={result.id}>
                      {result.id}
                    </option>
                  ))}
                </select>
              </label>
              <small>{routeCount === 1 ? "1 route" : `${routeCount} routes`}</small>
            </div>
          )}
        </>
      )}
    </article>
  );
}

function AgentSpecPalette({
  agents,
  draggingItemKey,
  onBeginDrag,
  onCreateAgent,
  onOpenAgent,
  onRemoveAgent,
}: {
  agents: AgentSpec[];
  draggingItemKey: string | null;
  onBeginDrag: (event: React.PointerEvent<HTMLElement>, item: PaletteItem, onOpen?: () => void) => void;
  onCreateAgent: () => void;
  onOpenAgent: (agent: AgentSpec) => void;
  onRemoveAgent: (agentId: string) => void;
}) {
  return (
    <aside className="project-card-palette agent-spec-palette" aria-label="Agent specs" onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
      <div className="palette-header">
        <strong>Agents</strong>
        <button className="palette-tab-add-button" type="button" onClick={onCreateAgent} title="Create agent" aria-label="Create agent">
          <Plus size={13} aria-hidden="true" />
        </button>
      </div>
      <div className="palette-list">
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

function PaletteNodePreview({ preview, agents }: { preview: PaletteDragPreview; agents: AgentSpec[] }) {
  const agent = agents.find((record) => record.id === preview.item.agentId);
  return (
    <article
      className={`project-node palette-node-preview agent ${preview.connection ? "connect-valid" : ""}`}
      style={{ left: preview.x, top: preview.y, width: preview.width, height: preview.height, minHeight: preview.height }}
      aria-hidden="true"
    >
      <div className="palette-node-preview-label">
        <Bot size={16} aria-hidden="true" />
        <span>{agent?.name ?? "Agent"}</span>
      </div>
    </article>
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
    <Modal title={editing ? "Agent details" : "Create agent"} onClose={onClose} side>
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
    <Modal title="Play" onClose={onClose} side>
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

function ExpressionDialog({
  node,
  state,
  selectedResult,
  onSelectedResultChange,
  onClose,
  onConnectRoute,
}: {
  node: GraphNode | null;
  state: GraphState;
  selectedResult: string;
  onSelectedResultChange: (resultId: string) => void;
  onClose: () => void;
  onConnectRoute: (resultId: string, target: string | null) => void;
}) {
  if (!node || node.type !== "expression") return null;
  const agentNodes = state.graph.nodes.filter((candidate) => candidate.type === "agent");
  const branchTargets = Object.fromEntries(state.graph.edges
    .filter((edge) => edge.source === node.id && edge.type === "routes" && edge.resultId)
    .map((edge) => [edge.resultId as string, edge.target]));
  const incomingAgent = incomingAgentForExpression(state, node);

  return (
    <Modal title="Expression" onClose={onClose} side>
      <form className="form-grid" onSubmit={(event) => event.preventDefault()}>
        <FormSection title="Evaluation">
          <div className="details-info-grid">
            <InfoRow icon={<Bot size={15} />} label="Upstream" value={incomingAgent ?? "No upstream agent"} />
            <InfoRow icon={<CircleDot size={15} />} label="Selected drag route" value={selectedResult} />
          </div>
          <label>
            <span>Result used when dragging from this expression</span>
            <select value={selectedResult} onChange={(event) => onSelectedResultChange(event.target.value)}>
              {state.results.map((result) => (
                <option key={result.id} value={result.id}>
                  {result.id}
                </option>
              ))}
            </select>
          </label>
        </FormSection>
        <FormSection title="Routes">
          <div className="route-editor-list">
            {state.results.map((result) => (
              <label key={result.id}>
                <span>{result.id}</span>
                <select value={branchTargets[result.id] ?? ""} onChange={(event) => onConnectRoute(result.id, event.target.value || null)}>
                  <option value="">None</option>
                  {agentNodes.map((agentNode) => (
                    <option key={agentNode.id} value={agentNode.id}>
                      {nodeLabel(agentNode, state)}
                    </option>
                  ))}
                </select>
                <small>{result.description}</small>
              </label>
            ))}
          </div>
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

function ResultsDialog({
  results,
  draft,
  onDraftChange,
  onCreate,
  onUpdate,
  onDelete,
  onClose,
}: {
  results: ResultDefinition[];
  draft: { id: string; description: string };
  onDraftChange: (draft: { id: string; description: string }) => void;
  onCreate: () => void;
  onUpdate: (resultId: string, description: string) => void;
  onDelete: (resultId: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal title="Results" onClose={onClose} side>
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          onCreate();
        }}
      >
        <FormSection title="New Result">
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
            Add result
          </button>
        </FormSection>
        <FormSection title="Catalog">
          <div className="record-list">
            {results.map((result) => (
              <article className={`record-card ${result.reserved ? "reserved" : ""}`} key={result.id}>
                <header>
                  <Braces size={17} aria-hidden="true" />
                  <strong>{result.id}</strong>
                  {result.reserved ? <span className="status-pill">reserved</span> : (
                    <button className="icon-button compact-icon danger" type="button" onClick={() => onDelete(result.id)} title="Delete result" aria-label="Delete result">
                      <Trash2 size={12} aria-hidden="true" />
                    </button>
                  )}
                </header>
                <textarea rows={3} value={result.description} disabled={result.reserved} onChange={(event) => onUpdate(result.id, event.target.value)} />
              </article>
            ))}
          </div>
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
    <Modal title="Sessions" onClose={onClose} side className="sessions-modal">
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

function Modal({
  title,
  children,
  onClose,
  wide,
  side,
  plainHeader,
  className: extraClassName,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
  side?: boolean;
  plainHeader?: boolean;
  className?: string;
}) {
  const [entered, setEntered] = React.useState(false);

  React.useEffect(() => {
    const frame = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const className = `${side ? `modal side ${entered ? "entered" : ""}` : wide ? "modal wide" : "modal"}${extraClassName ? ` ${extraClassName}` : ""}`;
  const backdropClassName = side ? `modal-backdrop side-backdrop ${entered ? "entered" : ""}` : "modal-backdrop";
  return createPortal(
    <div className={backdropClassName} role="presentation" onMouseDown={onClose}>
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
  return `${item.type}:${item.agentId}`;
}

function paletteConnectionForTarget(
  state: GraphState,
  sourceCandidate: GraphNode,
  target: GraphNode,
  selectedResults: Record<string, string>,
): PaletteDropConnection | null {
  if (sourceCandidate.type !== "agent") return null;
  if (target.type === "play") {
    return { source: target, target: sourceCandidate, type: "runs", targetNodeId: target.id };
  }
  if (target.type === "expression") {
    return {
      source: target,
      target: sourceCandidate,
      type: "routes",
      resultId: selectedRouteResultForExpression(state, target.id, selectedResults),
      targetNodeId: target.id,
    };
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
  selectedResults: Record<string, string>,
): Omit<GraphEdge, "id"> | null {
  return edgeForConnection(state, dragged, target, selectedResults) ?? edgeForConnection(state, target, dragged, selectedResults);
}

function edgeForConnection(
  state: GraphState,
  source: GraphNode,
  target: GraphNode,
  selectedResults: Record<string, string>,
): Omit<GraphEdge, "id"> | null {
  if (source.id === target.id) return null;
  if (source.type === "play" && target.type === "agent") return { source: source.id, target: target.id, type: "runs" };
  if (source.type === "agent" && target.type === "expression") return { source: source.id, target: target.id, type: "evaluates" };
  if (source.type === "expression" && target.type === "agent") {
    return {
      source: source.id,
      target: target.id,
      type: "routes",
      resultId: selectedRouteResultForExpression(state, source.id, selectedResults),
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
  return {
    ...state,
    graph: {
      ...state.graph,
      edges: upsertEdges(state.graph.edges, edge),
    },
  };
}

function upsertEdges(edges: GraphEdge[], edge: Omit<GraphEdge, "id">): GraphEdge[] {
  const duplicate = edges.some((candidate) =>
    candidate.source === edge.source &&
    candidate.target === edge.target &&
    candidate.type === edge.type &&
    candidate.resultId === edge.resultId
  );
  if (duplicate) return edges;
  const filtered = edges.filter((candidate) => {
    if (edge.type === "runs" || edge.type === "evaluates") {
      return !(candidate.source === edge.source && candidate.type === edge.type);
    }
    return !(candidate.source === edge.source && candidate.type === "routes" && candidate.resultId === edge.resultId);
  });
  return [...filtered, { id: newId("edge"), ...edge }];
}

function selectedRouteResultForExpression(
  state: GraphState,
  expressionId: string,
  selectedResults: Record<string, string>,
): string {
  const selected = selectedResults[expressionId];
  if (selected && state.results.some((result) => result.id === selected)) return selected;
  return state.results.find((result) => !result.reserved)?.id ?? "unknown";
}

function edgePath(source: GraphNode, target: GraphNode): string {
  const sourcePoint = projectNodeCenter(source);
  const targetPoint = projectNodeCenter(target);
  const midX = (sourcePoint.x + targetPoint.x) / 2;
  return `M ${sourcePoint.x} ${sourcePoint.y} C ${midX} ${sourcePoint.y}, ${midX} ${targetPoint.y}, ${targetPoint.x} ${targetPoint.y}`;
}

function edgeStatusPoint(source: GraphNode, target: GraphNode): { x: number; y: number } {
  const sourcePoint = projectNodeCenter(source);
  const targetPoint = projectNodeCenter(target);
  return {
    x: (sourcePoint.x + targetPoint.x) / 2,
    y: (sourcePoint.y + targetPoint.y) / 2,
  };
}

function connectionPreviewPath(source: GraphNode, target: { x: number; y: number }): string {
  const sourcePoint = projectNodeCenter(source);
  const midX = (sourcePoint.x + target.x) / 2;
  return `M ${sourcePoint.x} ${sourcePoint.y} C ${midX} ${sourcePoint.y}, ${midX} ${target.y}, ${target.x} ${target.y}`;
}

function projectNodeCenter(node: GraphNode): { x: number; y: number } {
  const size = projectNodeSizeForType(node.type);
  return { x: node.x + size.width / 2, y: node.y + size.height / 2 };
}

function projectNodeSizeForType(type: GraphNodeType): { width: number; height: number } {
  if (type === "play") return { width: 260, height: 132 };
  if (type === "agent") return { width: 180, height: 88 };
  return { width: 220, height: 138 };
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
  return {
    ...state,
    graph: {
      ...state.graph,
      nodes: state.graph.nodes.map((node) => node.id === nodeId ? update(node) : node),
    },
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

function incomingAgentForExpression(state: GraphState, node: GraphNode) {
  if (node.type !== "expression") return null;
  const incoming = state.graph.edges.find((edge) => edge.target === node.id && edge.type === "evaluates");
  const source = incoming ? state.graph.nodes.find((candidate) => candidate.id === incoming.source && candidate.type === "agent") : null;
  return source ? nodeLabel(source, state) : null;
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
