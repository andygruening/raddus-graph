import React from "react";
import { Archive, FileText, Loader2, Plus, RefreshCw, Rocket, Save, Trash2, Upload, X } from "lucide-react";
import { AgentModelSelect, FormSection, Modal } from "../../components/ui";
import { errorMessage } from "../../domain/errors";
import { formatDate } from "../../domain/format";
import { defaultAgentModel } from "../../domain/modelCatalog";
import { packageEnvSummary } from "../../domain/packagePresets";
import { packageManagers, type IntegrationRecord, type PackageManager, type PackagePresetRecord, type TutorialRecord } from "../../domain/types";

function readIconFile(file: File): Promise<string> {
  const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"]);
  if (!allowedTypes.has(file.type)) throw new Error("Icon must be a PNG, JPEG, WebP, GIF, or SVG image.");
  if (file.size > 256 * 1024) throw new Error("Icon must be smaller than 256 KB.");

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Could not read icon file."));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not read icon file."));
    reader.readAsDataURL(file);
  });
}

export function IntegrationsView({ integrations, loading, error, onRefresh, onCreate, onSelect }: { integrations: IntegrationRecord[]; loading: boolean; error: string | null; onRefresh: () => void; onCreate: () => void; onSelect: (integration: IntegrationRecord) => void }) {
  return <section className="mcp-servers-view"><header className="toolbar"><div><h1>Integrations</h1><p>{integrations.length} templates</p></div><div className="toolbar-actions"><button className="icon-button" type="button" onClick={onRefresh} disabled={loading} title="Refresh integrations">{loading ? <Loader2 className="spin" size={18} /> : <RefreshCw size={18} />}</button><button className="primary-button" type="button" onClick={onCreate}><Plus size={17} /> Add</button></div></header>{error ? <div className="notice error">{error}</div> : null}{integrations.length === 0 ? <div className="empty-state"><Rocket size={28} /><strong>No integrations found</strong><span>Add integration templates for project editors to install.</span></div> : <div className="mcp-server-table" role="table"><div className="mcp-server-table-head" role="row"><span>Logo</span><span>Name</span><span>MCP URL</span><span>Auth</span><span>Agent</span><span>Updated</span></div>{integrations.map((integration) => <button className="mcp-server-row" type="button" role="row" onClick={() => onSelect(integration)} key={integration.id}><span className="mcp-server-icon-cell">{integration.logo_data_url ? <img src={integration.logo_data_url} alt="" /> : <Rocket size={20} />}</span><span className="agent-name-cell"><strong>{integration.name}</strong><small>{integration.description || integration.id}</small></span><span>{integration.mcp_server_url}</span><span className="owner-chip">{integration.mcp_auth_type === "static_bearer" ? "Static bearer" : "Environment variable"}</span><span className="agent-name-cell"><strong>{integration.agent_name}</strong><small>{integration.agent_model}</small></span><span className="numeric-cell">{formatDate(integration.updated_at)}</span></button>)}</div>}</section>;
}

export function TutorialsView({ tutorials, loading, error, onRefresh, onCreate, onSelect }: { tutorials: TutorialRecord[]; loading: boolean; error: string | null; onRefresh: () => void; onCreate: () => void; onSelect: (tutorial: TutorialRecord) => void }) {
  return <section className="mcp-servers-view"><header className="toolbar"><div><h1>Tutorials</h1><p>{tutorials.length} available</p></div><div className="toolbar-actions"><button className="icon-button" type="button" onClick={onRefresh} disabled={loading} title="Refresh tutorials">{loading ? <Loader2 className="spin" size={18} /> : <RefreshCw size={18} />}</button><button className="primary-button" type="button" onClick={onCreate}><Plus size={17} /> Add</button></div></header>{error ? <div className="notice error">{error}</div> : null}{tutorials.length === 0 ? <div className="empty-state"><FileText size={28} /><strong>No tutorials found</strong><span>Add Markdown tutorials for project editors to read while adding integrations.</span></div> : <div className="mcp-server-table" role="table"><div className="mcp-server-table-head tutorial-table-head" role="row"><span>Icon</span><span>Title</span><span>Description</span><span>Updated</span></div>{tutorials.map((tutorial) => <button className="mcp-server-row tutorial-row" type="button" role="row" onClick={() => onSelect(tutorial)} key={tutorial.id}><span className="mcp-server-icon-cell">{tutorial.logo_data_url ? <img src={tutorial.logo_data_url} alt="" /> : <FileText size={20} />}</span><span className="agent-name-cell"><strong>{tutorial.title}</strong><small>{tutorial.id}</small></span><span>{tutorial.description || "Markdown tutorial"}</span><span className="numeric-cell">{formatDate(tutorial.updated_at)}</span></button>)}</div>}</section>;
}

export function PackagePresetsView({ packagePresets, loading, error, onRefresh, onCreate, onSelect }: { packagePresets: PackagePresetRecord[]; loading: boolean; error: string | null; onRefresh: () => void; onCreate: () => void; onSelect: (packagePreset: PackagePresetRecord) => void }) {
  return <section className="mcp-servers-view"><header className="toolbar"><div><h1>Package presets</h1><p>{packagePresets.length} available</p></div><div className="toolbar-actions"><button className="icon-button" type="button" onClick={onRefresh} disabled={loading} title="Refresh package presets">{loading ? <Loader2 className="spin" size={18} /> : <RefreshCw size={18} />}</button><button className="primary-button" type="button" onClick={onCreate}><Plus size={17} /> Add</button></div></header>{error ? <div className="notice error">{error}</div> : null}{packagePresets.length === 0 ? <div className="empty-state"><Archive size={28} /><strong>No package presets found</strong><span>Add package presets for project editors to install into project environments.</span></div> : <div className="mcp-server-table" role="table"><div className="mcp-server-table-head tutorial-table-head" role="row"><span>Icon</span><span>Name</span><span>Package</span><span>Updated</span></div>{packagePresets.map((packagePreset) => <button className="mcp-server-row tutorial-row" type="button" role="row" onClick={() => onSelect(packagePreset)} key={packagePreset.id}><span className="mcp-server-icon-cell">{packagePreset.logo_data_url ? <img src={packagePreset.logo_data_url} alt="" /> : <Archive size={20} />}</span><span className="agent-name-cell"><strong>{packagePreset.name}</strong><small>{packagePreset.description || packageEnvSummary(packagePreset) || packagePreset.id}</small></span><span><span className="owner-chip">{packagePreset.target}</span> {packagePreset.package_name}</span><span className="numeric-cell">{formatDate(packagePreset.updated_at)}</span></button>)}</div>}</section>;
}

export function IntegrationDialog({ integration, onClose, onSave, onDelete }: { integration?: IntegrationRecord; onClose: () => void; onSave: (value: Omit<IntegrationRecord, "id" | "created_at" | "updated_at">) => Promise<void>; onDelete?: () => Promise<void> }) {
  const [value, setValue] = React.useState({ name: integration?.name ?? "", description: integration?.description ?? "", logo_data_url: integration?.logo_data_url ?? null, mcp_server_url: integration?.mcp_server_url ?? "", mcp_auth_type: integration?.mcp_auth_type ?? "static_bearer" as IntegrationRecord["mcp_auth_type"], secret_help_url: integration?.secret_help_url ?? "", agent_name: integration?.agent_name ?? "", agent_description: integration?.agent_description ?? "", agent_system_prompt: integration?.agent_system_prompt ?? "", agent_model: integration?.agent_model ?? defaultAgentModel });
  const [error, setError] = React.useState<string | null>(null); const [saving, setSaving] = React.useState(false);
  async function selectLogo(file: File | undefined) { if (!file) return; try { setError(null); setValue({ ...value, logo_data_url: await readIconFile(file) }); } catch (logoError) { setError(errorMessage(logoError)); } }
  async function submit(event: React.FormEvent) { event.preventDefault(); setSaving(true); setError(null); try { await onSave({ ...value, description: value.description || null, secret_help_url: value.secret_help_url || null, agent_description: value.agent_description || null, agent_system_prompt: value.agent_system_prompt || null }); onClose(); } catch (saveError) { setError(errorMessage(saveError)); } finally { setSaving(false); } }
  return <Modal title={integration ? "Edit integration" : "Add integration"} onClose={onClose}><form className="form-grid" onSubmit={submit}><FormSection title="General info"><div className="icon-upload-field"><span>Logo image</span><div className="icon-upload-row"><div className="mcp-icon-preview" aria-label="Integration logo preview">{value.logo_data_url ? <img src={value.logo_data_url} alt="" /> : <Rocket size={24} aria-hidden="true" />}</div><label className="secondary-button compact-button"><Upload size={15} aria-hidden="true" />Upload<input className="visually-hidden-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" onChange={(event) => { void selectLogo(event.target.files?.[0]); event.target.value = ""; }} /></label>{value.logo_data_url ? <button className="secondary-button compact-button" type="button" onClick={() => setValue({ ...value, logo_data_url: null })}><X size={15} aria-hidden="true" />Remove</button> : null}</div></div><label><span>Name</span><input value={value.name} onChange={(e) => setValue({ ...value, name: e.target.value })} required /></label><label><span>Description</span><input value={value.description} onChange={(e) => setValue({ ...value, description: e.target.value })} /></label></FormSection><FormSection title="MCP server"><label><span>MCP server URL</span><input type="url" value={value.mcp_server_url} onChange={(e) => setValue({ ...value, mcp_server_url: e.target.value })} required /></label><label><span>Authentication</span><select value={value.mcp_auth_type} onChange={(e) => setValue({ ...value, mcp_auth_type: e.target.value as IntegrationRecord["mcp_auth_type"] })}><option value="static_bearer">Static bearer</option><option value="environment_variable">Environment variable</option></select></label><label><span>Secret help link</span><input type="url" value={value.secret_help_url ?? ""} onChange={(e) => setValue({ ...value, secret_help_url: e.target.value })} /></label></FormSection><FormSection title="Agent"><label><span>Name</span><input value={value.agent_name} onChange={(e) => setValue({ ...value, agent_name: e.target.value })} required /></label><label><span>Description</span><input value={value.agent_description ?? ""} onChange={(e) => setValue({ ...value, agent_description: e.target.value })} /></label><label><span>System prompt</span><textarea rows={5} value={value.agent_system_prompt ?? ""} onChange={(e) => setValue({ ...value, agent_system_prompt: e.target.value })} /></label><label><span>Model</span><AgentModelSelect value={value.agent_model} onChange={(agent_model) => setValue({ ...value, agent_model })} required /></label></FormSection>{error ? <div className="notice error">{error}</div> : null}<div className="dialog-actions">{onDelete ? <button className="danger-button" type="button" onClick={() => void onDelete()} disabled={saving}><Trash2 size={16} /> Delete</button> : null}<button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit" disabled={saving}>{saving ? <Loader2 className="spin" size={16} /> : <Save size={16} />} Save</button></div></form></Modal>;
}

export function TutorialDialog({ tutorial, onClose, onSave, onDelete }: { tutorial?: TutorialRecord; onClose: () => void; onSave: (value: Omit<TutorialRecord, "id" | "created_at" | "updated_at">) => Promise<void>; onDelete?: () => Promise<void> }) {
  const [value, setValue] = React.useState({ title: tutorial?.title ?? "", description: tutorial?.description ?? "", logo_data_url: tutorial?.logo_data_url ?? null, markdown: tutorial?.markdown ?? "" });
  const [error, setError] = React.useState<string | null>(null); const [saving, setSaving] = React.useState(false);
  async function submit(event: React.FormEvent) { event.preventDefault(); setSaving(true); setError(null); try { await onSave({ ...value, description: value.description || null }); onClose(); } catch (saveError) { setError(errorMessage(saveError)); } finally { setSaving(false); } }
  return <Modal title={tutorial ? "Edit tutorial" : "Add tutorial"} onClose={onClose} wide><form className="form-grid" onSubmit={submit}><FormSection title="Tutorial"><label><span>Title</span><input value={value.title} onChange={(e) => setValue({ ...value, title: e.target.value })} required /></label><label><span>Description</span><input value={value.description} onChange={(e) => setValue({ ...value, description: e.target.value })} /></label><label><span>Markdown</span><textarea className="markdown-editor" rows={18} value={value.markdown} onChange={(e) => setValue({ ...value, markdown: e.target.value })} required /></label></FormSection>{error ? <div className="notice error">{error}</div> : null}<div className="dialog-actions">{onDelete ? <button className="danger-button" type="button" onClick={() => void onDelete()} disabled={saving}><Trash2 size={16} /> Delete</button> : null}<button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit" disabled={saving}>{saving ? <Loader2 className="spin" size={16} /> : <Save size={16} />} Save</button></div></form></Modal>;
}

export function PackagePresetDialog({ packagePreset, onClose, onSave, onDelete }: { packagePreset?: PackagePresetRecord; onClose: () => void; onSave: (value: Omit<PackagePresetRecord, "id" | "created_at" | "updated_at">) => Promise<void>; onDelete?: () => Promise<void> }) {
  const [value, setValue] = React.useState({ name: packagePreset?.name ?? "", description: packagePreset?.description ?? "", logo_data_url: packagePreset?.logo_data_url ?? null, package_name: packagePreset?.package_name ?? "", target: packagePreset?.target ?? "pip" as PackageManager });
  const [environmentVariables, setEnvironmentVariables] = React.useState<Array<{ id: string; name: string }>>(
    (packagePreset?.environment_variables ?? []).map((name) => ({ id: crypto.randomUUID(), name })),
  );
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  async function selectLogo(file: File | undefined) {
    if (!file) return;
    try {
      setError(null);
      setValue({ ...value, logo_data_url: await readIconFile(file) });
    } catch (logoError) {
      setError(errorMessage(logoError));
    }
  }

  function updateEnvironmentVariable(id: string, name: string) {
    setEnvironmentVariables((current) => current.map((variable) => (variable.id === id ? { ...variable, name } : variable)));
  }

  function removeEnvironmentVariable(id: string) {
    setEnvironmentVariables((current) => current.filter((variable) => variable.id !== id));
  }

  function addEnvironmentVariable() {
    setEnvironmentVariables((current) => [...current, { id: crypto.randomUUID(), name: "" }]);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSave({
        ...value,
        description: value.description || null,
        environment_variables: environmentVariables.map((variable) => variable.name.trim()).filter(Boolean),
      });
      onClose();
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={packagePreset ? "Edit package preset" : "Add package preset"} onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <FormSection title="Package">
          <div className="icon-upload-field">
            <span>Logo image</span>
            <div className="icon-upload-row">
              <div className="mcp-icon-preview" aria-label="Package logo preview">{value.logo_data_url ? <img src={value.logo_data_url} alt="" /> : <Archive size={24} aria-hidden="true" />}</div>
              <label className="secondary-button compact-button"><Upload size={15} aria-hidden="true" />Upload<input className="visually-hidden-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" onChange={(event) => { void selectLogo(event.target.files?.[0]); event.target.value = ""; }} /></label>
              {value.logo_data_url ? <button className="secondary-button compact-button" type="button" onClick={() => setValue({ ...value, logo_data_url: null })}><X size={15} aria-hidden="true" />Remove</button> : null}
            </div>
          </div>
          <label><span>Name</span><input value={value.name} onChange={(e) => setValue({ ...value, name: e.target.value })} required /></label>
          <label><span>Description</span><input value={value.description} onChange={(e) => setValue({ ...value, description: e.target.value })} /></label>
          <label><span>Package name</span><input value={value.package_name} onChange={(e) => setValue({ ...value, package_name: e.target.value })} placeholder="wrangler" required /></label>
          <label><span>Target</span><select value={value.target} onChange={(e) => setValue({ ...value, target: e.target.value as PackageManager })}>{packageManagers.map((manager) => <option value={manager} key={manager}>{manager}</option>)}</select></label>
        </FormSection>

        <FormSection title="Required environment values">
          <div className="structured-editor">
            <div className="structured-editor-head">
              <span>{environmentVariables.length} required</span>
              <button className="secondary-button compact-button" type="button" onClick={addEnvironmentVariable}>
                <Plus size={15} aria-hidden="true" />
                Add value
              </button>
            </div>
            {environmentVariables.length === 0 ? <div className="structured-empty">No required environment values</div> : null}
            {environmentVariables.map((variable) => (
              <div className="structured-row mcp-env-row" key={variable.id}>
                <label>
                  <span>Name</span>
                  <input value={variable.name} onChange={(event) => updateEnvironmentVariable(variable.id, event.target.value)} placeholder="API_KEY" required />
                </label>
                <button className="icon-button row-remove-button" type="button" onClick={() => removeEnvironmentVariable(variable.id)} title="Remove value">
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        </FormSection>

        {error ? <div className="notice error">{error}</div> : null}
        <div className="dialog-actions">{onDelete ? <button className="danger-button" type="button" onClick={() => void onDelete()} disabled={saving}><Trash2 size={16} /> Delete</button> : null}<button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit" disabled={saving}>{saving ? <Loader2 className="spin" size={16} /> : <Save size={16} />} Save</button></div>
      </form>
    </Modal>
  );
}
