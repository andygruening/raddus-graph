import type { ManagedSession } from "./types";

export interface ManagedSessionUsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  total: number;
}

export interface ModelPricingUsdPerMtok {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
}

const managedAgentRuntimeUsdPerHour = 0.08;
const sonnet5PriceChangeAtMs = Date.UTC(2026, 8, 1);
const sonnet5IntroPricing: ModelPricingUsdPerMtok = { input: 2, output: 10, cacheRead: 0.2, cacheWrite5m: 2.5, cacheWrite1h: 4 };
const sonnet5StandardPricing: ModelPricingUsdPerMtok = { input: 3, output: 15, cacheRead: 0.3, cacheWrite5m: 3.75, cacheWrite1h: 6 };
const fable5Pricing: ModelPricingUsdPerMtok = { input: 10, output: 50, cacheRead: 1, cacheWrite5m: 12.5, cacheWrite1h: 20 };
const opus5Pricing: ModelPricingUsdPerMtok = { input: 5, output: 25, cacheRead: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 10 };
const opus4Pricing: ModelPricingUsdPerMtok = { input: 15, output: 75, cacheRead: 1.5, cacheWrite5m: 18.75, cacheWrite1h: 30 };
const sonnetPricing: ModelPricingUsdPerMtok = { input: 3, output: 15, cacheRead: 0.3, cacheWrite5m: 3.75, cacheWrite1h: 6 };
const haiku45Pricing: ModelPricingUsdPerMtok = { input: 1, output: 5, cacheRead: 0.1, cacheWrite5m: 1.25, cacheWrite1h: 2 };
const haiku35Pricing: ModelPricingUsdPerMtok = { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite5m: 1, cacheWrite1h: 1.6 };

const modelListPricingUsdPerMtok: Record<string, ModelPricingUsdPerMtok> = {
  "claude-fable-5": fable5Pricing,
  "claude-mythos-5": fable5Pricing,
  "claude-opus-5": opus5Pricing,
  "claude-opus-4-8": opus5Pricing,
  "claude-opus-4-7": opus5Pricing,
  "claude-opus-4-6": opus5Pricing,
  "claude-opus-4-5": opus5Pricing,
  "claude-opus-4-1": opus4Pricing,
  "claude-opus-4": opus4Pricing,
  "claude-sonnet-4-6": sonnetPricing,
  "claude-sonnet-4-5": sonnetPricing,
  "claude-sonnet-4": sonnetPricing,
  "claude-3-7-sonnet": sonnetPricing,
  "claude-3-5-sonnet": sonnetPricing,
  "claude-haiku-4-5": haiku45Pricing,
  "claude-haiku-3-5": haiku35Pricing,
  "claude-3-5-haiku": haiku35Pricing,
};

const modelPricingPrefixes = Object.keys(modelListPricingUsdPerMtok).sort((left, right) => right.length - left.length);

export function sessionModelId(session: ManagedSession): string | null {
  const model = session.agent.model;
  if (typeof model === "string") return model;
  if (model && typeof model.id === "string" && model.id.trim()) return model.id;
  return null;
}

export function pricingForModel(modelId: string | null): ModelPricingUsdPerMtok | null {
  if (!modelId) return null;
  const normalizedModelId = modelId.toLowerCase();
  if (normalizedModelId.startsWith("claude-sonnet-5")) {
    return Date.now() < sonnet5PriceChangeAtMs ? sonnet5IntroPricing : sonnet5StandardPricing;
  }
  const exactPricing = modelListPricingUsdPerMtok[normalizedModelId];
  if (exactPricing) return exactPricing;
  const prefix = modelPricingPrefixes.find((candidate) => normalizedModelId.startsWith(candidate));
  return prefix ? modelListPricingUsdPerMtok[prefix] : null;
}

export function sessionUsageTotals(usage: ManagedSession["usage"]): ManagedSessionUsageTotals | null {
  if (!usage) return null;
  const input = finiteNumberOrZero(usage.input_tokens);
  const output = finiteNumberOrZero(usage.output_tokens);
  const cacheRead = finiteNumberOrZero(usage.cache_read_input_tokens);
  const cacheWrite5m = finiteNumberOrZero(usage.cache_creation?.ephemeral_5m_input_tokens);
  const cacheWrite1h = finiteNumberOrZero(usage.cache_creation?.ephemeral_1h_input_tokens);
  return {
    input,
    output,
    cacheRead,
    cacheWrite5m,
    cacheWrite1h,
    total: input + output + cacheRead + cacheWrite5m + cacheWrite1h,
  };
}

export function estimateManagedSessionCost(session: ManagedSession): {
  tokenCostUsd: number | null;
  runtimeCostUsd: number | null;
  totalCostUsd: number | null;
  pricingAvailable: boolean;
} {
  const pricing = pricingForModel(sessionModelId(session));
  const usage = sessionUsageTotals(session.usage);
  const tokenCostUsd = pricing && usage
    ? (
        (usage.input * pricing.input)
        + (usage.output * pricing.output)
        + (usage.cacheRead * pricing.cacheRead)
        + (usage.cacheWrite5m * pricing.cacheWrite5m)
        + (usage.cacheWrite1h * pricing.cacheWrite1h)
      ) / 1_000_000
    : null;
  const activeSeconds = finiteNumberOrNull(session.stats?.active_seconds);
  const runtimeCostUsd = activeSeconds === null ? null : (activeSeconds / 3600) * managedAgentRuntimeUsdPerHour;
  const totalCostUsd = tokenCostUsd === null && runtimeCostUsd === null ? null : (tokenCostUsd ?? 0) + (runtimeCostUsd ?? 0);
  return {
    tokenCostUsd,
    runtimeCostUsd,
    totalCostUsd,
    pricingAvailable: Boolean(pricing),
  };
}

export function finiteNumberOrZero(value: number | null | undefined): number {
  return finiteNumberOrNull(value) ?? 0;
}

export function finiteNumberOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function formatSessionStatus(status: ManagedSession["status"]): string {
  if (status === "rescheduling") return "Rescheduling";
  if (status === "running") return "Running";
  if (status === "idle") return "Idle";
  return "Terminated";
}

export function formatSessionDuration(value: number | null | undefined): string {
  const seconds = finiteNumberOrNull(value);
  if (seconds === null) return "Unavailable";
  const roundedSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(roundedSeconds / 3600);
  const minutes = Math.floor((roundedSeconds % 3600) / 60);
  const remainderSeconds = roundedSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${remainderSeconds}s`;
  return `${remainderSeconds}s`;
}

export function formatTokenCount(value: number | null): string {
  if (value === null) return "Unavailable";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

export function formatUsd(value: number | null): string {
  if (value === null) return "Unavailable";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value >= 1 ? 2 : 4,
    maximumFractionDigits: value >= 1 ? 2 : 6,
  }).format(value);
}
