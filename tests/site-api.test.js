import test from "node:test";
import assert from "node:assert/strict";

import { createGalleryRepository } from "../src/server/gallery-repository.js";
import { onRequest as publicSiteHandler } from "../functions/api/public/site.js";
import { onRequest as adminSiteHandler } from "../functions/api/admin/site.js";
import { createTestDatabase } from "./helpers/test-database.js";

function createTestEnv() {
  return {
    GALLERY_DB: createTestDatabase(),
    GALLERY_ADMIN_KEY: "gallery-secret",
  };
}

async function createImage(repository, key, categoryId = null, dimensions = {}) {
  return await repository.upsertImage({
    storageKey: key,
    fileName: `${key}.webp`,
    fileUrl: `https://gallery.example.com/file/${key}.webp`,
    width: dimensions.width ?? 1920,
    height: dimensions.height ?? 1080,
    syncStatus: "ok",
    categoryId,
  });
}

test("public site handler returns defaults and empty featured list", async () => {
  const env = createTestEnv();
  const response = await publicSiteHandler({
    env,
    request: new Request("https://gallery.example.com/api/public/site"),
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.issueName, "图集");
  assert.match(payload.heroCopy, /慢慢看/);
  assert.equal(payload.issueCount, 0);
  assert.deepEqual(payload.featuredImages, []);
});

test("public site excludes ineligible members from the home album hero", async () => {
  const env = createTestEnv();
  const repository = createGalleryRepository(env.GALLERY_DB);
  const legacy = await createImage(repository, "legacy-wrong-ratio", null, {
    width: 1920,
    height: 1200,
  });
  env.GALLERY_DB
    .prepare("INSERT INTO album_images (album_id, image_id, sort_order) VALUES ((SELECT id FROM albums WHERE is_home = 1), ?, ?)")
    .run(legacy.id, 1);

  const response = await publicSiteHandler({
    env,
    request: new Request("https://gallery.example.com/api/public/site"),
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.featuredImages, []);
});

test("public home hero starts with the selected home album cover", async () => {
  const env = createTestEnv();
  const repository = createGalleryRepository(env.GALLERY_DB);
  const first = await createImage(repository, "cover-first");
  const cover = await createImage(repository, "cover-selected");
  const home = (await repository.listAlbums()).find((album) => album.isHome);

  await repository.updateAlbum(home.id, { imageIds: [first.id, cover.id], coverImageId: cover.id });

  const response = await publicSiteHandler({
    env,
    request: new Request("https://gallery.example.com/api/public/site"),
  });

  assert.deepEqual((await response.json()).featuredImages.map((image) => image.id), [cover.id, first.id]);
});

test("admin site handler requires auth", async () => {
  const env = createTestEnv();
  const response = await adminSiteHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/site"),
  });
  assert.equal(response.status, 401);
});

test("admin can patch site settings and featured order", async () => {
  const env = createTestEnv();
  const repository = createGalleryRepository(env.GALLERY_DB);
  const [category] = await repository.listCategories();
  const first = await createImage(repository, "a");
  const second = await createImage(repository, "b", category.id, {
    width: 1672,
    height: 941,
  });

  const response = await adminSiteHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/site", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-gallery-admin-key": "gallery-secret",
      },
      body: JSON.stringify({
        issueName: "红调侧光",
        heroCopy: "只留一句氛围。",
        featuredImageIds: [second.id, first.id],
      }),
    }),
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.issueName, "红调侧光");
  assert.equal(payload.heroCopy, "只留一句氛围。");
  assert.equal(payload.issueCount, 2);
  assert.deepEqual(payload.featuredImageIds, [second.id, first.id]);
  assert.deepEqual(payload.featuredImages.map((image) => image.id), [second.id, first.id]);
  assert.equal(payload.featuredImages[0].category.id, category.id);
  assert.equal(payload.featuredImages[0].featuredEligibility?.dimensions, "1672×941");
  assert.equal(payload.featuredImages[0].featuredEligibility?.isExactSixteenNine, false);
  assert.equal(payload.featuredImages[0].featuredEligibility?.isApproximatelySixteenNine, true);
  assert.equal(payload.featuredImages[0].featuredEligibility?.eligible, true);
  assert.equal(payload.featuredImages[0].featuredEligibility?.resolutionTier, "other");
  assert.equal(payload.featuredImages[0].featuredEligibility?.qualityLabel, "其他");
  assert.equal(payload.featuredImages[0].featuredEligibility?.reason, null);

  const publicResponse = await publicSiteHandler({
    env,
    request: new Request("https://gallery.example.com/api/public/site"),
  });
  const publicPayload = await publicResponse.json();
  assert.equal(publicPayload.issueName, "红调侧光");
  assert.equal(publicPayload.issueCount, 2);
  assert.deepEqual(publicPayload.featuredImages.map((image) => image.id), [second.id, first.id]);
  assert.equal(publicPayload.featuredImages[0].fileName, "b.webp");
  assert.equal("category" in publicPayload.featuredImages[0], false);
  assert.equal("featuredEligibility" in publicPayload.featuredImages[0], false);
});

test("admin site patch rejects unknown featured image ids", async () => {
  const env = createTestEnv();
  const repository = createGalleryRepository(env.GALLERY_DB);
  const image = await createImage(repository, "only");

  const response = await adminSiteHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/site", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-gallery-admin-key": "gallery-secret",
      },
      body: JSON.stringify({
        featuredImageIds: [image.id, 404],
      }),
    }),
  });

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.match(payload.error, /unknown image ids/);
});

test("admin site patch rolls back text when featured image validation fails", async () => {
  const env = createTestEnv();
  const repository = createGalleryRepository(env.GALLERY_DB);
  const image = await createImage(repository, "kept");
  await repository.updateSiteSettings({
    issueName: "原期名",
    heroCopy: "原文案",
  });
  await repository.setFeaturedImages([image.id]);

  const response = await adminSiteHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/site", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-gallery-admin-key": "gallery-secret",
      },
      body: JSON.stringify({
        issueName: "不应保存",
        heroCopy: "也不应保存",
        featuredImageIds: [image.id, 9999],
      }),
    }),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await repository.getSiteSettings(), {
    issueName: "原期名",
    heroCopy: "原文案",
  });
  assert.deepEqual(
    (await repository.listFeaturedImages()).map((featured) => featured.id),
    [image.id],
  );
});

test("admin site patch rejects ineligible featured images atomically", async () => {
  const env = createTestEnv();
  const repository = createGalleryRepository(env.GALLERY_DB);
  const selected = await createImage(repository, "selected-before-ineligible");
  const ineligible = await createImage(
    repository,
    "ineligible-ratio",
    null,
    { width: 1920, height: 1200 },
  );
  await repository.updateSiteSettings({
    issueName: "原期名",
    heroCopy: "原文案",
  });
  await repository.setFeaturedImages([selected.id]);

  const response = await adminSiteHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/site", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-gallery-admin-key": "gallery-secret",
      },
      body: JSON.stringify({
        issueName: "不应保存",
        heroCopy: "也不应保存",
        featuredImageIds: [ineligible.id],
      }),
    }),
  });

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.match(payload.error, /within 0\.5% of 16:9 and at least 1600x900/);
  assert.deepEqual(await repository.getSiteSettings(), {
    issueName: "原期名",
    heroCopy: "原文案",
  });
  assert.deepEqual(
    (await repository.listFeaturedImages()).map((image) => image.id),
    [selected.id],
  );
});

test("admin site patch rejects non-integer featured image ids without clearing selection", async () => {
  const env = createTestEnv();
  const repository = createGalleryRepository(env.GALLERY_DB);
  const image = await createImage(repository, "kept-invalid");
  await repository.setFeaturedImages([image.id]);

  const response = await adminSiteHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/site", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-gallery-admin-key": "gallery-secret",
      },
      body: JSON.stringify({ featuredImageIds: [image.id, "bad"] }),
    }),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(
    (await repository.listFeaturedImages()).map((featured) => featured.id),
    [image.id],
  );
});

test("admin site patch rejects duplicate featured image ids", async () => {
  const env = createTestEnv();
  const repository = createGalleryRepository(env.GALLERY_DB);
  const image = await createImage(repository, "kept-duplicate");
  await repository.setFeaturedImages([image.id]);

  const response = await adminSiteHandler({
    env,
    request: new Request("https://gallery.example.com/api/admin/site", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-gallery-admin-key": "gallery-secret",
      },
      body: JSON.stringify({ featuredImageIds: [image.id, image.id] }),
    }),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(
    (await repository.listFeaturedImages()).map((featured) => featured.id),
    [image.id],
  );
});

test("admin site patch rejects non-string text fields without mutating settings", async () => {
  for (const invalidBody of [
    { issueName: 42 },
    { heroCopy: { text: "not a string" } },
  ]) {
    const env = createTestEnv();
    const repository = createGalleryRepository(env.GALLERY_DB);
    await repository.updateSiteSettings({
      issueName: "原期名",
      heroCopy: "原文案",
    });

    const response = await adminSiteHandler({
      env,
      request: new Request("https://gallery.example.com/api/admin/site", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-gallery-admin-key": "gallery-secret",
        },
        body: JSON.stringify(invalidBody),
      }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await repository.getSiteSettings(), {
      issueName: "原期名",
      heroCopy: "原文案",
    });
  }
});
