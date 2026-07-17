import test from "node:test";
import assert from "node:assert/strict";

import {
  buildViewerUrl,
  clearViewerImageUrl,
  createImageViewer,
  getAdjacentImageUrls,
  getSwipeAction,
  getViewerKeyAction,
  wrapViewerIndex,
} from "../public/assets/image-viewer.js";

class FakeClassList {
  constructor(values = []) {
    this.values = new Set(values);
  }

  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  contains(value) { return this.values.has(value); }
}

class FakeTarget {
  constructor({ classes = [] } = {}) {
    this.listeners = new Map();
    this.classList = new FakeClassList(classes);
    this.hidden = false;
    this.textContent = "";
    this.src = "";
    this.alt = "";
    this.focusCalls = 0;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== listener));
  }

  dispatch(type, properties = {}) {
    const event = {
      target: this,
      preventDefault() { this.defaultPrevented = true; },
      ...properties,
    };
    for (const listener of this.listeners.get(type) ?? []) listener(event);
    return event;
  }

  focus() { this.focusCalls += 1; }
  removeAttribute(name) { if (name === "src") this.src = ""; }
}

function createViewerHarness(initialUrl = "https://gallery.example/?tag=portrait") {
  const windowObject = new FakeTarget();
  const modal = new FakeTarget({ classes: ["hidden"] });
  const elements = {
    modal,
    image: new FakeTarget(),
    title: new FakeTarget(),
    tags: new FakeTarget(),
    close: new FakeTarget(),
    previous: new FakeTarget(),
    next: new FakeTarget(),
    counter: new FakeTarget(),
    stage: new FakeTarget(),
  };
  const locationObject = { href: initialUrl };
  const historyCalls = [];
  const historyObject = {
    state: null,
    pushState(state, _title, url) {
      this.state = state;
      locationObject.href = new URL(url, locationObject.href).href;
      historyCalls.push(["push", state, url]);
    },
    replaceState(state, _title, url) {
      this.state = state;
      locationObject.href = new URL(url, locationObject.href).href;
      historyCalls.push(["replace", state, url]);
    },
    back() { historyCalls.push(["back"]); },
  };
  const documentObject = { documentElement: new FakeTarget() };
  const preloaded = [];
  const images = [
    { id: 1, fileName: "one.webp", fileUrl: "/file/one", tags: ["光"] },
    { id: 2, fileName: "two.webp", fileUrl: "/file/two", tags: ["影"] },
    { id: 3, fileName: "three.webp", fileUrl: "/file/three", tags: [] },
  ];
  const viewer = createImageViewer({
    elements,
    getImages: () => images,
    windowObject,
    documentObject,
    locationObject,
    historyObject,
    createPreloadImage: () => ({ set src(value) { preloaded.push(value); } }),
  });
  return {
    viewer,
    images,
    elements,
    windowObject,
    documentObject,
    locationObject,
    historyObject,
    historyCalls,
    preloaded,
  };
}

test("viewer navigation wraps in both directions", () => {
  assert.equal(wrapViewerIndex(3, 3), 0);
  assert.equal(wrapViewerIndex(-1, 3), 2);
  assert.equal(wrapViewerIndex(8, 3), 2);
  assert.equal(wrapViewerIndex(0, 0), -1);
});

test("viewer URLs preserve page context and change only the image", () => {
  assert.equal(
    buildViewerUrl("https://gallery.example/?tag=portrait&sort=new", 42),
    "/?tag=portrait&sort=new&image=42",
  );
  assert.equal(
    buildViewerUrl("https://gallery.example/album.html?slug=night&image=7", "9"),
    "/album.html?slug=night&image=9",
  );
  assert.equal(
    clearViewerImageUrl("https://gallery.example/album.html?slug=night&image=9#top"),
    "/album.html?slug=night#top",
  );
});

test("viewer keyboard mapping ignores unrelated keys", () => {
  assert.equal(getViewerKeyAction("ArrowLeft"), "previous");
  assert.equal(getViewerKeyAction("ArrowRight"), "next");
  assert.equal(getViewerKeyAction("Escape"), "close");
  assert.equal(getViewerKeyAction("Enter"), null);
});

test("viewer swipe requires a dominant horizontal movement of 48 pixels", () => {
  assert.equal(getSwipeAction({ startX: 100, startY: 20, endX: 48, endY: 25 }), "next");
  assert.equal(getSwipeAction({ startX: 20, startY: 20, endX: 72, endY: 25 }), "previous");
  assert.equal(getSwipeAction({ startX: 100, startY: 20, endX: 53, endY: 20 }), null);
  assert.equal(getSwipeAction({ startX: 100, startY: 20, endX: 45, endY: 90 }), null);
});

test("viewer adjacent preloads are unique and omit the current image", () => {
  const images = [
    { id: 1, fileUrl: "/file/one" },
    { id: 2, fileUrl: "/file/two" },
    { id: 3, fileUrl: "/file/three" },
  ];
  assert.deepEqual(getAdjacentImageUrls(images, 0), ["/file/three", "/file/two"]);
  assert.deepEqual(getAdjacentImageUrls(images.slice(0, 2), 0), ["/file/two"]);
  assert.deepEqual(getAdjacentImageUrls(images.slice(0, 1), 0), []);
});

test("viewer opens by id, renders metadata, pushes one URL and preloads neighbors", () => {
  const harness = createViewerHarness();
  const opener = new FakeTarget();

  assert.equal(harness.viewer.openById(2, { opener }), true);

  assert.equal(harness.elements.modal.classList.contains("hidden"), false);
  assert.equal(harness.elements.image.src, "/file/two");
  assert.equal(harness.elements.image.alt, "two.webp");
  assert.equal(harness.elements.title.textContent, "two.webp");
  assert.equal(harness.elements.tags.textContent, "影");
  assert.equal(harness.elements.counter.textContent, "2 / 3");
  assert.equal(harness.documentObject.documentElement.classList.contains("viewer-open"), true);
  assert.equal(harness.elements.close.focusCalls, 1);
  assert.deepEqual(harness.historyCalls[0], [
    "push",
    { galleryViewer: true },
    "/?tag=portrait&image=2",
  ]);
  assert.deepEqual(harness.preloaded, ["/file/one", "/file/three"]);
});

test("viewer next and previous wrap and replace the current viewer URL", () => {
  const harness = createViewerHarness();
  harness.viewer.openById(3);
  harness.elements.next.dispatch("click");
  assert.equal(harness.elements.image.src, "/file/one");
  assert.equal(harness.historyCalls.at(-1)[0], "replace");
  assert.equal(harness.historyCalls.at(-1)[2], "/?tag=portrait&image=1");
  harness.elements.previous.dispatch("click");
  assert.equal(harness.elements.image.src, "/file/three");
});

test("viewer routes active keyboard and single-finger swipe gestures", () => {
  const harness = createViewerHarness();
  harness.viewer.openById(1);

  const keyEvent = harness.windowObject.dispatch("keydown", { key: "ArrowRight" });
  assert.equal(keyEvent.defaultPrevented, true);
  assert.equal(harness.elements.image.src, "/file/two");

  harness.elements.stage.dispatch("touchstart", { touches: [{ clientX: 100, clientY: 20 }] });
  harness.elements.stage.dispatch("touchend", { changedTouches: [{ clientX: 40, clientY: 25 }] });
  assert.equal(harness.elements.image.src, "/file/three");

  harness.elements.stage.dispatch("touchstart", { touches: [{ clientX: 40, clientY: 20 }, { clientX: 45, clientY: 25 }] });
  harness.elements.stage.dispatch("touchend", { changedTouches: [{ clientX: 120, clientY: 20 }] });
  assert.equal(harness.elements.image.src, "/file/three");
});

test("viewer close goes back for page-open history and restores the opener", () => {
  const harness = createViewerHarness();
  const opener = new FakeTarget();
  harness.viewer.openById(1, { opener });

  harness.elements.close.dispatch("click");

  assert.equal(harness.elements.modal.classList.contains("hidden"), true);
  assert.equal(harness.documentObject.documentElement.classList.contains("viewer-open"), false);
  assert.equal(opener.focusCalls, 1);
  assert.deepEqual(harness.historyCalls.at(-1), ["back"]);
});

test("viewer direct links open after data load and close by removing only image", () => {
  const harness = createViewerHarness("https://gallery.example/album.html?slug=night&image=2");

  assert.equal(harness.viewer.syncFromUrl(), true);
  assert.equal(harness.elements.image.src, "/file/two");
  assert.equal(harness.historyCalls.length, 0);

  harness.viewer.close();
  assert.deepEqual(harness.historyCalls.at(-1), [
    "replace",
    null,
    "/album.html?slug=night",
  ]);
});

test("viewer popstate synchronizes open and closed states without adding history", () => {
  const harness = createViewerHarness();
  harness.locationObject.href = "https://gallery.example/?tag=portrait&image=3";
  harness.windowObject.dispatch("popstate");
  assert.equal(harness.elements.image.src, "/file/three");
  assert.equal(harness.historyCalls.length, 0);

  harness.locationObject.href = "https://gallery.example/?tag=portrait";
  harness.windowObject.dispatch("popstate");
  assert.equal(harness.elements.modal.classList.contains("hidden"), true);
  assert.equal(harness.historyCalls.length, 0);
});

test("viewer removes an invalid direct image and hides navigation for one image", () => {
  const harness = createViewerHarness("https://gallery.example/?tag=portrait&image=99");
  harness.images.splice(1);
  assert.equal(harness.viewer.syncFromUrl(), false);
  assert.equal(harness.historyCalls.at(-1)[2], "/?tag=portrait");

  harness.viewer.openById(1);
  assert.equal(harness.elements.previous.hidden, true);
  assert.equal(harness.elements.next.hidden, true);
  assert.equal(harness.elements.counter.textContent, "1 / 1");
});

test("viewer preloads each adjacent URL only once per instance", () => {
  const harness = createViewerHarness();
  harness.viewer.openById(1);
  harness.elements.next.dispatch("click");
  harness.elements.previous.dispatch("click");
  assert.deepEqual(harness.preloaded, ["/file/three", "/file/two", "/file/one"]);
});
