import type {
  AgentParameterConfig,
  AgentParameterDraft,
  McpServerDraft,
  RegisteredMcpServer,
  SkillDraft,
  SubAgentDraft,
} from "./types";

export function mcpServerDraftFromRegistered(server: RegisteredMcpServer, id: string = crypto.randomUUID()): McpServerDraft {
  return { id, registryId: server.id, name: server.name, url: server.url, permissionPolicy: "always_allow" };
}

export function createMcpServerDraft(registeredServers: RegisteredMcpServer[] = []): McpServerDraft {
  const first = registeredServers[0];
  return first ? mcpServerDraftFromRegistered(first) : { id: crypto.randomUUID(), registryId: "", name: "", url: "", permissionPolicy: "always_allow" };
}

export function createSkillDraft(): SkillDraft {
  return { id: crypto.randomUUID(), type: "anthropic", skillId: "", version: "" };
}

export function createSubAgentDraft(): SubAgentDraft {
  return { id: crypto.randomUUID(), agentId: "" };
}

export function createDefaultAgentParameterConfig(): AgentParameterConfig {
  return { enabled: false, allowAdditional: false, parameters: [] };
}

export function createAgentParameterDraft(): AgentParameterDraft {
  return { id: crypto.randomUUID(), key: "", label: "", type: "text", defaultValue: "", description: "", options: "" };
}

export function selectOptionsFromString(value: string): string[] {
  return value
    .split(",")
    .map((option) => option.trim())
    .filter((option, index, options) => option.length > 0 && options.indexOf(option) === index);
}
