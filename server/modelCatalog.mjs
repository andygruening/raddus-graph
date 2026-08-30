import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const fallbackCodexModelId = "gpt-5.5";

const fallbackCodexModels = [
  { id: "gpt-5.5", label: "GPT-5.5", runner: "codex" },
  { id: "gpt-5.6-sol", label: "GPT-5.6-Sol", runner: "codex" },
  { id: "gpt-5.6-terra", label: "GPT-5.6-Terra", runner: "codex" },
  { id: "gpt-5.6-luna", label: "GPT-5.6-Luna", runner: "codex" },
  { id: "gpt-5.4", label: "GPT-5.4", runner: "codex" },
  { id: "gpt-5.4-mini", label: "GPT-5.4-Mini", runner: "codex" },
  { id: "gpt-5.3-codex-spark", label: "GPT-5.3-Codex-Spark", runner: "codex" },
];

const unsupportedCodexModelIds = new Set(["gpt-5-codex", "gpt-5"]);

const claudeModels = [
  { id: "claude-opus-4-8", label: "Claude Opus 4.8", runner: "claude" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", runner: "claude" },
];

const availableCodexModels = localCodexModels();
const configuredCodexModelId = localCodexDefaultModelId();
export const defaultCodexModelId = defaultModelIdFor(availableCodexModels, configuredCodexModelId);

export const modelCatalog = [
  ...orderedCodexModels(),
  ...claudeModels,
];

export function runnerForModel(model) {
  const normalized = typeof model === "string" ? model.trim() : "";
  return modelCatalog.find((entry) => entry.id === normalized)?.runner ?? null;
}

export function modelIsSupported(model) {
  return Boolean(runnerForModel(model));
}

export function normalizeModelId(model) {
  const normalized = typeof model === "string" ? model.trim() : "";
  return modelIsSupported(normalized) ? normalized : defaultCodexModelId;
}

function orderedCodexModels() {
  const seen = new Set();
  const ordered = [];
  for (const model of availableCodexModels) {
    if (!model.id || seen.has(model.id)) continue;
    seen.add(model.id);
    ordered.push(model);
  }
  ordered.sort((left, right) => {
    if (left.id === defaultCodexModelId) return -1;
    if (right.id === defaultCodexModelId) return 1;
    return 0;
  });
  return ordered;
}

function localCodexModels() {
  const fromCache = codexModelsFromLocalCache();
  return fromCache.length > 0 ? fromCache : fallbackCodexModels;
}

function defaultModelIdFor(models, configuredModelId) {
  if (configuredModelId && models.some((model) => model.id === configuredModelId)) return configuredModelId;
  if (models.some((model) => model.id === fallbackCodexModelId)) return fallbackCodexModelId;
  return models[0]?.id ?? fallbackCodexModelId;
}

function codexModelsFromLocalCache() {
  try {
    const text = readFileSync(join(homedir(), ".codex", "models_cache.json"), "utf8");
    const cache = JSON.parse(text);
    if (!Array.isArray(cache.models)) return [];
    return cache.models.flatMap((model) => {
      if (model?.visibility !== "list" || typeof model.slug !== "string" || unsupportedCodexModelIds.has(model.slug)) return [];
      return [{
        id: model.slug,
        label: typeof model.display_name === "string" && model.display_name.trim() ? model.display_name.trim() : model.slug,
        runner: "codex",
      }];
    });
  } catch {
    return [];
  }
}

function localCodexDefaultModelId() {
  try {
    const text = readFileSync(join(homedir(), ".codex", "config.toml"), "utf8");
    const match = text.match(/^model\s*=\s*"([^"]+)"/m);
    return match?.[1]?.trim() || null;
  } catch {
    return null;
  }
}
