export async function onRequest({ env, params }) {
  const pathParts = Array.isArray(params?.path)
    ? params.path
    : typeof params?.path === "string"
      ? [params.path]
      : [];
  const fileId = pathParts.join("/");

  if (!fileId) {
    return new Response("Not found", { status: 404 });
  }

  const object = await env.GALLERY_BUCKET.get(fileId);
  if (!object?.body) {
    return new Response("Not found", { status: 404 });
  }

  const headers = new Headers();
  if (typeof object.writeHttpMetadata === "function") {
    object.writeHttpMetadata(headers);
  } else if (object.httpMetadata?.contentType) {
    headers.set("content-type", object.httpMetadata.contentType);
  }

  return new Response(object.body, { headers });
}
