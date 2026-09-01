import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("sessions dialog can continue a past graph session", async () => {
  const [app, apiClient, graphApi] = await Promise.all([
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/api/RaddusGraphApi.ts", import.meta.url), "utf8"),
    readFile(new URL("../server/graphApi.mjs", import.meta.url), "utf8"),
  ]);

  assert.ok(apiClient.includes("continueSession(sessionId: string)"), "API client should expose session continuation.");
  assert.ok(apiClient.includes("/continue"), "API client should call the continue endpoint.");
  assert.ok(graphApi.includes("continueGraphSession"), "Server API should route session continuation.");
  assert.ok(app.includes("function continueSession(sessionId: string)"), "App should continue sessions from the UI.");
  assert.ok(app.includes("canContinueGraphSession(selectedSession)"), "Continue action should be limited to past sessions.");
  assert.ok(app.includes("Continue"), "Sessions dialog should render a Continue button.");
});
