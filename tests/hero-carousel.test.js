import test from "node:test";
import assert from "node:assert/strict";

import { createHeroCarousel } from "../public/assets/hero-carousel.js";

function createFakeScheduler() {
  let nextId = 1;
  const callbacks = new Map();

  return {
    setInterval(callback) {
      const id = nextId;
      nextId += 1;
      callbacks.set(id, callback);
      return id;
    },
    clearInterval(id) {
      callbacks.delete(id);
    },
    tick() {
      for (const callback of [...callbacks.values()]) {
        callback();
      }
    },
    activeCount() {
      return callbacks.size;
    },
  };
}

test("carousel autoplay advances and manual navigation wraps", () => {
  const scheduler = createFakeScheduler();
  const indices = [];
  const carousel = createHeroCarousel({
    length: 3,
    onIndexChange: (index) => indices.push(index),
    setIntervalFn: scheduler.setInterval,
    clearIntervalFn: scheduler.clearInterval,
  });

  assert.deepEqual(indices, [0]);
  assert.equal(scheduler.activeCount(), 1);

  scheduler.tick();
  assert.equal(carousel.getState().index, 1);

  carousel.previous();
  assert.equal(carousel.getState().index, 0);
  carousel.previous();
  assert.equal(carousel.getState().index, 2);
  carousel.select(7);
  assert.equal(carousel.getState().index, 1);
  assert.equal(scheduler.activeCount(), 1);
});

test("carousel waits for every temporary pause reason to clear", () => {
  const scheduler = createFakeScheduler();
  const carousel = createHeroCarousel({
    length: 3,
    setIntervalFn: scheduler.setInterval,
    clearIntervalFn: scheduler.clearInterval,
  });

  carousel.setPauseReason("hover", true);
  assert.equal(scheduler.activeCount(), 0);
  carousel.setPauseReason("focus", true);
  carousel.setPauseReason("hover", false);
  assert.equal(scheduler.activeCount(), 0);
  carousel.setPauseReason("focus", false);
  assert.equal(scheduler.activeCount(), 1);
});

test("reduced motion starts paused and can be explicitly resumed", () => {
  const scheduler = createFakeScheduler();
  const carousel = createHeroCarousel({
    length: 2,
    reducedMotion: true,
    setIntervalFn: scheduler.setInterval,
    clearIntervalFn: scheduler.clearInterval,
  });

  assert.equal(carousel.getState().manualPaused, true);
  assert.equal(scheduler.activeCount(), 0);

  carousel.toggleManualPause();
  assert.equal(carousel.getState().manualPaused, false);
  assert.equal(scheduler.activeCount(), 1);

  carousel.setReducedMotion(true);
  assert.equal(carousel.getState().manualPaused, true);
  assert.equal(scheduler.activeCount(), 0);
});

test("single-image carousel never autoplays and destroy clears active timers", () => {
  const singleScheduler = createFakeScheduler();
  const single = createHeroCarousel({
    length: 1,
    setIntervalFn: singleScheduler.setInterval,
    clearIntervalFn: singleScheduler.clearInterval,
  });
  assert.equal(singleScheduler.activeCount(), 0);
  single.next();
  assert.equal(single.getState().index, 0);

  const scheduler = createFakeScheduler();
  const carousel = createHeroCarousel({
    length: 2,
    setIntervalFn: scheduler.setInterval,
    clearIntervalFn: scheduler.clearInterval,
  });
  assert.equal(scheduler.activeCount(), 1);
  carousel.destroy();
  assert.equal(scheduler.activeCount(), 0);
  scheduler.tick();
  assert.equal(carousel.getState().index, 0);
});
