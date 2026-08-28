import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bot, Calendar, Check, Clock3, ExternalLink, Info, KeyRound, Loader2, MessageSquare, MonitorCog, Plus, RefreshCw, Send, Server, Settings, Square, X } from "lucide-react";
import { FormSection, InfoRow, Modal } from "../../components/ui";
import { errorMessage } from "../../domain/errors";
import { formatDateTime } from "../../domain/format";
import { parseSessionMessageStatusUpdates } from "../../domain/sessionStatus";
import { estimateManagedSessionCost, formatSessionDuration, formatSessionStatus, formatTokenCount, formatUsd, sessionModelId, sessionUsageTotals } from "../../domain/sessionMetrics";
import { isStoppableSession, latestSessionsFirst } from "../../domain/sessionUtils";
import type { AgentRecord, AnthropicEnvironment, ChatMessage, ManagedSession, VaultRecord } from "../../domain/types";

export function PlaySessionsPanel({
  sessions,
  sessionsLoading,
  selectedSessionId,
  messages,
  loading,
  error,
  stoppingSessionId,
  onSelect,
  onRefresh,
  onSend,
  onStop,
  onClose,
}: {
  sessions: ManagedSession[];
  sessionsLoading: boolean;
  selectedSessionId: string;
  messages: ChatMessage[];
  loading: boolean;
  error: string | null;
  stoppingSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onRefresh: () => Promise<void>;
  onSend: (message: string) => Promise<void>;
  onStop: (session: ManagedSession) => Promise<void>;
  onClose: () => void;
}) {
  const [tab, setTab] = React.useState<"statusUpdates" | "chat">("chat");
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [sendError, setSendError] = React.useState<string | null>(null);
  const sortedSessions = React.useMemo(() => latestSessionsFirst(sessions), [sessions]);
  const latestSession = sortedSessions[0] ?? null;
  const selectedSession = sortedSessions.find((session) => session.id === selectedSessionId) ?? null;
  const selectedSessionValue = selectedSession?.id ?? latestSession?.id ?? "";
  const canStopSelectedSession = isStoppableSession(selectedSession);
  const stoppingSelectedSession = selectedSession ? stoppingSessionId === selectedSession.id : false;
  const statusUpdates = React.useMemo(() => parseSessionMessageStatusUpdates(messages), [messages]);

  React.useEffect(() => {
    if (sessionsLoading || sortedSessions.length === 0) return;
    if (selectedSessionId && sortedSessions.some((session) => session.id === selectedSessionId)) return;
    onSelect(sortedSessions[0].id);
  }, [onSelect, selectedSessionId, sessionsLoading, sortedSessions]);

  React.useEffect(() => {
    if (!selectedSession) setDetailsOpen(false);
  }, [selectedSession]);

  async function submitMessage(event: React.FormEvent) {
    event.preventDefault();
    const content = message.trim();
    if (!content || !selectedSessionId || sending) return;
    setSending(true);
    setSendError(null);
    try {
      await onSend(content);
      setMessage("");
      setTab("chat");
    } catch (sendMessageError) {
      setSendError(errorMessage(sendMessageError));
    } finally {
      setSending(false);
    }
  }

  async function stopSession() {
    if (!selectedSession || stoppingSelectedSession) return;
    setSendError(null);
    try {
      await onStop(selectedSession);
      setTab("chat");
    } catch (stopError) {
      setSendError(errorMessage(stopError));
    }
  }

  return (
    <Modal title="Trigger sessions" onClose={onClose} side>
      <div className="play-sessions-panel">
        <div className="trigger-session-select-row">
          <label>
            <span>Session</span>
            <select value={selectedSessionValue} onChange={(event) => onSelect(event.target.value)} disabled={sortedSessions.length === 0}>
              {sortedSessions.map((session) => (
                <option value={session.id} key={session.id}>
                  {session.agent.name} · {formatDateTime(session.updated_at)}
                </option>
              ))}
            </select>
          </label>
          <button className="icon-button" type="button" onClick={() => void onRefresh()} disabled={sessionsLoading} title="Refresh sessions" aria-label="Refresh sessions">
            {sessionsLoading ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <RefreshCw size={18} aria-hidden="true" />}
          </button>
          <button className="icon-button" type="button" onClick={() => setDetailsOpen(true)} disabled={!selectedSession} title="Session details" aria-label="Open session details">
            <Info size={18} aria-hidden="true" />
          </button>
        </div>
        {!sessionsLoading && sessions.length === 0 ? (
          <div className="empty-state compact-empty">
            <MessageSquare size={22} aria-hidden="true" />
            <span>No sessions for connected agents</span>
          </div>
        ) : null}
        <div className="snippet-tabs" role="tablist" aria-label="Trigger session view">
          <button className={tab === "statusUpdates" ? "active" : ""} type="button" role="tab" aria-selected={tab === "statusUpdates"} onClick={() => setTab("statusUpdates")}>
            Status Updates
          </button>
          <button className={tab === "chat" ? "active" : ""} type="button" role="tab" aria-selected={tab === "chat"} onClick={() => setTab("chat")}>
            Chat
          </button>
        </div>
        {tab === "chat" ? (
          <ChatMessageList messages={messages} loading={loading} emptyText={sortedSessions.length === 0 ? "No sessions for connected agents." : "No messages for this session yet."} />
        ) : (
          <div className="status-update-history" aria-live="polite">
            {loading ? (
              <div className="empty-state compact-empty">
                <Loader2 className="spin" size={20} aria-hidden="true" />
                <span>Loading session messages</span>
              </div>
            ) : statusUpdates.length > 0 ? (
              statusUpdates.map((statusUpdate) => (
                <article className="status-update-card" key={statusUpdate.id}>
                  <strong>{statusUpdate.title || statusUpdate.status}</strong>
                  <span>{statusUpdate.agent} · {statusUpdate.status}</span>
                  <p>{statusUpdate.message}</p>
                  {statusUpdate.link ? (
                    <a href={statusUpdate.link} target="_blank" rel="noreferrer">
                      <ExternalLink size={14} aria-hidden="true" />
                      Open link
                    </a>
                  ) : null}
                </article>
              ))
            ) : (
              <div className="chat-placeholder">
                <Info size={24} aria-hidden="true" />
                <span>{sortedSessions.length === 0 ? "No sessions for connected agents." : "No status updates for this session yet."}</span>
              </div>
            )}
          </div>
        )}
        {tab === "chat" && error ? <div className="notice error">{error}</div> : null}
        {tab === "statusUpdates" && error ? <div className="notice error">{error}</div> : null}
        {sendError ? <div className="notice error">{sendError}</div> : null}
        <form className="chat-compose trigger-session-compose" onSubmit={submitMessage}>
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder={selectedSessionValue ? "Message this session" : "No session available"}
            rows={2}
            disabled={!selectedSessionValue || sending}
          />
          <div className="chat-compose-actions">
            {canStopSelectedSession ? (
              <button className="secondary-button stop-session-button" type="button" onClick={stopSession} disabled={stoppingSelectedSession} title="Stop session">
                {stoppingSelectedSession ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <Square size={16} aria-hidden="true" />}
                Stop
              </button>
            ) : null}
            <button className="primary-button" type="submit" disabled={!selectedSessionValue || !message.trim() || sending}>
              {sending ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
              Send
            </button>
          </div>
        </form>
        {detailsOpen && selectedSession ? <SessionDetailsPopup session={selectedSession} onClose={() => setDetailsOpen(false)} /> : null}
      </div>
    </Modal>
  );
}

function SessionDetailsPopup({ session, onClose }: { session: ManagedSession; onClose: () => void }) {
  const modelId = sessionModelId(session);
  const usage = sessionUsageTotals(session.usage);
  const estimate = estimateManagedSessionCost(session);
  const vaultCount = session.vault_ids.length;

  return (
    <Modal title="Session details" onClose={onClose} className="session-details-modal">
      <div className="session-details-popup">
        <div className="session-detail-title">
          <span className={`session-status-pill ${session.status}`}>{formatSessionStatus(session.status)}</span>
          <strong>{session.title || session.agent.name}</strong>
          <small>{session.id}</small>
        </div>

        <div className="session-detail-grid">
          <InfoRow icon={<Bot size={15} aria-hidden="true" />} label="Agent" value={`${session.agent.name} · v${session.agent.version}`} />
          <InfoRow icon={<Server size={15} aria-hidden="true" />} label="Model" value={modelId ?? "Unavailable"} />
          <InfoRow icon={<MonitorCog size={15} aria-hidden="true" />} label="Environment" value={session.environment_id} />
          <InfoRow icon={<KeyRound size={15} aria-hidden="true" />} label="Vaults" value={vaultCount === 0 ? "None" : String(vaultCount)} />
          <InfoRow icon={<Calendar size={15} aria-hidden="true" />} label="Created" value={formatDateTime(session.created_at)} />
          <InfoRow icon={<Calendar size={15} aria-hidden="true" />} label="Updated" value={formatDateTime(session.updated_at)} />
          <InfoRow icon={<Clock3 size={15} aria-hidden="true" />} label="Running time" value={formatSessionDuration(session.stats?.active_seconds)} />
          <InfoRow icon={<Clock3 size={15} aria-hidden="true" />} label="Elapsed time" value={formatSessionDuration(session.stats?.duration_seconds)} />
        </div>

        {session.deployment_id ? (
          <div className="session-detail-row">
            <span>Deployment</span>
            <strong>{session.deployment_id}</strong>
          </div>
        ) : null}

        <section className="session-detail-section">
          <h2>Token Usage</h2>
          <div className="session-metric-grid">
            <SessionMetric label="Total tokens" value={formatTokenCount(usage?.total ?? null)} />
            <SessionMetric label="Input" value={formatTokenCount(usage?.input ?? null)} />
            <SessionMetric label="Output" value={formatTokenCount(usage?.output ?? null)} />
            <SessionMetric label="Cache read" value={formatTokenCount(usage?.cacheRead ?? null)} />
            <SessionMetric label="5m cache write" value={formatTokenCount(usage?.cacheWrite5m ?? null)} />
            <SessionMetric label="1h cache write" value={formatTokenCount(usage?.cacheWrite1h ?? null)} />
          </div>
        </section>

        <section className="session-detail-section">
          <h2>Estimated Spend</h2>
          <div className="session-metric-grid">
            <SessionMetric label="Total" value={formatUsd(estimate.totalCostUsd)} emphasis />
            <SessionMetric label="Tokens" value={formatUsd(estimate.tokenCostUsd)} />
            <SessionMetric label="Runtime" value={formatUsd(estimate.runtimeCostUsd)} />
          </div>
          {!estimate.pricingAvailable ? <p className="session-detail-note">Token estimate unavailable for this model.</p> : null}
          {estimate.totalCostUsd !== null ? <p className="session-detail-note">List-price estimate; billing may differ.</p> : null}
        </section>

        {session.metadata && Object.keys(session.metadata).length > 0 ? (
          <section className="session-detail-section">
            <h2>Metadata</h2>
            <div className="session-metadata-list">
              {Object.entries(session.metadata).map(([key, value]) => (
                <div className="session-detail-row" key={key}>
                  <span>{key}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            <X size={16} aria-hidden="true" />
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}

function SessionMetric({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className={emphasis ? "session-metric emphasis" : "session-metric"}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ChatMessageList({ messages, loading, emptyText }: { messages: ChatMessage[]; loading: boolean; emptyText: string }) {
  const historyRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const history = historyRef.current;
    if (!history) return;
    history.scrollTop = history.scrollHeight;
  }, [messages, loading]);

  return (
    <div className="message-history" ref={historyRef} aria-live="polite">
      {messages.length === 0 ? (
        <div className="chat-placeholder">
          <MessageSquare size={24} aria-hidden="true" />
          <span>{emptyText}</span>
        </div>
      ) : (
        messages.map((message) => (
          <article className={message.role === "user" ? "chat-message user" : "chat-message assistant"} key={message.id}>
            <span>{message.role === "user" ? "You" : "Agent"}</span>
            {message.role === "assistant" ? <MarkdownMessage content={message.content} /> : <p>{message.content}</p>}
          </article>
        ))
      )}
      {loading ? (
        <article className="chat-message assistant">
          <span>Agent</span>
          <p className="typing-line">
            <Loader2 className="spin" size={16} aria-hidden="true" />
            Loading
          </p>
        </article>
      ) : null}
    </div>
  );
}

export function ChatView({
  agents,
  environments,
  vaults,
  sessions,
  sessionsLoading,
  removingSessionId,
  stoppingSessionId,
  selectedSessionId,
  selectedAgentId,
  selectedEnvironmentId,
  selectedVaultIds,
  onAgentChange,
  onEnvironmentChange,
  onVaultToggle,
  onSessionSelect,
  onSessionRemove,
  onSessionStop,
  messages,
  input,
  onInputChange,
  loading,
  approvalLoadingId,
  error,
  onSubmit,
  onConfirmApproval,
  onCreateAgent,
}: {
  agents: AgentRecord[];
  environments: AnthropicEnvironment[];
  vaults: VaultRecord[];
  sessions: ManagedSession[];
  sessionsLoading: boolean;
  removingSessionId: string | null;
  stoppingSessionId: string | null;
  selectedSessionId: string;
  selectedAgentId: string;
  selectedEnvironmentId: string;
  selectedVaultIds: string[];
  onAgentChange: (agentId: string) => void;
  onEnvironmentChange: (environmentId: string) => void;
  onVaultToggle: (vaultId: string) => void;
  onSessionSelect: (session: ManagedSession) => void;
  onSessionRemove: (session: ManagedSession) => void;
  onSessionStop: (session: ManagedSession) => Promise<void>;
  messages: ChatMessage[];
  input: string;
  onInputChange: (value: string) => void;
  loading: boolean;
  approvalLoadingId: string | null;
  error: string | null;
  onSubmit: (event: React.FormEvent) => void;
  onConfirmApproval: (message: ChatMessage, result: "allow" | "deny") => void;
  onCreateAgent: () => void;
}) {
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const historyRef = React.useRef<HTMLDivElement | null>(null);
  const selectedSession = sessions.find((session) => session.id === selectedSessionId) ?? null;
  const canStopSelectedSession = isStoppableSession(selectedSession);
  const stoppingSelectedSession = selectedSession ? stoppingSessionId === selectedSession.id : false;

  React.useEffect(() => {
    const history = historyRef.current;
    if (!history) return;
    history.scrollTop = history.scrollHeight;
  }, [messages, loading]);

  return (
    <section className="chat-view">
      <div className="chat-panel">
        <div className="chat-controls">
          <div className="chat-agent-control">
            <label>
              <span>Agent</span>
              <select value={selectedAgentId} onChange={(event) => onAgentChange(event.target.value)} disabled={agents.length === 0}>
                {agents.map((record) => (
                  <option value={record.id} key={record.id}>
                    {record.agent.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="icon-button chat-settings-button" type="button" onClick={() => setSettingsOpen(true)} title="Chat settings">
              <Settings size={18} aria-hidden="true" />
            </button>
          </div>
        </div>

        {agents.length === 0 ? (
          <div className="empty-state chat-empty">
            <MessageSquare size={28} aria-hidden="true" />
            <strong>No agents available</strong>
            <span>Create an agent before starting a chat.</span>
            <button className="primary-button" type="button" onClick={onCreateAgent}>
              <Plus size={16} aria-hidden="true" />
              Create agent
            </button>
          </div>
        ) : environments.length === 0 ? (
          <div className="empty-state chat-empty">
            <MonitorCog size={28} aria-hidden="true" />
            <strong>No environments available</strong>
            <span>Create an environment before starting a chat.</span>
          </div>
        ) : (
          <>
            <div className="chat-history-layout">
              <aside className="session-sidebar" aria-label="Sessions">
                <div className="session-sidebar-head">
                  <span>Sessions</span>
                  {sessionsLoading ? <Loader2 className="spin" size={15} aria-hidden="true" /> : null}
                </div>
                <div className="session-list">
                  {sessions.length === 0 ? (
                    <div className="session-empty">No sessions</div>
                  ) : (
                    sessions.map((session) => (
                      <div className={session.id === selectedSessionId ? "session-item active" : "session-item"} key={session.id}>
                        <button className="session-select-button" type="button" onClick={() => onSessionSelect(session)}>
                          <strong>{session.title || session.agent.name}</strong>
                          <span>{session.agent.name}</span>
                          <small>{formatDateTime(session.updated_at)}</small>
                        </button>
                        <button
                          className="session-remove-button"
                          type="button"
                          onClick={() => onSessionRemove(session)}
                          disabled={removingSessionId === session.id}
                          title="Remove session"
                          aria-label={`Remove ${session.title || session.agent.name} session`}
                        >
                          {removingSessionId === session.id ? <Loader2 className="spin" size={14} aria-hidden="true" /> : <X size={14} aria-hidden="true" />}
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </aside>

              <div className="message-history" ref={historyRef} aria-live="polite">
                {messages.length === 0 ? (
                  <div className="chat-placeholder">
                    <MessageSquare size={24} aria-hidden="true" />
                    <span>Send a message to start this session.</span>
                  </div>
                ) : (
                  messages.map((message) => (
                    <article className={message.role === "user" ? "chat-message user" : "chat-message assistant"} key={message.id}>
                      <span>{message.role === "user" ? "You" : "Agent"}</span>
                      {message.role === "assistant" ? <MarkdownMessage content={message.content} /> : <p>{message.content}</p>}
                      {message.awaitingApproval ? (
                        <div className="approval-actions">
                          {message.approvalStatus === "pending" ? (
                            <>
                              <button className="secondary-button compact-button" type="button" onClick={() => onConfirmApproval(message, "deny")} disabled={Boolean(approvalLoadingId) || loading}>
                                {approvalLoadingId === message.id ? <Loader2 className="spin" size={15} aria-hidden="true" /> : <X size={15} aria-hidden="true" />}
                                Deny
                              </button>
                              <button className="primary-button compact-button" type="button" onClick={() => onConfirmApproval(message, "allow")} disabled={Boolean(approvalLoadingId) || loading}>
                                {approvalLoadingId === message.id ? <Loader2 className="spin" size={15} aria-hidden="true" /> : <Check size={15} aria-hidden="true" />}
                                Approve
                              </button>
                            </>
                          ) : (
                            <span className={message.approvalStatus === "allowed" ? "approval-status allowed" : "approval-status denied"}>
                              {message.approvalStatus === "allowed" ? "Approved" : "Denied"}
                            </span>
                          )}
                        </div>
                      ) : null}
                    </article>
                  ))
                )}
                {loading ? (
                  <article className="chat-message assistant">
                    <span>Agent</span>
                    <p className="typing-line">
                      <Loader2 className="spin" size={16} aria-hidden="true" />
                      Thinking
                    </p>
                  </article>
                ) : null}
              </div>
            </div>

            {error ? <div className="notice error">{error}</div> : null}

            <form className="chat-compose" onSubmit={onSubmit}>
              <textarea
                value={input}
                onChange={(event) => onInputChange(event.target.value)}
                placeholder="Message the selected agent"
                rows={3}
                disabled={loading || !selectedAgentId || !selectedEnvironmentId}
              />
              <div className="chat-compose-actions">
                {canStopSelectedSession ? (
                  <button
                    className="secondary-button stop-session-button"
                    type="button"
                    onClick={() => {
                      if (selectedSession) void onSessionStop(selectedSession);
                    }}
                    disabled={stoppingSelectedSession}
                    title="Stop session"
                  >
                    {stoppingSelectedSession ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <Square size={16} aria-hidden="true" />}
                    Stop
                  </button>
                ) : null}
                <button className="primary-button" type="submit" disabled={loading || !input.trim() || !selectedAgentId || !selectedEnvironmentId}>
                  {loading ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
                  Send
                </button>
              </div>
            </form>
          </>
        )}
      </div>

      {settingsOpen ? (
        <ChatSettingsDialog
          environments={environments}
          vaults={vaults}
          selectedEnvironmentId={selectedEnvironmentId}
          selectedVaultIds={selectedVaultIds}
          onEnvironmentChange={onEnvironmentChange}
          onVaultToggle={onVaultToggle}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </section>
  );
}

function ChatSettingsDialog({
  environments,
  vaults,
  selectedEnvironmentId,
  selectedVaultIds,
  onEnvironmentChange,
  onVaultToggle,
  onClose,
}: {
  environments: AnthropicEnvironment[];
  vaults: VaultRecord[];
  selectedEnvironmentId: string;
  selectedVaultIds: string[];
  onEnvironmentChange: (environmentId: string) => void;
  onVaultToggle: (vaultId: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal title="Chat settings" onClose={onClose}>
      <div className="form-grid">
        <FormSection title="Runtime">
          <label>
            <span>Environment</span>
            <select value={selectedEnvironmentId} onChange={(event) => onEnvironmentChange(event.target.value)} disabled={environments.length === 0}>
              {environments.map((environment) => (
                <option value={environment.id} key={environment.id}>
                  {environment.name}
                </option>
              ))}
            </select>
          </label>
        </FormSection>

        <FormSection title="Vaults">
          <fieldset className="vault-selector modal-vault-selector">
            <legend>Attached vaults</legend>
            {vaults.length === 0 ? (
              <span className="vault-selector-empty">No vaults available</span>
            ) : (
              <div className="vault-selector-options">
                {vaults.map((vault) => (
                  <label className="vault-checkbox" key={vault.id}>
                    <input type="checkbox" checked={selectedVaultIds.includes(vault.id)} onChange={() => onVaultToggle(vault.id)} />
                    <span>{vault.display_name}</span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>
        </FormSection>

        <div className="dialog-actions">
          <button className="primary-button" type="button" onClick={onClose}>
            <Check size={16} aria-hidden="true" />
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
}

function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="markdown-message">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
