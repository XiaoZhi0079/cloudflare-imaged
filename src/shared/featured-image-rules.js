function positiveInteger(value) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

export function classifyFeaturedImage(image = {}) {
  const width = positiveInteger(image.width);
  const height = positiveInteger(image.height);
  const hasDimensions = width !== null && height !== null;
  const isExactSixteenNine = hasDimensions && BigInt(width) * 9n === BigInt(height) * 16n;
  const meetsMinimum = hasDimensions && width >= 1920 && height >= 1080;
  const eligible = isExactSixteenNine && meetsMinimum;
  const resolutionTier = !eligible
    ? null
    : width >= 3840 && height >= 2160
      ? "4k"
      : width >= 2560 && height >= 1440
        ? "2k"
        : "1k";
  const is4K = resolutionTier === "4k";
  const qualityLabel = resolutionTier === "4k"
    ? "4K"
    : resolutionTier === "2k"
      ? "2K"
      : resolutionTier === "1k"
        ? "1K / 1080p"
        : null;
  const reason = !hasDimensions
    ? "尺寸未知"
    : !isExactSixteenNine
      ? "比例不符"
      : !meetsMinimum
        ? "分辨率不足"
        : null;

  return {
    dimensions: hasDimensions ? `${width}×${height}` : "尺寸未知",
    isExactSixteenNine,
    meetsMinimum,
    eligible,
    is4K,
    resolutionTier,
    qualityLabel,
    statusLabel: eligible ? "轮播可用" : reason,
    reason,
  };
}
