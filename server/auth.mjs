import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { platform } from "node:os";
import { createAnthropicClient } from "./anthropicClient.mjs";
import {
  keychainAccount,
  keychainService,
  localUserEmail,
  localUserId,
  sessionCookieName,
  sessionMaxAgeSeconds,
} from "./config.mjs";
import { HttpError } from "./errors.mjs";
import { sendJson } from "./httpUtils.mjs";
import {
  clearActiveLocalProfile,
  findLocalProfileByKeyFingerprint,
  readActiveLocalProfileId,
  setActiveLocalProfile,
  upsertLocalProfile,
} from "./localStore.mjs";

const sessions = new Map();
const memoryApiKeys = new Map();
let activeMemoryProfileId = null;

export async function handleLogin(req, res) {
  const apiKey = parseApiKey(req);
  const client = createAnthropicClient(apiKey);
  await client.models.list({ limit: 1 });
  const profile = await profileForApiKey(apiKey);
  await writeStoredApiKey(profile.id, apiKey);
  await setActiveLocalProfile(profile.id);
  const session = createServerSession(apiKey, profile);
  setSessionCookie(res, session.id, sessionMaxAgeSeconds);
  sendJson(res, 200, authPayload(session));
}

export async function handleLogout(req, res) {
  const sessionId = readSessionId(req);
  const session = sessionId ? sessions.get(sessionId) : null;
  if (sessionId) sessions.delete(sessionId);
  const profileId = session?.profileId ?? await readActiveLocalProfileId();
  await clearStoredApiKey(profileId);
  await clearLegacyStoredApiKey();
  await clearActiveLocalProfile(profileId);
  setSessionCookie(res, "", 0);
  sendJson(res, 200, { ok: true });
}

export async function ensureSession(req, res) {
  const existing = getExistingSession(req);
  if (existing) return existing;

  const stored = await readStoredProfileApiKey();
  if (!stored) throw new HttpError(401, "Sign in with your Anthropic API key.");

  const session = createServerSession(stored.apiKey, stored.profile);
  setSessionCookie(res, session.id, sessionMaxAgeSeconds);
  return session;
}

export function authPayload(session = null) {
  return {
    token: "local-proxy-session",
    uuid: localUserId,
    email: localUserEmail,
    role: "admin",
    profile_id: session?.profileId ?? null,
    profile_label: session?.profileLabel ?? null,
  };
}

export async function profileForApiKey(apiKey) {
  return upsertLocalProfile(await localProfileForApiKey(apiKey));
}

export async function readMigrationProfileForStoredApiKey() {
  const activeProfileId = await readActiveLocalProfileId();
  const activeApiKey = activeProfileId ? await readStoredApiKey(activeProfileId) : null;
  const apiKey = activeApiKey ?? await readLegacyStoredApiKey();
  return apiKey ? localProfileForApiKey(apiKey) : null;
}

export async function migrateStoredApiKeyToActiveProfile() {
  const stored = await readStoredProfileApiKey();
  return stored?.profile ?? null;
}

async function localProfileForApiKey(apiKey) {
  const keyFingerprint = apiKeyFingerprint(apiKey);
  const existing = await findLocalProfileByKeyFingerprint(keyFingerprint);
  const now = new Date().toISOString();
  return {
    id: existing?.id ?? profileIdFromKeyFingerprint(keyFingerprint),
    provider: "anthropic",
    label: existing?.label ?? `Anthropic API key ${keyFingerprint.slice(-8)}`,
    keyFingerprint,
    createdAt: existing?.createdAt ?? now,
    lastUsedAt: now,
  };
}

export function pruneExpiredSessions() {
  const cutoff = Date.now() - sessionMaxAgeSeconds * 1000;
  for (const [sessionId, session] of sessions.entries()) {
    if (session.lastSeenAt < cutoff) sessions.delete(sessionId);
  }
}

function parseApiKey(req) {
  const authHeader = String(req.headers.authorization ?? "");
  const apiKey = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  if (!apiKey) throw new HttpError(401, "Missing Anthropic API key.");
  if (apiKey.includes("Web browsers: disabled by default") || apiKey.includes("dangerouslyAllowBrowser")) {
    throw new HttpError(400, "That value is the SDK browser warning, not an Anthropic API key. Paste an API key from the Anthropic Console.");
  }
  return apiKey;
}

function createServerSession(apiKey, profile) {
  const sessionId = randomBytes(32).toString("base64url");
  const now = Date.now();
  const session = {
    id: sessionId,
    apiKey,
    profileId: profile.id,
    profileLabel: profile.label,
    createdAt: now,
    lastSeenAt: now,
  };
  sessions.set(sessionId, session);
  return session;
}

function getExistingSession(req) {
  const sessionId = readSessionId(req);
  const session = sessionId ? sessions.get(sessionId) : null;
  if (!session || Date.now() - session.lastSeenAt > sessionMaxAgeSeconds * 1000) {
    if (sessionId) sessions.delete(sessionId);
    return null;
  }
  session.lastSeenAt = Date.now();
  return session;
}

function readSessionId(req) {
  const cookie = String(req.headers.cookie ?? "");
  const match = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${sessionCookieName}=`));
  return match ? decodeURIComponent(match.slice(sessionCookieName.length + 1)) : null;
}

function setSessionCookie(res, sessionId, maxAge) {
  const value = sessionId ? encodeURIComponent(sessionId) : "";
  res.setHeader("set-cookie", `${sessionCookieName}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`);
}

async function readStoredProfileApiKey() {
  const activeProfileId = await readActiveLocalProfileId();
  if (activeProfileId) {
    const activeApiKey = await readStoredApiKey(activeProfileId);
    if (activeApiKey) {
      const profile = await profileForApiKey(activeApiKey);
      if (profile.id !== activeProfileId) {
        await writeStoredApiKey(profile.id, activeApiKey);
        await clearStoredApiKey(activeProfileId);
      }
      await setActiveLocalProfile(profile.id);
      return { apiKey: activeApiKey, profile };
    }
  }

  const legacyApiKey = await readLegacyStoredApiKey();
  if (!legacyApiKey) return null;
  const profile = await profileForApiKey(legacyApiKey);
  await writeStoredApiKey(profile.id, legacyApiKey);
  await clearLegacyStoredApiKey();
  await setActiveLocalProfile(profile.id);
  return { apiKey: legacyApiKey, profile };
}

async function readStoredApiKey(profileId) {
  if (!profileId) return null;
  if (platform() !== "darwin") return memoryApiKeys.get(profileId) ?? null;
  const result = await runSecurity(["find-generic-password", "-a", keychainAccountForProfile(profileId), "-s", keychainService, "-w"], { allowMissing: true });
  return result ? result.trim() || null : null;
}

async function writeStoredApiKey(profileId, apiKey) {
  if (platform() !== "darwin") {
    memoryApiKeys.set(profileId, apiKey);
    activeMemoryProfileId = profileId;
    return;
  }
  await runSecurity(["add-generic-password", "-a", keychainAccountForProfile(profileId), "-s", keychainService, "-U", "-w", apiKey]);
}

async function clearStoredApiKey(profileId) {
  if (!profileId) return;
  if (platform() !== "darwin") {
    memoryApiKeys.delete(profileId);
    if (activeMemoryProfileId === profileId) activeMemoryProfileId = null;
    return;
  }
  await runSecurity(["delete-generic-password", "-a", keychainAccountForProfile(profileId), "-s", keychainService], { allowMissing: true });
}

async function readLegacyStoredApiKey() {
  if (platform() !== "darwin") {
    return activeMemoryProfileId ? memoryApiKeys.get(activeMemoryProfileId) ?? null : null;
  }
  const result = await runSecurity(["find-generic-password", "-a", keychainAccount, "-s", keychainService, "-w"], { allowMissing: true });
  return result ? result.trim() || null : null;
}

async function clearLegacyStoredApiKey() {
  if (platform() !== "darwin") return;
  await runSecurity(["delete-generic-password", "-a", keychainAccount, "-s", keychainService], { allowMissing: true });
}

function apiKeyFingerprint(apiKey) {
  return createHash("sha256")
    .update("raddus-canvas:anthropic-api-key:v1\0")
    .update(apiKey.trim())
    .digest("hex");
}

function profileIdFromKeyFingerprint(keyFingerprint) {
  return `anthropic-${keyFingerprint.slice(0, 32)}`;
}

function keychainAccountForProfile(profileId) {
  return `anthropic:${profileId}`;
}

function runSecurity(args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn("security", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.stdin.on("error", () => undefined);
    child.on("error", (error) => {
      rejectRun(new HttpError(500, `macOS Keychain operation failed: ${String(error.message).trim()}`));
    });
    child.on("close", (code) => {
      const message = `${stdout}${stderr}`;
      if (code !== 0) {
        if (options.allowMissing && /could not be found|The specified item could not be found|SecKeychainSearchCopyNext/.test(message)) {
          resolveRun("");
          return;
        }
        rejectRun(new HttpError(500, `macOS Keychain operation failed: ${String(stderr || `security exited with code ${code}`).trim()}`));
        return;
      }
      resolveRun(stdout);
    });

    child.stdin.end(typeof options.stdin === "string" ? options.stdin : "");
  });
}
