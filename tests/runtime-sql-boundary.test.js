import test from "node:test";
import assert from "node:assert/strict";

import { createGalleryRepository } from "../src/server/gallery-repository.js";
import { onRequest as publicImagesHandler } from "../functions/api/public/images.js";
import { onRequest as publicSiteHandler } from "../functions/api/public/site.js";
import { onRequest as publicTagsHandler } from "../functions/api/public/tags.js";
import { createTestDatabase } from "./helpers/test-database.js";

const FORBIDDEN_READ_SQL = /\b(PRAGMA|CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|REPLACE)\b/i;

function recordDatabase(database) {
  const statements = [];
  const wrapped = new Proxy(database, {
    get(target, property) {
      if (property === "prepare") {
        return (sql) => {
          statements.push(String(sql));
          return target.prepare(sql);
        };
      }
      if (property === "exec") {
        return (sql) => {
          statements.push(String(sql));
          return target.exec(sql);
        };
      }

      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  return { database: wrapped, statements };
}

function assertReadOnly(statements) {
  const forbidden = statements.filter((sql) => FORBIDDEN_READ_SQL.test(sql));
  assert.deepEqual(forbidden, [], `read path executed forbidden SQL:\n${forbidden.join("\n")}`);
}

function selectStatements(statements) {
  return statements.filter((sql) => /^\s*SELECT\b/i.test(sql));
}

test("public tags request executes only its business SELECT", async () => {
  const recorded = recordDatabase(createTestDatabase());
  const response = await publicTagsHandler({
    env: { GALLERY_DB: recorded.database },
    request: new Request("https://gallery.example/api/public/tags"),
  });

  assert.equal(response.status, 200);
  assertReadOnly(recorded.statements);
  assert.equal(selectStatements(recorded.statements).length, 1);
});

test("empty public image result executes one SELECT and no initialization", async () => {
  const recorded = recordDatabase(createTestDatabase());
  const response = await publicImagesHandler({
    env: { GALLERY_DB: recorded.database },
    request: new Request("https://gallery.example/api/public/images?tag=missing"),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { images: [] });
  assertReadOnly(recorded.statements);
  assert.equal(selectStatements(recorded.statements).length, 1);
});

test("non-empty public image result executes at most two SELECTs", async () => {
  const database = createTestDatabase();
  database.prepare("INSERT INTO tags (name, slug, sort_order) VALUES (?, ?, ?)").run("测试", "test", 1);
  database
    .prepare("INSERT INTO images (storage_key, file_name, file_url, width, height) VALUES (?, ?, ?, ?, ?)")
    .run("gallery/test.webp", "test.webp", "https://gallery.example/file/test.webp", 1920, 1080);
  database.prepare("INSERT INTO image_tags (image_id, tag_id) VALUES (?, ?)").run(1, 1);
  const recorded = recordDatabase(database);

  const response = await publicImagesHandler({
    env: { GALLERY_DB: recorded.database },
    request: new Request("https://gallery.example/api/public/images?tag=test"),
  });

  assert.equal(response.status, 200);
  assert.equal((await response.json()).images.length, 1);
  assertReadOnly(recorded.statements);
  assert.equal(selectStatements(recorded.statements).length, 2);
});

test("public site request is read-only", async () => {
  const recorded = recordDatabase(createTestDatabase());
  const response = await publicSiteHandler({
    env: { GALLERY_DB: recorded.database },
    request: new Request("https://gallery.example/api/public/site"),
  });

  assert.equal(response.status, 200);
  assertReadOnly(recorded.statements);
});

test("tag and category list methods never repair sort order while reading", async () => {
  const database = createTestDatabase();
  database.prepare("INSERT INTO tags (name, slug, sort_order) VALUES (?, ?, ?)").run("A", "a", 8);
  database.prepare("UPDATE categories SET sort_order = 9 WHERE directory_slug = ?").run("scenery");
  const recorded = recordDatabase(database);
  const repository = createGalleryRepository(recorded.database);

  const tags = await repository.listTags();
  const categories = await repository.listCategories();

  assert.equal(tags[0].sort_order, 8);
  assert.equal(categories.at(-1).sort_order, 9);
  assertReadOnly(recorded.statements);
  assert.equal(selectStatements(recorded.statements).length, 2);
});
