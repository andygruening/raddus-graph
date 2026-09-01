import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("start dialogs close after a play launch starts successfully", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");

  assert.ok(
    app.includes("async function runPlayNode(node: GraphNode, launchSelection?: PlayLaunchSelection): Promise<boolean>"),
    "runPlayNode should return whether the launch started.",
  );
  assert.ok(
    app.includes("async function runPlayLaunch(selection: PlayLaunchSelection): Promise<boolean>"),
    "runPlayLaunch should return whether the launch started.",
  );
  assert.ok(
    app.includes("const started = await runPlayNode(node);") &&
      app.includes("if (started) setDialog(null);"),
    "The node play dialog should close after a successful start.",
  );
  assert.ok(
    app.includes("const started = await runPlayLaunch(selection);") &&
      app.includes("if (started) setDialog(null);"),
    "The graph play dialog should close after a successful start.",
  );
});
