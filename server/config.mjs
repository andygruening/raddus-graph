import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const host = "127.0.0.1";
export const defaultPort = Number.parseInt(process.env.PORT ?? "5174", 10);
export const maxBodyBytes = 2 * 1024 * 1024;
export const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const distDir = resolve(appRoot, "dist");
export const graphDataDir = resolveGraphDataDir();
export const removedProviderRoutes = new Set(["agents", "deployments", "environments", "messages", "sessions", "skills", "vaults"]);
export const removedCanvasRoutes = new Set(["api-keys", "chat", "integrations", "mcp-servers", "package-presets", "projects", "tutorials", "users"]);

function resolveGraphDataDir() {
  if (process.env.RADDUS_GRAPH_DIR) return resolve(process.env.RADDUS_GRAPH_DIR);
  return resolve(homedir(), ".raddus-graph");
}
