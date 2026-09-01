import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { projectNodeSizeForType } from "../src/edgeRouting.ts";

test("expression canvas cards render as smaller capsules", async () => {
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  const expressionBlock = css.match(/\.project-node\.expression\s*\{(?<body>[\s\S]*?)\n\}/)?.groups?.body ?? "";
  const agentSize = projectNodeSizeForType("agent");
  const expressionSize = projectNodeSizeForType("expression");

  assert.ok(expressionBlock, "expression card CSS block should exist");
  assert.deepEqual(expressionSize, { width: 140, height: 44 });
  assert.ok(expressionSize.width < agentSize.width, "expression cards should be narrower than agent cards");
  assert.ok(expressionSize.height < agentSize.height, "expression cards should be shorter than agent cards");
  assert.match(expressionBlock, /border-radius:\s*999px/);
  assert.match(expressionBlock, /width:\s*140px/);
  assert.match(expressionBlock, /height:\s*44px/);
  assert.match(expressionBlock, /min-height:\s*44px/);
});
