export const modelCatalog = [
  { id: "gpt-5-codex", label: "GPT-5 Codex", runner: "codex" },
  { id: "gpt-5", label: "GPT-5", runner: "codex" },
  { id: "o3", label: "o3", runner: "codex" },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8", runner: "claude" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", runner: "claude" },
];

export function runnerForModel(model) {
  const normalized = typeof model === "string" ? model.trim() : "";
  return modelCatalog.find((entry) => entry.id === normalized)?.runner ?? null;
}

export function modelIsSupported(model) {
  return Boolean(runnerForModel(model));
}
