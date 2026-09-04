import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { projectNodeSizeForType } from "../src/edgeRouting.ts";

test("approval review is global UI, not a canvas card or route target", async () => {
  const [app, css, api] = await Promise.all([
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../src/api/RaddusGraphApi.ts", import.meta.url), "utf8"),
  ]);

  assert.ok(api.includes('"play" | "agent" | "expression" | "graph" | "any"'), "Graph node types should not include review.");
  assert.deepEqual(projectNodeSizeForType("play"), { width: 56, height: 56 });
  assert.equal(app.includes('type: "review"'), false, "New projects should not include a review card.");
  assert.equal(app.includes('node.type === "review"'), false, "Canvas cards should not render or open review nodes.");
  assert.equal(app.includes('target.type === "review"'), false, "The UI should not create routes to review nodes.");
  assert.equal(css.includes(".project-node.review"), false, "Review card styling should not remain on the canvas.");
  assert.ok(app.includes("pendingApprovalSessions"), "The app should scan all sessions for pending approvals.");
  assert.ok(app.includes("pending-approval-overlay"), "Pending approvals should render at the top center.");
  assert.ok(app.includes('type: "approval-review"'), "Pending approvals should open a session-based review dialog.");
  assert.ok(app.includes("api.submitReviewResponse(sessionId, { answer })"), "Review answers should submit without a review node id.");
  assert.ok(css.includes(".pending-approval-button"), "Pending approvals should have a visible icon-only button style.");
});
