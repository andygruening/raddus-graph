import { startServer } from "./index.mjs";
import { openExternalBrowser } from "./openExternalBrowser.mjs";

export async function runCli(args = process.argv.slice(2), env = process.env) {
  const result = await startServer({ isDev: args.includes("--dev") });

  if (shouldAutoOpenBrowser(args, env)) {
    openExternalBrowser(result.url);
  }

  return result;
}

export function shouldAutoOpenBrowser(args, env = process.env) {
  if (args.includes("--no-open")) return false;
  if (env.CI) return false;
  return true;
}
