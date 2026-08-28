import { packageManagers, type AgentRecord, type AnthropicDeployment, type AnthropicEnvironment, type McpAuthKind, type RegisteredMcpServer, type VaultCredential, type VaultRecord } from "./types";

export function shortId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}...${id.slice(-4)}`;
}

export function mcpAuthLabel(authType: McpAuthKind): string {
  if (authType === "no_auth") return "No auth";
  if (authType === "static_bearer") return "Static bearer";
  return "Environment value";
}

export function mcpScopeLabel(server: RegisteredMcpServer): string {
  if (mcpServerIsGlobal(server)) return "Global";
  const projectCount = (server.project_ids ?? []).length;
  return projectCount === 1 ? "1 project" : `${projectCount} projects`;
}

export function vaultScopeLabel(vault: VaultRecord): string {
  if (vault.managed_scope === "global") return "Global";
  if (vault.managed_scope === "project") return vault.project_name ? `Project · ${vault.project_name}` : "Project";
  if (vault.managed_scope === "external") return "External";
  return vault.type;
}

export function credentialAuthLabel(auth: VaultCredential["auth"]): string {
  if (auth.type === "static_bearer" && typeof auth.mcp_server_url === "string") {
    return `Static bearer · ${auth.mcp_server_url}`;
  }
  if (auth.type === "mcp_oauth" && typeof auth.mcp_server_url === "string") {
    return `MCP OAuth · ${auth.mcp_server_url}`;
  }
  if (auth.type === "environment_variable" && typeof auth.secret_name === "string") {
    return `Environment variable · ${auth.secret_name}`;
  }
  return auth.type;
}

export function deploymentAgentId(deployment: AnthropicDeployment): string {
  return typeof deployment.agent?.id === "string" ? deployment.agent.id : "";
}

export function deploymentAgentName(deployment: AnthropicDeployment, agents: AgentRecord[]): string {
  const agentId = deploymentAgentId(deployment);
  return agents.find((record) => record.id === agentId)?.agent.name ?? deployment.agent.name ?? shortId(agentId);
}

export function environmentNameFor(environmentId: string, environments: AnthropicEnvironment[]): string {
  return environments.find((environment) => environment.id === environmentId)?.name ?? shortId(environmentId);
}

export function environmentPackageSummary(environment: AnthropicEnvironment): string {
  const packages = isRecord(environment.config.packages) ? environment.config.packages : null;
  if (!packages) return "";

  const parts = packageManagers.flatMap((manager) => {
    const values = packages[manager];
    return Array.isArray(values) && values.length > 0 ? [`${manager} ${values.length}`] : [];
  });
  return parts.join(" · ");
}

function mcpServerIsGlobal(server: RegisteredMcpServer): boolean {
  return (server.project_ids ?? []).length === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
