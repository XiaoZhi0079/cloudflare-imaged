const FILE_CACHE_CONTROL = "public, max-age=3600, must-revalidate";
const NOT_FOUND_CACHE_CONTROL = "no-store, max-age=0";

function notFoundResponse() {
  return new Response("Not found", {
    status: 404,
    headers: { "cache-control": NOT_FOUND_CACHE_CONTROL },
  });
}

function downloadFileName(fileId) {
  const original = fileId.split("/").at(-1) || "image";
  const fallback = original
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "_")
    .slice(0, 180) || "image";
  const encoded = encodeURIComponent(original).replace(/['()*]/g, (character) => (
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  ));
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export async function onRequest({ env, params, request }) {
  const pathParts = Array.isArray(params?.path)
    ? params.path
    : typeof params?.path === "string"
      ? [params.path]
      : [];
  const fileId = pathParts.join("/");

  if (!fileId) {
    return notFoundResponse();
  }

  const object = await env.GALLERY_BUCKET.get(fileId);
  if (!object?.body) {
    return notFoundResponse();
  }

  const headers = new Headers();
  if (typeof object.writeHttpMetadata === "function") {
    object.writeHttpMetadata(headers);
  } else if (object.httpMetadata?.contentType) {
    headers.set("content-type", object.httpMetadata.contentType);
  }

  headers.set("cache-control", FILE_CACHE_CONTROL);
  const forceDownload = request ? new URL(request.url).searchParams.get("download") === "1" : false;
  if (forceDownload) {
    headers.set("content-disposition", downloadFileName(fileId));
  }
  if (object.httpEtag) {
    headers.set("etag", object.httpEtag);
    const etags = (request?.headers.get("if-none-match") ?? "")
      .split(",")
      .map((value) => value.trim());
    if (etags.includes("*") || etags.includes(object.httpEtag)) {
      return new Response(null, { status: 304, headers });
    }
  }

  return new Response(object.body, { headers });
}
