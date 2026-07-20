export const DEFAULT_PUBLIC_SITE = Object.freeze({
  issueName: "图集",
  heroCopy: "",
  issueCount: 0,
  featuredImages: [],
});

export async function fetchPublicJson(url, init, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(url, init);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload?.error ?? `Request failed: ${response.status}`);
  }

  return payload;
}

export async function loadPublicBootstrapData(fetchImpl = globalThis.fetch) {
  const sitePromise = fetchPublicJson("/api/public/site", undefined, fetchImpl)
    .catch(() => ({ ...DEFAULT_PUBLIC_SITE, featuredImages: [] }));
  const tagsPromise = fetchPublicJson("/api/public/tags", undefined, fetchImpl);
  const albumsPromise = fetchPublicJson("/api/public/albums", undefined, fetchImpl)
    .catch(() => ({ albums: [] }));
  const [site, tagsPayload, albumsPayload] = await Promise.all([sitePromise, tagsPromise, albumsPromise]);

  return {
    site,
    tags: Array.isArray(tagsPayload?.tags) ? tagsPayload.tags : [],
    tagGroups: Array.isArray(tagsPayload?.tagGroups) ? tagsPayload.tagGroups : [],
    albums: Array.isArray(albumsPayload?.albums) ? albumsPayload.albums : [],
  };
}
