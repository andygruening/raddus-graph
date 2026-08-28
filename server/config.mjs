import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const host = "127.0.0.1";
export const defaultPort = Number.parseInt(process.env.PORT ?? "5174", 10);
export const sessionCookieName = "canvas_local_session";
export const sessionMaxAgeSeconds = 12 * 60 * 60;
export const maxBodyBytes = 2 * 1024 * 1024;
export const localUserId = "local-anthropic-user";
export const localUserEmail = "Local Anthropic key";
export const localStoreNames = new Set(["projects", "mcpServers"]);
export const keychainService = "Raddus Canvas Anthropic API Key";
export const keychainAccount = localUserId;
export const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const distDir = resolve(appRoot, "dist");
export const localDataFile = resolveLocalDataFile();
export const bareAnthropicRoutes = new Set(["agents", "deployments", "environments", "messages", "sessions", "skills", "vaults"]);
export const bareLocalRoutes = new Set(["api-keys", "chat", "integrations", "mcp-servers", "package-presets", "projects", "tutorials", "users"]);

function resolveLocalDataFile() {
  if (process.env.RADDUS_CANVAS_DATA_FILE) return resolve(process.env.RADDUS_CANVAS_DATA_FILE);
  const currentPlatform = platform();
  if (currentPlatform === "darwin") return join(homedir(), "Library", "Application Support", "Raddus Canvas", "data.json");
  if (currentPlatform === "win32") return join(process.env.APPDATA ?? homedir(), "Raddus Canvas", "data.json");
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "raddus-canvas", "data.json");
}
