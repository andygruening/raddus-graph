import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

async function importCanvasViewportStorage() {
  const source = await readFile(new URL("../src/canvasViewportStorage.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const path = join(tmpdir(), `canvasViewportStorage-${Date.now()}-${Math.random().toString(16).slice(2)}.mjs`);
  await writeFile(path, output.outputText);
  return import(`file://${path}`);
}

function memoryStorage() {
  const items = new Map();
  return {
    getItem(key) {
      return items.has(key) ? items.get(key) : null;
    },
    setItem(key, value) {
      items.set(key, value);
    },
  };
}

test("canvas viewport persists per project and rejects malformed values", async () => {
  const {
    defaultCanvasViewport,
    readCanvasViewport,
    writeCanvasViewport,
    canvasViewportStorageKey,
  } = await importCanvasViewportStorage();
  const storage = memoryStorage();

  writeCanvasViewport("project-alpha", { x: -320, y: 144, zoom: 1.35 }, storage);
  writeCanvasViewport("project-beta", { x: 80, y: 12, zoom: 0.7 }, storage);

  assert.equal(canvasViewportStorageKey("project-alpha"), "raddus-graph:canvas-viewport:project-alpha");
  assert.deepEqual(readCanvasViewport("project-alpha", storage), { x: -320, y: 144, zoom: 1.35 });
  assert.deepEqual(readCanvasViewport("project-beta", storage), { x: 80, y: 12, zoom: 0.7 });

  storage.setItem(canvasViewportStorageKey("project-alpha"), JSON.stringify({ x: "bad", y: 0, zoom: 1 }));
  assert.deepEqual(readCanvasViewport("project-alpha", storage), defaultCanvasViewport);
});

test("app restores saved project viewport and persists camera changes", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");

  assert.ok(app.includes("readCanvasViewport"), "App should read saved viewport state.");
  assert.ok(app.includes("writeCanvasViewport"), "App should write viewport state.");
  assert.ok(app.includes("state?.selectedProjectId"), "Viewport restore should be scoped to the selected project.");
  assert.ok(app.includes("function scheduleCamera(nextCamera: CanvasViewport"), "Camera changes should flow through scheduleCamera.");
  assert.ok(app.includes("persistCameraProjectIdFrameRef"), "Scheduled viewport writes should keep the project id they started with.");
  assert.ok(app.includes("persistCameraValueFrameRef"), "Scheduled viewport writes should keep the camera value they started with.");
  assert.ok(app.includes("writeCanvasViewport(persistProjectId, persistCamera)"), "Scheduled camera changes should persist.");
  assert.equal(app.includes("setCamera(defaultCanvasViewport);"), false, "Project switching should restore the saved viewport instead of resetting.");
});
