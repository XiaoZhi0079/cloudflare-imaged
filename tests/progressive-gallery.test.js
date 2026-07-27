import test from "node:test";
import assert from "node:assert/strict";

import { createProgressiveGallery } from "../public/assets/progressive-gallery.js";

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  toggle(value, force) {
    if (force) this.values.add(value);
    else this.values.delete(value);
  }

  contains(value) {
    return this.values.has(value);
  }
}

class FakeRoot {
  constructor() {
    this.innerHTML = "";
    this.classList = new FakeClassList();
  }

  insertAdjacentHTML(position, markup) {
    assert.equal(position, "beforeend");
    this.innerHTML += markup;
  }
}

class FakeButton {
  constructor() {
    this.hidden = true;
    this.listeners = new Map();
    this.attributes = new Map();
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  removeEventListener(type, listener) {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  click() {
    this.listeners.get("click")?.();
  }
}

class FakeIntersectionObserver {
  static instances = [];

  constructor(callback, options) {
    this.callback = callback;
    this.options = options;
    this.observed = [];
    this.disconnected = false;
    FakeIntersectionObserver.instances.push(this);
  }

  observe(target) {
    this.observed.push(target);
  }

  disconnect() {
    this.disconnected = true;
  }

  intersect() {
    this.callback([{ isIntersecting: true }]);
  }
}

function createHarness(itemCount = 100) {
  FakeIntersectionObserver.instances = [];
  const root = new FakeRoot();
  const button = new FakeButton();
  let bindCount = 0;
  const controller = createProgressiveGallery({
    root,
    loadMoreButton: button,
    renderCards: (items) => items.map((item) => `<i>${item.id}</i>`).join(""),
    bindCards: () => { bindCount += 1; },
    IntersectionObserverClass: FakeIntersectionObserver,
  });
  const items = Array.from({ length: itemCount }, (_, index) => ({ id: index + 1 }));
  return { root, button, controller, items, getBindCount: () => bindCount };
}

test("progressive gallery renders 48 cards at a time and exposes a fallback button", () => {
  const harness = createHarness();
  harness.controller.setItems(harness.items);

  assert.equal(harness.controller.getRenderedCount(), 48);
  assert.match(harness.root.innerHTML, /<i>1<\/i>/);
  assert.match(harness.root.innerHTML, /<i>48<\/i>/);
  assert.doesNotMatch(harness.root.innerHTML, /<i>49<\/i>/);
  assert.equal(harness.button.hidden, false);
  assert.equal(harness.button.attributes.get("aria-label"), "加载更多图片，已显示 48 / 100");
  assert.equal(harness.getBindCount(), 1);

  harness.button.click();
  assert.equal(harness.controller.getRenderedCount(), 96);
  harness.button.click();
  assert.equal(harness.controller.getRenderedCount(), 100);
  assert.equal(harness.button.hidden, true);
  assert.equal(harness.getBindCount(), 3);
});

test("progressive gallery automatically appends a batch near the viewport", () => {
  const harness = createHarness();
  const observer = FakeIntersectionObserver.instances[0];
  assert.deepEqual(observer.observed, [harness.button]);
  assert.equal(observer.options.rootMargin, "600px 0px");

  harness.controller.setItems(harness.items);
  observer.intersect();

  assert.equal(harness.controller.getRenderedCount(), 96);
  harness.controller.destroy();
  assert.equal(observer.disconnected, true);
  assert.equal(harness.button.listeners.has("click"), false);
});

test("progressive gallery resets cleanly for an empty result", () => {
  const harness = createHarness(12);
  harness.controller.setItems(harness.items);
  harness.controller.setItems([], { emptyMarkup: "<p>暂无图片</p>" });

  assert.equal(harness.controller.getRenderedCount(), 0);
  assert.equal(harness.root.innerHTML, "<p>暂无图片</p>");
  assert.equal(harness.root.classList.contains("is-empty"), true);
  assert.equal(harness.button.hidden, true);
});
