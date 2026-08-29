export type RunnerId = "codex" | "claude";
export type GraphNodeType = "play" | "agent" | "expression";
export type GraphEdgeType = "runs" | "evaluates" | "routes";
export type GraphSessionStatus = "running" | "completed" | "failed" | "stopped";
export type NodeStatusState = "queued" | "started" | "working" | "blocked" | "completed" | "failed" | "stopped";

export interface ModelCatalogEntry {
  id: string;
  label: string;
  runner: RunnerId;
}

export interface AgentSpec {
  id: string;
  name: string;
  model: string;
  systemPrompt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResultDefinition {
  id: string;
  description: string;
  reserved?: boolean;
}

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  x: number;
  y: number;
  prompt?: string;
  repository?: string | null;
  branch?: string | null;
  agentId?: string | null;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: GraphEdgeType;
  resultId?: string;
  bend?: { x: number; y: number } | null;
}

export interface GraphDocument {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface ProjectRecord {
  id: string;
  name: string;
  graph: GraphDocument;
  createdAt: string;
  updatedAt: string;
}

export interface NodeStatus {
  id: string;
  nodeId: string;
  state: NodeStatusState;
  summary: string;
  detail: string;
  emittedResultId: string | null;
  routedResultId: string | null;
  routeReason: string | null;
  source: string;
  stdout: string;
  stderr: string;
  createdAt: string;
}

export interface TerminalOutcome {
  id: string;
  nodeId: string;
  state: "completed" | "failed" | "stopped";
  emittedResultId: string | null;
  routedResultId: string | null;
  routeReason: string | null;
  summary: string;
  detail: string;
  stdout: string;
  stderr: string;
  createdAt: string;
}

export interface GraphSession {
  id: string;
  status: GraphSessionStatus;
  playNodeId: string;
  prompt: string;
  repository: { nameWithOwner: string; url: string; branch: string } | null;
  workspacePath: string;
  branchName: string | null;
  prUrl: string | null;
  activeNodeId: string | null;
  projectId: string | null;
  projectName: string | null;
  nodeStatuses: Record<string, NodeStatus[]>;
  nodeOutcomes: Record<string, TerminalOutcome>;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GraphState {
  version: number;
  agents: AgentSpec[];
  results: ResultDefinition[];
  projects: ProjectRecord[];
  selectedProjectId: string;
  graph: GraphDocument;
  sessions: GraphSession[];
  updatedAt: string;
  dataDir: string;
}

export interface RepositoryOption {
  nameWithOwner: string;
  url: string;
  defaultBranch: string;
  description: string;
  isPrivate: boolean;
}

export interface RepositoryListResult {
  available: boolean;
  authenticated: boolean;
  error: string | null;
  repositories: RepositoryOption[];
}

export interface BranchListResult {
  available: boolean;
  authenticated: boolean;
  error: string | null;
  branches: string[];
}

export class RaddusGraphApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "RaddusGraphApiError";
  }
}

export class RaddusGraphApi {
  getState(): Promise<GraphState> {
    return requestJson<GraphState>("/api/graph/state");
  }

  saveState(state: Pick<GraphState, "agents" | "results" | "graph"> & Partial<Pick<GraphState, "projects" | "selectedProjectId">>): Promise<GraphState> {
    return requestJson<GraphState>("/api/graph/state", jsonInit("PUT", state));
  }

  getModels(): Promise<{ models: ModelCatalogEntry[] }> {
    return requestJson<{ models: ModelCatalogEntry[] }>("/api/graph/models");
  }

  listRepositories(): Promise<RepositoryListResult> {
    return requestJson<RepositoryListResult>("/api/graph/repositories");
  }

  listBranches(repo: string): Promise<BranchListResult> {
    return requestJson<BranchListResult>(`/api/graph/branches?repo=${encodeURIComponent(repo)}`);
  }

  listSessions(): Promise<{ sessions: GraphSession[] }> {
    return requestJson<{ sessions: GraphSession[] }>("/api/graph/sessions");
  }

  createSession(payload: { projectId?: string; playNodeId: string; prompt: string; repository?: string | null; repositoryUrl?: string; branch?: string | null }): Promise<{ session: GraphSession }> {
    return requestJson<{ session: GraphSession }>("/api/graph/sessions", jsonInit("POST", payload));
  }

  stopSession(sessionId: string): Promise<{ session: GraphSession }> {
    return requestJson<{ session: GraphSession }>(`/api/graph/sessions/${encodeURIComponent(sessionId)}/stop`, jsonInit("POST"));
  }
}

function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
  });
  const payload = await responsePayload(response);
  if (!response.ok) {
    throw new RaddusGraphApiError(errorMessage(payload) ?? `Request failed with ${response.status}`, response.status);
  }
  return payload as T;
}

async function responsePayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function errorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const error = record.error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && typeof (error as Record<string, unknown>).message === "string") {
    return (error as Record<string, string>).message;
  }
  if (typeof record.message === "string") return record.message;
  return null;
}
