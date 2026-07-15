function positiveInteger(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

export function classifyFeaturedImage(image = {}) {
  const width = positiveInteger(image.width);
  const height = positiveInteger(image.height);
  const hasDimensions = width !== null && height !== null;
  const isExactSixteenNine = hasDimensions && width * 9 === height * 16;
  const meetsMinimum = hasDimensions && width >= 1920 && height >= 1080;
  const eligible = isExactSixteenNine && meetsMinimum;
  const is4K = width === 3840 && height === 2160;
  const qualityLabel = is4K
    ? "4K"
    : width === 1920 && height === 1080
      ? "Full HD"
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
    qualityLabel,
    statusLabel: eligible ? "轮播可用" : reason,
    reason,
  };
}
