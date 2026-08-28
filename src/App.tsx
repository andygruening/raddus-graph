import React from "react";
import {
  Bot,
  Braces,
  CircleDot,
  Database,
  GitPullRequest,
  Loader2,
  Network,
  Play,
  Plus,
  RefreshCw,
  Save,
  Square,
  Trash2,
} from "lucide-react";
import {
  type AgentSpec,
  type BranchListResult,
  type GraphEdge,
  type GraphNode,
  type GraphSession,
  type GraphState,
  type ModelCatalogEntry,
  type RepositoryListResult,
  type RepositoryOption,
  type ResultDefinition,
  RaddusGraphApi,
} from "./api/RaddusGraphApi";

type ActiveTab = "graph" | "agents" | "results" | "sessions";
type SaveStatus = "idle" | "saving" | "saved" | "error";

const api = new RaddusGraphApi();
const nodeWidth = 292;
const nodeHeight = 172;
const reservedResultIds = new Set(["unknown", "fallback"]);

export default function App() {
  const [state, setState] = React.useState<GraphState | null>(null);
  const [models, setModels] = React.useState<ModelCatalogEntry[]>([]);
  const [repositoryResult, setRepositoryResult] = React.useState<RepositoryListResult | null>(null);
  const [branchesByRepo, setBranchesByRepo] = React.useState<Record<string, BranchListResult>>({});
  const [activeTab, setActiveTab] = React.useState<ActiveTab>("graph");
  const [loading, setLoading] = React.useState(true);
  const [saveStatus, setSaveStatus] = React.useState<SaveStatus>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [runningPlayNodeId, setRunningPlayNodeId] = React.useState<string | null>(null);
  const [agentDraft, setAgentDraft] = React.useState(() => defaultAgentDraft());
  const [resultDraft, setResultDraft] = React.useState({ id: "", description: "" });
  const [drag, setDrag] = React.useState<{ nodeId: string; offsetX: number; offsetY: number } | null>(null);
  const canvasRef = React.useRef<HTMLDivElement | null>(null);
  const latestState = React.useRef<GraphState | null>(null);

  React.useEffect(() => {
    latestState.current = state;
  }, [state]);

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
    if (!drag) return undefined;
    const move = (event: PointerEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = Math.max(24, event.clientX - rect.left - drag.offsetX);
      const y = Math.max(24, event.clientY - rect.top - drag.offsetY);
      setState((current) => current ? updateNodeInState(current, drag.nodeId, (node) => ({ ...node, x, y })) : current);
    };
    const up = () => {
      const current = latestState.current;
      if (current) void persistState(current);
      setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [drag]);

  async function loadInitial() {
    setLoading(true);
    setError(null);
    try {
      const [nextState, modelPayload, repositories] = await Promise.all([
        api.getState(),
        api.getModels(),
        api.listRepositories(),
      ]);
      setState(nextState);
      setModels(modelPayload.models);
      setRepositoryResult(repositories);
      setAgentDraft(defaultAgentDraft(modelPayload.models[0]?.id));
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }

  async function refreshSessions() {
    try {
      const payload = await api.listSessions();
      setState((current) => current ? { ...current, sessions: payload.sessions } : current);
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
      setState((current) => current ? { ...saved, sessions: current.sessions } : saved);
      setSaveStatus("saved");
      window.setTimeout(() => setSaveStatus("idle"), 1400);
    } catch (saveError) {
      setSaveStatus("error");
      setError(errorMessage(saveError));
    }
  }

  function mutateState(update: (current: GraphState) => GraphState, persist = true) {
    setState((current) => {
      if (!current) return current;
      const next = update(current);
      if (persist) void persistState(next);
      return next;
    });
  }

  function createAgent() {
    const name = agentDraft.name.trim();
    const model = agentDraft.model.trim();
    if (!name || !model) {
      setError("Agent name and model are required.");
      return;
    }
    const now = new Date().toISOString();
    const agent: AgentSpec = {
      id: newId("agent"),
      name,
      model,
      systemPrompt: agentDraft.systemPrompt.trim(),
      createdAt: now,
      updatedAt: now,
    };
    mutateState((current) => ({
      ...current,
      agents: [...current.agents, agent],
    }));
    setAgentDraft(defaultAgentDraft(models[0]?.id));
  }

  function updateAgent(agentId: string, patch: Partial<AgentSpec>) {
    mutateState((current) => ({
      ...current,
      agents: current.agents.map((agent) => agent.id === agentId ? { ...agent, ...patch, updatedAt: new Date().toISOString() } : agent),
      graph: patch.id ? current.graph : current.graph,
    }));
  }

  function deleteAgent(agentId: string) {
    mutateState((current) => ({
      ...current,
      agents: current.agents.filter((agent) => agent.id !== agentId),
      graph: {
        nodes: current.graph.nodes.map((node) => node.type === "agent" && node.agentId === agentId ? { ...node, agentId: null } : node),
        edges: current.graph.edges,
      },
    }));
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

  function addNode(type: GraphNode["type"]) {
    mutateState((current) => {
      const count = current.graph.nodes.length;
      const node: GraphNode = {
        id: newId(type),
        type,
        x: 80 + (count % 3) * 340,
        y: 96 + Math.floor(count / 3) * 260,
        ...(type === "play" ? { prompt: "", repository: null, branch: null } : {}),
        ...(type === "agent" ? { agentId: current.agents[0]?.id ?? null } : {}),
      };
      return {
        ...current,
        graph: { ...current.graph, nodes: [...current.graph.nodes, node] },
      };
    });
  }

  function deleteNode(nodeId: string) {
    mutateState((current) => ({
      ...current,
      graph: {
        nodes: current.graph.nodes.filter((node) => node.id !== nodeId),
        edges: current.graph.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
      },
    }));
  }

  function updateNode(nodeId: string, patch: Partial<GraphNode>) {
    mutateState((current) => updateNodeInState(current, nodeId, (node) => ({ ...node, ...patch })));
  }

  function connectSingle(source: string, target: string | null, type: GraphEdge["type"]) {
    mutateState((current) => ({
      ...current,
      graph: {
        nodes: current.graph.nodes,
        edges: [
          ...current.graph.edges.filter((edge) => !(edge.source === source && edge.type === type)),
          ...(target ? [{ id: newId("edge"), source, target, type }] : []),
        ],
      },
    }));
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
    if (!state || node.type !== "play") return;
    const prompt = (node.prompt ?? "").trim();
    if (!prompt) {
      setError("Enter a play prompt before running.");
      return;
    }
    setRunningPlayNodeId(node.id);
    setError(null);
    try {
      const saved = await api.saveState({ agents: state.agents, results: state.results, graph: state.graph });
      const repository = node.repository || null;
      const repositoryOption = repositoryResult?.repositories.find((candidate) => candidate.nameWithOwner === repository);
      const payload = await api.createSession({
        playNodeId: node.id,
        prompt,
        repository,
        repositoryUrl: repositoryOption?.url,
        branch: repository ? node.branch || repositoryOption?.defaultBranch || "main" : null,
      });
      setState({ ...saved, sessions: [payload.session, ...saved.sessions.filter((session) => session.id !== payload.session.id)] });
      setActiveTab("sessions");
    } catch (runError) {
      setError(errorMessage(runError));
    } finally {
      setRunningPlayNodeId(null);
    }
  }

  async function stopSession(sessionId: string) {
    try {
      const payload = await api.stopSession(sessionId);
      setState((current) => current ? {
        ...current,
        sessions: current.sessions.map((session) => session.id === sessionId ? payload.session : session),
      } : current);
    } catch (stopError) {
      setError(errorMessage(stopError));
    }
  }

  const repositories = repositoryResult?.repositories ?? [];
  const runningSessions = state?.sessions.filter((session) => session.status === "running").length ?? 0;

  return (
    <div className="rg-app">
      <aside className="rg-sidebar">
        <div className="rg-brand">
          <img src="/raddus-logo.png" alt="" />
          <div>
            <strong>Raddus Graph</strong>
            <span>Local agent graph</span>
          </div>
        </div>
        <nav className="rg-nav" aria-label="Primary">
          <TabButton active={activeTab === "graph"} icon={<Network size={18} />} label="Graph" onClick={() => setActiveTab("graph")} />
          <TabButton active={activeTab === "agents"} icon={<Bot size={18} />} label="Agents" onClick={() => setActiveTab("agents")} />
          <TabButton active={activeTab === "results"} icon={<Braces size={18} />} label="Results" onClick={() => setActiveTab("results")} />
          <TabButton active={activeTab === "sessions"} icon={<CircleDot size={18} />} label={`Sessions${runningSessions ? ` ${runningSessions}` : ""}`} onClick={() => setActiveTab("sessions")} />
        </nav>
        <div className="rg-store">
          <Database size={16} />
          <span>{state?.dataDir ?? ".raddus-graph"}</span>
        </div>
      </aside>

      <main className="rg-main">
        <header className="rg-topbar">
          <div>
            <h1>{tabTitle(activeTab)}</h1>
            <p>{tabSubtitle(activeTab)}</p>
          </div>
          <div className="rg-topbar-actions">
            {saveStatus === "saving" ? <span className="rg-save-status"><Loader2 className="rg-spin" size={16} /> Saving</span> : null}
            {saveStatus === "saved" ? <span className="rg-save-status saved"><Save size={16} /> Saved</span> : null}
            <button className="rg-icon-button" type="button" onClick={() => void loadInitial()} title="Refresh">
              <RefreshCw size={18} />
            </button>
          </div>
        </header>

        {error ? <div className="rg-notice error">{error}</div> : null}
        {loading || !state ? (
          <div className="rg-loading"><Loader2 className="rg-spin" size={24} /> Loading Raddus Graph</div>
        ) : (
          <>
            {activeTab === "graph" ? (
              <GraphView
                state={state}
                models={models}
                repositories={repositories}
                repositoryResult={repositoryResult}
                branchesByRepo={branchesByRepo}
                runningPlayNodeId={runningPlayNodeId}
                canvasRef={canvasRef}
                onAddNode={addNode}
                onDeleteNode={deleteNode}
                onUpdateNode={updateNode}
                onConnectSingle={connectSingle}
                onConnectRoute={connectRoute}
                onRunPlayNode={(node) => void runPlayNode(node)}
                onLoadBranches={(repo) => void loadBranches(repo)}
                onDragStart={(event, node) => {
                  const canvas = canvasRef.current;
                  if (!canvas) return;
                  const rect = canvas.getBoundingClientRect();
                  setDrag({ nodeId: node.id, offsetX: event.clientX - rect.left - node.x, offsetY: event.clientY - rect.top - node.y });
                }}
              />
            ) : null}
            {activeTab === "agents" ? (
              <AgentsView
                agents={state.agents}
                models={models}
                draft={agentDraft}
                onDraftChange={setAgentDraft}
                onCreate={createAgent}
                onUpdate={updateAgent}
                onDelete={deleteAgent}
              />
            ) : null}
            {activeTab === "results" ? (
              <ResultsView
                results={state.results}
                draft={resultDraft}
                onDraftChange={setResultDraft}
                onCreate={addResult}
                onUpdate={updateResult}
                onDelete={deleteResult}
              />
            ) : null}
            {activeTab === "sessions" ? (
              <SessionsView sessions={state.sessions} onRefresh={() => void refreshSessions()} onStop={(sessionId) => void stopSession(sessionId)} />
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}

function GraphView({
  state,
  repositories,
  repositoryResult,
  branchesByRepo,
  runningPlayNodeId,
  canvasRef,
  onAddNode,
  onDeleteNode,
  onUpdateNode,
  onConnectSingle,
  onConnectRoute,
  onRunPlayNode,
  onLoadBranches,
  onDragStart,
}: {
  state: GraphState;
  models: ModelCatalogEntry[];
  repositories: RepositoryOption[];
  repositoryResult: RepositoryListResult | null;
  branchesByRepo: Record<string, BranchListResult>;
  runningPlayNodeId: string | null;
  canvasRef: React.RefObject<HTMLDivElement | null>;
  onAddNode: (type: GraphNode["type"]) => void;
  onDeleteNode: (nodeId: string) => void;
  onUpdateNode: (nodeId: string, patch: Partial<GraphNode>) => void;
  onConnectSingle: (source: string, target: string | null, type: GraphEdge["type"]) => void;
  onConnectRoute: (source: string, resultId: string, target: string | null) => void;
  onRunPlayNode: (node: GraphNode) => void;
  onLoadBranches: (repo: string) => void;
  onDragStart: (event: React.PointerEvent, node: GraphNode) => void;
}) {
  const agentNodes = state.graph.nodes.filter((node) => node.type === "agent");
  const expressionNodes = state.graph.nodes.filter((node) => node.type === "expression");
  return (
    <section className="rg-graph-shell">
      <div className="rg-graph-toolbar">
        <button type="button" className="rg-secondary-button" onClick={() => onAddNode("play")}><Play size={16} /> Play</button>
        <button type="button" className="rg-secondary-button" onClick={() => onAddNode("agent")}><Bot size={16} /> Agent</button>
        <button type="button" className="rg-secondary-button" onClick={() => onAddNode("expression")}><Braces size={16} /> Expression</button>
        {repositoryResult && !repositoryResult.authenticated ? <span className="rg-muted">GitHub: None only</span> : null}
      </div>
      <div className="rg-canvas-viewport">
        <div className="rg-canvas" ref={canvasRef}>
          <svg className="rg-edges" width="1800" height="1200" aria-hidden="true">
            <defs>
              <marker id="rg-arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">
                <path d="M0,0 L9,4.5 L0,9 z" fill="currentColor" />
              </marker>
            </defs>
            {state.graph.edges.map((edge) => (
              <GraphEdgeLine key={edge.id} edge={edge} nodes={state.graph.nodes} />
            ))}
          </svg>
          {state.graph.nodes.map((node) => (
            <GraphNodeCard
              key={node.id}
              node={node}
              state={state}
              agentNodes={agentNodes}
              expressionNodes={expressionNodes}
              repositories={repositories}
              branchesByRepo={branchesByRepo}
              running={runningPlayNodeId === node.id}
              onDelete={() => onDeleteNode(node.id)}
              onUpdate={(patch) => onUpdateNode(node.id, patch)}
              onConnectSingle={(target, type) => onConnectSingle(node.id, target, type)}
              onConnectRoute={(resultId, target) => onConnectRoute(node.id, resultId, target)}
              onRun={() => onRunPlayNode(node)}
              onLoadBranches={onLoadBranches}
              onDragStart={(event) => onDragStart(event, node)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function GraphEdgeLine({ edge, nodes }: { edge: GraphEdge; nodes: GraphNode[] }) {
  const source = nodes.find((node) => node.id === edge.source);
  const target = nodes.find((node) => node.id === edge.target);
  if (!source || !target) return null;
  const start = { x: source.x + nodeWidth, y: source.y + 78 };
  const end = { x: target.x, y: target.y + 78 };
  const midX = (start.x + end.x) / 2;
  const path = `M ${start.x} ${start.y} C ${midX} ${start.y}, ${midX} ${end.y}, ${end.x} ${end.y}`;
  return (
    <g className={`rg-edge ${edge.type}`}>
      <path d={path} markerEnd="url(#rg-arrow)" />
      {edge.resultId ? <text x={midX} y={(start.y + end.y) / 2 - 8}>{edge.resultId}</text> : null}
    </g>
  );
}

function GraphNodeCard({
  node,
  state,
  agentNodes,
  expressionNodes,
  repositories,
  branchesByRepo,
  running,
  onDelete,
  onUpdate,
  onConnectSingle,
  onConnectRoute,
  onRun,
  onLoadBranches,
  onDragStart,
}: {
  node: GraphNode;
  state: GraphState;
  agentNodes: GraphNode[];
  expressionNodes: GraphNode[];
  repositories: RepositoryOption[];
  branchesByRepo: Record<string, BranchListResult>;
  running: boolean;
  onDelete: () => void;
  onUpdate: (patch: Partial<GraphNode>) => void;
  onConnectSingle: (target: string | null, type: GraphEdge["type"]) => void;
  onConnectRoute: (resultId: string, target: string | null) => void;
  onRun: () => void;
  onLoadBranches: (repo: string) => void;
  onDragStart: (event: React.PointerEvent) => void;
}) {
  const agent = node.type === "agent" ? state.agents.find((candidate) => candidate.id === node.agentId) : null;
  const title = node.type === "play" ? "Play" : node.type === "expression" ? "Expression" : agent?.name ?? "Agent";
  const incomingAgent = incomingAgentForExpression(state, node);
  const nextAgentId = edgeTarget(state.graph.edges, node.id, node.type === "play" ? "runs" : "evaluates");
  const branchTargets = Object.fromEntries(state.graph.edges
    .filter((edge) => edge.source === node.id && edge.type === "routes" && edge.resultId)
    .map((edge) => [edge.resultId as string, edge.target]));
  const repoBranches = node.repository ? branchesByRepo[node.repository]?.branches ?? [] : [];

  return (
    <article className={`rg-node ${node.type}`} style={{ transform: `translate(${node.x}px, ${node.y}px)` }}>
      <header className="rg-node-header" onPointerDown={onDragStart}>
        <span>{nodeIcon(node.type)}</span>
        <strong>{title}</strong>
        <button type="button" className="rg-node-delete" title="Delete node" onPointerDown={(event) => event.stopPropagation()} onClick={onDelete}><Trash2 size={15} /></button>
      </header>

      {node.type === "play" ? (
        <div className="rg-node-body">
          <label>
            <span>Prompt</span>
            <textarea value={node.prompt ?? ""} rows={3} onChange={(event) => onUpdate({ prompt: event.target.value })} />
          </label>
          <div className="rg-field-grid">
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
                {repositories.map((repo) => <option key={repo.nameWithOwner} value={repo.nameWithOwner}>{repo.nameWithOwner}</option>)}
              </select>
            </label>
            <label>
              <span>Branch</span>
              <select value={node.branch ?? ""} disabled={!node.repository} onChange={(event) => onUpdate({ branch: event.target.value || null })}>
                <option value="">None</option>
                {(repoBranches.length ? repoBranches : [node.branch].filter(Boolean) as string[]).map((branch) => <option key={branch} value={branch}>{branch}</option>)}
              </select>
            </label>
          </div>
          <label>
            <span>Runs</span>
            <NodeSelect value={nextAgentId} nodes={agentNodes} state={state} onChange={(target) => onConnectSingle(target, "runs")} />
          </label>
          <button type="button" className="rg-primary-button" disabled={running} onClick={onRun}>
            {running ? <Loader2 className="rg-spin" size={16} /> : <Play size={16} />} Run
          </button>
        </div>
      ) : null}

      {node.type === "agent" ? (
        <div className="rg-node-body">
          <label>
            <span>Agent spec</span>
            <select value={node.agentId ?? ""} onChange={(event) => onUpdate({ agentId: event.target.value || null })}>
              <option value="">Unassigned</option>
              {state.agents.map((spec) => <option key={spec.id} value={spec.id}>{spec.name}</option>)}
            </select>
          </label>
          <div className="rg-node-meta">{agent ? agent.model : "No model"}</div>
          <label>
            <span>Evaluates</span>
            <NodeSelect value={nextAgentId} nodes={expressionNodes} state={state} onChange={(target) => onConnectSingle(target, "evaluates")} />
          </label>
        </div>
      ) : null}

      {node.type === "expression" ? (
        <div className="rg-node-body">
          <div className="rg-node-meta">{incomingAgent ? `From ${incomingAgent}` : "No upstream agent"}</div>
          <div className="rg-branch-list">
            {state.results.map((result) => (
              <label key={result.id}>
                <span>{result.id}</span>
                <NodeSelect value={branchTargets[result.id] ?? null} nodes={agentNodes} state={state} onChange={(target) => onConnectRoute(result.id, target)} />
              </label>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function AgentsView({
  agents,
  models,
  draft,
  onDraftChange,
  onCreate,
  onUpdate,
  onDelete,
}: {
  agents: AgentSpec[];
  models: ModelCatalogEntry[];
  draft: Pick<AgentSpec, "name" | "model" | "systemPrompt">;
  onDraftChange: (draft: Pick<AgentSpec, "name" | "model" | "systemPrompt">) => void;
  onCreate: () => void;
  onUpdate: (agentId: string, patch: Partial<AgentSpec>) => void;
  onDelete: (agentId: string) => void;
}) {
  return (
    <section className="rg-panel-grid">
      <form className="rg-editor-panel" onSubmit={(event) => { event.preventDefault(); onCreate(); }}>
        <h2>New Agent</h2>
        <label>
          <span>Name</span>
          <input value={draft.name} onChange={(event) => onDraftChange({ ...draft, name: event.target.value })} />
        </label>
        <label>
          <span>Model</span>
          <select value={draft.model} onChange={(event) => onDraftChange({ ...draft, model: event.target.value })}>
            {models.map((model) => <option key={model.id} value={model.id}>{model.label} ({model.runner})</option>)}
          </select>
        </label>
        <label>
          <span>System prompt</span>
          <textarea rows={8} value={draft.systemPrompt} onChange={(event) => onDraftChange({ ...draft, systemPrompt: event.target.value })} />
        </label>
        <button className="rg-primary-button" type="submit"><Plus size={16} /> Create</button>
      </form>
      <div className="rg-list-panel">
        {agents.map((agent) => (
          <article className="rg-record" key={agent.id}>
            <div className="rg-record-header">
              <Bot size={18} />
              <strong>{agent.name}</strong>
              <button type="button" className="rg-icon-button danger" onClick={() => onDelete(agent.id)} title="Delete agent"><Trash2 size={16} /></button>
            </div>
            <label>
              <span>Name</span>
              <input value={agent.name} onChange={(event) => onUpdate(agent.id, { name: event.target.value })} />
            </label>
            <label>
              <span>Model</span>
              <select value={agent.model} onChange={(event) => onUpdate(agent.id, { model: event.target.value })}>
                {models.map((model) => <option key={model.id} value={model.id}>{model.label} ({model.runner})</option>)}
              </select>
            </label>
            <label>
              <span>System prompt</span>
              <textarea rows={5} value={agent.systemPrompt} onChange={(event) => onUpdate(agent.id, { systemPrompt: event.target.value })} />
            </label>
          </article>
        ))}
        {agents.length === 0 ? <EmptyState icon={<Bot size={24} />} title="No agents" /> : null}
      </div>
    </section>
  );
}

function ResultsView({
  results,
  draft,
  onDraftChange,
  onCreate,
  onUpdate,
  onDelete,
}: {
  results: ResultDefinition[];
  draft: { id: string; description: string };
  onDraftChange: (draft: { id: string; description: string }) => void;
  onCreate: () => void;
  onUpdate: (resultId: string, description: string) => void;
  onDelete: (resultId: string) => void;
}) {
  return (
    <section className="rg-panel-grid">
      <form className="rg-editor-panel" onSubmit={(event) => { event.preventDefault(); onCreate(); }}>
        <h2>New Result</h2>
        <label>
          <span>ID</span>
          <input value={draft.id} onChange={(event) => onDraftChange({ ...draft, id: event.target.value })} placeholder="approved" />
        </label>
        <label>
          <span>Description</span>
          <textarea rows={5} value={draft.description} onChange={(event) => onDraftChange({ ...draft, description: event.target.value })} />
        </label>
        <button className="rg-primary-button" type="submit"><Plus size={16} /> Add</button>
      </form>
      <div className="rg-list-panel">
        {results.map((result) => (
          <article className={`rg-record ${result.reserved ? "reserved" : ""}`} key={result.id}>
            <div className="rg-record-header">
              <Braces size={18} />
              <strong>{result.id}</strong>
              {result.reserved ? <span className="rg-chip">reserved</span> : <button type="button" className="rg-icon-button danger" onClick={() => onDelete(result.id)} title="Delete result"><Trash2 size={16} /></button>}
            </div>
            <label>
              <span>Description</span>
              <textarea rows={3} value={result.description} disabled={result.reserved} onChange={(event) => onUpdate(result.id, event.target.value)} />
            </label>
          </article>
        ))}
      </div>
    </section>
  );
}

function SessionsView({ sessions, onRefresh, onStop }: { sessions: GraphSession[]; onRefresh: () => void; onStop: (sessionId: string) => void }) {
  return (
    <section className="rg-session-shell">
      <div className="rg-section-actions">
        <button type="button" className="rg-secondary-button" onClick={onRefresh}><RefreshCw size={16} /> Refresh</button>
      </div>
      {sessions.length === 0 ? <EmptyState icon={<CircleDot size={24} />} title="No graph sessions" /> : null}
      {sessions.map((session) => {
        const latestStatuses = Object.values(session.nodeStatuses).flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6);
        return (
          <article className="rg-session" key={session.id}>
            <header>
              <div>
                <strong>{session.id}</strong>
                <span className={`rg-status ${session.status}`}>{session.status}</span>
              </div>
              <div className="rg-session-actions">
                {session.prUrl ? <a className="rg-secondary-link" href={session.prUrl} target="_blank" rel="noreferrer"><GitPullRequest size={16} /> PR</a> : null}
                {session.status === "running" ? <button type="button" className="rg-secondary-button" onClick={() => onStop(session.id)}><Square size={16} /> Stop</button> : null}
              </div>
            </header>
            <div className="rg-session-meta">
              <span>{formatDateTime(session.createdAt)}</span>
              <span>{session.repository ? `${session.repository.nameWithOwner}@${session.repository.branch}` : "None"}</span>
              <span>{session.workspacePath}</span>
            </div>
            <p>{session.prompt}</p>
            {session.error ? <div className="rg-notice error">{session.error}</div> : null}
            <div className="rg-status-list">
              {latestStatuses.map((status) => (
                <div key={status.id}>
                  <span className={`rg-status ${status.state}`}>{status.state}</span>
                  <strong>{status.nodeId}</strong>
                  <span>{status.summary || status.routeReason || "status"}</span>
                  {status.routedResultId ? <code>{status.routedResultId}</code> : null}
                </div>
              ))}
            </div>
          </article>
        );
      })}
    </section>
  );
}

function NodeSelect({ value, nodes, state, onChange }: { value: string | null | undefined; nodes: GraphNode[]; state: GraphState; onChange: (target: string | null) => void }) {
  return (
    <select value={value ?? ""} onChange={(event) => onChange(event.target.value || null)}>
      <option value="">None</option>
      {nodes.map((node) => <option key={node.id} value={node.id}>{nodeLabel(node, state)}</option>)}
    </select>
  );
}

function TabButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button className={active ? "active" : ""} type="button" onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function EmptyState({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="rg-empty">
      {icon}
      <strong>{title}</strong>
    </div>
  );
}

function nodeIcon(type: GraphNode["type"]) {
  if (type === "play") return <Play size={17} />;
  if (type === "agent") return <Bot size={17} />;
  return <Braces size={17} />;
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

function edgeTarget(edges: GraphEdge[], source: string, type: GraphEdge["type"]) {
  return edges.find((edge) => edge.source === source && edge.type === type)?.target ?? null;
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

function defaultAgentDraft(model = "gpt-5-codex"): Pick<AgentSpec, "name" | "model" | "systemPrompt"> {
  return { name: "", model, systemPrompt: "" };
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

function tabTitle(tab: ActiveTab) {
  if (tab === "agents") return "Agents";
  if (tab === "results") return "Results";
  if (tab === "sessions") return "Sessions";
  return "Graph";
}

function tabSubtitle(tab: ActiveTab) {
  if (tab === "agents") return "Model, name, and system prompt";
  if (tab === "results") return "Shared terminal outcomes";
  if (tab === "sessions") return "Local runs, workspaces, and pull requests";
  return "Play nodes, agents, and expressions";
}
