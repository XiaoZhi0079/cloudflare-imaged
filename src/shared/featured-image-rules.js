const FEATURED_MIN_WIDTH = 1600;
const FEATURED_MIN_HEIGHT = 900;
const RATIO_TOLERANCE_NUMERATOR = 5n;
const RATIO_TOLERANCE_DENOMINATOR = 1000n;

function positiveInteger(value) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

function absoluteBigInt(value) {
  return value < 0n ? -value : value;
}

export function classifyFeaturedImage(image = {}) {
  const width = positiveInteger(image.width);
  const height = positiveInteger(image.height);
  const hasDimensions = width !== null && height !== null;
  const widthBigInt = hasDimensions ? BigInt(width) : 0n;
  const heightBigInt = hasDimensions ? BigInt(height) : 0n;
  const ratioDifference = hasDimensions
    ? absoluteBigInt(widthBigInt * 9n - heightBigInt * 16n)
    : 0n;
  const isExactSixteenNine = hasDimensions && ratioDifference === 0n;
  const isApproximatelySixteenNine = hasDimensions
    && ratioDifference * RATIO_TOLERANCE_DENOMINATOR
      <= heightBigInt * 16n * RATIO_TOLERANCE_NUMERATOR;
  const meetsMinimum = hasDimensions
    && width >= FEATURED_MIN_WIDTH
    && height >= FEATURED_MIN_HEIGHT;
  const eligible = isApproximatelySixteenNine && meetsMinimum;
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
        ? "HD+ / 900p+"
        : null;
  const reason = !hasDimensions
    ? "尺寸未知"
    : !isApproximatelySixteenNine
      ? "比例不符"
      : !meetsMinimum
        ? "分辨率不足"
        : null;

  return {
    dimensions: hasDimensions ? `${width}×${height}` : "尺寸未知",
    isExactSixteenNine,
    isApproximatelySixteenNine,
    meetsMinimum,
    eligible,
    is4K,
    resolutionTier,
    qualityLabel,
    statusLabel: eligible ? "轮播可用" : reason,
    reason,
  };
}
