import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { localDataFile, localStoreNames } from "./config.mjs";
import { HttpError } from "./errors.mjs";
import { asPayload, readJsonBody, sendJson } from "./httpUtils.mjs";

let localDataWriteQueue = Promise.resolve();

export async function handleLocalStore(req, res, url, session) {
  const profileId = session?.profileId;
  if (!profileId) throw new HttpError(401, "Sign in with your Anthropic API key.");

  const segments = url.pathname.slice("/api/local-store/".length).split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
  const [resource, id] = segments;

  if (resource === "import" && req.method === "POST" && segments.length === 1) {
    const body = asPayload(await readJsonBody(req));
    const store = await updateLocalProfileStore(profileId, (current) => mergeImportedLocalStore(current, body));
    sendJson(res, 200, localStorePayload(store));
    return;
  }

  if (resource === "settings") {
    if (req.method === "GET" && segments.length === 1) {
      sendJson(res, 200, { settings: (await readLocalProfileStore(profileId)).settings });
      return;
    }
    if (req.method === "PATCH" && segments.length === 1) {
      const body = asPayload(await readJsonBody(req));
      const store = await updateLocalProfileStore(profileId, (current) => ({ ...current, settings: { ...current.settings, ...body } }));
      sendJson(res, 200, { settings: store.settings });
      return;
    }
  }

  if (localStoreNames.has(resource)) {
    if (req.method === "GET" && segments.length === 1) {
      sendJson(res, 200, { records: (await readLocalProfileStore(profileId))[resource] });
      return;
    }
    if (req.method === "PUT" && id && segments.length === 2) {
      const body = asPayload(await readJsonBody(req));
      const record = { ...body, id };
      const store = await updateLocalProfileStore(profileId, (current) => ({
        ...current,
        [resource]: upsertLocalRecord(current[resource], record),
      }));
      sendJson(res, 200, { record: store[resource].find((item) => item.id === id) ?? record });
      return;
    }
    if (req.method === "DELETE" && id && segments.length === 2) {
      const store = await updateLocalProfileStore(profileId, (current) => ({
        ...current,
        [resource]: current[resource].filter((record) => record.id !== id),
      }));
      sendJson(res, 200, { ok: true, records: store[resource] });
      return;
    }
  }

  throw new HttpError(404, `Unknown local store endpoint: ${req.method} /${segments.join("/")}`);
}

export async function findLocalProfileByKeyFingerprint(keyFingerprint) {
  if (!keyFingerprint) return null;
  const data = await readLocalData();
  return data.profiles.find((profile) => profile.keyFingerprint === keyFingerprint) ?? null;
}

export async function upsertLocalProfile(profile) {
  const normalizedProfile = normalizeProfile(profile);
  if (!normalizedProfile) throw new Error("Local profile needs a stable id and key fingerprint.");

  const data = await updateLocalData((current) => {
    const index = current.profiles.findIndex((item) => item.id === normalizedProfile.id);
    const profiles = index < 0
      ? [...current.profiles, normalizedProfile]
      : current.profiles.map((item, itemIndex) => (itemIndex === index ? { ...item, ...normalizedProfile } : item));
    return {
      ...current,
      profiles,
    };
  });

  return data.profiles.find((item) => item.id === normalizedProfile.id) ?? normalizedProfile;
}

export async function readActiveLocalProfileId() {
  return (await readLocalData()).activeProfileId;
}

export async function setActiveLocalProfile(profileId) {
  await updateLocalData((current) => ({
    ...current,
    activeProfileId: profileId || null,
  }));
}

export async function clearActiveLocalProfile(profileId) {
  await updateLocalData((current) => ({
    ...current,
    activeProfileId: !profileId || current.activeProfileId === profileId ? null : current.activeProfileId,
  }));
}

export async function backupAndMigrateLocalDataFile(profile = null) {
  const text = await readFile(localDataFile, "utf8");
  const parsed = JSON.parse(text);
  const current = normalizeLocalData(parsed);
  const next = profile ? claimProfileStore(upsertProfileInData(current, profile), profile.id) : current;
  const backupFile = `${localDataFile}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  await mkdir(dirname(localDataFile), { recursive: true });
  await copyFile(localDataFile, backupFile);
  await writeLocalData(next);
  return { dataFile: localDataFile, backupFile, profileId: profile?.id ?? null };
}

export async function migrateLocalDataFileFromBackup(backupFile, profile = null) {
  const text = await readFile(backupFile, "utf8");
  const parsed = JSON.parse(text);
  const current = normalizeLocalData(parsed);
  const next = profile ? claimProfileStore(upsertProfileInData(current, profile), profile.id) : current;
  await writeLocalData(next);
  return { dataFile: localDataFile, backupFile, profileId: profile?.id ?? null };
}

async function readLocalData() {
  try {
    const text = await readFile(localDataFile, "utf8");
    return normalizeLocalData(JSON.parse(text));
  } catch (error) {
    if (error?.code === "ENOENT") return defaultLocalData();
    throw error;
  }
}

async function updateLocalData(update) {
  const run = localDataWriteQueue.then(async () => {
    const current = await readLocalData();
    const next = normalizeLocalData(await update(current));
    await writeLocalData(next);
    return next;
  });
  localDataWriteQueue = run.catch(() => undefined);
  return run;
}

async function readLocalProfileStore(profileId) {
  const data = await updateLocalData((current) => claimProfileStore(current, profileId));
  return data.stores[profileId] ?? defaultProfileStore();
}

async function updateLocalProfileStore(profileId, update) {
  const data = await updateLocalData(async (current) => {
    const currentWithStore = claimProfileStore(current, profileId);
    const currentStore = currentWithStore.stores[profileId] ?? defaultProfileStore();
    const nextStore = normalizeProfileStore(await update(currentStore));
    return {
      ...currentWithStore,
      stores: {
        ...currentWithStore.stores,
        [profileId]: nextStore,
      },
    };
  });
  return data.stores[profileId] ?? defaultProfileStore();
}

async function writeLocalData(data) {
  await mkdir(dirname(localDataFile), { recursive: true });
  const tempFile = `${localDataFile}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempFile, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  await rename(tempFile, localDataFile);
}

function defaultLocalData() {
  return {
    version: 2,
    activeProfileId: null,
    profiles: [],
    stores: {},
    pendingLegacyStore: null,
  };
}

function normalizeLocalData(value) {
  const record = value && typeof value === "object" ? value : {};
  if (record.version === 2 || Array.isArray(record.profiles) || isRecord(record.stores)) {
    const profiles = normalizeProfiles(record.profiles);
    const profileIds = new Set(profiles.map((profile) => profile.id));
    const stores = normalizeProfileStores(record.stores);
    const activeProfileId = typeof record.activeProfileId === "string" && profileIds.has(record.activeProfileId) ? record.activeProfileId : null;
    return {
      version: 2,
      activeProfileId,
      profiles,
      stores,
      pendingLegacyStore: record.pendingLegacyStore ? normalizeProfileStore(record.pendingLegacyStore) : null,
    };
  }

  const pendingLegacyStore = normalizeProfileStore(record);
  return {
    ...defaultLocalData(),
    pendingLegacyStore: profileStoreHasData(pendingLegacyStore) ? pendingLegacyStore : null,
  };
}

function normalizeProfiles(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((profile) => {
    const normalizedProfile = normalizeProfile(profile);
    return normalizedProfile ? [normalizedProfile] : [];
  });
}

function normalizeProfile(value) {
  if (!isRecord(value)) return null;
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const keyFingerprint = typeof value.keyFingerprint === "string" ? value.keyFingerprint.trim() : "";
  if (!id || !keyFingerprint) return null;
  const now = new Date().toISOString();
  return {
    id,
    provider: typeof value.provider === "string" && value.provider.trim() ? value.provider.trim() : "anthropic",
    label: typeof value.label === "string" && value.label.trim() ? value.label.trim() : "Anthropic API key",
    keyFingerprint,
    createdAt: typeof value.createdAt === "string" && value.createdAt ? value.createdAt : now,
    lastUsedAt: typeof value.lastUsedAt === "string" && value.lastUsedAt ? value.lastUsedAt : now,
  };
}

function normalizeProfileStores(value) {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([profileId]) => typeof profileId === "string" && profileId.trim())
      .map(([profileId, store]) => [profileId, normalizeProfileStore(store)]),
  );
}

function defaultProfileStore() {
  return {
    projects: [],
    mcpServers: [],
    settings: {},
  };
}

function normalizeProfileStore(value) {
  const record = isRecord(value) ? value : {};
  return {
    projects: Array.isArray(record.projects) ? record.projects.filter(isLocalRecord) : [],
    mcpServers: Array.isArray(record.mcpServers) ? record.mcpServers.filter(isLocalRecord) : [],
    settings: isRecord(record.settings) ? record.settings : {},
  };
}

function profileStoreHasData(store) {
  return store.projects.length > 0 || store.mcpServers.length > 0 || Object.keys(store.settings).length > 0;
}

function claimProfileStore(data, profileId) {
  if (!profileId || data.stores[profileId]) return data;
  return {
    ...data,
    stores: {
      ...data.stores,
      [profileId]: data.pendingLegacyStore ?? defaultProfileStore(),
    },
    pendingLegacyStore: null,
  };
}

function upsertProfileInData(data, profile) {
  const normalizedProfile = normalizeProfile(profile);
  if (!normalizedProfile) return data;
  const index = data.profiles.findIndex((item) => item.id === normalizedProfile.id);
  return {
    ...data,
    activeProfileId: normalizedProfile.id,
    profiles: index < 0
      ? [...data.profiles, normalizedProfile]
      : data.profiles.map((item, itemIndex) => (itemIndex === index ? { ...item, ...normalizedProfile } : item)),
  };
}

function mergeImportedLocalStore(current, body) {
  const imported = normalizeProfileStore(body);
  return {
    ...current,
    projects: mergeLocalRecords(current.projects, imported.projects),
    mcpServers: mergeLocalRecords(current.mcpServers, imported.mcpServers),
    settings: { ...imported.settings, ...current.settings },
  };
}

function localStorePayload(store) {
  return {
    projects: store.projects,
    mcpServers: store.mcpServers,
    settings: store.settings,
  };
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isLocalRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && typeof value.id === "string" && value.id.trim());
}

function upsertLocalRecord(records, record) {
  const nextRecord = { ...record, id: String(record.id) };
  const index = records.findIndex((item) => item.id === nextRecord.id);
  if (index < 0) return [...records, nextRecord];
  return records.map((item, itemIndex) => (itemIndex === index ? nextRecord : item));
}

function mergeLocalRecords(current, imported) {
  let next = [...current];
  for (const record of imported) {
    if (!next.some((item) => item.id === record.id)) next = [...next, record];
  }
  return next;
}
