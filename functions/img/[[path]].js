import { IMAGE_VARIANT_WIDTHS } from "../../src/shared/image-variants.js";

const VARIANT_CACHE_CONTROL = "public, max-age=86400, stale-while-revalidate=604800";

function pathPartsFrom(params) {
  if (Array.isArray(params?.path)) return params.path;
  if (typeof params?.path === "string") return params.path.split("/");
  return [];
}

function isSafePathPart(value) {
  const part = String(value ?? "");
  return Boolean(part) && part !== "." && part !== ".." && !part.includes("/") && !part.includes("\\");
}

function negotiatedFormat(accept) {
  if (/image\/avif/i.test(accept)) return "avif";
  if (/image\/webp/i.test(accept)) return "webp";
  return null;
}

function fallbackResponse(sourceUrl) {
  return new Response(null, {
    status: 307,
    headers: {
      location: sourceUrl,
      "cache-control": "no-store",
    },
  });
}

function transformedResponse(response) {
  const headers = new Headers(response.headers);
  headers.set("cache-control", VARIANT_CACHE_CONTROL);
  const vary = headers.get("vary");
  if (!vary) headers.set("vary", "Accept");
  else if (!vary.split(",").some((value) => value.trim().toLowerCase() === "accept")) {
    headers.set("vary", `${vary}, Accept`);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function createImageTransformHandler({ fetchImpl = globalThis.fetch } = {}) {
  return async function handleImageTransform({ request, params }) {
    const url = new URL(request.url);
    const width = Number(url.searchParams.get("w"));
    const pathParts = pathPartsFrom(params);
    if (!IMAGE_VARIANT_WIDTHS.includes(width) || !pathParts.length || !pathParts.every(isSafePathPart)) {
      return new Response("Invalid image variant", { status: 400 });
    }

    const sourcePath = pathParts.map((part) => encodeURIComponent(part)).join("/");
    const sourceUrl = new URL(`/file/${sourcePath}`, url.origin).href;
    const imageOptions = {
      fit: "scale-down",
      width,
      quality: 82,
    };
    const format = negotiatedFormat(request.headers.get("accept") ?? "");
    if (format) imageOptions.format = format;

    try {
      const response = await fetchImpl(sourceUrl, { cf: { image: imageOptions } });
      if (response.ok || response.redirected || response.status === 304) {
        return transformedResponse(response);
      }
    } catch {
      return fallbackResponse(sourceUrl);
    }
    return fallbackResponse(sourceUrl);
  };
}

const handleImageTransform = createImageTransformHandler();

export async function onRequest(context) {
  return handleImageTransform(context);
}
