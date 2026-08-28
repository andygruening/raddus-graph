import { spawn } from "node:child_process";
import { platform } from "node:os";

export function openExternalBrowser(url) {
  const command = browserOpenCommand(url);
  let reportedFailure = false;
  const child = spawn(command.command, command.args, {
    detached: true,
    stdio: "ignore",
  });

  child.on("error", (error) => {
    reportOpenFailure(url, error.message);
    reportedFailure = true;
  });

  child.on("exit", (code) => {
    if (reportedFailure || code === 0 || code === null) return;
    reportOpenFailure(url, `${command.command} exited with code ${code}`);
  });

  child.unref();
}

function reportOpenFailure(url, reason) {
  console.warn(`Could not open the browser automatically: ${reason}`);
  console.log(`Open ${url} in your browser.`);
}

function browserOpenCommand(url) {
  if (platform() === "darwin") {
    return { command: "open", args: [url] };
  }

  if (platform() === "win32") {
    return { command: "cmd", args: ["/c", "start", "", url] };
  }

  return { command: "xdg-open", args: [url] };
}
