import test from "node:test";
import assert from "node:assert/strict";

import { onRequest as adminAlbums } from "../functions/api/admin/albums.js";
import { onRequest as publicAlbums } from "../functions/api/public/albums.js";
import { createGalleryRepository } from "../src/server/gallery-repository.js";
import { createTestDatabase } from "./helpers/test-database.js";

function env() {
  return { GALLERY_DB: createTestDatabase(), GALLERY_ADMIN_KEY: "secret" };
}

function adminRequest(method = "GET", body) {
  return new Request("https://gallery.test/api/admin/albums", {
    method,
    headers: { "x-gallery-admin-key": "secret", "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

test("admin albums require auth and support create update delete", async () => {
  const state = env();
  assert.equal((await adminAlbums({ env: state, request: new Request("https://gallery.test/api/admin/albums") })).status, 401);

  const createdResponse = await adminAlbums({ env: state, request: adminRequest("POST", { name: "城市", description: "夜色" }) });
  assert.equal(createdResponse.status, 201);
  const created = (await createdResponse.json()).album;
  assert.equal(created.name, "城市");

  const updatedResponse = await adminAlbums({
    env: state,
    request: adminRequest("PATCH", { id: created.id, name: "新城市", description: "新夜色", isHome: true }),
  });
  assert.equal(updatedResponse.status, 200);
  const updated = (await updatedResponse.json()).album;
  assert.equal(updated.name, "新城市");
  assert.equal(updated.description, "新夜色");
  assert.equal(updated.isHome, true);

  const home = (await createGalleryRepository(state.GALLERY_DB).listAlbums()).find((album) => album.slug === "home");
  const deletedResponse = await adminAlbums({ env: state, request: adminRequest("DELETE", { id: home.id }) });
  assert.equal(deletedResponse.status, 200);
});

test("public albums expose safe summaries and ordered detail", async () => {
  const state = env();
  const repository = createGalleryRepository(state.GALLERY_DB);
  const album = await repository.createAlbum({ name: "风景", description: "山海之间" });
  const image = await repository.upsertImage({
    storageKey: "gallery/a.webp", fileName: "a.webp", fileUrl: "/file/gallery/a.webp",
    width: 1920, height: 1080, syncStatus: "ok",
  });
  await repository.updateAlbum(album.id, { imageIds: [image.id] });

  const listPayload = await (await publicAlbums({
    env: state,
    request: new Request("https://gallery.test/api/public/albums"),
  })).json();
  const summary = listPayload.albums.find((item) => item.slug === album.slug);
  assert.equal(summary.imageCount, 1);
  assert.equal("images" in summary, false);
  assert.equal(summary.coverImage.fileName, "a.webp");

  const detailResponse = await publicAlbums({
    env: state,
    request: new Request(`https://gallery.test/api/public/albums?slug=${album.slug}`),
  });
  assert.equal(detailResponse.status, 200);
  assert.deepEqual((await detailResponse.json()).album.images.map(({ id }) => id), [image.id]);
});

test("album cover changes persist through the admin API and public summary", async () => {
  const state = env();
  const repository = createGalleryRepository(state.GALLERY_DB);
  const album = await repository.createAlbum({ name: "封面测试" });
  const first = await repository.upsertImage({
    storageKey: "gallery/first.webp", fileName: "first.webp", fileUrl: "/file/gallery/first.webp",
    width: 1920, height: 1080, syncStatus: "ok",
  });
  const cover = await repository.upsertImage({
    storageKey: "gallery/cover.webp", fileName: "cover.webp", fileUrl: "/file/gallery/cover.webp",
    width: 1920, height: 1080, syncStatus: "ok",
  });

  const updateResponse = await adminAlbums({
    env: state,
    request: adminRequest("PATCH", {
      id: album.id,
      imageIds: [first.id, cover.id],
      coverImageId: cover.id,
    }),
  });
  assert.equal(updateResponse.status, 200);
  assert.equal((await updateResponse.json()).album.coverImageId, cover.id);

  const listPayload = await (await publicAlbums({
    env: state,
    request: new Request("https://gallery.test/api/public/albums"),
  })).json();
  assert.equal(listPayload.albums.find((item) => item.id === album.id).coverImage.id, cover.id);
});
