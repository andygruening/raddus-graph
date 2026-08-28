export type JsonObject = Record<string, unknown>;

export interface AuthSession {
  token: string;
  uuid: string;
  email: string;
  role?: WorkspaceRole;
  profile_id?: string | null;
  profile_label?: string | null;
}

export interface Agent {
  id: string;
  name: string;
  version: number;
  description: string | null;
  system: string | null;
  model: unknown;
  metadata: Record<string, string>;
  tools: unknown[];
  skills: unknown[];
  mcp_servers: unknown[];
  multiagent: unknown | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentRecord {
  id: string;
  creator_uuid: string;
  name: string;
  version: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  agent: Agent;
}

export interface Member {
  uuid: string;
  email: string;
  role: WorkspaceRole;
}

export type WorkspaceRole = "admin" | "member";

export interface ApiKeyRecord {
  id: string;
  name: string;
  key_prefix: string;
  project_id: string | null;
  creator_uuid: string | null;
  creator_email: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmailReceiverRecord {
  id: string;
  name: string;
  domain: string;
  project_id: string;
  creator_uuid: string | null;
  creator_email: string | null;
  created_at: string;
  updated_at: string;
}

export type ActiveTab = "chat" | "agents" | "mcpServers" | "integrations" | "packages" | "tutorials" | "skills" | "deployments" | "environments" | "secrets" | "apiKeys" | "members";
export type EnvironmentKind = "cloud" | "self_hosted";
export type SecretKind = "static_bearer" | "environment_variable";
export type McpAuthKind = "no_auth" | SecretKind;
export type McpAuthEditKind = "unchanged" | McpAuthKind;
export type ScheduleMode = "hours" | "days" | "weeks" | "cron";
export type PaletteTab = "triggers" | "agents" | "mcps" | "skills";
export type PackageManager = "pip" | "npm" | "apt" | "cargo" | "gem" | "go";

export const packageManagers: PackageManager[] = ["pip", "npm", "apt", "cargo", "gem", "go"];

export type McpPermissionPolicyType = "always_allow" | "always_ask";

export interface McpServerDraft {
  id: string;
  registryId: string;
  name: string;
  url: string;
  permissionPolicy: McpPermissionPolicyType;
}

export interface RegisteredMcpServer {
  id: string;
  name: string;
  description: string | null;
  url: string;
  icon_data_url: string | null;
  auth_type: McpAuthKind;
  vault_id: string | null;
  credential_id: string | null;
  project_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface SkillRecord {
  id: string;
  display_title: string | null;
  description?: string | null;
  latest_version: string | null;
  project_ids?: string[];
  source: "custom" | "anthropic" | string;
  type: string;
  created_at: string;
  updated_at: string;
}

export interface IntegrationRecord {
  id: string; name: string; description: string | null; logo_data_url: string | null;
  mcp_server_url: string; mcp_auth_type: "static_bearer" | "environment_variable"; secret_help_url: string | null;
  agent_name: string; agent_description: string | null; agent_system_prompt: string | null; agent_model: string;
  created_at: string; updated_at: string;
}

export interface TutorialRecord {
  id: string; title: string; description: string | null; logo_data_url: string | null; markdown: string;
  created_at: string; updated_at: string;
}

export interface PackagePresetRecord {
  id: string;
  name: string;
  description: string | null;
  logo_data_url: string | null;
  package_name: string;
  target: PackageManager;
  environment_variables: string[];
  created_at: string;
  updated_at: string;
}

export interface SkillDraft {
  id: string;
  type: "anthropic" | "custom";
  skillId: string;
  version: string;
}

export interface SubAgentDraft {
  id: string;
  agentId: string;
}

export type AgentParameterType = "text" | "number" | "boolean" | "select";

export interface AgentParameterDraft {
  id: string;
  key: string;
  label: string;
  type: AgentParameterType;
  defaultValue: string;
  description: string;
  options: string;
}

export interface AgentParameterConfig {
  enabled: boolean;
  allowAdditional: boolean;
  parameters: AgentParameterDraft[];
}

export interface ScheduleDraft {
  mode: ScheduleMode;
  interval: number;
  minute: number;
  hour: number;
  dayOfWeek: number;
  expression: string;
  timezone: string;
}

export type SlackTriggerType = "none" | "all" | "channel" | "user" | "keyword";

export interface SlackTriggerDraft {
  type: SlackTriggerType;
  keyword?: string;
  channel_id?: string;
  user_id?: string;
}

export interface ApiTriggerDraft {
  api_key_id: string;
}

export interface EmailTriggerDraft {
  receiver_id: string;
}

export type ProjectNodeType = "play" | "agent" | "schedule" | "mcp" | "skill" | "slack" | "api" | "email";
export type ProjectEdgeType = "runs" | "sub_agent" | "schedules" | "uses_mcp" | "uses_skill" | "slack_triggers" | "api_triggers" | "email_triggers";

export interface ProjectNode {
  id: string;
  type: ProjectNodeType;
  x: number;
  y: number;
  agent_id?: string;
  mcp_server_id?: string;
  skill_id?: string;
  prompt?: string;
  schedule?: ScheduleDraft;
  slack_trigger?: SlackTriggerDraft;
  api_trigger?: ApiTriggerDraft;
  email_trigger?: EmailTriggerDraft;
  parameter_values?: Record<string, string>;
  session_ids?: string[];
  synced_from_agent_id?: string;
  synced_ref_id?: string;
  synced_role?: "sub_agent" | "mcp" | "skill";
}

export interface ProjectEdge {
  id: string;
  source: string;
  target: string;
  type: ProjectEdgeType;
  deployment_id?: string;
}

export interface ProjectGraph {
  nodes: ProjectNode[];
  edges: ProjectEdge[];
}

export interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
}

export type CanvasViewportsByProject = Record<string, CanvasViewport>;

export interface GeneratedAgentSpec {
  name: string;
  description: string;
  system_prompt: string;
  mcp_server_ids: string[];
  required_integration_ids: string[];
}

export interface GeneratedProjectPlan {
  project: { name: string };
  agents: Array<{ id: string; name: string; description: string; system_prompt: string; model?: string; skill_ids?: string[] }>;
  triggers: Array<{ id: string; type: "play" | "schedule" | "slack" | "api" | "email"; name: string; description: string; prompt?: string; schedule?: ScheduleDraft; slack_trigger?: SlackTriggerDraft }>;
  mcps: Array<{ id: string; name: string; description: string }>;
  skills: Array<{ id: string; name: string; description: string; type?: "anthropic" | "custom"; skill_id?: string; version?: string }>;
  connections: Array<{ from: string; to: string; type: "runs" | "sub_agent" | "uses_mcp" | "uses_skill" | "schedules" | "slack_triggers" | "api_triggers" | "email_triggers" }>;
}

export type CanvasReviewActionId =
  | "create-agent"
  | "update-agent"
  | "add-agent-to-canvas"
  | "add-mcp-to-canvas"
  | "connect-mcp"
  | "connect-sub-agent"
  | "add-trigger"
  | "connect-trigger"
  | "update-trigger";

export interface CanvasReviewAction {
  id: string;
  actionId: CanvasReviewActionId;
  title: string;
  rationale: string;
  details: string;
  agent_id?: string;
  agent_name?: string;
  agent_description?: string;
  system_prompt?: string;
  model?: string;
  mcp_server_id?: string;
  mcp_server_ids?: string[];
  required_integration_ids?: string[];
  parent_agent_id?: string;
  child_agent_id?: string;
  sub_agent_ids?: string[];
  target_agent_id?: string;
  trigger_type?: "play" | "schedule" | "slack" | "api" | "email";
  trigger_prompt?: string;
  schedule?: ScheduleDraft;
  slack_trigger?: SlackTriggerDraft;
  node_id?: string;
  source_node_id?: string;
  api_key_id?: string;
  receiver_id?: string;
  add_to_canvas?: boolean;
}

export interface CanvasReviewResult {
  summary: string;
  actions: CanvasReviewAction[];
}

export interface CanvasReviewApplyResult {
  project: ProjectRecord;
  applied: CanvasReviewAction[];
  skipped: Array<{ id: string; title: string; reason: string }>;
}

export interface CanvasReviewValidationContext {
  agentIds: Set<string>;
  mcpServerIds: Set<string>;
  integrationTemplateIds: Set<string>;
  nodeIds: Set<string>;
  triggerNodeIds: Set<string>;
}

export interface ProjectRecord {
  id: string;
  name: string;
  creator_uuid: string;
  graph: ProjectGraph;
  is_public: boolean;
  anthropic_environment_id?: string | null;
  anthropic_vault_id?: string | null;
  vault_ids?: string[];
  current_user_role?: "owner" | "editor" | "viewer";
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  awaitingApproval?: ChatApprovalWait | null;
  approvalStatus?: "pending" | "allowed" | "denied";
}

export interface ChatApprovalWait {
  event_ids: string[];
  approvals: Array<{
    id: string;
    type: string;
    name?: string;
    mcp_server_name?: string;
    evaluated_permission?: string | null;
    session_thread_id?: string | null;
  } | null>;
  message: string;
}

export interface ManagedSession {
  id: string;
  agent: {
    id: string;
    name: string;
    version: number;
    model?: string | { id?: string | null; speed?: string | null } | null;
  };
  archived_at: string | null;
  created_at: string;
  deployment_id?: string | null;
  environment_id: string;
  metadata?: Record<string, string> | null;
  stats?: {
    active_seconds?: number | null;
    duration_seconds?: number | null;
  } | null;
  status: "rescheduling" | "running" | "idle" | "terminated";
  title: string | null;
  updated_at: string;
  usage?: {
    cache_creation?: {
      ephemeral_1h_input_tokens?: number | null;
      ephemeral_5m_input_tokens?: number | null;
    } | null;
    cache_read_input_tokens?: number | null;
    input_tokens?: number | null;
    output_tokens?: number | null;
  } | null;
  vault_ids: string[];
}

export interface AnthropicDeployment {
  id: string;
  agent: { id: string; name?: string; version?: number; [key: string]: unknown };
  archived_at: string | null;
  created_at: string;
  description: string | null;
  environment_id: string;
  initial_events: unknown[];
  metadata: Record<string, string>;
  name: string;
  paused_reason: unknown | null;
  resources: unknown[];
  schedule: unknown | null;
  status: "active" | "paused" | string;
  type: "deployment";
  updated_at: string;
  vault_ids: string[];
}

export interface AnthropicEnvironment {
  id: string;
  name: string;
  description: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  config: { type: string; [key: string]: unknown };
  metadata: Record<string, string>;
  scope?: "organization" | "account";
}

export interface VaultRecord {
  id: string;
  archived_at: string | null;
  can_add_credentials?: boolean;
  can_delete_credentials?: boolean;
  can_delete_vault?: boolean;
  created_at: string;
  display_name: string;
  managed_scope?: "global" | "project" | "external";
  metadata: Record<string, string>;
  project_id?: string | null;
  project_name?: string | null;
  runtime_selectable?: boolean;
  type: "vault";
  updated_at: string;
}

export interface VaultCredential {
  id: string;
  archived_at: string | null;
  auth: { type: string; [key: string]: unknown };
  created_at: string;
  display_name?: string | null;
  metadata: Record<string, string>;
  type: "vault_credential";
  updated_at: string;
  vault_id: string;
}
