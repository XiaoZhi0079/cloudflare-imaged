import test from "node:test";
import assert from "node:assert/strict";

import { classifyFeaturedImage } from "../src/shared/featured-image-rules.js";

test("featured eligibility accepts full HD and larger exact 16:9 images", () => {
  assert.deepEqual(classifyFeaturedImage({ width: 1920, height: 1080 }), {
    dimensions: "1920×1080",
    isExactSixteenNine: true,
    meetsMinimum: true,
    eligible: true,
    is4K: false,
    qualityLabel: "Full HD",
    statusLabel: "轮播可用",
    reason: null,
  });
  assert.equal(classifyFeaturedImage({ width: 2560, height: 1440 }).eligible, true);
  assert.equal(classifyFeaturedImage({ width: 3840, height: 2160 }).is4K, true);
  assert.equal(classifyFeaturedImage({ width: 7680, height: 4320 }).is4K, false);
});

test("featured eligibility rejects low resolution wrong ratio and unknown dimensions", () => {
  assert.equal(classifyFeaturedImage({ width: 1280, height: 720 }).reason, "分辨率不足");
  assert.equal(classifyFeaturedImage({ width: 1920, height: 1200 }).reason, "比例不符");
  assert.equal(classifyFeaturedImage({ width: null, height: null }).reason, "尺寸未知");
});
