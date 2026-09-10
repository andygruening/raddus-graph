import test from "node:test";
import assert from "node:assert/strict";
import { workspaceOpenCommand } from "../server/openWorkspaceDirectory.mjs";

test("workspace directory opener chooses the native file manager by platform", () => {
  assert.deepEqual(workspaceOpenCommand("/tmp/raddus-workspace", "darwin"), {
    command: "open",
    args: ["/tmp/raddus-workspace"],
  });
  assert.deepEqual(workspaceOpenCommand("C:\\Users\\me\\raddus-workspace", "win32"), {
    command: "explorer.exe",
    args: ["C:\\Users\\me\\raddus-workspace"],
  });
  assert.deepEqual(workspaceOpenCommand("/tmp/raddus-workspace", "linux"), {
    command: "xdg-open",
    args: ["/tmp/raddus-workspace"],
  });
});
