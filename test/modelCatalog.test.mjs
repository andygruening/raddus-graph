import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultCodexModelId,
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
  assert.equal(normalizeModelReasoningEffort("claude-sonnet-4-6", "high"), null);
});
