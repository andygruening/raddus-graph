import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { projectNodeSizeForType } from "../src/edgeRouting.ts";

test("review cards are available in the canvas UI and styled like start cards", async () => {
  const [app, css, api] = await Promise.all([
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../src/api/RaddusGraphApi.ts", import.meta.url), "utf8"),
  ]);
  const playBlock = css.match(/\.project-node\.play\s*\{(?<body>[\s\S]*?)\n\}/)?.groups?.body ?? "";
  const reviewBlock = css.match(/\.project-node\.review\s*\{(?<body>[\s\S]*?)\n\}/)?.groups?.body ?? "";

  assert.ok(api.includes('"play" | "agent" | "expression" | "review"'), "Graph node types should include review.");
  assert.ok(api.includes('"running" | "waiting_review" | "completed"'), "Graph session status should include waiting_review.");
  assert.deepEqual(projectNodeSizeForType("review"), projectNodeSizeForType("play"));
  assert.deepEqual(projectNodeSizeForType("review"), { width: 56, height: 56 });
  assert.deepEqual(projectNodeSizeForType("play"), { width: 56, height: 56 });
  assert.ok(app.includes("function PaletteReviewButton"), "The palette should expose a review card.");
  assert.ok(app.includes("function ReviewDialog"), "Clicking a pending review should open a response dialog.");
  assert.ok(app.includes("submitReviewResponse"), "Review answers should call the resume API.");
  assert.ok(app.includes("activeReviewNodeIds"), "Pending reviews should highlight their canvas card.");
  assert.equal(app.includes("<strong>Start</strong>"), false, "Start canvas cards should be icon-only.");
  assert.ok(app.includes("<MessageSquareText size={20}"), "Review canvas cards should use an icon-only layout.");
  assert.equal(app.includes("project-edge-label"), false, "Route result IDs should not render above connection lines.");
  assert.equal(css.includes("project-edge-label"), false, "Hidden route labels should not leave unused CSS behind.");
  assert.ok(playBlock, "play card CSS block should exist");
  assert.ok(reviewBlock, "review card CSS block should exist");
  for (const block of [playBlock, reviewBlock]) {
    assert.match(block, /width:\s*56px/);
    assert.match(block, /height:\s*56px/);
    assert.match(block, /min-height:\s*56px/);
  }
});
