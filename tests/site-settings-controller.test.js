import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import * as siteSettings from "../public/assets/admin/site-settings.js";

const { mergeFeaturedSelection } = siteSettings;
const controllerSource = readFileSync(new URL("../public/assets/admin/site-settings.js", import.meta.url), "utf8");
const settingsCss = readFileSync(new URL("../public/assets/admin/settings.css", import.meta.url), "utf8");

test("featured selection keeps existing order and appends new images in library order", () => {
  const current = [{ id: 3 }, { id: 1 }, { id: 2 }];
  const library = [
    { id: 4, featuredEligibility: { eligible: true } },
    { id: 3, featuredEligibility: { eligible: true } },
    { id: 2, featuredEligibility: { eligible: true } },
    { id: 1, featuredEligibility: { eligible: true } },
    { id: 5, featuredEligibility: { eligible: true } },
  ];

  const merged = mergeFeaturedSelection(current, library, [1, 3, 4, 5]);

  assert.deepEqual(merged.map((image) => image.id), [3, 1, 4, 5]);
  assert.deepEqual(current.map((image) => image.id), [3, 1, 2]);
  assert.equal(merged[0], current[0]);
  assert.equal(merged[1], current[1]);
});

test("featured selection keeps old invalid items but never appends new invalid images", () => {
  const current = [{ id: 1, featuredEligibility: { eligible: false } }];
  const library = [
    current[0],
    { id: 2, featuredEligibility: { eligible: false } },
    { id: 3, featuredEligibility: { eligible: true } },
  ];

  const merged = mergeFeaturedSelection(current, library, [1, 2, 3]);

  assert.deepEqual(merged.map((image) => image.id), [1, 3]);
  assert.equal(merged[0], current[0]);
  assert.equal(current.length, 1);
});

test("current featured renderer keeps invalid items removable and escapes eligibility labels", () => {
  assert.equal(typeof siteSettings.renderFeaturedItem, "function");

  const invalidHtml = siteSettings.renderFeaturedItem({
    id: '7" onmouseover="bad',
    fileName: "<script>bad()</script>",
    fileUrl: 'https://gallery.example/file?x=" onerror="bad',
    featuredEligibility: {
      dimensions: '<svg onload="bad">',
      eligible: false,
      is4K: true,
      qualityLabel: "<i>4K</i>",
      statusLabel: "<u>不可用</u>",
      reason: "<b>比例不符</b>",
    },
  }, 0, 2);

  assert.match(invalidHtml, /site-featured-item is-ineligible/);
  assert.match(invalidHtml, /当前图片不符合轮播规格，请移除后再保存/);
  assert.match(invalidHtml, /data-action="move-up"/);
  assert.match(invalidHtml, /data-action="move-down"/);
  assert.match(invalidHtml, /data-action="remove"/);
  assert.match(invalidHtml, /&lt;svg onload=&quot;bad&quot;&gt;/);
  assert.match(invalidHtml, /&lt;b&gt;比例不符&lt;\/b&gt;/);
  assert.match(invalidHtml, /&lt;i&gt;4K&lt;\/i&gt;/);
  assert.match(invalidHtml, /data-featured-id="7&quot; onmouseover=&quot;bad"/);
  assert.doesNotMatch(invalidHtml, /<script>|<svg onload=|<b>比例不符|<i>4K/);

  const validHtml = siteSettings.renderFeaturedItem({
    id: 8,
    fileName: "valid.webp",
    fileUrl: "/file/valid",
    featuredEligibility: {
      dimensions: "3840×2160",
      eligible: true,
      is4K: true,
      qualityLabel: "4K",
      statusLabel: "轮播可用",
    },
  }, 1, 2);
  assert.match(validHtml, /3840×2160/);
  assert.match(validHtml, /轮播可用/);
  assert.match(validHtml, />4K</);
  assert.doesNotMatch(validHtml, /当前图片不符合轮播规格/);
});

test("picker renderer disables invalid cards, preserves checked legacy items, and escapes metadata", () => {
  assert.equal(typeof siteSettings.renderFeaturedPickerCard, "function");

  const invalidHtml = siteSettings.renderFeaturedPickerCard({
    id: '9" onchange="bad',
    fileName: "<script>picker()</script>",
    fileUrl: "/file/invalid",
    featuredEligibility: {
      dimensions: "<em>1600×900</em>",
      eligible: false,
      qualityLabel: null,
      statusLabel: "<u>分辨率不足</u>",
      reason: "<strong>分辨率不足</strong>",
    },
  }, true);

  assert.match(invalidHtml, /site-picker-card is-ineligible is-disabled/);
  assert.match(invalidHtml, /<input[^>]*checked[^>]*disabled/);
  assert.match(invalidHtml, /&lt;em&gt;1600×900&lt;\/em&gt;/);
  assert.match(invalidHtml, /&lt;strong&gt;分辨率不足&lt;\/strong&gt;/);
  assert.match(invalidHtml, /value="9&quot; onchange=&quot;bad"/);
  assert.doesNotMatch(invalidHtml, /<script>|<em>|<strong>/);

  const eligibleHtml = siteSettings.renderFeaturedPickerCard({
    id: 10,
    fileName: "4k.webp",
    fileUrl: "/file/4k",
    featuredEligibility: {
      dimensions: "3840×2160",
      eligible: true,
      is4K: true,
      qualityLabel: "4K",
      statusLabel: "轮播可用",
    },
  }, false);
  assert.match(eligibleHtml, /site-picker-card is-eligible is-4k/);
  assert.doesNotMatch(eligibleHtml, /<input[^>]*disabled/);
  assert.match(eligibleHtml, /3840×2160/);
  assert.match(eligibleHtml, /轮播可用/);
  assert.match(eligibleHtml, />4K</);
});

test("picker explains the rule and filters chosen ids before merge", () => {
  assert.match(controllerSource, /仅精确 16:9 且至少 1920×1080 可加入轮播/);
  assert.match(
    controllerSource,
    /const eligibleIds = new Set\(images[\s\S]*?featuredEligibility\?\.eligible === true[\s\S]*?const chosenIds = [\s\S]*?\.filter\(\(imageId\) => currentIds\.has\(imageId\) \|\| eligibleIds\.has\(imageId\)\)/,
  );
});

test("loading preserves every server featured image without eligibility filtering", () => {
  const applyPayloadSource = controllerSource.match(/function applyPayload\(payload\)[\s\S]*?\r?\n  }\r?\n\r?\n  async function load/)?.[0] || "";
  assert.match(applyPayloadSource, /featuredImages:\s*\[\.\.\.server\.featuredImages\]/);
  assert.doesNotMatch(applyPayloadSource, /\.filter\(/);
});

test("settings styles distinguish invalid, eligible, 4K, disabled, and checked states", () => {
  assert.match(settingsCss, /\.site-featured-item\.is-ineligible/);
  assert.match(settingsCss, /\.site-featured-warning/);
  assert.match(settingsCss, /\.site-featured-meta/);
  assert.match(settingsCss, /\.site-picker-meta/);
  assert.match(settingsCss, /\.site-picker-card\.is-eligible/);
  assert.match(settingsCss, /\.site-picker-card\.is-4k/);
  assert.match(settingsCss, /\.site-picker-card\.is-ineligible/);
  assert.match(settingsCss, /\.site-picker-card\.is-disabled/);
  assert.match(settingsCss, /\.site-picker-card:has\(input:checked\)/);
  assert.match(settingsCss, /overflow-wrap:\s*anywhere/);
});
