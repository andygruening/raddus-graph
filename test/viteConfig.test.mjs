import test from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "vite";

test("dev server ignores graph session storage changes", async () => {
  const config = await resolveConfig({
    appType: "spa",
    server: {
      hmr: { host: "127.0.0.1", protocol: "ws" },
      middlewareMode: true,
    },
  }, "serve", "development");
  const ignored = config.server.watch?.ignored ?? [];
  const patterns = Array.isArray(ignored) ? ignored : [ignored];

  assert.ok(
    patterns.some((pattern) => String(pattern).includes(".raddus-graph")),
    "Vite must ignore .raddus-graph so session create/delete does not reload the app.",
  );
});
