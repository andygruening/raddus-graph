import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const fallbackCodexModelId = "gpt-5.5";

const defaultCodexReasoningEffortOptions = [
  { id: "low", label: "Low", description: "Fast responses with lighter reasoning" },
  { id: "medium", label: "Medium", description: "Balances speed and reasoning depth for everyday tasks" },
  { id: "high", label: "High", description: "Greater reasoning depth for complex problems" },
  { id: "xhigh", label: "Extra high", description: "Extra high reasoning depth for complex problems" },
];

const codexReasoningEffortLabels = new Map([
  ["minimal", "Minimal"],
  ["low", "Low"],
  ["medium", "Medium"],
  ["high", "High"],
  ["xhigh", "Extra high"],
  ["max", "Max"],
  ["ultra", "Ultra"],
]);

const fallbackCodexModels = [
  codexModelEntry("gpt-5.5", "GPT-5.5"),
  codexModelEntry("gpt-5.6-sol", "GPT-5.6-Sol"),
  codexModelEntry("gpt-5.6-terra", "GPT-5.6-Terra"),
  codexModelEntry("gpt-5.6-luna", "GPT-5.6-Luna"),
  codexModelEntry("gpt-5.4", "GPT-5.4"),
  codexModelEntry("gpt-5.4-mini", "GPT-5.4-Mini"),
  codexModelEntry("gpt-5.3-codex-spark", "GPT-5.3-Codex-Spark"),
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

export function normalizeModelReasoningEffort(model, effort) {
  const normalized = typeof effort === "string" ? effort.trim() : "";
  if (!normalized || runnerForModel(model) !== "codex") return null;
  const supported = reasoningEffortsForModel(model).map((option) => option.id);
  return supported.includes(normalized) ? normalized : null;
}

export function reasoningEffortsForModel(model) {
  const entry = modelCatalog.find((candidate) => candidate.id === model);
  return entry?.runner === "codex" && Array.isArray(entry.reasoningEfforts) ? entry.reasoningEfforts : [];
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
      return [codexModelEntry(
        model.slug,
        typeof model.display_name === "string" && model.display_name.trim() ? model.display_name.trim() : model.slug,
        model.supported_reasoning_levels,
        model.default_reasoning_level,
      )];
    });
  } catch {
    return [];
  }
}

function codexModelEntry(id, label, supportedReasoningLevels = defaultCodexReasoningEffortOptions, defaultReasoningEffort = "medium") {
  const reasoningEfforts = normalizeReasoningEffortOptions(supportedReasoningLevels);
  return {
    id,
    label,
    runner: "codex",
    reasoningEfforts,
    defaultReasoningEffort: normalizeReasoningEffort(defaultReasoningEffort, reasoningEfforts) ?? null,
  };
}

function normalizeReasoningEffortOptions(value) {
  const seen = new Set();
  const source = Array.isArray(value) && value.length > 0 ? value : defaultCodexReasoningEffortOptions;
  return source.flatMap((option) => {
    const id = typeof option === "string" ? option.trim() : option?.effort?.trim() || option?.id?.trim() || "";
    if (!id || seen.has(id)) return [];
    seen.add(id);
    return [{
      id,
      label: typeof option?.label === "string" && option.label.trim() ? option.label.trim() : codexReasoningEffortLabels.get(id) ?? id,
      description: typeof option?.description === "string" ? option.description.trim() : "",
    }];
  });
}

function normalizeReasoningEffort(effort, options) {
  const normalized = typeof effort === "string" ? effort.trim() : "";
  return normalized && options.some((option) => option.id === normalized) ? normalized : null;
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
