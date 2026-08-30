import test from "node:test";
import assert from "node:assert/strict";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("graph data defaults to the user home directory", async () => {
  const previous = process.env.RADDUS_GRAPH_DIR;
  delete process.env.RADDUS_GRAPH_DIR;
  try {
    const config = await import(`../server/config.mjs?config-test-default=${Date.now()}`);
    assert.equal(config.graphDataDir, resolve(homedir(), ".raddus-graph"));
  } finally {
    if (previous === undefined) {
      delete process.env.RADDUS_GRAPH_DIR;
    } else {
      process.env.RADDUS_GRAPH_DIR = previous;
    }
  }
});

test("graph data directory can still be overridden", async () => {
  const previous = process.env.RADDUS_GRAPH_DIR;
  const dataDir = join(tmpdir(), "raddus-graph-config-test");
  process.env.RADDUS_GRAPH_DIR = dataDir;
  try {
    const config = await import(`../server/config.mjs?config-test-override=${Date.now()}`);
    assert.equal(config.graphDataDir, resolve(dataDir));
  } finally {
    if (previous === undefined) {
      delete process.env.RADDUS_GRAPH_DIR;
    } else {
      process.env.RADDUS_GRAPH_DIR = previous;
    }
  }
});
