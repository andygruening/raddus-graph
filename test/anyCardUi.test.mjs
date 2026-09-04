import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { projectNodeSizeForType } from "../src/edgeRouting.ts";

test("any card is a required red square and only connects to expressions", async () => {
  const [app, css, api] = await Promise.all([
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../src/api/RaddusGraphApi.ts", import.meta.url), "utf8"),
  ]);
  const anyBlock = css.match(/\.project-node\.any\s*\{(?<body>[\s\S]*?)\n\}/)?.groups?.body ?? "";

  assert.ok(api.includes('"graph" | "any"'), "Graph node types should include any.");
  assert.deepEqual(projectNodeSizeForType("any"), { width: 56, height: 56 });
  assert.ok(app.includes('type: "any"'), "New projects should include an any card.");
  assert.ok(app.includes('node.type === "any"'), "Canvas cards should render any nodes explicitly.");
  assert.ok(app.includes("<Asterisk size={20}"), "Any cards should use an icon-only wildcard symbol.");
  assert.ok(app.includes('node.type === "play" || node.type === "any"'), "Any cards should be protected from deletion.");
  assert.ok(app.includes('source.type === "any" && target.type === "expression"'), "Any cards should connect only to expression cards.");
  assert.ok(app.includes('source.type === "expression" && target.type === "any"'), "Dragging from an expression to Any should create an Any evaluation edge.");
  assert.equal(app.includes("function PaletteAnyButton"), false, "Any cards should not be palette-created.");
  assert.ok(anyBlock, "any card CSS block should exist.");
  assert.match(anyBlock, /--node-accent:\s*#dc2626/);
  assert.match(anyBlock, /width:\s*56px/);
  assert.match(anyBlock, /height:\s*56px/);
  assert.match(anyBlock, /min-height:\s*56px/);
});
