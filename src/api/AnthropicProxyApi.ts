export const ANTHROPIC_PUBLIC_API_BASE_URL = "https://api.anthropic.com";

export class AnthropicApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly requestId?: string | null,
  ) {
    super(message);
    this.name = "AnthropicApiError";
  }
}

export class AnthropicProxyApi {
  async listAgents(): Promise<unknown[]> {
    return this.request("/agents");
  }

  async createAgent(payload: unknown): Promise<unknown> {
    return this.request("/agents", jsonInit("POST", payload));
  }

  async updateAgent(agentId: string, payload: unknown): Promise<unknown> {
    return this.request(`/agents/${encodeURIComponent(agentId)}`, jsonInit("PATCH", payload));
  }

  async archiveAgent(agentId: string): Promise<unknown> {
    return this.request(`/agents/${encodeURIComponent(agentId)}/archive`, jsonInit("POST"));
  }

  async listEnvironments(): Promise<unknown[]> {
    return this.request("/environments");
  }

  async createEnvironment(payload: unknown): Promise<unknown> {
    return this.request("/environments", jsonInit("POST", payload));
  }

  async updateEnvironment(environmentId: string, payload: unknown): Promise<unknown> {
    return this.request(`/environments/${encodeURIComponent(environmentId)}`, jsonInit("PATCH", payload));
  }

  async deleteEnvironment(environmentId: string): Promise<unknown> {
    return this.request(`/environments/${encodeURIComponent(environmentId)}`, jsonInit("DELETE"));
  }

  async listDeployments(): Promise<unknown[]> {
    return this.request("/deployments");
  }

  async createDeployment(payload: unknown): Promise<unknown> {
    return this.request("/deployments", jsonInit("POST", payload));
  }

  async archiveDeployment(deploymentId: string): Promise<unknown> {
    return this.request(`/deployments/${encodeURIComponent(deploymentId)}`, jsonInit("DELETE"));
  }

  async runDeployment(deploymentId: string): Promise<unknown> {
    return this.request(`/deployments/${encodeURIComponent(deploymentId)}/run`, jsonInit("POST"));
  }

  async listSessions(): Promise<unknown[]> {
    return this.request("/sessions");
  }

  async createSession(payload: unknown): Promise<unknown> {
    return this.request("/sessions", jsonInit("POST", payload));
  }

  async deleteSession(sessionId: string): Promise<unknown> {
    return this.request(`/sessions/${encodeURIComponent(sessionId)}`, jsonInit("DELETE"));
  }

  async listSessionEvents(sessionId: string): Promise<unknown[]> {
    return this.request(`/sessions/${encodeURIComponent(sessionId)}/events`);
  }

  async sendSessionEvents(sessionId: string, events: unknown[]): Promise<unknown> {
    return this.request(`/sessions/${encodeURIComponent(sessionId)}/events`, jsonInit("POST", { events }));
  }

  async interruptSession(sessionId: string): Promise<unknown> {
    return this.request(`/sessions/${encodeURIComponent(sessionId)}/interrupt`, jsonInit("POST"));
  }

  async listVaults(): Promise<unknown[]> {
    return this.request("/vaults");
  }

  async createVault(payload: unknown): Promise<unknown> {
    return this.request("/vaults", jsonInit("POST", payload));
  }

  async deleteVault(vaultId: string): Promise<unknown> {
    return this.request(`/vaults/${encodeURIComponent(vaultId)}`, jsonInit("DELETE"));
  }

  async listVaultCredentials(vaultId: string): Promise<unknown[]> {
    return this.request(`/vaults/${encodeURIComponent(vaultId)}/credentials`);
  }

  async createVaultCredential(vaultId: string, payload: unknown): Promise<unknown> {
    return this.request(`/vaults/${encodeURIComponent(vaultId)}/credentials`, jsonInit("POST", payload));
  }

  async deleteVaultCredential(vaultId: string, credentialId: string): Promise<unknown> {
    return this.request(`/vaults/${encodeURIComponent(vaultId)}/credentials/${encodeURIComponent(credentialId)}`, jsonInit("DELETE"));
  }

  async listSkills(): Promise<unknown[]> {
    return this.request("/skills");
  }

  async createMessage(payload: unknown): Promise<unknown> {
    return this.request("/messages", jsonInit("POST", payload));
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    return proxyFetch<T>(`/api/anthropic${path}`, init);
  }
}

export async function createAnthropicProxySession<T>(apiKey: string): Promise<T> {
  const trimmed = apiKey.trim();
  if (!trimmed) throw new AnthropicApiError("Enter an Anthropic API key.", 0);
  if (trimmed.includes("Web browsers: disabled by default") || trimmed.includes("dangerouslyAllowBrowser")) {
    throw new AnthropicApiError("That value is the SDK browser warning, not an Anthropic API key. Paste an API key from the Anthropic Console.", 0);
  }
  return proxyFetch<T>("/api/auth/login", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      authorization: `Bearer ${trimmed}`,
    },
  });
}

export async function readAnthropicProxySession<T>(): Promise<T | null> {
  try {
    return await proxyFetch<T>("/api/auth/session");
  } catch (error) {
    if (error instanceof AnthropicApiError && error.status === 401) return null;
    throw error;
  }
}

export async function clearAnthropicProxySession(): Promise<void> {
  await proxyFetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
}

function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

async function proxyFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
  });
  const requestId = response.headers.get("x-request-id");
  const payload = await responseJson(response);
  if (!response.ok) {
    const message = errorMessageFromPayload(payload) ?? `Request failed with ${response.status}`;
    throw new AnthropicApiError(message, response.status, requestId);
  }
  return payload as T;
}

async function responseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function errorMessageFromPayload(payload: unknown): string | null {
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
