import React from "react";
import { ChevronDown, ChevronRight, Plus, X } from "lucide-react";
import {
  createAgentParameterDraft,
  createSkillDraft,
  createSubAgentDraft,
  mcpServerDraftFromRegistered,
  selectOptionsFromString,
} from "../../domain/drafts";
import type {
  AgentParameterConfig,
  AgentParameterDraft,
  AgentParameterType,
  AgentRecord,
  McpPermissionPolicyType,
  McpServerDraft,
  RegisteredMcpServer,
  SkillDraft,
  SubAgentDraft,
} from "../../domain/types";

export function AgentParameterEditor({ config, onChange, disabled }: { config: AgentParameterConfig; onChange: (config: AgentParameterConfig) => void; disabled?: boolean }) {
  function updateParameter(id: string, patch: Partial<AgentParameterDraft>) {
    onChange({ ...config, parameters: config.parameters.map((parameter) => (parameter.id === id ? { ...parameter, ...patch } : parameter)) });
  }

  function removeParameter(id: string) {
    onChange({ ...config, parameters: config.parameters.filter((parameter) => parameter.id !== id) });
  }

  return (
    <div className="structured-editor parameter-schema-editor">
      <div className="structured-editor-head">
        <span>Required values</span>
        <button className="secondary-button compact-button" type="button" onClick={() => onChange({ ...config, parameters: [...config.parameters, createAgentParameterDraft()] })} disabled={disabled || !config.enabled}>
          <Plus size={15} aria-hidden="true" />
          Add value
        </button>
      </div>
      <label className="check-row">
        <input type="checkbox" checked={config.enabled} onChange={(event) => onChange({ ...config, enabled: event.target.checked })} disabled={disabled} />
        <span>Enable custom values</span>
      </label>
      <label className="check-row">
        <input type="checkbox" checked={config.allowAdditional} onChange={(event) => onChange({ ...config, allowAdditional: event.target.checked })} disabled={disabled || !config.enabled} />
        <span>Allow additional custom values</span>
      </label>
      {!config.enabled ? <div className="structured-empty">Values are disabled</div> : null}
      {config.enabled && config.parameters.length === 0 ? <div className="structured-empty">No required values configured</div> : null}
      {config.enabled
        ? config.parameters.map((parameter) => (
            <div className="structured-row parameter-row" key={parameter.id}>
              <label>
                <span>Key</span>
                <input value={parameter.key} onChange={(event) => updateParameter(parameter.id, { key: event.target.value })} disabled={disabled} placeholder="theme" />
              </label>
              <label>
                <span>Label</span>
                <input value={parameter.label} onChange={(event) => updateParameter(parameter.id, { label: event.target.value })} disabled={disabled} placeholder="Theme" />
              </label>
              <label>
                <span>Type</span>
                <select value={parameter.type} onChange={(event) => updateParameter(parameter.id, { type: event.target.value as AgentParameterType })} disabled={disabled}>
                  <option value="text">Text</option>
                  <option value="number">Number</option>
                  <option value="boolean">Boolean</option>
                  <option value="select">Select</option>
                </select>
              </label>
              <label>
                <span>Default</span>
                <input value={parameter.defaultValue} onChange={(event) => updateParameter(parameter.id, { defaultValue: event.target.value })} disabled={disabled} />
              </label>
              {parameter.type === "select" ? (
                <label>
                  <span>Options</span>
                  <input value={parameter.options} onChange={(event) => updateParameter(parameter.id, { options: event.target.value })} disabled={disabled} placeholder="light, dark" />
                </label>
              ) : null}
              <label className="parameter-description-field">
                <span>Description</span>
                <input value={parameter.description} onChange={(event) => updateParameter(parameter.id, { description: event.target.value })} disabled={disabled} />
              </label>
              <button className="icon-button row-remove-button" type="button" onClick={() => removeParameter(parameter.id)} disabled={disabled} title="Remove value">
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          ))
        : null}
    </div>
  );
}

export function NodeParameterEditor({ config, values, onChange, disabled }: { config: AgentParameterConfig; values: Record<string, string>; onChange: (values: Record<string, string>) => void; disabled?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const knownKeys = new Set(config.parameters.map((parameter) => parameter.key));
  const additionalEntries = Object.entries(values).filter(([key]) => !knownKeys.has(key));
  const hasExpandableValues = config.allowAdditional;

  function setValue(key: string, value: string) {
    onChange({ ...values, [key]: value });
  }

  function removeValue(key: string) {
    const next = { ...values };
    delete next[key];
    onChange(next);
  }

  function renameValue(previousKey: string, nextKey: string) {
    if (previousKey === nextKey || knownKeys.has(nextKey)) return;
    const next = { ...values };
    const value = next[previousKey] ?? "";
    delete next[previousKey];
    next[nextKey] = value;
    onChange(next);
  }

  function addAdditionalValue() {
    let index = 1;
    let key = "custom_value";
    while (values[key] !== undefined || knownKeys.has(key)) {
      index += 1;
      key = `custom_value_${index}`;
    }
    onChange({ ...values, [key]: "" });
  }

  return (
    <div className="node-parameter-editor">
      {config.parameters.length > 0 ? (
        <div className="node-required-parameter-fields">
          {config.parameters.map((parameter) => (
            <NodeParameterInput key={parameter.key} parameter={parameter} value={values[parameter.key] ?? parameter.defaultValue} onChange={(value) => setValue(parameter.key, value)} disabled={disabled} />
          ))}
        </div>
      ) : null}
      {hasExpandableValues ? (
        <button className="node-parameter-toggle" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
          <span>Additional values</span>
          {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
        </button>
      ) : null}
      {open && hasExpandableValues ? (
        <div className="node-parameter-fields">
          {additionalEntries.map(([key, value]) => (
            <div className="node-parameter-additional-row" key={key}>
              <input value={key} onChange={(event) => renameValue(key, event.target.value)} disabled={disabled || !config.allowAdditional} />
              <input value={value} onChange={(event) => setValue(key, event.target.value)} disabled={disabled || !config.allowAdditional} />
              <button className="icon-button compact-icon" type="button" onClick={() => removeValue(key)} disabled={disabled || !config.allowAdditional} title="Remove value">
                <X size={12} aria-hidden="true" />
              </button>
            </div>
          ))}
          {config.allowAdditional ? (
            <button className="secondary-button compact-button" type="button" onClick={addAdditionalValue} disabled={disabled}>
              <Plus size={14} aria-hidden="true" />
              Add value
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function NodeParameterInput({ parameter, value, onChange, disabled }: { parameter: AgentParameterDraft; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const hint = `Enter ${parameter.label || parameter.key}...`;
  if (parameter.type === "boolean") {
    return (
      <select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
        <option value="">{hint}</option>
        <option value="true">True</option>
        <option value="false">False</option>
      </select>
    );
  }
  if (parameter.type === "select") {
    const options = selectOptionsFromString(parameter.options);
    return (
      <select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
        <option value="">{hint}</option>
        {options.map((option) => (
          <option value={option} key={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }
  return <input type={parameter.type === "number" ? "number" : "text"} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} placeholder={hint} />;
}

export function SkillEditor({ skills, onChange, disabled }: { skills: SkillDraft[]; onChange: (skills: SkillDraft[]) => void; disabled?: boolean }) {
  function update(id: string, patch: Partial<SkillDraft>) {
    onChange(skills.map((skill) => (skill.id === id ? { ...skill, ...patch } : skill)));
  }

  function remove(id: string) {
    onChange(skills.filter((skill) => skill.id !== id));
  }

  return (
    <div className="structured-editor">
      <div className="structured-editor-head">
        <span>Skills</span>
        <button className="secondary-button compact-button" type="button" onClick={() => onChange([...skills, createSkillDraft()])} disabled={disabled}>
          <Plus size={15} aria-hidden="true" />
          Add skill
        </button>
      </div>

      {skills.length === 0 ? <div className="structured-empty">No skills configured</div> : null}

      {skills.map((skill) => (
        <div className="structured-row skill-row" key={skill.id}>
          <label>
            <span>Type</span>
            <select value={skill.type} onChange={(event) => update(skill.id, { type: event.target.value as SkillDraft["type"] })} disabled={disabled}>
              <option value="anthropic">Anthropic</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <label>
            <span>Skill ID</span>
            <input value={skill.skillId} onChange={(event) => update(skill.id, { skillId: event.target.value })} disabled={disabled} placeholder={skill.type === "anthropic" ? "xlsx" : "skill_abc123"} />
          </label>
          <label>
            <span>Version</span>
            <input value={skill.version} onChange={(event) => update(skill.id, { version: event.target.value })} disabled={disabled} placeholder="latest" />
          </label>
          <button className="icon-button row-remove-button" type="button" onClick={() => remove(skill.id)} disabled={disabled} title="Remove skill">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}

export function SubAgentEditor({
  subAgents,
  agents,
  onChange,
  disabled,
}: {
  subAgents: SubAgentDraft[];
  agents: AgentRecord[];
  onChange: (subAgents: SubAgentDraft[]) => void;
  disabled?: boolean;
}) {
  function update(id: string, patch: Partial<SubAgentDraft>) {
    onChange(subAgents.map((subAgent) => (subAgent.id === id ? { ...subAgent, ...patch } : subAgent)));
  }

  function remove(id: string) {
    onChange(subAgents.filter((subAgent) => subAgent.id !== id));
  }

  const selectedIds = new Set(subAgents.map((subAgent) => subAgent.agentId).filter(Boolean));

  return (
    <div className="structured-editor">
      <div className="structured-editor-head">
        <span>Sub agents</span>
        <button className="secondary-button compact-button" type="button" onClick={() => onChange([...subAgents, createSubAgentDraft()])} disabled={disabled || agents.length === 0}>
          <Plus size={15} aria-hidden="true" />
          Add sub agent
        </button>
      </div>

      {subAgents.length === 0 ? <div className="structured-empty">No sub agents configured</div> : null}

      {subAgents.map((subAgent) => (
        <div className="structured-row sub-agent-row" key={subAgent.id}>
          <label>
            <span>Agent</span>
            <select value={subAgent.agentId} onChange={(event) => update(subAgent.id, { agentId: event.target.value })} disabled={disabled}>
              <option value="">Select agent</option>
              {agents.map((record) => {
                const selectedElsewhere = selectedIds.has(record.id) && record.id !== subAgent.agentId;
                return (
                  <option value={record.id} key={record.id} disabled={selectedElsewhere}>
                    {record.agent.name} · {record.id}
                  </option>
                );
              })}
            </select>
          </label>
          <button className="icon-button row-remove-button" type="button" onClick={() => remove(subAgent.id)} disabled={disabled} title="Remove sub agent">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}

export function McpServerEditor({
  servers,
  registeredServers,
  onChange,
  disabled,
}: {
  servers: McpServerDraft[];
  registeredServers: RegisteredMcpServer[];
  onChange: (servers: McpServerDraft[]) => void;
  disabled?: boolean;
}) {
  function updateServer(id: string, registryId: string) {
    const registered = registeredServers.find((server) => server.id === registryId);
    if (!registered) return;
    onChange(servers.map((server) => (server.id === id ? { ...mcpServerDraftFromRegistered(registered, server.id), permissionPolicy: server.permissionPolicy ?? "always_allow" } : server)));
  }

  function updatePermissionPolicy(id: string, permissionPolicy: McpPermissionPolicyType) {
    onChange(servers.map((server) => (server.id === id ? { ...server, permissionPolicy } : server)));
  }

  function remove(id: string) {
    onChange(servers.filter((server) => server.id !== id));
  }

  function add() {
    const firstAvailable = registeredServers.find((server) => !servers.some((selected) => selected.registryId === server.id));
    if (!firstAvailable) return;
    onChange([...servers, mcpServerDraftFromRegistered(firstAvailable)]);
  }

  const selectedRegistryIds = new Set(servers.map((server) => server.registryId).filter(Boolean));

  return (
    <div className="structured-editor">
      <div className="structured-editor-head">
        <span>MCP servers</span>
        <button className="secondary-button compact-button" type="button" onClick={add} disabled={disabled || registeredServers.length === 0 || selectedRegistryIds.size >= registeredServers.length}>
          <Plus size={15} aria-hidden="true" />
          Add MCP
        </button>
      </div>

      {registeredServers.length === 0 ? <div className="structured-empty">No MCP servers registered</div> : servers.length === 0 ? <div className="structured-empty">No MCP servers configured</div> : null}

      {servers.map((server) => (
        <div className="structured-row mcp-row" key={server.id}>
          <label>
            <span>MCP server</span>
            <select value={server.registryId} onChange={(event) => updateServer(server.id, event.target.value)} disabled={disabled}>
              {!server.registryId ? <option value="">{server.name || "Select MCP server"}</option> : null}
              {registeredServers.map((registered) => {
                const selectedElsewhere = selectedRegistryIds.has(registered.id) && registered.id !== server.registryId;
                return (
                  <option value={registered.id} key={registered.id} disabled={selectedElsewhere}>
                    {registered.name}
                  </option>
                );
              })}
            </select>
          </label>
          <label>
            <span>Tool approval</span>
            <select value={server.permissionPolicy ?? "always_allow"} onChange={(event) => updatePermissionPolicy(server.id, event.target.value as McpPermissionPolicyType)} disabled={disabled}>
              <option value="always_allow">Always allow</option>
              <option value="always_ask">Ask before use</option>
            </select>
          </label>
          <button className="icon-button row-remove-button" type="button" onClick={() => remove(server.id)} disabled={disabled} title="Remove MCP server">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
