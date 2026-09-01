import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("agent handoffs play a ding when a later agent starts", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");

  assert.ok(app.includes("agentHandoffDingRef"), "App should track handoff ding state across renders.");
  assert.ok(app.includes("playedAgentSessionIds"), "Each next agent should only trigger one ding.");
  assert.ok(app.includes("!isStartedAgentSession(agentSession)"), "Queued handoff stubs should not trigger the ding.");
  assert.ok(app.includes("didAgentStartAfterPreviousFinished(session, agentSession)"), "Dings should require a terminal previous agent.");
  assert.ok(app.includes("function playAgentHandoffDing()"), "App should provide an agent handoff sound effect.");
  assert.ok(app.includes("primeAgentHandoffDing();"), "User interactions that start or resume graphs should unlock audio playback.");
});
