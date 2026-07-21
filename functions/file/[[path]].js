const FILE_CACHE_CONTROL = "public, max-age=3600, must-revalidate";
const NOT_FOUND_CACHE_CONTROL = "no-store, max-age=0";

function notFoundResponse() {
  return new Response("Not found", {
    status: 404,
    headers: { "cache-control": NOT_FOUND_CACHE_CONTROL },
  });
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
