import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import * as siteSettings from "../public/assets/admin/site-settings.js";

const {
  filterFeaturedCandidates,
  mergeFeaturedSelection,
} = siteSettings;
const controllerSource = readFileSync(new URL("../public/assets/admin/site-settings.js", import.meta.url), "utf8");
const settingsCss = readFileSync(new URL("../public/assets/admin/settings.css", import.meta.url), "utf8");

function candidate(id, resolutionTier, overrides = {}) {
  const labels = {
    other: "其他",
    "1k": "1K",
    "2k": "2K",
    "4k": "4K",
  };
  const dimensions = {
    other: "1672×941",
    "1k": "1920×1080",
    "2k": "2560×1440",
    "4k": "3840×2160",
  };
  return {
    id,
    fileName: `${id}.webp`,
    fileUrl: `/file/${id}.webp`,
    featuredEligibility: {
      eligible: true,
      is4K: resolutionTier === "4k",
      resolutionTier,
      qualityLabel: labels[resolutionTier],
      dimensions: dimensions[resolutionTier],
      statusLabel: "轮播可用",
    },
    ...overrides,
  };
}

test("featured candidates exclude invalid records and split into four resolution tiers", () => {
  const images = [
    candidate(1, "other"),
    candidate(2, "1k"),
    candidate(3, "2k"),
    candidate(4, "4k"),
    { id: 5, featuredEligibility: { eligible: false, resolutionTier: null, reason: "比例不符" } },
    { id: 6, featuredEligibility: { eligible: false, resolutionTier: null, reason: "尺寸未知" } },
    { id: 7, featuredEligibility: { eligible: true, resolutionTier: null } },
    { id: 8, featuredEligibility: { eligible: true, resolutionTier: "future" } },
    { id: 9 },
  ];

  assert.deepEqual(filterFeaturedCandidates(images, "all").map(({ id }) => id), [1, 2, 3, 4]);
  assert.deepEqual(filterFeaturedCandidates(images, "4k").map(({ id }) => id), [4]);
  assert.deepEqual(filterFeaturedCandidates(images, "2k").map(({ id }) => id), [3]);
  assert.deepEqual(filterFeaturedCandidates(images, "1k").map(({ id }) => id), [2]);
  assert.deepEqual(filterFeaturedCandidates(images, "other").map(({ id }) => id), [1]);
  assert.deepEqual(filterFeaturedCandidates(images, "unsupported"), []);
});

test("featured selection keeps existing order and appends candidates in library order", () => {
  const current = [{ id: 3 }, { id: 1 }, { id: 2 }];
  const library = [candidate(4, "1k"), candidate(3, "4k"), candidate(2, "2k"), candidate(1, "1k"), candidate(5, "4k")];

  const merged = mergeFeaturedSelection(current, library, [1, 3, 4, 5]);

  assert.deepEqual(merged.map((image) => image.id), [3, 1, 4, 5]);
  assert.deepEqual(current.map((image) => image.id), [3, 1, 2]);
  assert.equal(merged[0], current[0]);
  assert.equal(merged[1], current[1]);
});

test("featured selection preserves current legacy items that are absent from candidates", () => {
  const legacy = { id: 1, featuredEligibility: { eligible: false, reason: "比例不符" } };
  const current = [legacy, candidate(2, "1k")];
  const candidates = [candidate(2, "1k"), candidate(3, "2k")];

  const merged = mergeFeaturedSelection(current, candidates, [3]);

  assert.deepEqual(merged.map((image) => image.id), [1, 3]);
  assert.equal(merged[0], legacy);
});

test("current featured renderer keeps invalid items removable and escapes eligibility labels", () => {
  const invalidHtml = siteSettings.renderFeaturedItem({
    id: '7" onmouseover="bad',
    fileName: "<script>bad()</script>",
    fileUrl: 'https://gallery.example/file?x=" onerror="bad',
    featuredEligibility: {
      dimensions: '<svg onload="bad">',
      eligible: false,
      is4K: false,
      resolutionTier: null,
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
  assert.doesNotMatch(invalidHtml, /<script>|<svg onload=|<b>比例不符|<i>4K/);
});

test("picker renderer returns only eligible tier cards without rejection text", () => {
  assert.equal(siteSettings.renderFeaturedPickerCard({
    id: 9,
    featuredEligibility: {
      eligible: false,
      resolutionTier: null,
      reason: "分辨率不足",
    },
  }, true), "");

  const eligibleHtml = siteSettings.renderFeaturedPickerCard(candidate(10, "4k", {
    fileName: "<script>4k()</script>",
  }), true);
  assert.match(eligibleHtml, /site-picker-card is-4k/);
  assert.match(eligibleHtml, /<input[^>]*checked/);
  assert.doesNotMatch(eligibleHtml, /<input[^>]*disabled/);
  assert.match(eligibleHtml, /3840×2160/);
  assert.match(eligibleHtml, />4K</);
  assert.doesNotMatch(eligibleHtml, /轮播可用|比例不符|分辨率不足|尺寸未知/);
  assert.doesNotMatch(eligibleHtml, /<script>/);
});

test("picker exposes only four resolution controls and defaults to 4K", () => {
  assert.match(controllerSource, /接近 16:9（误差不超过 0\.5%）且至少 1600×900 可加入轮播/);
  assert.match(controllerSource, /label: "4K"/);
  assert.match(controllerSource, /label: "2K"/);
  assert.match(controllerSource, /label: "1K"/);
  assert.match(controllerSource, /label: "其他"/);
  assert.match(controllerSource, /let activeTier = "4k"/);
  assert.match(controllerSource, /selectedCandidateIds/);
  assert.doesNotMatch(controllerSource, /全部可用|HD\+ \/ 900p\+/);
});

test("loading preserves every server featured image without eligibility filtering", () => {
  const applyPayloadSource = controllerSource.match(/function applyPayload\(payload\)[\s\S]*?\r?\n  }\r?\n\r?\n  async function load/)?.[0] || "";
  assert.match(applyPayloadSource, /featuredImages:\s*\[\.\.\.server\.featuredImages\]/);
  assert.doesNotMatch(applyPayloadSource, /\.filter\(/);
});

test("settings styles keep legacy warnings and add independent candidate filters", () => {
  assert.match(settingsCss, /\.site-featured-item\.is-ineligible/);
  assert.match(settingsCss, /\.site-featured-warning/);
  assert.match(settingsCss, /\.site-featured-meta/);
  assert.match(settingsCss, /\.site-picker-filters/);
  assert.match(settingsCss, /\.site-picker-filter\.is-active/);
  assert.match(settingsCss, /\.site-picker-filter-count/);
  assert.match(settingsCss, /\.site-picker-empty/);
  assert.match(settingsCss, /\.site-picker-card\.is-4k/);
  assert.match(settingsCss, /\.site-picker-card\.is-2k/);
  assert.match(settingsCss, /\.site-picker-card\.is-1k/);
  assert.match(settingsCss, /\.site-picker-card\.is-other/);
  assert.doesNotMatch(settingsCss, /\.site-picker-card\.is-ineligible/);
  assert.doesNotMatch(settingsCss, /\.site-picker-card\.is-disabled/);
  assert.match(settingsCss, /\.site-picker-card:has\(input:checked\)/);
  assert.match(settingsCss, /overflow-wrap:\s*anywhere/);
});

test("featured controller uses task-specific settings language", () => {
  assert.match(controllerSource, /精选设置已修改，保存后生效/);
  assert.match(controllerSource, /精选设置已保存/);
  assert.doesNotMatch(controllerSource, /站点设置已修改|站点设置已保存/);
});

function fakeElement(initial = {}) {
  const listeners = new Map();
  return {
    disabled: false,
    value: "",
    textContent: "",
    innerHTML: "",
    ...initial,
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    dispatch(type) {
      listeners.get(type)?.({ target: this, closest: () => null });
    },
  };
}

function controllerHarness(responses) {
  const elements = {
    "#site-issue-name": fakeElement(),
    "#site-hero-copy": fakeElement(),
    "#site-status": fakeElement(),
    "#site-featured-list": fakeElement(),
    "#site-add-featured": fakeElement(),
    "#site-save": fakeElement(),
  };
  const calls = [];
  const errors = [];
  const queue = [...responses];
  const controller = siteSettings.createSiteSettingsController({
    root: { querySelector: (selector) => elements[selector] },
    client: {
      async request(path, options) {
        calls.push({ path, options });
        const next = queue.shift();
        if (next instanceof Error) throw next;
        return next;
      },
    },
    dialogs: {},
    notifier: { error: (message) => errors.push(message), success() {} },
  });
  controller.bind();
  return { controller, elements, calls, errors };
}

test("featured controller stays locked and cannot save after initial load failure", async () => {
  const harness = controllerHarness([new Error("temporary site failure")]);
  const { elements, controller, calls, errors } = harness;

  for (const selector of [
    "#site-issue-name", "#site-hero-copy", "#site-add-featured", "#site-save",
  ]) {
    assert.equal(elements[selector].disabled, true);
  }

  await assert.rejects(controller.load(), /temporary site failure/);
  elements["#site-save"].dispatch("click");
  elements["#site-add-featured"].dispatch("click");

  assert.equal(calls.length, 1, "failed initialization must not allow image or save requests");
  assert.match(errors.at(-1), /尚未加载/);
  assert.equal(elements["#site-save"].disabled, true);
  assert.equal(elements["#site-add-featured"].disabled, true);
});

test("featured controller unlocks only after a later load succeeds", async () => {
  const payload = { issueName: "本期", heroCopy: "一句文案", featuredImages: [] };
  const harness = controllerHarness([new Error("temporary"), payload]);
  const { elements, controller } = harness;

  await assert.rejects(controller.load(), /temporary/);
  await controller.load();

  assert.equal(elements["#site-issue-name"].value, "本期");
  assert.equal(elements["#site-hero-copy"].value, "一句文案");
  assert.equal(elements["#site-issue-name"].disabled, false);
  assert.equal(elements["#site-hero-copy"].disabled, false);
  assert.equal(elements["#site-add-featured"].disabled, false);
  assert.equal(elements["#site-save"].disabled, true, "unchanged loaded data is not saveable");
});
