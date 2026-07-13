export class AdminApiError extends Error {
  constructor(message, status = 0, payload = null) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
    this.payload = payload;
  }
}

export class AdminUnauthorizedError extends AdminApiError {
  constructor(message = "Unauthorized", payload = null) {
    super(message, 401, payload);
    this.name = "AdminUnauthorizedError";
  }
}

function parseResponseText(text) {
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

export function createAdminApiClient({
  fetchImpl = globalThis.fetch,
  getKey,
  onUnauthorized = () => {},
} = {}) {
  if (typeof fetchImpl !== "function" || typeof getKey !== "function") {
    throw new TypeError("fetchImpl and getKey are required");
  }

  return {
    async request(url, { timeoutMs = 15000, ...init } = {}) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const headers = new Headers(init.headers ?? {});
        headers.set("x-gallery-admin-key", getKey());
        if (typeof init.body === "string" && !headers.has("content-type")) {
          headers.set("content-type", "application/json");
        }

        const response = await fetchImpl(url, {
          ...init,
          headers,
          signal: controller.signal,
        });
        const payload = parseResponseText(await response.text());

        if (response.status === 401) {
          onUnauthorized();
          throw new AdminUnauthorizedError(payload.error ?? "Unauthorized", payload);
        }

        if (!response.ok) {
          throw new AdminApiError(payload.error ?? `请求失败：${response.status}`, response.status, payload);
        }

        return payload;
      } catch (error) {
        if (error?.name === "AbortError") {
          throw new AdminApiError("请求超时，请稍后重试。", 0);
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
