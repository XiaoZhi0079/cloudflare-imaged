export const IMAGE_VARIANT_WIDTHS = Object.freeze([
  320,
  480,
  640,
  768,
  960,
  1280,
  1600,
  1920,
  2560,
]);

export const IMAGE_VARIANT_PRESETS = Object.freeze({
  gallery: Object.freeze({
    widths: Object.freeze([320, 480, 640, 768, 960]),
    sizes: "(max-width: 480px) calc(100vw - 20px), (max-width: 720px) calc(50vw - 19px), (max-width: 980px) calc(33.333vw - 25.333px), 306px",
  }),
  cover: Object.freeze({
    widths: Object.freeze([480, 640, 768, 960, 1280]),
    sizes: "(max-width: 480px) calc(100vw - 20px), (max-width: 720px) calc(50vw - 16px), 415px",
  }),
  hero: Object.freeze({
    widths: Object.freeze([640, 960, 1280, 1600, 1920, 2560]),
    sizes: "(max-width: 720px) calc(100vw - 20px), 1280px",
  }),
  viewer: Object.freeze({
    widths: Object.freeze([640, 960, 1280, 1600, 1920, 2560]),
    sizes: "(max-width: 1391px) 92vw, 1280px",
  }),
});

export function buildImageVariantUrl(fileUrl, width) {
  const normalizedWidth = Number(width);
  if (!IMAGE_VARIANT_WIDTHS.includes(normalizedWidth)) return null;

  try {
    const url = new URL(String(fileUrl ?? ""), "https://gallery.invalid");
    if (!url.pathname.startsWith("/file/")) return null;
    const storagePath = url.pathname.slice("/file/".length);
    if (!storagePath) return null;
    return `/img/${storagePath}?w=${normalizedWidth}`;
  } catch {
    return null;
  }
}

export function getResponsiveImageAttributes(image, presetName) {
  const preset = IMAGE_VARIANT_PRESETS[presetName];
  if (!preset) throw new RangeError(`Unknown image variant preset: ${presetName}`);

  const src = String(image?.fileUrl ?? "");
  const intrinsicWidth = Number(image?.width);
  const hasIntrinsicWidth = Number.isFinite(intrinsicWidth) && intrinsicWidth > 0;
  const widths = preset.widths.filter((width) => !hasIntrinsicWidth || width <= intrinsicWidth);
  const srcset = widths
    .map((width) => {
      const url = buildImageVariantUrl(src, width);
      return url ? `${url} ${width}w` : null;
    })
    .filter(Boolean)
    .join(", ");
  const attributes = {
    src,
    srcset,
    sizes: preset.sizes,
  };
  const intrinsicHeight = Number(image?.height);
  if (Number.isInteger(intrinsicWidth) && intrinsicWidth > 0) attributes.width = intrinsicWidth;
  if (Number.isInteger(intrinsicHeight) && intrinsicHeight > 0) attributes.height = intrinsicHeight;
  return attributes;
}

export function applyResponsiveImageAttributes(element, image, presetName) {
  const attributes = getResponsiveImageAttributes(image, presetName);
  element.srcset = attributes.srcset;
  element.sizes = attributes.sizes;

  for (const name of ["width", "height"]) {
    if (attributes[name]) element.setAttribute(name, attributes[name]);
    else element.removeAttribute(name);
  }
  element.src = attributes.src;
  return attributes;
}
