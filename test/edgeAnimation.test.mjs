import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("active route animation uses absolute dash lengths instead of normalized path fractions", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  const activeRouteBlock = css.match(/\.project-edge-group\.execution-active-route \.project-edge\s*\{(?<body>[\s\S]*?)\n\}/)?.groups?.body ?? "";

  assert.ok(activeRouteBlock, "active route CSS block should exist");
  assert.equal(app.includes("pathLength={1}"), false);
  assert.match(app, /--edge-path-length/);
  assert.doesNotMatch(activeRouteBlock, /stroke-dasharray:\s*0?\.\d/);
  assert.match(activeRouteBlock, /stroke-dasharray:\s*\d+(?:\.\d+)?\s+\d+(?:\.\d+)?/);
});
