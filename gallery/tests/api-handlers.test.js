import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { createGalleryRepository } from "../src/server/gallery-repository.js";
import { onRequest as publicTagsHandler } from "../functions/api/public/tags.js";
import { onRequest as publicImagesHandler } from "../functions/api/public/images.js";
import { onRequest as adminTagsHandler } from "../functions/api/admin/tags.js";
import { onRequest as adminImagesHandler } from "../functions/api/admin/images.js";
import { onRequest as adminImportHandler } from "../functions/api/admin/images/import.js";
import { onRequest as adminUploadHandler } from "../functions/api/admin/images/upload.js";
import { onRequest as adminTagAssignmentsHandler } from "../functions/api/admin/images/tag-assignments.js";

function createTestEnv(options = {}) {
  const database = new DatabaseSync(":memory:");
  if (options.withSchema !== false) {
    const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
    database.exec(schema);
  }

  return {
    GALLERY_DB: database,
    GALLERY_ADMIN_KEY: "gallery-secret",
    IMGBED_BASE_URL: "https://imgbed.example.com",
    IMGBED_API_TOKEN: "imgbed-token",
  };
}

test("public tags handler bootstraps the schema when the database is empty", async () => {
  const env = createTestEnv({ withSchema: false });

  const response = await publicTagsHandler({
    env,
    request: new Request("https://gallery.example.com/api/public/tags"),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    tags: [],
  });
});

test("public tags handler returns visible ordered tags only", async () => {
  const env = createTestEnv();
  const repository = createGalleryRepository(env.GALLERY_DB);

  await repository.createTag({ name: "欧美美女", sortOrder: 3, isVisible: true });
  await repository.createTag({ name: "校园风情", sortOrder: 1, isVisible: true });
  await repository.createTag({ name: "隐藏分类", sortOrder: 0, isVisible: false });

  const response = await publicTagsHandler({
    env,
    request: new Request("https://gallery.example.com/api/public/tags"),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    tags: [
      { id: 2, name: "校园风情", slug: "校园风情", sortOrder: 1 },
      { id: 1, name: "欧美美女", slug: "欧美美女", sortOrder: 2 },
    ],
  });
});

test("public images handler returns images for the requested tag", async () => {
  const env = createTestEnv();
  const repository = createGalleryRepository(env.GALLERY_DB);
  const campus = await repository.createTag({ name: "校园风情", sortOrder: 1, isVisible: true });
  const japan = await repository.createTag({ name: "日本美女", sortOrder: 2, isVisible: true });

  const campusImage = await repository.upsertImage({
    imgbedFileId: "girls/campus-01.webp",
    fileName: "campus-01.webp",
    fileUrl: "https://imgbed.example.com/file/girls/campus-01.webp",
    width: 900,
    height: 1350,
    syncStatus: "ok",
  });
  const japanImage = await repository.upsertImage({
    imgbedFileId: "girls/japan-01.webp",
    fileName: "japan-01.webp",
    fileUrl: "https://imgbed.example.com/file/girls/japan-01.webp",
    width: 720,
    height: 1280,
    syncStatus: "ok",
  });

  await repository.replaceImageTags(campusImage.id, [campus.id]);
  await repository.replaceImageTags(japanImage.id, [japan.id]);

  const response = await publicImagesHandler({
    env,
    request: new Request("https://gallery.example.com/api/public/images?tag=%E6%A0%A1%E5%9B%AD%E9%A3%8E%E6%83%85"),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    images: [
      {
        id: campusImage.id,
        fileName: "campus-01.webp",
        fileUrl: "https://imgbed.example.com/file/girls/campus-01.webp",
        width: 900,
        height: 1350,
        tags: ["校园风情"],
      },
    ],
  });
});

test("admin tags handler creates tags when the admin key is valid", async () => {
  const env = createTestEnv();

  const response = await adminTagsHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/tags", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gallery-admin-key": "gallery-secret",
      },
      body: JSON.stringify({
        name: "田园景色",
        sortOrder: 1,
        isVisible: true,
      }),
    }),
  });

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    tag: {
      id: 1,
      name: "田园景色",
      slug: "田园景色",
      sortOrder: 1,
      isVisible: true,
    },
  });
});

test("admin tags handler rejects blank tag names", async () => {
  const env = createTestEnv();

  const response = await adminTagsHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/tags", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gallery-admin-key": "gallery-secret",
      },
      body: JSON.stringify({
        name: "   ",
      }),
    }),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "标签名称不能为空。",
  });
});

test("admin tags handler rejects duplicate tags with a conflict response", async () => {
  const env = createTestEnv();
  const repository = createGalleryRepository(env.GALLERY_DB);
  await repository.createTag({ name: "校园风情", sortOrder: 1, isVisible: true });

  const response = await adminTagsHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/tags", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gallery-admin-key": "gallery-secret",
      },
      body: JSON.stringify({
        name: "校园风情",
        sortOrder: 2,
        isVisible: true,
      }),
    }),
  });

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "标签已存在。",
  });
});

test("admin tags handler reorders tags into contiguous slots when sort order is updated", async () => {
  const env = createTestEnv();
  const repository = createGalleryRepository(env.GALLERY_DB);
  const first = await repository.createTag({ name: "tag-alpha", sortOrder: 1, isVisible: true });
  const second = await repository.createTag({ name: "tag-bravo", sortOrder: 2, isVisible: true });
  const third = await repository.createTag({ name: "tag-charlie", sortOrder: 3, isVisible: true });

  const response = await adminTagsHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/tags", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-gallery-admin-key": "gallery-secret",
      },
      body: JSON.stringify({
        id: third.id,
        sortOrder: 2,
      }),
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    tag: {
      id: third.id,
      name: "tag-charlie",
      slug: "tag-charlie",
      sortOrder: 2,
      isVisible: true,
    },
  });

  const listResponse = await adminTagsHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/tags", {
      headers: {
        "x-gallery-admin-key": "gallery-secret",
      },
    }),
  });

  assert.deepEqual((await listResponse.json()).tags, [
    { id: first.id, name: "tag-alpha", slug: "tag-alpha", sortOrder: 1, isVisible: true },
    { id: third.id, name: "tag-charlie", slug: "tag-charlie", sortOrder: 2, isVisible: true },
    { id: second.id, name: "tag-bravo", slug: "tag-bravo", sortOrder: 3, isVisible: true },
  ]);
});

test("admin tags handler updates tag fields when the admin key is valid", async () => {
  const env = createTestEnv();
  const repository = createGalleryRepository(env.GALLERY_DB);
  const tag = await repository.createTag({ name: "日本美女", sortOrder: 2, isVisible: true });

  const response = await adminTagsHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/tags", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-gallery-admin-key": "gallery-secret",
      },
      body: JSON.stringify({
        id: tag.id,
        name: "日系写真",
        sortOrder: 1,
        isVisible: false,
      }),
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    tag: {
      id: tag.id,
      name: "日系写真",
      slug: "日系写真",
      sortOrder: 1,
      isVisible: false,
    },
  });
});

test("admin tags handler deletes a tag when the admin key is valid", async () => {
  const env = createTestEnv();
  const repository = createGalleryRepository(env.GALLERY_DB);
  const tag = await repository.createTag({ name: "校园风情", sortOrder: 1, isVisible: true });

  const response = await adminTagsHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/tags", {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        "x-gallery-admin-key": "gallery-secret",
      },
      body: JSON.stringify({ id: tag.id }),
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    deletedTagId: tag.id,
  });

  const listResponse = await adminTagsHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/tags", {
      headers: {
        "x-gallery-admin-key": "gallery-secret",
      },
    }),
  });

  assert.deepEqual((await listResponse.json()).tags, []);
});

test("admin images handler returns an empty list on a fresh database", async () => {
  const env = createTestEnv({ withSchema: false });

  const response = await adminImagesHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/images", {
      headers: {
        "x-gallery-admin-key": "gallery-secret",
      },
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    images: [],
  });
});


test("admin images handler deletes a gallery image after ImgBed deletion succeeds", async () => {
  const calls = [];
  const env = {
    ...createTestEnv(),
    __FETCH: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ success: true }), {
        headers: { "content-type": "application/json" },
      });
    },
  };
  const repository = createGalleryRepository(env.GALLERY_DB);
  const image = await repository.upsertImage({
    imgbedFileId: "gallery/campus-01.webp",
    fileName: "campus-01.webp",
    fileUrl: "https://cdn.example.com/gallery/campus-01.webp",
    width: 900,
    height: 1350,
    syncStatus: "ok",
  });

  const response = await adminImagesHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/images", {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        "x-gallery-admin-key": "gallery-secret",
      },
      body: JSON.stringify({ imageId: image.id }),
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { deletedImageId: image.id });
  assert.match(calls[0].url, /\/api\/manage\/delete\/gallery%2Fcampus-01\.webp$/);

  const listResponse = await adminImagesHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/images", {
      headers: {
        "x-gallery-admin-key": "gallery-secret",
      },
    }),
  });

  assert.deepEqual(await listResponse.json(), { images: [] });
});

test("admin images handler renames a gallery image after ImgBed rename succeeds", async () => {
  const calls = [];
  const env = {
    ...createTestEnv(),
    __FETCH: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ success: true, newFileId: "gallery/campus-02.webp" }), {
        headers: { "content-type": "application/json" },
      });
    },
  };
  const repository = createGalleryRepository(env.GALLERY_DB);
  const image = await repository.upsertImage({
    imgbedFileId: "gallery/campus-01.webp",
    fileName: "campus-01.webp",
    fileUrl: "https://cdn.example.com/gallery/campus-01.webp",
    width: 900,
    height: 1350,
    syncStatus: "ok",
  });

  const response = await adminImagesHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/images", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-gallery-admin-key": "gallery-secret",
      },
      body: JSON.stringify({ imageId: image.id, fileName: "campus-02.webp" }),
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    image: {
      id: image.id,
      fileName: "campus-02.webp",
      fileUrl: "https://imgbed.example.com/file/gallery/campus-02.webp",
      width: 900,
      height: 1350,
      tags: [],
      syncStatus: "ok",
      note: null,
    },
  });
  assert.match(calls[0].url, /\/api\/manage\/rename\/gallery%2Fcampus-01\.webp$/);
  assert.deepEqual(JSON.parse(calls[0].init.body), { newFileId: "gallery/campus-02.webp" });
});

test("admin images handler moves a gallery image after ImgBed move succeeds", async () => {
  const calls = [];
  const env = {
    ...createTestEnv(),
    __FETCH: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ success: true, newFileId: "archive/campus-01.webp" }), {
        headers: { "content-type": "application/json" },
      });
    },
  };
  const repository = createGalleryRepository(env.GALLERY_DB);
  const image = await repository.upsertImage({
    imgbedFileId: "gallery/campus-01.webp",
    fileName: "campus-01.webp",
    fileUrl: "https://cdn.example.com/gallery/campus-01.webp",
    width: 900,
    height: 1350,
    syncStatus: "ok",
  });

  const response = await adminImagesHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/images", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-gallery-admin-key": "gallery-secret",
      },
      body: JSON.stringify({ imageId: image.id, directory: "archive" }),
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    image: {
      id: image.id,
      fileName: "campus-01.webp",
      fileUrl: "https://imgbed.example.com/file/archive/campus-01.webp",
      width: 900,
      height: 1350,
      tags: [],
      syncStatus: "ok",
      note: null,
    },
  });
  assert.match(calls[0].url, /\/api\/manage\/move\/gallery%2Fcampus-01\.webp\?dist=archive$/);
});

test("admin images handler keeps the record and marks sync failure when ImgBed move fails", async () => {
  const env = {
    ...createTestEnv(),
    __FETCH: async () =>
      new Response(JSON.stringify({ success: false, error: "cannot move" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
  };
  const repository = createGalleryRepository(env.GALLERY_DB);
  const image = await repository.upsertImage({
    imgbedFileId: "gallery/campus-01.webp",
    fileName: "campus-01.webp",
    fileUrl: "https://cdn.example.com/gallery/campus-01.webp",
    width: 900,
    height: 1350,
    syncStatus: "ok",
  });

  const response = await adminImagesHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/images", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-gallery-admin-key": "gallery-secret",
      },
      body: JSON.stringify({ imageId: image.id, directory: "archive" }),
    }),
  });

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    error: "\u5e95\u5c42\u6587\u4ef6\u79fb\u52a8\u5931\u8d25\uff0c\u56fe\u7247\u5df2\u6807\u8bb0\u4e3a\u5f85\u4fee\u590d\u3002",
    imageId: image.id,
  });

  const listResponse = await adminImagesHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/images", {
      headers: {
        "x-gallery-admin-key": "gallery-secret",
      },
    }),
  });

  assert.deepEqual(await listResponse.json(), {
    images: [
      {
        id: image.id,
        fileName: "campus-01.webp",
        fileUrl: "https://cdn.example.com/gallery/campus-01.webp",
        width: 900,
        height: 1350,
        tags: [],
        syncStatus: "move_failed",
        note: "\u5e95\u5c42\u6587\u4ef6\u79fb\u52a8\u5931\u8d25\uff0c\u56fe\u7247\u4ecd\u4fdd\u7559\u5728\u539f\u59cb\u76ee\u5f55\u4e2d\u3002",
      },
    ],
  });
});

test("admin images handler keeps the record and marks sync failure when ImgBed rename fails", async () => {
  const env = {
    ...createTestEnv(),
    __FETCH: async () =>
      new Response(JSON.stringify({ success: false, message: "cannot rename" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
  };
  const repository = createGalleryRepository(env.GALLERY_DB);
  const image = await repository.upsertImage({
    imgbedFileId: "gallery/campus-01.webp",
    fileName: "campus-01.webp",
    fileUrl: "https://cdn.example.com/gallery/campus-01.webp",
    width: 900,
    height: 1350,
    syncStatus: "ok",
  });

  const response = await adminImagesHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/images", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-gallery-admin-key": "gallery-secret",
      },
      body: JSON.stringify({ imageId: image.id, fileName: "campus-02.webp" }),
    }),
  });

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    error: "\u5e95\u5c42\u6587\u4ef6\u91cd\u547d\u540d\u5931\u8d25\uff0c\u56fe\u7247\u5df2\u6807\u8bb0\u4e3a\u5f85\u4fee\u590d\u3002",
    imageId: image.id,
  });

  const listResponse = await adminImagesHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/images", {
      headers: {
        "x-gallery-admin-key": "gallery-secret",
      },
    }),
  });

  assert.deepEqual(await listResponse.json(), {
    images: [
      {
        id: image.id,
        fileName: "campus-01.webp",
        fileUrl: "https://cdn.example.com/gallery/campus-01.webp",
        width: 900,
        height: 1350,
        tags: [],
        syncStatus: "rename_failed",
        note: "\u5e95\u5c42\u6587\u4ef6\u91cd\u547d\u540d\u5931\u8d25\uff0c\u56fe\u7247\u4ecd\u4fdd\u7559\u539f\u59cb\u6587\u4ef6\u540d\u3002",
      },
    ],
  });
});

test("admin images handler keeps the record and marks sync failure when ImgBed deletion fails", async () => {
  const env = {
    ...createTestEnv(),
    __FETCH: async () =>
      new Response(JSON.stringify({ success: false, error: "cannot delete" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
  };
  const repository = createGalleryRepository(env.GALLERY_DB);
  const image = await repository.upsertImage({
    imgbedFileId: "gallery/campus-01.webp",
    fileName: "campus-01.webp",
    fileUrl: "https://cdn.example.com/gallery/campus-01.webp",
    width: 900,
    height: 1350,
    syncStatus: "ok",
  });

  const response = await adminImagesHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/images", {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        "x-gallery-admin-key": "gallery-secret",
      },
      body: JSON.stringify({ imageId: image.id }),
    }),
  });

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    error: "底层文件删除失败，图片已标记为待修复。",
    imageId: image.id,
  });

  const listResponse = await adminImagesHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/images", {
      headers: {
        "x-gallery-admin-key": "gallery-secret",
      },
    }),
  });

  assert.deepEqual(await listResponse.json(), {
    images: [
      {
        id: image.id,
        fileName: "campus-01.webp",
        fileUrl: "https://cdn.example.com/gallery/campus-01.webp",
        width: 900,
        height: 1350,
        tags: [],
        syncStatus: "delete_failed",
        note: "底层文件删除失败，图片仍保留在资源库中。",
      },
    ],
  });
});

test("admin upload handler sends files to ImgBed and immediately maps selected tags", async () => {
  const calls = [];
  const env = {
    ...createTestEnv(),
    GALLERY_UPLOAD_CHANNEL: "cfr2",
    GALLERY_UPLOAD_NAME_TYPE: "short",
    __FETCH: async (url) => {
      calls.push(String(url));
      return new Response(
        JSON.stringify([
          {
            src: "/file/gallery/campus-01.webp",
            publicUrl: "https://cdn.example.com/gallery/campus-01.webp",
          },
        ]),
        { headers: { "content-type": "application/json" } },
      );
    },
  };
  const repository = createGalleryRepository(env.GALLERY_DB);
  const campus = await repository.createTag({ name: "校园风情", sortOrder: 1, isVisible: true });

  const formData = new FormData();
  formData.append("files", new File(["image-bytes"], "campus-01.webp", { type: "image/webp" }));
  formData.append("tagIds", JSON.stringify([campus.id]));
  formData.append("filesMeta", JSON.stringify([{ width: 900, height: 1350 }]));

  const response = await adminUploadHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/images/upload", {
      method: "POST",
      headers: {
        "x-gallery-admin-key": "gallery-secret",
      },
      body: formData,
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    uploadedCount: 1,
    images: [
      {
        id: 1,
        fileName: "campus-01.webp",
        fileUrl: "https://cdn.example.com/gallery/campus-01.webp",
        width: 900,
        height: 1350,
        tags: ["校园风情"],
      },
    ],
  });
  assert.match(calls[0], /uploadChannel=cfr2/);
  assert.match(calls[0], /uploadNameType=short/);
  assert.match(calls[0], /uploadFolder=gallery/);
});

test("admin images import handler upserts image records from ImgBed", async () => {
  const env = {
    ...createTestEnv(),
    __FETCH: async () =>
      new Response(
        JSON.stringify({
          files: [
            {
              name: "girls/japan-01.webp",
              metadata: {
                FileType: "image/webp",
                Width: 720,
                Height: 1280,
              },
            },
          ],
        }),
        { headers: { "content-type": "application/json" } },
      ),
  };

  const response = await adminImportHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/images/import", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gallery-admin-key": "gallery-secret",
      },
      body: JSON.stringify({ recursive: true }),
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    importedCount: 1,
  });

  const listResponse = await adminImagesHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/images", {
      headers: {
        "x-gallery-admin-key": "gallery-secret",
      },
    }),
  });

  assert.equal(listResponse.status, 200);
  assert.equal((await listResponse.json()).images.length, 1);
});

test("admin tag assignment handler rejects missing tag ids", async () => {
  const env = createTestEnv();
  const repository = createGalleryRepository(env.GALLERY_DB);
  const image = await repository.upsertImage({
    imgbedFileId: "girls/japan-01.webp",
    fileName: "japan-01.webp",
    fileUrl: "https://imgbed.example.com/file/girls/japan-01.webp",
    width: 720,
    height: 1280,
    syncStatus: "ok",
  });

  const response = await adminTagAssignmentsHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/images/tag-assignments", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gallery-admin-key": "gallery-secret",
      },
      body: JSON.stringify({
        imageId: image.id,
        tagIds: [999],
      }),
    }),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "?????????????????",
  });
});

test("admin tag assignment handler replaces image tag bindings", async () => {
  const env = createTestEnv();
  const repository = createGalleryRepository(env.GALLERY_DB);
  const campus = await repository.createTag({ name: "校园风情", sortOrder: 1, isVisible: true });
  const japan = await repository.createTag({ name: "日本美女", sortOrder: 2, isVisible: true });
  const image = await repository.upsertImage({
    imgbedFileId: "girls/japan-01.webp",
    fileName: "japan-01.webp",
    fileUrl: "https://imgbed.example.com/file/girls/japan-01.webp",
    width: 720,
    height: 1280,
    syncStatus: "ok",
  });

  const response = await adminTagAssignmentsHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/images/tag-assignments", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gallery-admin-key": "gallery-secret",
      },
      body: JSON.stringify({
        imageId: image.id,
        tagIds: [campus.id, japan.id],
      }),
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    imageId: image.id,
    tagIds: [campus.id, japan.id],
  });
});


