import React from "react";
import { KeyRound, Loader2 } from "lucide-react";

interface SignInViewProps {
  themedStyle: React.CSSProperties & Record<`--${string}`, string | number>;
  onSubmitApiKey: (apiKey: string) => Promise<void>;
}

export function SignInView({ themedStyle, onSubmitApiKey }: SignInViewProps) {
  const [apiKey, setApiKey] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmedKey = apiKey.trim();
    if (!trimmedKey) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmitApiKey(trimmedKey);
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="signin-shell" style={themedStyle}>
      <section className="signin-panel local-key-panel">
        <div className="signin-heading">
          <div className="signin-logo local-key-logo" aria-hidden="true">
            <KeyRound size={22} />
          </div>
          <div className="signin-title-copy">
            <h1>Raddus Canvas</h1>
          </div>
        </div>
        <p className="signin-tagline">
          Enter a valid Anthropic API Key. Your key is securely stored on this device.{" "}
          <a href="https://github.com/andygruening/raddus-canvas#security" target="_blank" rel="noreferrer">
            Learn More
          </a>
        </p>
        <form className="local-key-form" onSubmit={submit}>
          <div className="local-key-input-wrap">
            <input
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              type="password"
              placeholder="sk-ant-api..."
              aria-label="Anthropic API key"
              autoComplete="off"
              spellCheck={false}
              required
            />
            <span className="local-key-input-mark" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </div>
          {error ? <div className="notice error">{error}</div> : null}
          <button className="primary-button" type="submit" disabled={saving || !apiKey.trim()}>
            {saving ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <KeyRound size={16} aria-hidden="true" />}
            Continue
          </button>
        </form>
      </section>
    </main>
  );
}
