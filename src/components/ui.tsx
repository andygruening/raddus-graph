import React from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronRight, X } from "lucide-react";
import { agentModelOptions } from "../domain/modelCatalog";

export function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="form-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function CollapsibleSection({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="form-section collapsible-section">
      <button className="collapsible-section-toggle" type="button" onClick={onToggle} aria-expanded={open}>
        <span>{title}</span>
        {open ? <ChevronDown size={17} aria-hidden="true" /> : <ChevronRight size={17} aria-hidden="true" />}
      </button>
      {open ? <div className="collapsible-section-body">{children}</div> : null}
    </section>
  );
}

export function AgentModelSelect({
  value,
  onChange,
  disabled,
  required,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
}) {
  const hasKnownValue = agentModelOptions.some((option) => option.value === value);

  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} required={required}>
      {!hasKnownValue && value ? <option value={value}>{value}</option> : null}
      {agentModelOptions.map((option) => (
        <option value={option.value} key={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function JsonEditor({ label, value, onChange, rows, disabled }: { label: string; value: string; onChange: (value: string) => void; rows: number; disabled?: boolean }) {
  return (
    <label>
      <span>{label}</span>
      <textarea className="code-input" value={value} onChange={(event) => onChange(event.target.value)} rows={rows} spellCheck={false} disabled={disabled} />
    </label>
  );
}

export function Modal({
  title,
  children,
  onClose,
  wide,
  side,
  plainHeader,
  className: extraClassName,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
  side?: boolean;
  plainHeader?: boolean;
  className?: string;
}) {
  const [entered, setEntered] = React.useState(false);

  React.useEffect(() => {
    const frame = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const className = `${side ? `modal side ${entered ? "entered" : ""}` : wide ? "modal wide" : "modal"}${extraClassName ? ` ${extraClassName}` : ""}`;
  const backdropClassName = side ? `modal-backdrop side-backdrop ${entered ? "entered" : ""}` : "modal-backdrop";
  return createPortal(
    <div className={backdropClassName} role="presentation" onMouseDown={onClose}>
      <section className={className} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <header className={plainHeader ? "modal-header plain" : "modal-header"}>
          <h1>{title}</h1>
          {!plainHeader ? (
            <button className="icon-button" type="button" onClick={onClose} title="Close">
              <X size={18} aria-hidden="true" />
            </button>
          ) : (
            <button className="icon-button modal-close-button" type="button" onClick={onClose} title="Close">
              <X size={18} aria-hidden="true" />
            </button>
          )}
        </header>
        {children}
      </section>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="confirm-backdrop" role="presentation" onMouseDown={onCancel}>
      <section className="confirm-modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <h2>{title}</h2>
        <p>{message}</p>
        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>
            <X size={16} aria-hidden="true" />
            Cancel
          </button>
          <button className={danger ? "danger-button" : "primary-button"} type="button" onClick={onConfirm}>
            <Check size={16} aria-hidden="true" />
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

export function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="info-row">
      <div>{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
