import test from "node:test";
import assert from "node:assert/strict";

import { createGalleryRepository } from "../src/server/gallery-repository.js";
import { createTestDatabase } from "./helpers/test-database.js";

async function image(repository, name) {
  return await repository.upsertImage({
    storageKey: `gallery/${name}.webp`,
    fileName: `${name}.webp`,
    fileUrl: `/file/gallery/${name}.webp`,
    width: 1920,
    height: 1080,
    syncStatus: "ok",
  });
}

test("albums keep ordered members and allow one image in multiple albums", async () => {
  const repository = createGalleryRepository(createTestDatabase());
  const first = await image(repository, "first");
  const second = await image(repository, "second");
  const home = (await repository.listAlbums())[0];
  const travel = await repository.createAlbum({ name: "旅行", description: "一路风景" });

  await repository.updateAlbum(home.id, { imageIds: [first.id], coverImageId: first.id });
  const updated = await repository.updateAlbum(travel.id, {
    imageIds: [second.id, first.id],
    coverImageId: second.id,
  });

  assert.deepEqual(updated.images.map(({ id }) => id), [second.id, first.id]);
  assert.equal(updated.coverImageId, second.id);
  assert.deepEqual((await repository.getAlbumById(home.id)).images.map(({ id }) => id), [first.id]);
});

test("setting a home album clears the previous home atomically", async () => {
  const repository = createGalleryRepository(createTestDatabase());
  const original = (await repository.listAlbums())[0];
  const next = await repository.createAlbum({ name: "新首页", description: "新的介绍" });

  await repository.updateAlbum(next.id, { isHome: true });
  const albums = await repository.listAlbums();

  assert.equal(albums.find((album) => album.id === original.id).isHome, false);
  assert.equal(albums.find((album) => album.id === next.id).isHome, true);
  assert.equal(albums.filter((album) => album.isHome).length, 1);
});

test("album updates reject duplicate members and repair invalid covers", async () => {
  const repository = createGalleryRepository(createTestDatabase());
  const first = await image(repository, "first");
  const second = await image(repository, "second");
  const album = await repository.createAlbum({ name: "测试图集" });

  await assert.rejects(
    repository.updateAlbum(album.id, { imageIds: [first.id, first.id] }),
    /duplicates/,
  );
  await assert.rejects(
    repository.updateAlbum(album.id, { imageIds: [first.id], coverImageId: second.id }),
    /cover image must belong/,
  );

  const updated = await repository.updateAlbum(album.id, {
    imageIds: [first.id, second.id],
    coverImageId: second.id,
  });
  const repaired = await repository.updateAlbum(album.id, { imageIds: [first.id] });
  assert.equal(updated.coverImageId, second.id);
  assert.equal(repaired.coverImageId, first.id);
});

test("home albums cannot be deleted and image deletion cleans album membership", async () => {
  const database = createTestDatabase();
  const repository = createGalleryRepository(database);
  const first = await image(repository, "first");
  const home = (await repository.listAlbums())[0];
  const other = await repository.createAlbum({ name: "可删除" });
  await repository.updateAlbum(other.id, { imageIds: [first.id] });

  await assert.rejects(repository.deleteAlbum(home.id), /home album/);
  assert.equal(await repository.deleteImage(first.id), true);
  assert.deepEqual((await repository.getAlbumById(other.id)).images, []);
  assert.equal(await repository.deleteAlbum(other.id), true);
});
