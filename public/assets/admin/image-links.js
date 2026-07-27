export function buildDirectImageUrl(fileUrl, baseUrl = globalThis.location?.href) {
  const value = String(fileUrl ?? "").trim();
  if (!value || !baseUrl) return "";
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return "";
  }
}

export function buildDownloadImageUrl(fileUrl, baseUrl = globalThis.location?.href) {
  const directUrl = buildDirectImageUrl(fileUrl, baseUrl);
  if (!directUrl) return "";
  const url = new URL(directUrl);
  url.searchParams.set("download", "1");
  return url.href;
}
