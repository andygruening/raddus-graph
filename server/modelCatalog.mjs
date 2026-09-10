import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { runProcess as defaultRunProcess } from "./processUtils.mjs";

export const fallbackCodexModelId = "gpt-5.5";

const defaultCodexReasoningEffortOptions = [
  { id: "low", label: "Low", description: "Fast responses with lighter reasoning" },
  { id: "medium", label: "Medium", description: "Balances speed and reasoning depth for everyday tasks" },
  { id: "high", label: "High", description: "Greater reasoning depth for complex problems" },
  { id: "xhigh", label: "Extra high", description: "Extra high reasoning depth for complex problems" },
];

const reasoningEffortLabels = new Map([
  ["minimal", "Minimal"],
  ["low", "Low"],
  ["medium", "Medium"],
  ["high", "High"],
  ["xhigh", "Extra high"],
  ["max", "Max"],
  ["ultra", "Ultra"],
]);

const defaultClaudeReasoningEffortOptions = [
  { id: "low", label: "Low", description: "Fast responses with lighter reasoning" },
  { id: "medium", label: "Medium", description: "Balances speed and reasoning depth for everyday tasks" },
  { id: "high", label: "High", description: "Greater reasoning depth for complex problems" },
  { id: "xhigh", label: "Extra high", description: "Extra high reasoning depth for complex problems" },
  { id: "max", label: "Max", description: "Maximum reasoning depth for the hardest problems" },
];

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

const baseClaudeModels = [
  { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
];
const fallbackClaudeModels = claudeModelsWithReasoning(defaultClaudeReasoningEffortOptions);

const availableCodexModels = localCodexModelSet().models;
const configuredCodexModelId = localCodexDefaultModelId();
export const defaultCodexModelId = defaultModelIdFor(availableCodexModels, configuredCodexModelId);

export const modelCatalog = [
  ...orderedCodexModels(availableCodexModels, defaultCodexModelId),
  ...fallbackClaudeModels,
];

export async function refreshModelCatalog(options = {}) {
  const payload = await discoverModelCatalog(options);
  replaceModelCatalog(payload.models);
  return payload;
}

export async function discoverModelCatalog(options = {}) {
  const runProcess = options.runProcess ?? defaultRunProcess;
  const checkedAt = options.checkedAt ?? new Date().toISOString();
  const [codexCli, claudeCli] = await Promise.all([
    discoverCodexCliModels(runProcess),
    discoverClaudeCliModels(runProcess),
  ]);
  const codexFallback = localCodexModelSet();
  const codexModels = codexCli.models.length > 0 ? codexCli.models : codexFallback.models;
  const codexDefaultModelId = defaultModelIdFor(
    codexModels,
    options.codexDefaultModelId ?? localCodexDefaultModelId(),
  );
  const claudeModels = claudeCli.models.length > 0 ? claudeCli.models : fallbackClaudeModels;
  const models = [
    ...orderedCodexModels(codexModels, codexDefaultModelId),
    ...dedupeModels(claudeModels),
  ];

  return {
    checkedAt,
    models,
    runners: [
      {
        ...codexCli.runner,
        source: codexCli.models.length > 0 ? "cli" : codexFallback.source,
        error: codexCli.models.length > 0 ? null : codexCli.runner.error,
      },
      claudeCli.runner,
    ],
  };
}

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
  if (!normalized) return null;
  const supported = reasoningEffortsForModel(model).map((option) => option.id);
  return supported.includes(normalized) ? normalized : null;
}

export function reasoningEffortsForModel(model) {
  const entry = modelCatalog.find((candidate) => candidate.id === model);
  return Array.isArray(entry?.reasoningEfforts) ? entry.reasoningEfforts : [];
}

function replaceModelCatalog(models) {
  modelCatalog.splice(0, modelCatalog.length, ...dedupeModels(models));
}

function orderedCodexModels(models, defaultModelId) {
  const seen = new Set();
  const ordered = [];
  for (const model of models) {
    if (!model.id || seen.has(model.id)) continue;
    seen.add(model.id);
    ordered.push(model);
  }
  ordered.sort((left, right) => {
    if (left.id === defaultModelId) return -1;
    if (right.id === defaultModelId) return 1;
    return 0;
  });
  return ordered;
}

function localCodexModelSet() {
  const fromCache = codexModelsFromLocalCache();
  if (fromCache.length > 0) return { models: fromCache, source: "cache" };
  return { models: fallbackCodexModels, source: "fallback" };
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

async function discoverCodexCliModels(runProcess) {
  const result = await runProcess("codex", ["debug", "models"], {
    timeoutMs: 10_000,
    maxOutputBytes: 6_000_000,
  });
  const available = !result.error;
  if (!result.ok) {
    return {
      models: [],
      runner: runnerDiscovery("codex", "Codex", "codex", available, "fallback", processErrorMessage("codex debug models", result)),
    };
  }

  const parsed = parseJsonOutput(result.stdout || result.stderr);
  if (!parsed.ok) {
    return {
      models: [],
      runner: runnerDiscovery("codex", "Codex", "codex", available, "fallback", "Codex CLI model catalog was not valid JSON."),
    };
  }

  const models = codexModelsFromCatalogPayload(parsed.value);
  return {
    models,
    runner: runnerDiscovery(
      "codex",
      "Codex",
      "codex",
      available,
      "cli",
      models.length > 0 ? null : "Codex CLI returned no listable models.",
    ),
  };
}

async function discoverClaudeCliModels(runProcess) {
  const versionResult = await runProcess("claude", ["--version"], {
    timeoutMs: 5_000,
    maxOutputBytes: 20_000,
  });
  if (!versionResult.ok) {
    return {
      models: baseClaudeModels.map((model) => ({ ...model, runner: "claude" })),
      runner: runnerDiscovery("claude", "Claude", "claude", !versionResult.error, "fallback", processErrorMessage("claude --version", versionResult)),
    };
  }

  const helpResult = await runProcess("claude", ["--help"], {
    timeoutMs: 5_000,
    maxOutputBytes: 80_000,
  });
  const effortOptions = helpResult.ok ? reasoningEffortOptionsFromHelp(helpResult.stdout || helpResult.stderr) : [];
  const models = effortOptions.length > 0
    ? claudeModelsWithReasoning(effortOptions)
    : baseClaudeModels.map((model) => ({ ...model, runner: "claude" }));

  return {
    models,
    runner: {
      ...runnerDiscovery(
        "claude",
        "Claude",
        "claude",
        true,
        helpResult.ok ? "cli-help+fallback-models" : "fallback",
        helpResult.ok
          ? "Claude CLI does not expose a machine-readable model catalog; using bundled model IDs."
          : processErrorMessage("claude --help", helpResult),
      ),
      version: cleanProcessText(versionResult.stdout || versionResult.stderr),
    },
  };
}

function codexModelsFromCatalogPayload(value) {
  const records = Array.isArray(value?.models) ? value.models : [];
  return records.flatMap((model) => {
    const id = typeof model?.slug === "string" ? model.slug.trim() : typeof model?.id === "string" ? model.id.trim() : "";
    if (model?.visibility !== "list" || !id || unsupportedCodexModelIds.has(id)) return [];
    return [codexModelEntry(
      id,
      typeof model.display_name === "string" && model.display_name.trim() ? model.display_name.trim() : id,
      model.supported_reasoning_levels,
      model.default_reasoning_level,
    )];
  });
}

function codexModelEntry(id, label, supportedReasoningLevels = defaultCodexReasoningEffortOptions, defaultReasoningEffort = "medium") {
  const reasoningEfforts = normalizeReasoningEffortOptions(supportedReasoningLevels, defaultCodexReasoningEffortOptions);
  return {
    id,
    label,
    runner: "codex",
    reasoningEfforts,
    defaultReasoningEffort: normalizeReasoningEffort(defaultReasoningEffort, reasoningEfforts) ?? null,
  };
}

function claudeModelsWithReasoning(reasoningEfforts) {
  return baseClaudeModels.map((model) => claudeModelEntry(model.id, model.label, reasoningEfforts));
}

function claudeModelEntry(id, label, supportedReasoningLevels = defaultClaudeReasoningEffortOptions, defaultReasoningEffort = null) {
  const reasoningEfforts = normalizeReasoningEffortOptions(supportedReasoningLevels, []);
  return {
    id,
    label,
    runner: "claude",
    ...(reasoningEfforts.length > 0 ? { reasoningEfforts } : {}),
    defaultReasoningEffort: normalizeReasoningEffort(defaultReasoningEffort, reasoningEfforts) ?? null,
  };
}

function normalizeReasoningEffortOptions(value, fallbackOptions) {
  const seen = new Set();
  const source = Array.isArray(value) && value.length > 0 ? value : fallbackOptions;
  return source.flatMap((option) => {
    const id = typeof option === "string" ? option.trim() : option?.effort?.trim() || option?.id?.trim() || "";
    if (!id || seen.has(id)) return [];
    seen.add(id);
    return [{
      id,
      label: typeof option?.label === "string" && option.label.trim() ? option.label.trim() : reasoningEffortLabels.get(id) ?? id,
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

function reasoningEffortOptionsFromHelp(text) {
  const match = text.match(/--effort\s+<level>[\s\S]*?\(([^)]+)\)/);
  if (!match) return [];
  const efforts = match[1]
    .split(",")
    .map((option) => option.trim())
    .filter((option) => /^[a-z][a-z0-9-]*$/.test(option));
  return normalizeReasoningEffortOptions(efforts, []);
}

function parseJsonOutput(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return { ok: false, value: null };
    try {
      return { ok: true, value: JSON.parse(text.slice(start, end + 1)) };
    } catch {
      return { ok: false, value: null };
    }
  }
}

function runnerDiscovery(id, label, command, available, source, error) {
  return {
    id,
    label,
    command,
    available,
    source,
    error: error || null,
  };
}

function processErrorMessage(command, result) {
  if (result.timedOut) return `${command} timed out.`;
  return cleanProcessText(result.stderr || result.stdout || result.error?.message || "") || `${command} exited with code ${result.code ?? "unknown"}.`;
}

function cleanProcessText(text) {
  return String(text)
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function dedupeModels(models) {
  const seen = new Set();
  return models.flatMap((model) => {
    const id = typeof model?.id === "string" ? model.id.trim() : "";
    if (!id || seen.has(id)) return [];
    seen.add(id);
    return [{ ...model, id }];
  });
}
