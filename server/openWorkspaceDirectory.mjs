import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { platform as currentPlatform } from "node:os";
import { HttpError } from "./errors.mjs";

export async function openWorkspaceDirectory(workspacePath) {
  const path = typeof workspacePath === "string" ? workspacePath.trim() : "";
  if (!path) throw new HttpError(400, "Workspace path is missing.");

  const details = await stat(path).catch((error) => {
    if (error?.code === "ENOENT") throw new HttpError(404, "Workspace directory was not found.");
    throw error;
  });
  if (!details.isDirectory()) throw new HttpError(400, "Workspace path is not a directory.");

  const command = workspaceOpenCommand(path);
  await spawnWorkspaceOpenCommand(command);
  return { workspacePath: path };
}

export function workspaceOpenCommand(workspacePath, targetPlatform = currentPlatform()) {
  if (targetPlatform === "darwin") {
    return { command: "open", args: [workspacePath] };
  }

  if (targetPlatform === "win32") {
    return { command: "explorer.exe", args: [workspacePath] };
  }

  return { command: "xdg-open", args: [workspacePath] };
}

function spawnWorkspaceOpenCommand(command) {
  return new Promise((resolveOpen, rejectOpen) => {
    let settled = false;
    const child = spawn(command.command, command.args, {
      detached: true,
      stdio: "ignore",
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      rejectOpen(new HttpError(500, `Could not open workspace directory: ${error.message}`));
    });

    child.on("spawn", () => {
      if (settled) return;
      settled = true;
      child.unref();
      resolveOpen();
    });
  });
}
