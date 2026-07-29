import test from "node:test";
import assert from "node:assert/strict";

import { createGalleryRepository } from "../src/server/gallery-repository.js";
import { createTestDatabase } from "./helpers/test-database.js";

function databaseWithInjectedRunFailure(database, matcher, failureNumber) {
  let matches = 0;
  return new Proxy(database, {
    get(target, property) {
      if (property === "prepare") {
        return (sql) => {
          const statement = target.prepare(sql);
          return new Proxy(statement, {
            get(statementTarget, statementProperty) {
              const value = Reflect.get(statementTarget, statementProperty, statementTarget);
              if (statementProperty !== "run" || typeof value !== "function") {
                return typeof value === "function" ? value.bind(statementTarget) : value;
              }
              return (...params) => {
                if (matcher.test(sql)) {
                  matches += 1;
                  if (matches === failureNumber) throw new Error("injected database failure");
                }
                return value.apply(statementTarget, params);
              };
            },
          });
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function fixture() {
  const database = createTestDatabase();
  const repository = createGalleryRepository(database);
  const tags = [
    await repository.createTag({ name: "标签一", sortOrder: 1, isVisible: true }),
    await repository.createTag({ name: "标签二", sortOrder: 2, isVisible: true }),
  ];
  const category = (await repository.listCategories())[0];
  return { database, repository, tags, category };
}

function uploadSessionInput({ category, tags, id = "6af0b175-3c6b-4a20-a1ab-52b77fbab671", storageKey = "gallery/atomic.png" }) {
  return {
    id,
    storageKey,
    fileName: storageKey.split("/").at(-1),
    fileUrl: `https://gallery.example.com/file/${storageKey}`,
    contentType: "image/png",
    fileSize: 123,
    width: 1920,
    height: 1080,
    categoryId: category.id,
    tagIds: tags.map((tag) => tag.id),
  };
}

test("replaceImageTags rolls back the complete tag set when one insert fails", async () => {
  const { database, repository, tags } = await fixture();
  const image = await repository.upsertImage({
    storageKey: "gallery/existing.png",
    fileName: "existing.png",
    fileUrl: "/file/gallery/existing.png",
    width: 1920,
    height: 1080,
    syncStatus: "ok",
  });
  await repository.replaceImageTags(image.id, [tags[0].id]);

  const failingRepository = createGalleryRepository(databaseWithInjectedRunFailure(
    database,
    /INSERT INTO image_tags/i,
    1,
  ));
  await assert.rejects(
    failingRepository.replaceImageTags(image.id, tags.map((tag) => tag.id)),
    /injected database failure/,
  );

  assert.deepEqual(await repository.getImageTagIds(image.id), [tags[0].id]);
});

test("one atomic batch replaces 100 heterogeneous image tag sets", async () => {
  const { database, repository, tags } = await fixture();
  const assignments = [];
  for (let index = 1; index <= 100; index += 1) {
    const image = await repository.upsertImage({
      storageKey: `gallery/batch-${index}.png`,
      fileName: `batch-${index}.png`,
      fileUrl: `/file/gallery/batch-${index}.png`,
      width: 1920,
      height: 1080,
      syncStatus: "ok",
    });
    assignments.push({
      imageId: image.id,
      tagIds: index % 2 === 0 ? [tags[0].id] : [tags[0].id, tags[1].id],
    });
  }

  const verified = await repository.replaceImageTagAssignments(assignments);
  assert.deepEqual(verified, assignments);

  const failingRepository = createGalleryRepository(databaseWithInjectedRunFailure(
    database,
    /INSERT INTO image_tags/i,
    1,
  ));
  const replacements = assignments.map((assignment) => ({
    imageId: assignment.imageId,
    tagIds: assignment.tagIds.length === 1 ? [tags[1].id] : [tags[0].id],
  }));
  await assert.rejects(
    failingRepository.replaceImageTagAssignments(replacements),
    /injected database failure/,
  );

  for (const assignment of assignments) {
    assert.deepEqual(await repository.getImageTagIds(assignment.imageId), assignment.tagIds);
  }
});

test("upload completion atomically creates the image and its full tag set", async () => {
  const { database, repository, tags, category } = await fixture();
  const input = uploadSessionInput({ category, tags });
  const reservation = await repository.reserveUploadSession(input);
  assert.equal(reservation.session.id, input.id);

  const failingRepository = createGalleryRepository(databaseWithInjectedRunFailure(
    database,
    /INSERT INTO image_tags/i,
    1,
  ));
  await assert.rejects(
    failingRepository.completeUploadSession(input.id),
    /injected database failure/,
  );

  assert.equal(await repository.getImageByStorageKey(input.storageKey), null);
  assert.equal((await repository.getUploadSessionById(input.id)).status, "pending");

  const completed = await repository.completeUploadSession(input.id);
  assert.deepEqual(completed.expectedTagIds, tags.map((tag) => tag.id));
  assert.deepEqual(completed.actualTagIds, tags.map((tag) => tag.id));
  assert.equal(completed.idempotent, false);

  const retried = await repository.completeUploadSession(input.id);
  assert.equal(retried.image.id, completed.image.id);
  assert.equal(retried.idempotent, true);
});

test("multi-session upload completion rolls back every image when tag insertion fails", async () => {
  const { database, repository, tags, category } = await fixture();
  const inputs = [
    uploadSessionInput({ category, tags, id: "11111111-1111-4111-8111-111111111111", storageKey: "gallery/chunk-a.png" }),
    uploadSessionInput({ category, tags, id: "22222222-2222-4222-8222-222222222222", storageKey: "gallery/chunk-b.png" }),
    uploadSessionInput({ category, tags, id: "33333333-3333-4333-8333-333333333333", storageKey: "gallery/chunk-c.png" }),
  ];
  for (const input of inputs) await repository.reserveUploadSession(input);

  const failingRepository = createGalleryRepository(databaseWithInjectedRunFailure(
    database,
    /INSERT INTO image_tags/i,
    1,
  ));
  await assert.rejects(
    failingRepository.completeUploadSessions(inputs.map((input) => input.id)),
    /injected database failure/,
  );

  for (const input of inputs) {
    assert.equal(await repository.getImageByStorageKey(input.storageKey), null);
    assert.equal((await repository.getUploadSessionById(input.id)).status, "pending");
  }
});

test("upload reservations reject another session targeting the same storage key", async () => {
  const { repository, tags, category } = await fixture();
  const firstInput = uploadSessionInput({ category, tags });
  await repository.reserveUploadSession(firstInput);

  const second = await repository.reserveUploadSession(uploadSessionInput({
    category,
    tags,
    id: "2f204b26-d2c7-46d0-95cb-8cad1176f639",
  }));

  assert.equal(second.session, null);
  assert.equal(second.storageSession.id, firstInput.id);
  assert.equal(second.existingImage, null);
});

test("batch upload reservation leaves no partial sessions when one storage key conflicts", async () => {
  const { repository, tags, category } = await fixture();
  const existing = uploadSessionInput({ category, tags });
  await repository.reserveUploadSession(existing);
  const conflict = uploadSessionInput({
    category,
    tags,
    id: "2f204b26-d2c7-46d0-95cb-8cad1176f639",
    storageKey: existing.storageKey,
  });
  const otherwiseValid = uploadSessionInput({
    category,
    tags,
    id: "33333333-3333-4333-8333-333333333333",
    storageKey: "gallery/otherwise-valid.png",
  });

  const reservations = await repository.reserveUploadSessions([conflict, otherwiseValid]);

  assert.equal(reservations[0].session, null);
  assert.equal(reservations[0].storageSession.id, existing.id);
  assert.equal(reservations[1].session, null);
  assert.equal(await repository.getUploadSessionById(otherwiseValid.id), null);
});

test("deleting a completed image releases its upload reservation", async () => {
  const { repository, tags, category } = await fixture();
  const input = uploadSessionInput({ category, tags });
  await repository.reserveUploadSession(input);
  const completed = await repository.completeUploadSession(input.id);

  assert.equal(await repository.deleteImage(completed.image.id), true);
  assert.equal(await repository.getUploadSessionById(input.id), null);

  const replacement = await repository.reserveUploadSession(uploadSessionInput({
    category,
    tags,
    id: "2f204b26-d2c7-46d0-95cb-8cad1176f639",
  }));
  assert.equal(replacement.session.id, "2f204b26-d2c7-46d0-95cb-8cad1176f639");
});

test("an expired pending reservation can be replaced safely", async () => {
  const { database, repository, tags, category } = await fixture();
  const input = uploadSessionInput({ category, tags });
  await repository.reserveUploadSession(input);
  database.prepare("UPDATE upload_sessions SET expires_at = datetime('now', '-1 minute') WHERE id = ?").run(input.id);

  const replacement = await repository.reserveUploadSession(uploadSessionInput({
    category,
    tags,
    id: "2f204b26-d2c7-46d0-95cb-8cad1176f639",
  }));
  assert.equal(replacement.session.id, "2f204b26-d2c7-46d0-95cb-8cad1176f639");
  assert.equal(await repository.getUploadSessionById(input.id), null);
});

test("an expired pending reservation releases its content hash for a different storage key", async () => {
  const { database, repository, tags, category } = await fixture();
  const contentSha256 = "c".repeat(64);
  const input = {
    ...uploadSessionInput({ category, tags }),
    contentSha256,
  };
  await repository.reserveUploadSession(input);
  database.prepare("UPDATE upload_sessions SET expires_at = datetime('now', '-1 minute') WHERE id = ?").run(input.id);

  const replacement = await repository.reserveUploadSession({
    ...uploadSessionInput({
      category,
      tags,
      id: "2f204b26-d2c7-46d0-95cb-8cad1176f639",
      storageKey: "gallery/replacement-content.png",
    }),
    contentSha256,
  });

  assert.equal(replacement.session.id, "2f204b26-d2c7-46d0-95cb-8cad1176f639");
  assert.equal(await repository.getUploadSessionById(input.id), null);
});
