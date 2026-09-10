import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultCodexModelId,
  discoverModelCatalog,
  modelCatalog,
  modelIsSupported,
  normalizeModelReasoningEffort,
  reasoningEffortsForModel,
  normalizeModelId,
  runnerForModel,
} from "../server/modelCatalog.mjs";

test("model catalog defaults to a Codex model supported by the local ChatGPT account", () => {
  assert.equal(runnerForModel(defaultCodexModelId), "codex");
  assert.equal(modelCatalog[0].id, defaultCodexModelId);
  assert.notEqual(defaultCodexModelId, "gpt-5-codex");
  assert.notEqual(defaultCodexModelId, "gpt-5");
});

test("unsupported legacy Codex model IDs are not offered or retained", () => {
  assert.equal(modelIsSupported("gpt-5-codex"), false);
  assert.equal(modelIsSupported("gpt-5"), false);
  assert.equal(normalizeModelId("gpt-5-codex"), defaultCodexModelId);
  assert.equal(normalizeModelId("gpt-5"), defaultCodexModelId);
});

test("Codex models expose supported reasoning efforts", () => {
  const efforts = reasoningEffortsForModel(defaultCodexModelId);
  assert.ok(efforts.length > 0);
  assert.ok(efforts.some((effort) => effort.id === "high"));
  assert.equal(normalizeModelReasoningEffort(defaultCodexModelId, "high"), "high");
  assert.equal(normalizeModelReasoningEffort(defaultCodexModelId, "unsupported"), null);
});

test("Claude fallback models expose supported reasoning efforts", () => {
  const efforts = reasoningEffortsForModel("claude-sonnet-4-6");
  assert.ok(efforts.some((effort) => effort.id === "high"));
  assert.equal(normalizeModelReasoningEffort("claude-sonnet-4-6", "high"), "high");
  assert.equal(normalizeModelReasoningEffort("claude-sonnet-4-6", "ultra"), null);
});

test("model discovery reads Codex catalog JSON and Claude effort levels from CLI help", async () => {
  const calls = [];
  const payload = await discoverModelCatalog({
    checkedAt: "2026-09-04T00:00:00.000Z",
    codexDefaultModelId: "gpt-cli-default",
    runProcess: async (command, args) => {
      calls.push([command, args]);
      if (command === "codex") {
        assert.deepEqual(args, ["debug", "models"]);
        return {
          ok: true,
          stdout: JSON.stringify({
            models: [
              {
                slug: "gpt-hidden",
                display_name: "GPT Hidden",
                visibility: "hide",
                supported_reasoning_levels: ["low"],
              },
              {
                slug: "gpt-cli-default",
                display_name: "GPT CLI Default",
                visibility: "list",
                default_reasoning_level: "high",
                supported_reasoning_levels: [
                  { effort: "low", description: "Fast" },
                  { effort: "high", description: "Deep" },
                ],
              },
            ],
          }),
          stderr: "",
        };
      }
      if (command === "claude" && args[0] === "--version") {
        return { ok: true, stdout: "2.1.258 (Claude Code)", stderr: "" };
      }
      if (command === "claude" && args[0] === "--help") {
        return {
          ok: true,
          stdout: "--effort <level> Effort level for the current session (low, medium, high, xhigh, max)",
          stderr: "",
        };
      }
      return { ok: false, stdout: "", stderr: "unexpected command" };
    },
  });

  assert.equal(payload.checkedAt, "2026-09-04T00:00:00.000Z");
  assert.ok(calls.some(([command]) => command === "codex"));
  assert.ok(calls.some(([command, args]) => command === "claude" && args[0] === "--help"));
  assert.equal(payload.models[0].id, "gpt-cli-default");
  assert.equal(payload.models.some((model) => model.id === "gpt-hidden"), false);
  assert.deepEqual(
    payload.models.find((model) => model.id === "gpt-cli-default")?.reasoningEfforts.map((effort) => effort.id),
    ["low", "high"],
  );
  assert.deepEqual(
    payload.models.find((model) => model.id === "claude-sonnet-4-6")?.reasoningEfforts.map((effort) => effort.id),
    ["low", "medium", "high", "xhigh", "max"],
  );
  assert.equal(payload.runners.find((runner) => runner.id === "codex")?.source, "cli");
  assert.equal(payload.runners.find((runner) => runner.id === "claude")?.source, "cli-help+fallback-models");
  assert.match(payload.runners.find((runner) => runner.id === "claude")?.error ?? "", /machine-readable model catalog/);
});
