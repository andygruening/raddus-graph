const dbName = "raddus-canvas-secure-storage";
const legacyDbName = "canvas-local-secure-storage";
const dbVersion = 1;
const storeName = "secure-items";
const cryptoKeyId = "anthropic-api-key-aes-key";
const encryptedKeyId = "anthropic-api-key";

interface EncryptedSecret {
  version: 1;
  iv: string;
  ciphertext: string;
}

export async function readStoredAnthropicApiKey(): Promise<string | null> {
  const db = await openDb();
  const encrypted = await idbGet<EncryptedSecret>(db, encryptedKeyId);
  if (!encrypted) return migrateLegacyStoredAnthropicApiKey();

  try {
    const key = await getOrCreateCryptoKey(db);
    const iv = base64ToBytes(encrypted.iv);
    const ciphertext = base64ToBytes(encrypted.ciphertext);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as unknown as BufferSource },
      key,
      ciphertext as unknown as BufferSource,
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    await clearStoredAnthropicApiKey();
    return null;
  }
}

export async function writeStoredAnthropicApiKey(apiKey: string): Promise<void> {
  const db = await openDb();
  const key = await getOrCreateCryptoKey(db);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as unknown as BufferSource }, key, new TextEncoder().encode(apiKey));
  await idbPut(db, encryptedKeyId, {
    version: 1,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  } satisfies EncryptedSecret);
}

export async function clearStoredAnthropicApiKey(): Promise<void> {
  const db = await openDb();
  const legacyDb = await openLegacyDbIfExists();
  await Promise.allSettled([clearStoredAnthropicApiKeyFromDb(db), ...(legacyDb ? [clearStoredAnthropicApiKeyFromDb(legacyDb)] : [])]);
  legacyDb?.close();
}

async function getOrCreateCryptoKey(db: IDBDatabase): Promise<CryptoKey> {
  const existing = await idbGet<CryptoKey>(db, cryptoKeyId);
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await idbPut(db, cryptoKeyId, key);
  return key;
}

function openDb(): Promise<IDBDatabase> {
  return openStorageDb(dbName, true);
}

function openStorageDb(name: string, upgrade: boolean): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = upgrade ? indexedDB.open(name, dbVersion) : indexedDB.open(name);
    request.onupgradeneeded = () => {
      if (upgrade && !request.result.objectStoreNames.contains(storeName)) {
        request.result.createObjectStore(storeName);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open secure storage."));
  });
}

async function migrateLegacyStoredAnthropicApiKey(): Promise<string | null> {
  const legacyDb = await openLegacyDbIfExists();
  if (!legacyDb) return null;
  try {
    const apiKey = await readStoredAnthropicApiKeyFromDb(legacyDb).catch(() => null);
    if (!apiKey) return null;
    await writeStoredAnthropicApiKey(apiKey);
    await Promise.allSettled([idbDelete(legacyDb, encryptedKeyId), idbDelete(legacyDb, cryptoKeyId)]);
    return apiKey;
  } finally {
    legacyDb.close();
  }
}

async function readStoredAnthropicApiKeyFromDb(db: IDBDatabase): Promise<string | null> {
  if (!db.objectStoreNames.contains(storeName)) return null;
  const encrypted = await idbGet<EncryptedSecret>(db, encryptedKeyId);
  if (!encrypted) return null;
  const key = await idbGet<CryptoKey>(db, cryptoKeyId);
  if (!key) return null;
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(encrypted.iv) as unknown as BufferSource },
    key,
    base64ToBytes(encrypted.ciphertext) as unknown as BufferSource,
  );
  return new TextDecoder().decode(plaintext);
}

async function clearStoredAnthropicApiKeyFromDb(db: IDBDatabase): Promise<void> {
  if (!db.objectStoreNames.contains(storeName)) return;
  await Promise.allSettled([idbDelete(db, encryptedKeyId), idbDelete(db, cryptoKeyId)]);
}

async function openLegacyDbIfExists(): Promise<IDBDatabase | null> {
  const databases = await listIndexedDbs();
  if (databases && !databases.some((database) => database.name === legacyDbName)) return null;
  return openStorageDb(legacyDbName, false);
}

async function listIndexedDbs(): Promise<Array<{ name?: string | null }> | null> {
  const indexedDbWithList = indexedDB as IDBFactory & { databases?: () => Promise<Array<{ name?: string | null }>> };
  return typeof indexedDbWithList.databases === "function" ? indexedDbWithList.databases() : null;
}

function idbGet<T>(db: IDBDatabase, key: string): Promise<T | undefined> {
  return withStore<T | undefined>(db, "readonly", (store) => store.get(key));
}

function idbPut(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return withStore<void>(db, "readwrite", (store) => store.put(value, key));
}

function idbDelete(db: IDBDatabase, key: string): Promise<void> {
  return withStore<void>(db, "readwrite", (store) => store.delete(key));
}

function withStore<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const request = run(transaction.objectStore(storeName));
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
