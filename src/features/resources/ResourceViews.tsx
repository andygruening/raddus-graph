import { ChevronDown, ChevronRight, KeyRound, Loader2, LockKeyhole, MonitorCog, Pencil, Play, Plus, RefreshCw, Rocket, Server, Sparkles, Trash2 } from "lucide-react";
import { formatDate } from "../../domain/format";
import { credentialAuthLabel, deploymentAgentName, environmentNameFor, environmentPackageSummary, mcpAuthLabel, mcpScopeLabel, vaultScopeLabel } from "../../domain/labels";
import type { AgentRecord, AnthropicDeployment, AnthropicEnvironment, ApiKeyRecord, RegisteredMcpServer, SkillRecord, VaultCredential, VaultRecord } from "../../domain/types";

export function DeploymentsView({
  deployments,
  agents,
  environments,
  loading,
  runningDeploymentId,
  error,
  onRefresh,
  onOpenCreate,
  onSelect,
  onRun,
}: {
  deployments: AnthropicDeployment[];
  agents: AgentRecord[];
  environments: AnthropicEnvironment[];
  loading: boolean;
  runningDeploymentId: string | null;
  error: string | null;
  onRefresh: () => void;
  onOpenCreate: () => void;
  onSelect: (deployment: AnthropicDeployment) => void;
  onRun: (deployment: AnthropicDeployment) => void;
}) {
  return (
    <section className="deployments-view">
      <header className="toolbar">
        <div>
          <h1>Deployments</h1>
          <p>{deployments.length} configured</p>
        </div>
        <div className="toolbar-actions">
          <button className="icon-button" type="button" onClick={onRefresh} disabled={loading} title="Refresh deployments">
            {loading ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <RefreshCw size={18} aria-hidden="true" />}
          </button>
          <button className="primary-button" type="button" onClick={onOpenCreate} disabled={agents.length === 0 || environments.length === 0}>
            <Plus size={17} aria-hidden="true" />
            Create
          </button>
        </div>
      </header>

      {error ? <div className="notice error">{error}</div> : null}

      {loading && deployments.length === 0 ? (
        <div className="empty-state">
          <Loader2 className="spin" size={24} aria-hidden="true" />
          <span>Loading deployments</span>
        </div>
      ) : deployments.length === 0 ? (
        <div className="empty-state">
          <Rocket size={28} aria-hidden="true" />
          <strong>No deployments found</strong>
          <span>Create a deployment once an agent and environment exist.</span>
          <button className="primary-button" type="button" onClick={onOpenCreate} disabled={agents.length === 0 || environments.length === 0}>
            <Plus size={16} aria-hidden="true" />
            Create
          </button>
        </div>
      ) : (
        <div className="deployment-table" role="table" aria-label="Deployments">
          <div className="deployment-table-head" role="row">
            <span>Name</span>
            <span>Agent</span>
            <span>Environment</span>
            <span>Status</span>
            <span>Updated</span>
            <span>Run</span>
          </div>
          {deployments.map((deployment) => (
            <div className="deployment-row" key={deployment.id} role="row">
              <button className="deployment-select-button" type="button" onClick={() => onSelect(deployment)}>
                <span className="agent-name-cell">
                  <strong>{deployment.name}</strong>
                  <small>{deployment.description || deployment.id}</small>
                </span>
                <span>{deploymentAgentName(deployment, agents)}</span>
                <span>{environmentNameFor(deployment.environment_id, environments)}</span>
                <span className={deployment.status === "active" ? "owner-chip mine" : "owner-chip"}>{deployment.status}</span>
                <span className="numeric-cell">{formatDate(deployment.updated_at)}</span>
              </button>
              <button
                className="icon-button deployment-run-button"
                type="button"
                onClick={() => onRun(deployment)}
                disabled={Boolean(runningDeploymentId)}
                title="Run deployment now"
                aria-label={`Run ${deployment.name} now`}
              >
                {runningDeploymentId === deployment.id ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function McpServersView({
  servers,
  loading,
  error,
  onRefresh,
  onOpenCreate,
  onSelect,
}: {
  servers: RegisteredMcpServer[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onOpenCreate: () => void;
  onSelect: (server: RegisteredMcpServer) => void;
}) {
  return (
    <section className="mcp-servers-view">
      <header className="toolbar">
        <div>
          <h1>MCP Servers</h1>
          <p>{servers.length} configured</p>
        </div>
        <div className="toolbar-actions">
          <button className="icon-button" type="button" onClick={onRefresh} disabled={loading} title="Refresh MCP servers">
            {loading ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <RefreshCw size={18} aria-hidden="true" />}
          </button>
          <button className="primary-button" type="button" onClick={onOpenCreate}>
            <Plus size={17} aria-hidden="true" />
            Add
          </button>
        </div>
      </header>

      {error ? <div className="notice error">{error}</div> : null}

      {loading && servers.length === 0 ? (
        <div className="empty-state">
          <Loader2 className="spin" size={24} aria-hidden="true" />
          <span>Loading MCP servers</span>
        </div>
      ) : servers.length === 0 ? (
        <div className="empty-state">
          <Server size={28} aria-hidden="true" />
          <strong>No MCP servers found</strong>
          <span>Add MCP servers before attaching them to agents.</span>
          <button className="primary-button" type="button" onClick={onOpenCreate}>
            <Plus size={16} aria-hidden="true" />
            Add
          </button>
        </div>
      ) : (
        <div className="mcp-server-table" role="table" aria-label="MCP servers">
          <div className="mcp-server-table-head" role="row">
            <span>Icon</span>
            <span>Name</span>
            <span>URL</span>
            <span>Scope</span>
            <span>Auth</span>
            <span>Updated</span>
          </div>
          {servers.map((server) => (
            <button className="mcp-server-row" key={server.id} type="button" role="row" onClick={() => onSelect(server)}>
              <span className="mcp-server-icon-cell">{server.icon_data_url ? <img src={server.icon_data_url} alt="" /> : <Server size={20} aria-hidden="true" />}</span>
              <span className="agent-name-cell">
                <strong>{server.name}</strong>
                <small>{server.description || server.id}</small>
              </span>
              <span>{server.url}</span>
              <span className="owner-chip">{mcpScopeLabel(server)}</span>
              <span className="owner-chip">{mcpAuthLabel(server.auth_type)}</span>
              <span className="numeric-cell">{formatDate(server.updated_at)}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export function SkillsView({
  skills,
  loading,
  saving,
  error,
  onRefresh,
  onOpenCreate,
  onSelect,
}: {
  skills: SkillRecord[];
  loading: boolean;
  saving: boolean;
  error: string | null;
  onRefresh: () => void;
  onOpenCreate: () => void;
  onSelect: (skill: SkillRecord) => void;
}) {
  const builtInCount = skills.filter((skill) => skill.source === "anthropic").length;
  const customCount = skills.length - builtInCount;
  return (
    <section className="skills-view">
      <header className="toolbar">
        <div>
          <h1>Skills</h1>
          <p>{builtInCount} built-in, {customCount} custom</p>
        </div>
        <div className="toolbar-actions">
          <button className="icon-button" type="button" onClick={onRefresh} disabled={loading} title="Refresh skills">
            {loading ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <RefreshCw size={18} aria-hidden="true" />}
          </button>
          <button className="primary-button" type="button" onClick={onOpenCreate} disabled={saving}>
            {saving ? <Loader2 className="spin" size={17} aria-hidden="true" /> : <Plus size={17} aria-hidden="true" />}
            Create
          </button>
        </div>
      </header>

      {error ? <div className="notice error">{error}</div> : null}

      {loading && skills.length === 0 ? (
        <div className="empty-state">
          <Loader2 className="spin" size={24} aria-hidden="true" />
          <span>Loading skills</span>
        </div>
      ) : skills.length === 0 ? (
        <div className="empty-state">
          <Sparkles size={28} aria-hidden="true" />
          <strong>No skills found</strong>
          <span>Create a skill before attaching it to agents.</span>
          <button className="primary-button" type="button" onClick={onOpenCreate} disabled={saving}>
            <Plus size={16} aria-hidden="true" />
            Create
          </button>
        </div>
      ) : (
        <div className="skill-table" role="table" aria-label="Skills">
          <div className="skill-table-head" role="row">
            <span>Name</span>
            <span>Source</span>
            <span>Type</span>
            <span>Version</span>
            <span>Updated</span>
          </div>
          {skills.map((skill) => (
            <button className="skill-row" key={skill.id} type="button" role="row" onClick={() => onSelect(skill)}>
              <span className="agent-name-cell">
                <strong>{skill.display_title || skill.id}</strong>
                <small>{skill.description || skill.id}</small>
              </span>
              <span className="owner-chip">{skill.source}</span>
              <span>{skill.type}</span>
              <span className="numeric-cell">{skill.source === "anthropic" && !skill.latest_version ? "Built-in" : (skill.latest_version ?? "No version")}</span>
              <span className="numeric-cell">{skill.source === "anthropic" ? "Built-in" : formatDate(skill.updated_at)}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export function EnvironmentsView({
  environments,
  loading,
  error,
  onRefresh,
  onOpenCreate,
  onOpenEdit,
}: {
  environments: AnthropicEnvironment[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onOpenCreate: () => void;
  onOpenEdit: (environment: AnthropicEnvironment) => void;
}) {
  return (
    <section className="environments-view">
      <header className="toolbar">
        <div>
          <h1>Environments</h1>
          <p>{environments.length} available</p>
        </div>
        <div className="toolbar-actions">
          <button className="icon-button" type="button" onClick={onRefresh} disabled={loading} title="Refresh environments">
            {loading ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <RefreshCw size={18} aria-hidden="true" />}
          </button>
          <button className="primary-button" type="button" onClick={onOpenCreate}>
            <Plus size={17} aria-hidden="true" />
            Create
          </button>
        </div>
      </header>

      {error ? <div className="notice error">{error}</div> : null}

      <div className="environment-list">
        {loading && environments.length === 0 ? (
          <div className="empty-state">
            <Loader2 className="spin" size={24} aria-hidden="true" />
            <span>Loading environments</span>
          </div>
        ) : environments.length === 0 ? (
          <div className="empty-state">
            <MonitorCog size={28} aria-hidden="true" />
            <strong>No environments found</strong>
            <span>Create a cloud or self-hosted environment.</span>
            <button className="primary-button" type="button" onClick={onOpenCreate}>
              <Plus size={16} aria-hidden="true" />
              Create
            </button>
          </div>
        ) : (
          <div className="environment-table" role="table" aria-label="Environments">
            <div className="environment-table-head" role="row">
              <span>Name</span>
              <span>Type</span>
              <span>Scope</span>
              <span>Updated</span>
              <span>Actions</span>
            </div>
            {environments.map((environment) => (
              <article className="environment-row" key={environment.id} role="row">
                <span className="agent-name-cell">
                  <strong>{environment.name}</strong>
                  <small>{environmentPackageSummary(environment) || environment.description || environment.id}</small>
                </span>
                <span className="owner-chip">{environment.config.type}</span>
                <span>{environment.scope ?? "account"}</span>
                <span className="numeric-cell">{formatDate(environment.updated_at)}</span>
                <span className="environment-actions">
                  <button className="icon-button" type="button" onClick={() => onOpenEdit(environment)} title="Edit environment">
                    <Pencil size={16} aria-hidden="true" />
                  </button>
                </span>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export function SecretsView({
  vaults,
  loading,
  error,
  expandedVaultIds,
  credentialsByVault,
  credentialsLoadingByVault,
  onRefresh,
  onOpenCreateSecret,
  onToggleVault,
  onDeleteCredential,
}: {
  vaults: VaultRecord[];
  loading: boolean;
  error: string | null;
  expandedVaultIds: Set<string>;
  credentialsByVault: Record<string, VaultCredential[]>;
  credentialsLoadingByVault: Record<string, boolean>;
  onRefresh: () => void;
  onOpenCreateSecret: (vault: VaultRecord) => void;
  onToggleVault: (vaultId: string) => void;
  onDeleteCredential: (vaultId: string, credentialId: string) => void;
}) {
  return (
    <section className="secrets-view">
      <header className="toolbar">
        <div>
          <h1>Secrets</h1>
          <p>{vaults.length} vaults</p>
        </div>
        <div className="toolbar-actions">
          <button className="icon-button" type="button" onClick={onRefresh} disabled={loading} title="Refresh vaults">
            {loading ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <RefreshCw size={18} aria-hidden="true" />}
          </button>
        </div>
      </header>

      {error ? <div className="notice error">{error}</div> : null}

      {loading && vaults.length === 0 ? (
        <div className="empty-state">
          <Loader2 className="spin" size={24} aria-hidden="true" />
          <span>Loading vaults</span>
        </div>
      ) : vaults.length === 0 ? (
        <div className="empty-state">
          <LockKeyhole size={28} aria-hidden="true" />
          <strong>No vaults found</strong>
          <span>Vaults will appear here after they are created in Anthropic or by project secrets.</span>
        </div>
      ) : (
        <div className="vault-list" aria-label="Vaults">
          {vaults.map((vault) => {
            const expanded = expandedVaultIds.has(vault.id);
            const credentials = credentialsByVault[vault.id] ?? [];
            const credentialsLoading = Boolean(credentialsLoadingByVault[vault.id]);

            return (
              <article className={expanded ? "vault-tile expanded" : "vault-tile"} key={vault.id}>
                <button className="vault-tile-main" type="button" onClick={() => onToggleVault(vault.id)} aria-expanded={expanded}>
                  <span className="vault-expander">{expanded ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}</span>
                  <span className="agent-name-cell">
                    <strong>{vault.display_name}</strong>
                    <small>{vault.id}</small>
                  </span>
                  <span className="owner-chip">{vaultScopeLabel(vault)}</span>
                  <span className="numeric-cell">{formatDate(vault.updated_at)}</span>
                </button>

                {expanded ? (
                  <div className="credential-panel">
                    <div className="credential-panel-head">
                      <span>Credentials</span>
                      <div className="credential-panel-actions">
                        <strong>{credentialsLoading ? "Loading" : `${credentials.length}`}</strong>
                        {vault.can_add_credentials ? (
                          <button className="secondary-button compact-button" type="button" onClick={() => onOpenCreateSecret(vault)}>
                            <Plus size={15} aria-hidden="true" />
                            Add secret
                          </button>
                        ) : null}
                      </div>
                    </div>
                    {credentialsLoading ? (
                      <div className="structured-empty">
                        <Loader2 className="spin" size={16} aria-hidden="true" />
                        Loading credentials
                      </div>
                    ) : credentials.length === 0 ? (
                      <div className="structured-empty">No credentials in this vault</div>
                    ) : (
                      <div className="credential-list">
                        {credentials.map((credential) => (
                          <div className="credential-row" key={credential.id}>
                            <span className="agent-name-cell">
                              <strong>{credential.display_name || credential.id}</strong>
                              <small>{credentialAuthLabel(credential.auth)}</small>
                            </span>
                            <span className="numeric-cell">{formatDate(credential.updated_at)}</span>
                            {vault.can_delete_credentials ? (
                              <button className="danger-button compact-button" type="button" onClick={() => onDeleteCredential(vault.id, credential.id)}>
                                <Trash2 size={15} aria-hidden="true" />
                                Delete
                              </button>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function ApiKeysView({
  apiKeys,
  loading,
  saving,
  error,
  onRefresh,
  onOpenCreate,
  onRotate,
  onDelete,
  canEdit,
}: {
  apiKeys: ApiKeyRecord[];
  loading: boolean;
  saving: boolean;
  error: string | null;
  onRefresh: () => void;
  onOpenCreate: () => void;
  onRotate: (apiKey: ApiKeyRecord) => void;
  onDelete: (apiKey: ApiKeyRecord) => void;
  canEdit: boolean;
}) {
  return (
    <section className="api-keys-view">
      <header className="toolbar">
        <div>
          <h1>API Keys</h1>
          <p>{apiKeys.length} available</p>
        </div>
        <div className="toolbar-actions">
          <button className="icon-button" type="button" onClick={onRefresh} disabled={loading} title="Refresh API keys">
            {loading ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <RefreshCw size={18} aria-hidden="true" />}
          </button>
          <button className="primary-button" type="button" onClick={onOpenCreate} disabled={!canEdit}>
            <Plus size={17} aria-hidden="true" />
            Create
          </button>
        </div>
      </header>

      {error ? <div className="notice error">{error}</div> : null}

      {loading && apiKeys.length === 0 ? (
        <div className="empty-state">
          <Loader2 className="spin" size={24} aria-hidden="true" />
          <span>Loading API keys</span>
        </div>
      ) : apiKeys.length === 0 ? (
        <div className="empty-state">
          <KeyRound size={28} aria-hidden="true" />
          <strong>No API keys found</strong>
          <span>Create a key for server API authentication.</span>
          <button className="primary-button" type="button" onClick={onOpenCreate} disabled={!canEdit}>
            <Plus size={16} aria-hidden="true" />
            Create
          </button>
        </div>
      ) : (
        <div className="api-key-list" aria-label="API keys">
          {apiKeys.map((apiKey) => (
            <article className="api-key-tile" key={apiKey.id}>
              <div className="api-key-main">
                <span className="api-key-icon">
                  <KeyRound size={18} aria-hidden="true" />
                </span>
                <span className="agent-name-cell">
                  <strong>{apiKey.name}</strong>
                  <small>{apiKey.key_prefix}...</small>
                </span>
                <span className="api-key-meta">
                  <small>Created</small>
                  <strong>{formatDate(apiKey.created_at)}</strong>
                </span>
                <span className="api-key-meta">
                  <small>Last used</small>
                  <strong>{apiKey.last_used_at ? formatDate(apiKey.last_used_at) : "Never"}</strong>
                </span>
                <span className="api-key-meta">
                  <small>Owner</small>
                  <strong>{apiKey.creator_email ?? apiKey.creator_uuid ?? "Unknown"}</strong>
                </span>
              </div>
              <div className="api-key-actions">
                <button className="secondary-button compact-button" type="button" onClick={() => onRotate(apiKey)} disabled={saving || !canEdit}>
                  <RefreshCw size={15} aria-hidden="true" />
                  Rotate
                </button>
                <button className="danger-button compact-button" type="button" onClick={() => onDelete(apiKey)} disabled={saving || !canEdit}>
                  <Trash2 size={15} aria-hidden="true" />
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
