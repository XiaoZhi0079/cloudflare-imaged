import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { createAlbumManagementController } from "../public/assets/admin/album-management.js";

const moduleUrl = new URL("../public/assets/admin/album-management.js", import.meta.url);

test("album management controller owns multi-album operations", () => {
  assert.equal(existsSync(moduleUrl), true);
  const source = readFileSync(moduleUrl, "utf8");
  for (const contract of [
    "/api/admin/albums", "/api/admin/images", "createAlbumManagementController",
    "create-album", "save-album", "delete-album", "add-images",
    "move-up", "move-down", "remove", "coverImageId", "isHome",
    "轮播可用", "非轮播比例", "cover-image",
  ]) assert.match(source, new RegExp(contract));
});

class FakeElement {
  constructor() {
    this.listeners = new Map();
    this.disabled = false;
    this.value = "";
    this.checked = false;
    this.innerHTML = "";
    this.textContent = "";
    this.focused = false;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  async emit(type, event = {}) {
    const payload = { target: this, ...event };
    for (const listener of this.listeners.get(type) ?? []) {
      await listener(payload);
    }
  }

  focus() {
    this.focused = true;
  }
}

function album(id, name) {
  return {
    id,
    name,
    slug: `album-${id}`,
    description: `${name}介绍`,
    coverImageId: id * 10 + 1,
    isHome: id === 1,
    imageCount: 2,
    images: [
      { id: id * 10 + 1, fileName: `${name}-1.webp`, width: 1920, height: 1080, featuredEligibility: { eligible: true } },
      { id: id * 10 + 2, fileName: `${name}-2.webp`, width: 1920, height: 1080, featuredEligibility: { eligible: true } },
    ],
  };
}

function createHarness({ confirmResult = true } = {}) {
  const selectors = [
    "#album-list", "#album-name", "#album-description", "#album-cover",
    "#album-is-home", "#album-members", "#album-status",
    '[data-action="add-images"]', '[data-action="save-album"]', '[data-action="delete-album"]',
  ];
  const elements = Object.fromEntries(selectors.map((selector) => [selector, new FakeElement()]));
  elements.create = new FakeElement();
  const albums = [album(1, "首页"), album(2, "旅行")];
  const requests = [];
  const client = {
    async request(url, options = {}) {
      if (url === "/api/admin/albums" && !options.method) return { albums };
      if (url === "/api/admin/albums" && options.method === "PATCH") {
        const body = JSON.parse(options.body);
        requests.push(body);
        const current = albums.find((item) => item.id === body.id);
        return { album: { ...current, ...body, imageCount: body.imageIds.length } };
      }
      throw new Error(`Unexpected request: ${url} ${options.method ?? "GET"}`);
    },
  };
  const dialogs = {
    confirmCalls: 0,
    async confirm() {
      this.confirmCalls += 1;
      return confirmResult;
    },
  };
  const previousDocument = globalThis.document;
  globalThis.document = {
    querySelector(selector) {
      return selector === '[data-action="create-album"]' ? elements.create : null;
    },
  };
  const root = { querySelector: (selector) => elements[selector] };
  const controller = createAlbumManagementController({
    root,
    client,
    dialogs,
    notifier: { success() {}, error() {} },
  });
  controller.bind();
  return {
    albums,
    controller,
    dialogs,
    requests,
    elements: {
      list: elements["#album-list"],
      name: elements["#album-name"],
      description: elements["#album-description"],
      cover: elements["#album-cover"],
      isHome: elements["#album-is-home"],
      members: elements["#album-members"],
      status: elements["#album-status"],
      save: elements['[data-action="save-album"]'],
      delete: elements['[data-action="delete-album"]'],
    },
    restore() {
      globalThis.document = previousDocument;
    },
  };
}

test("album editor saves the current name description home state and cover", async () => {
  const harness = createHarness();
  try {
    await harness.controller.load();
    harness.elements.name.value = "新的首页名字";
    await harness.elements.name.emit("input");
    harness.elements.description.value = "新的图集介绍";
    await harness.elements.description.emit("input");
    harness.elements.isHome.checked = false;
    await harness.elements.isHome.emit("change");
    harness.elements.cover.value = "12";
    await harness.elements.cover.emit("change");

    await harness.elements.save.emit("click");

    assert.equal(harness.requests.length, 1);
    assert.deepEqual(
      {
        name: harness.requests[0].name,
        description: harness.requests[0].description,
        isHome: harness.requests[0].isHome,
        coverImageId: harness.requests[0].coverImageId,
      },
      { name: "新的首页名字", description: "新的图集介绍", isHome: false, coverImageId: 12 },
    );
  } finally {
    harness.restore();
  }
});

test("album editor marks the selected member as the persisted cover", async () => {
  const harness = createHarness();
  try {
    await harness.controller.load();
    harness.elements.cover.value = "12";
    await harness.elements.cover.emit("change");
    assert.match(harness.elements.members.innerHTML, /data-member-id="12"[^>]*>[\s\S]*cover-image/);
    await harness.elements.save.emit("click");

    assert.equal(harness.requests[0].coverImageId, 12);
    assert.match(harness.elements.members.innerHTML, /data-member-id="12"[^>]*>[\s\S]*cover-image/);
  } finally {
    harness.restore();
  }
});

test("album editor keeps unsaved metadata when member changes rerender the editor", async () => {
  const harness = createHarness();
  try {
    await harness.controller.load();
    harness.elements.name.value = "还没保存的新名字";
    await harness.elements.name.emit("input");
    await harness.elements.members.emit("click", {
      target: {
        closest(selector) {
          if (selector === "[data-action]") return { dataset: { action: "remove" } };
          if (selector === "[data-member-id]") return { dataset: { memberId: "11" } };
          return null;
        },
      },
    });

    assert.equal(harness.elements.name.value, "还没保存的新名字");
    assert.match(harness.elements.status.textContent, /未保存/);
  } finally {
    harness.restore();
  }
});

test("album editor confirms before discarding unsaved metadata on album switch", async () => {
  const harness = createHarness({ confirmResult: false });
  try {
    await harness.controller.load();
    harness.elements.description.value = "尚未保存的介绍";
    await harness.elements.description.emit("input");
    await harness.elements.list.emit("click", {
      target: { closest: () => ({ dataset: { albumId: "2" } }) },
    });

    assert.equal(harness.dialogs.confirmCalls, 1);
    assert.equal(harness.elements.description.value, "尚未保存的介绍");
  } finally {
    harness.restore();
  }
});

test("album editor keeps delete disabled while the persisted album is still the home album", async () => {
  const harness = createHarness();
  try {
    await harness.controller.load();
    harness.elements.isHome.checked = false;
    await harness.elements.isHome.emit("change");

    assert.equal(harness.elements.delete.disabled, true);
  } finally {
    harness.restore();
  }
});

test("album editor rejects a blank name before sending an update", async () => {
  const harness = createHarness();
  try {
    await harness.controller.load();
    harness.elements.name.value = "   ";
    await harness.elements.name.emit("input");
    await harness.elements.save.emit("click");

    assert.equal(harness.requests.length, 0);
    assert.match(harness.elements.status.textContent, /名字不能为空/);
    assert.equal(harness.elements.name.focused, true);
  } finally {
    harness.restore();
  }
});
