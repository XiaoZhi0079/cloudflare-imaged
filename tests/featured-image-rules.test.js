import test from "node:test";
import assert from "node:assert/strict";

import { classifyFeaturedImage } from "../src/shared/featured-image-rules.js";

test("featured eligibility accepts HD+ and larger near-16:9 images", () => {
  assert.deepEqual(classifyFeaturedImage({ width: 1600, height: 900 }), {
    dimensions: "1600×900",
    isExactSixteenNine: true,
    isApproximatelySixteenNine: true,
    meetsMinimum: true,
    eligible: true,
    is4K: false,
    resolutionTier: "1k",
    qualityLabel: "HD+ / 900p+",
    statusLabel: "轮播可用",
    reason: null,
  });

  const roundedExport = classifyFeaturedImage({ width: 1672, height: 941 });
  assert.equal(roundedExport.isExactSixteenNine, false);
  assert.equal(roundedExport.isApproximatelySixteenNine, true);
  assert.equal(roundedExport.eligible, true);
  assert.equal(roundedExport.resolutionTier, "1k");
  assert.equal(roundedExport.qualityLabel, "HD+ / 900p+");

  assert.equal(classifyFeaturedImage({ width: 2560, height: 1440 }).resolutionTier, "2k");
  assert.equal(classifyFeaturedImage({ width: 3200, height: 1800 }).resolutionTier, "2k");
  assert.equal(classifyFeaturedImage({ width: 3840, height: 2160 }).resolutionTier, "4k");
  assert.equal(classifyFeaturedImage({ width: 3840, height: 2160 }).is4K, true);
  assert.equal(classifyFeaturedImage({ width: 7680, height: 4320 }).resolutionTier, "4k");
  assert.equal(classifyFeaturedImage({ width: 7680, height: 4320 }).is4K, true);
});

test("featured eligibility includes the 0.5 percent ratio boundaries", () => {
  for (const width of [3184, 3216]) {
    const boundary = classifyFeaturedImage({ width, height: 1800 });
    assert.equal(boundary.isApproximatelySixteenNine, true);
    assert.equal(boundary.eligible, true);
  }

  for (const width of [3183, 3217]) {
    const outside = classifyFeaturedImage({ width, height: 1800 });
    assert.equal(outside.isApproximatelySixteenNine, false);
    assert.equal(outside.reason, "比例不符");
  }
});

test("featured eligibility rejects low resolution wrong ratio and unknown dimensions", () => {
  const lowResolution = classifyFeaturedImage({ width: 1280, height: 720 });
  assert.equal(lowResolution.isApproximatelySixteenNine, true);
  assert.equal(lowResolution.reason, "分辨率不足");
  assert.equal(lowResolution.resolutionTier, null);

  const wrongRatio = classifyFeaturedImage({ width: 1920, height: 1200 });
  assert.equal(wrongRatio.isApproximatelySixteenNine, false);
  assert.equal(wrongRatio.reason, "比例不符");
  assert.equal(wrongRatio.resolutionTier, null);

  const unknown = classifyFeaturedImage({ width: null, height: null });
  assert.equal(unknown.isApproximatelySixteenNine, false);
  assert.equal(unknown.reason, "尺寸未知");
  assert.equal(unknown.resolutionTier, null);
});

test("featured eligibility safely rejects extreme dimensions", () => {
  const safeSquare = classifyFeaturedImage({
    width: Number.MAX_SAFE_INTEGER,
    height: Number.MAX_SAFE_INTEGER,
  });
  assert.equal(safeSquare.isExactSixteenNine, false);
  assert.equal(safeSquare.isApproximatelySixteenNine, false);
  assert.equal(safeSquare.reason, "比例不符");

  const invalidDimensions = [
    { width: 0, height: 900 },
    { width: -1600, height: 900 },
    { width: 1600.5, height: 900 },
    { width: Number.POSITIVE_INFINITY, height: 900 },
    { width: Number.MAX_VALUE, height: Number.MAX_VALUE },
    { width: Number.MAX_SAFE_INTEGER + 1, height: Number.MAX_SAFE_INTEGER + 1 },
  ];
  for (const dimensions of invalidDimensions) {
    const result = classifyFeaturedImage(dimensions);
    assert.equal(result.dimensions, "尺寸未知");
    assert.equal(result.isApproximatelySixteenNine, false);
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "尺寸未知");
  }
});
