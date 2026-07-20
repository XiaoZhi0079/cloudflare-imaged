export const ADMIN_KEY_STORAGE_KEY = "gallery-admin-key";

export function createAdminKeyStore(storage = globalThis.localStorage) {
  if (!storage) {
    throw new TypeError("A Storage implementation is required");
  }

  return {
    get() {
      return String(storage.getItem(ADMIN_KEY_STORAGE_KEY) ?? "").trim();
    },
    set(value) {
      const key = String(value ?? "").trim();
      if (key) {
        storage.setItem(ADMIN_KEY_STORAGE_KEY, key);
      } else {
        storage.removeItem(ADMIN_KEY_STORAGE_KEY);
      }
      return key;
    },
    clear() {
      storage.removeItem(ADMIN_KEY_STORAGE_KEY);
    },
  };
}

export async function verifyAdminKey(client) {
  const payload = await client.request("/api/admin/tags", { method: "GET" });
  return Array.isArray(payload.tags) ? payload.tags : [];
}

export async function fetchAdminTaxonomy(client) {
  const payload = await client.request("/api/admin/tags", { method: "GET" });
  return {
    tags: Array.isArray(payload?.tags) ? payload.tags : [],
    tagGroups: Array.isArray(payload?.tagGroups) ? payload.tagGroups : [],
  };
}
