import { normalizeTagName, slugifyTagName } from "../shared/tag-utils.js";
import { classifyFeaturedImage } from "../shared/featured-image-rules.js";

const DEFAULT_CATEGORIES = [
  { name: "性感美人", directorySlug: "sexy-beauty", sortOrder: 1 },
  { name: "气质美人", directorySlug: "elegant-beauty", sortOrder: 2 },
  { name: "风景", directorySlug: "scenery", sortOrder: 3 },
];

const DEFAULT_SITE_SETTINGS = {
  issue_name: "图集",
  hero_copy: "慢慢看，挑一份喜欢的气质。本期以红调与侧光为主，适合夜色、轮廓与留白。",
};

const SCHEMA_STATEMENTS = [
  `
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_visible INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      directory_slug TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      storage_key TEXT NOT NULL UNIQUE,
      file_name TEXT NOT NULL,
      file_url TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      sync_status TEXT NOT NULL DEFAULT 'ok',
      note TEXT,
      category_id INTEGER,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS image_tags (
      image_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (image_id, tag_id),
      FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS site_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS featured_images (
      image_id INTEGER PRIMARY KEY,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
    )
  `,
];

const MIGRATION_STATEMENTS = [
  `ALTER TABLE images ADD COLUMN category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL`,
];

const INDEX_STATEMENTS = [
  `CREATE INDEX IF NOT EXISTS idx_tags_visible_order ON tags(is_visible, sort_order, name)`,
  `CREATE INDEX IF NOT EXISTS idx_categories_order ON categories(sort_order, name)`,
  `CREATE INDEX IF NOT EXISTS idx_images_file_id ON images(storage_key)`,
  `CREATE INDEX IF NOT EXISTS idx_images_category_id ON images(category_id)`,
  `CREATE INDEX IF NOT EXISTS idx_image_tags_image_id ON image_tags(image_id)`,
  `CREATE INDEX IF NOT EXISTS idx_image_tags_tag_id ON image_tags(tag_id)`,
  `CREATE INDEX IF NOT EXISTS idx_featured_images_order ON featured_images(sort_order, image_id)`,
];

const SELECT_IMAGE_COLUMNS = `
  images.id,
  images.storage_key AS storageKey,
  images.file_name AS fileName,
  images.file_url AS fileUrl,
  images.width,
  images.height,
  images.sync_status AS syncStatus,
  images.note,
  categories.id AS categoryId,
  categories.name AS categoryName,
  categories.directory_slug AS categoryDirectorySlug,
  categories.sort_order AS categorySortOrder
`;

function bindStatement(database, sql, params) {
  const statement = database.prepare(sql);

  if (typeof statement.bind === "function") {
    return statement.bind(...params);
  }

  return {
    run: async () => statement.run(...params),
    all: async () => statement.all(...params),
    first: async () => statement.get(...params),
  };
}

async function run(database, sql, params = []) {
  return await bindStatement(database, sql, params).run();
}

async function runBatch(database, entries) {
  const statements = entries.map(({ sql, params }) => bindStatement(database, sql, params));
  if (typeof database.batch === "function") {
    return await database.batch(statements);
  }

  if (typeof database.exec !== "function") {
    throw new Error("Database does not support atomic batches");
  }

  database.exec("BEGIN");
  try {
    const results = [];
    for (const statement of statements) {
      results.push(await statement.run());
    }
    database.exec("COMMIT");
    return results;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function toPlainRecord(row) {
  return row && typeof row === "object" ? { ...row } : row;
}

function toPlainRows(rows) {
  return Array.isArray(rows) ? rows.map(toPlainRecord) : rows;
}

async function all(database, sql, params = []) {
  const result = await bindStatement(database, sql, params).all();
  const rows = Array.isArray(result?.results) ? result.results : result;

  return toPlainRows(rows);
}

async function first(database, sql, params = []) {
  const result = await bindStatement(database, sql, params).first();

  return result ? toPlainRecord(result) : null;
}

function mapImageRow(row) {
  const image = {
    id: row.id,
    storageKey: row.storageKey,
    fileName: row.fileName,
    fileUrl: row.fileUrl,
    width: row.width,
    height: row.height,
    syncStatus: row.syncStatus,
    note: row.note ?? null,
  };

  if (Number.isInteger(Number(row.categoryId)) && Number(row.categoryId) > 0) {
    image.category = {
      id: Number(row.categoryId),
      name: row.categoryName,
      directorySlug: row.categoryDirectorySlug,
      sortOrder: Number(row.categorySortOrder ?? 0),
    };
  }

  return image;
}

async function getImageTagRows(database, imageIds) {
  if (imageIds.length === 0) {
    return [];
  }

  const placeholders = imageIds.map(() => "?").join(", ");

  return await all(
    database,
    `
      SELECT image_tags.image_id, tags.name
      FROM image_tags
      INNER JOIN tags ON tags.id = image_tags.tag_id
      WHERE image_tags.image_id IN (${placeholders})
      ORDER BY tags.sort_order ASC, tags.name ASC
    `,
    imageIds,
  );
}

function attachTagNames(images, tagRows) {
  const namesByImageId = new Map();

  for (const row of tagRows) {
    const current = namesByImageId.get(row.image_id) ?? [];
    current.push(row.name);
    namesByImageId.set(row.image_id, current);
  }

  return images.map((image) => ({
    ...image,
    tags: namesByImageId.get(image.id) ?? [],
  }));
}

async function getTagById(database, tagId) {
  return await first(
    database,
    `
      SELECT id, name, slug, sort_order, is_visible
      FROM tags
      WHERE id = ?
    `,
    [tagId],
  );
}

async function getCategoryById(database, categoryId) {
  return await first(
    database,
    `
      SELECT id, name, directory_slug, sort_order
      FROM categories
      WHERE id = ?
    `,
    [categoryId],
  );
}

async function getExistingTagIds(database, tagIds) {
  if (tagIds.length === 0) {
    return [];
  }

  const placeholders = tagIds.map(() => "?").join(", ");
  const rows = await all(
    database,
    `
      SELECT id
      FROM tags
      WHERE id IN (${placeholders})
    `,
    tagIds,
  );

  return rows.map((row) => Number(row.id)).filter(Number.isInteger);
}

async function listTagsOrdered(database) {
  return await all(
    database,
    `
      SELECT id, name, slug, sort_order, is_visible
      FROM tags
      ORDER BY sort_order ASC, name ASC, id ASC
    `,
  );
}

async function listCategoriesOrdered(database) {
  return await all(
    database,
    `
      SELECT id, name, directory_slug, sort_order
      FROM categories
      ORDER BY sort_order ASC, name ASC, id ASC
    `,
  );
}

function clampTagPosition(sortOrder, maxPosition, fallbackPosition = maxPosition) {
  const boundedMax = Math.max(1, maxPosition);
  const normalizedFallback = Math.min(Math.max(fallbackPosition, 1), boundedMax);
  const numeric = Number(sortOrder);

  if (!Number.isInteger(numeric) || numeric <= 0) {
    return normalizedFallback;
  }

  return Math.min(Math.max(numeric, 1), boundedMax);
}

function clampCategoryPosition(sortOrder, maxPosition, fallbackPosition = maxPosition) {
  const boundedMax = Math.max(1, maxPosition);
  const normalizedFallback = Math.min(Math.max(fallbackPosition, 1), boundedMax);
  const numeric = Number(sortOrder);

  if (!Number.isInteger(numeric) || numeric <= 0) {
    return normalizedFallback;
  }

  return Math.min(Math.max(numeric, 1), boundedMax);
}

async function applyContiguousTagOrder(database, orderedTags) {
  for (let index = 0; index < orderedTags.length; index += 1) {
    const tag = orderedTags[index];
    const nextSortOrder = index + 1;

    if (Number(tag.sort_order) !== nextSortOrder) {
      await run(
        database,
        `
          UPDATE tags
          SET sort_order = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        [nextSortOrder, tag.id],
      );
    }

    tag.sort_order = nextSortOrder;
  }

  return orderedTags;
}

async function applyContiguousCategoryOrder(database, orderedCategories) {
  for (let index = 0; index < orderedCategories.length; index += 1) {
    const category = orderedCategories[index];
    const nextSortOrder = index + 1;

    if (Number(category.sort_order) !== nextSortOrder) {
      await run(
        database,
        `
          UPDATE categories
          SET sort_order = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        [nextSortOrder, category.id],
      );
    }

    category.sort_order = nextSortOrder;
  }

  return orderedCategories;
}

async function normalizeTagSortOrders(database) {
  return await applyContiguousTagOrder(database, await listTagsOrdered(database));
}

async function normalizeCategorySortOrders(database) {
  return await applyContiguousCategoryOrder(database, await listCategoriesOrdered(database));
}

function recordsInSubmittedOrder(records, orderedIds) {
  const recordsById = new Map(records.map((record) => [Number(record.id), record]));
  const submittedIds = orderedIds.map(Number);
  const uniqueIds = new Set(submittedIds);

  if (
    submittedIds.length !== records.length
    || uniqueIds.size !== records.length
    || submittedIds.some((id) => !recordsById.has(id))
  ) {
    throw new RangeError("incomplete order");
  }

  return submittedIds.map((id) => recordsById.get(id));
}

async function applyExactOrder(database, table, records) {
  await runBatch(
    database,
    records.map((record, index) => ({
      sql: `
        UPDATE ${table}
        SET sort_order = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      params: [index + 1, record.id],
    })),
  );

  return records.map((record, index) => ({
    ...record,
    sort_order: index + 1,
  }));
}

function normalizeCategoryName(name) {
  return String(name ?? "").trim();
}

function normalizeCategoryDirectorySlug(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function seedDefaultCategories(database) {
  for (const category of DEFAULT_CATEGORIES) {
    await run(
      database,
      `
        INSERT INTO categories (name, directory_slug, sort_order)
        VALUES (?, ?, ?)
        ON CONFLICT DO NOTHING
      `,
      [category.name, category.directorySlug, category.sortOrder],
    );
  }
}

async function seedDefaultSiteSettings(database) {
  for (const [key, value] of Object.entries(DEFAULT_SITE_SETTINGS)) {
    await run(
      database,
      `
        INSERT INTO site_settings (key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO NOTHING
      `,
      [key, value],
    );
  }
}

function mapSiteSettings(rows) {
  const values = new Map((rows ?? []).map((row) => [row.key, row.value]));

  return {
    issueName: String(values.get("issue_name") ?? DEFAULT_SITE_SETTINGS.issue_name),
    heroCopy: String(values.get("hero_copy") ?? DEFAULT_SITE_SETTINGS.hero_copy),
  };
}

function siteSettingUpsertEntry(key, value) {
  return {
    sql: `
      INSERT INTO site_settings (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP
    `,
    params: [key, value],
  };
}

function validateFeaturedImageIds(value) {
  if (!Array.isArray(value)) {
    throw new TypeError("featuredImageIds must be an array");
  }

  if (value.some((imageId) => !Number.isInteger(imageId) || imageId <= 0)) {
    throw new RangeError("featuredImageIds must contain positive integers");
  }

  if (new Set(value).size !== value.length) {
    throw new RangeError("featuredImageIds must not contain duplicates");
  }

  return [...value];
}

export function createGalleryRepository(database) {
  let schemaReady;

  async function ensureSchema() {
    if (!schemaReady) {
      schemaReady = (async () => {
        try {
          await run(database, `PRAGMA foreign_keys = ON`);
        } catch {
          // Some database adapters may not support PRAGMA.
        }

        for (const statement of SCHEMA_STATEMENTS) {
          await run(database, statement);
        }

        for (const statement of MIGRATION_STATEMENTS) {
          try {
            await run(database, statement);
          } catch (error) {
            const message = String(error?.message ?? "").toLowerCase();
            if (!message.includes("duplicate column name")) {
              throw error;
            }
          }
        }

        for (const statement of INDEX_STATEMENTS) {
          await run(database, statement);
        }

        await seedDefaultCategories(database);
        await seedDefaultSiteSettings(database);
      })();
    }

    await schemaReady;
  }

  async function assertEligibleFeaturedImages(imageIds) {
    if (imageIds.length === 0) {
      return;
    }

    const placeholders = imageIds.map(() => "?").join(", ");
    const rows = await all(
      database,
      `SELECT id, width, height FROM images WHERE id IN (${placeholders})`,
      imageIds,
    );
    const rowsById = new Map(rows.map((row) => [Number(row.id), row]));
    const missingIds = imageIds.filter((imageId) => !rowsById.has(imageId));
    if (missingIds.length > 0) {
      throw new RangeError(`unknown image ids: ${missingIds.join(", ")}`);
    }

    const invalidIds = imageIds.filter(
      (imageId) => !classifyFeaturedImage(rowsById.get(imageId)).eligible,
    );
    if (invalidIds.length > 0) {
      throw new RangeError(
        `featured images must be exact 16:9 and at least 1920x1080: ${invalidIds.join(", ")}`,
      );
    }
  }

  return {
    async getSiteSettings() {
      await ensureSchema();
      const rows = await all(database, `SELECT key, value FROM site_settings`);
      return mapSiteSettings(rows);
    },

    async updateSiteSettings(changes = {}) {
      await ensureSchema();

      const nextIssueName = changes.issueName === undefined
        ? undefined
        : String(changes.issueName ?? "").trim();
      const nextHeroCopy = changes.heroCopy === undefined
        ? undefined
        : String(changes.heroCopy ?? "").trim();

      if (nextIssueName !== undefined && !nextIssueName) {
        throw new RangeError("issueName is required");
      }
      if (nextHeroCopy !== undefined && !nextHeroCopy) {
        throw new RangeError("heroCopy is required");
      }

      const entries = [];
      if (nextIssueName !== undefined) {
        entries.push(siteSettingUpsertEntry("issue_name", nextIssueName));
      }
      if (nextHeroCopy !== undefined) {
        entries.push(siteSettingUpsertEntry("hero_copy", nextHeroCopy));
      }
      if (entries.length > 0) {
        await runBatch(database, entries);
      }

      return await this.getSiteSettings();
    },

    async updateSiteConfiguration(changes = {}) {
      await ensureSchema();

      const hasIssueName = changes.issueName !== undefined;
      const hasHeroCopy = changes.heroCopy !== undefined;
      const hasFeaturedImages = changes.featuredImageIds !== undefined;

      if (hasIssueName && typeof changes.issueName !== "string") {
        throw new TypeError("issueName must be a string");
      }
      if (hasHeroCopy && typeof changes.heroCopy !== "string") {
        throw new TypeError("heroCopy must be a string");
      }

      const issueName = hasIssueName ? String(changes.issueName ?? "").trim() : undefined;
      const heroCopy = hasHeroCopy ? String(changes.heroCopy ?? "").trim() : undefined;

      if (hasIssueName && !issueName) {
        throw new RangeError("issueName is required");
      }
      if (hasHeroCopy && !heroCopy) {
        throw new RangeError("heroCopy is required");
      }

      const featuredImageIds = hasFeaturedImages
        ? validateFeaturedImageIds(changes.featuredImageIds)
        : undefined;

      if (hasFeaturedImages) {
        await assertEligibleFeaturedImages(featuredImageIds);
      }

      const entries = [];
      if (hasIssueName) {
        entries.push(siteSettingUpsertEntry("issue_name", issueName));
      }
      if (hasHeroCopy) {
        entries.push(siteSettingUpsertEntry("hero_copy", heroCopy));
      }
      if (hasFeaturedImages) {
        entries.push({ sql: `DELETE FROM featured_images`, params: [] });
        featuredImageIds.forEach((imageId, index) => {
          entries.push({
            sql: `INSERT INTO featured_images (image_id, sort_order) VALUES (?, ?)`,
            params: [imageId, index + 1],
          });
        });
      }

      if (entries.length > 0) {
        await runBatch(database, entries);
      }

      return {
        ...(await this.getSiteSettings()),
        featuredImages: await this.listFeaturedImages(),
      };
    },

    async listFeaturedImages() {
      await ensureSchema();

      const imageRows = await all(
        database,
        `
          SELECT ${SELECT_IMAGE_COLUMNS}
          FROM featured_images
          INNER JOIN images ON images.id = featured_images.image_id
          LEFT JOIN categories ON categories.id = images.category_id
          ORDER BY featured_images.sort_order ASC, featured_images.image_id ASC
        `,
      );

      const images = imageRows.map(mapImageRow);
      return attachTagNames(images, await getImageTagRows(database, images.map((image) => image.id)));
    },

    async setFeaturedImages(imageIds = []) {
      await ensureSchema();

      const orderedIds = [];
      const seen = new Set();

      for (const value of imageIds) {
        const imageId = Number(value);
        if (!Number.isInteger(imageId) || imageId <= 0 || seen.has(imageId)) {
          continue;
        }
        seen.add(imageId);
        orderedIds.push(imageId);
      }

      await assertEligibleFeaturedImages(orderedIds);

      await run(database, `DELETE FROM featured_images`);

      for (let index = 0; index < orderedIds.length; index += 1) {
        await run(
          database,
          `
            INSERT INTO featured_images (image_id, sort_order)
            VALUES (?, ?)
          `,
          [orderedIds[index], index + 1],
        );
      }

      return await this.listFeaturedImages();
    },

    async createTag({ name, sortOrder = 0, isVisible = true }) {
      await ensureSchema();

      const normalizedName = normalizeTagName(name);
      const slug = slugifyTagName(normalizedName);
      const orderedTags = await normalizeTagSortOrders(database);
      const targetPosition = clampTagPosition(sortOrder, orderedTags.length + 1, orderedTags.length + 1);

      await run(
        database,
        `
          INSERT INTO tags (name, slug, sort_order, is_visible)
          VALUES (?, ?, ?, ?)
        `,
        [normalizedName, slug, targetPosition, isVisible ? 1 : 0],
      );

      const created = await first(
        database,
        `
          SELECT id, name, slug, sort_order, is_visible
          FROM tags
          WHERE slug = ?
        `,
        [slug],
      );

      orderedTags.splice(targetPosition - 1, 0, created);
      await applyContiguousTagOrder(database, orderedTags);

      return await getTagById(database, created.id);
    },

    async updateTag(tagId, changes) {
      await ensureSchema();

      const current = await getTagById(database, tagId);
      if (!current) {
        return null;
      }

      const orderedTags = await normalizeTagSortOrders(database);
      const currentIndex = orderedTags.findIndex((tag) => Number(tag.id) === Number(tagId));
      const currentPosition = currentIndex === -1 ? Number(current.sort_order) || 1 : currentIndex + 1;
      const normalizedName = changes.name === undefined ? current.name : normalizeTagName(changes.name);
      const slug = changes.name === undefined ? current.slug : slugifyTagName(normalizedName);
      const targetPosition = changes.sortOrder === undefined
        ? currentPosition
        : clampTagPosition(changes.sortOrder, orderedTags.length, currentPosition);
      const isVisible = changes.isVisible === undefined ? Number(current.is_visible) : changes.isVisible ? 1 : 0;

      await run(
        database,
        `
          UPDATE tags
          SET name = ?, slug = ?, sort_order = ?, is_visible = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        [normalizedName, slug, currentPosition, isVisible, tagId],
      );

      const updated = await getTagById(database, tagId);
      const reorderedTags = orderedTags.filter((tag) => Number(tag.id) !== Number(tagId));
      reorderedTags.splice(targetPosition - 1, 0, updated);
      await applyContiguousTagOrder(database, reorderedTags);

      return await getTagById(database, tagId);
    },

    async deleteTag(tagId) {
      await ensureSchema();

      const current = await getTagById(database, tagId);
      if (!current) {
        return false;
      }

      await run(database, `DELETE FROM image_tags WHERE tag_id = ?`, [tagId]);
      await run(database, `DELETE FROM tags WHERE id = ?`, [tagId]);
      await normalizeTagSortOrders(database);

      return true;
    },

    async listTags() {
      await ensureSchema();
      await normalizeTagSortOrders(database);
      return await listTagsOrdered(database);
    },

    async reorderTags(orderedIds) {
      await ensureSchema();
      const records = recordsInSubmittedOrder(await listTagsOrdered(database), orderedIds);
      await applyExactOrder(database, "tags", records);
      return await listTagsOrdered(database);
    },

    async listVisibleTags() {
      await ensureSchema();
      await normalizeTagSortOrders(database);

      return await all(
        database,
        `
          SELECT id, name, slug, sort_order, is_visible
          FROM tags
          WHERE is_visible = 1
          ORDER BY sort_order ASC, name ASC, id ASC
        `,
      );
    },

    async getExistingTagIds(tagIds) {
      await ensureSchema();
      return await getExistingTagIds(database, tagIds);
    },

    async listCategories() {
      await ensureSchema();
      await normalizeCategorySortOrders(database);
      return await listCategoriesOrdered(database);
    },

    async reorderCategories(orderedIds) {
      await ensureSchema();
      const records = recordsInSubmittedOrder(await listCategoriesOrdered(database), orderedIds);
      await applyExactOrder(database, "categories", records);
      return await listCategoriesOrdered(database);
    },

    async getCategoryById(categoryId) {
      await ensureSchema();
      return await getCategoryById(database, categoryId);
    },

    async createCategory({ name, directorySlug, sortOrder = 0 }) {
      await ensureSchema();

      const normalizedName = normalizeCategoryName(name);
      const normalizedDirectorySlug = normalizeCategoryDirectorySlug(directorySlug);
      const orderedCategories = await normalizeCategorySortOrders(database);
      const targetPosition = clampCategoryPosition(sortOrder, orderedCategories.length + 1, orderedCategories.length + 1);

      await run(
        database,
        `
          INSERT INTO categories (name, directory_slug, sort_order)
          VALUES (?, ?, ?)
        `,
        [normalizedName, normalizedDirectorySlug, targetPosition],
      );

      const created = await first(
        database,
        `
          SELECT id, name, directory_slug, sort_order
          FROM categories
          WHERE directory_slug = ?
        `,
        [normalizedDirectorySlug],
      );

      orderedCategories.splice(targetPosition - 1, 0, created);
      await applyContiguousCategoryOrder(database, orderedCategories);

      return await getCategoryById(database, created.id);
    },

    async updateCategory(categoryId, changes) {
      await ensureSchema();

      const current = await getCategoryById(database, categoryId);
      if (!current) {
        return null;
      }

      const orderedCategories = await normalizeCategorySortOrders(database);
      const currentIndex = orderedCategories.findIndex((category) => Number(category.id) === Number(categoryId));
      const currentPosition = currentIndex === -1 ? Number(current.sort_order) || 1 : currentIndex + 1;
      const normalizedName = changes.name === undefined ? current.name : normalizeCategoryName(changes.name);
      const targetPosition = changes.sortOrder === undefined
        ? currentPosition
        : clampCategoryPosition(changes.sortOrder, orderedCategories.length, currentPosition);

      await run(
        database,
        `
          UPDATE categories
          SET name = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        [normalizedName, currentPosition, categoryId],
      );

      const updated = await getCategoryById(database, categoryId);
      const reorderedCategories = orderedCategories.filter((category) => Number(category.id) !== Number(categoryId));
      reorderedCategories.splice(targetPosition - 1, 0, updated);
      await applyContiguousCategoryOrder(database, reorderedCategories);

      return await getCategoryById(database, categoryId);
    },

    async upsertImage({ storageKey, fileName, fileUrl, width, height, syncStatus, note = null, categoryId = null }) {
      await ensureSchema();

      await run(
        database,
        `
          INSERT INTO images (storage_key, file_name, file_url, width, height, sync_status, note, category_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(storage_key) DO UPDATE SET
            file_name = excluded.file_name,
            file_url = excluded.file_url,
            width = excluded.width,
            height = excluded.height,
            sync_status = excluded.sync_status,
            note = excluded.note,
            category_id = excluded.category_id,
            updated_at = CURRENT_TIMESTAMP
        `,
        [storageKey, fileName, fileUrl, width ?? null, height ?? null, syncStatus ?? "ok", note, categoryId ?? null],
      );

      return await first(
        database,
        `
          SELECT ${SELECT_IMAGE_COLUMNS}
          FROM images
          LEFT JOIN categories ON categories.id = images.category_id
          WHERE images.storage_key = ?
        `,
        [storageKey],
      ).then((row) => (row ? mapImageRow(row) : null));
    },

    async getImageById(imageId) {
      await ensureSchema();

      const image = await first(
        database,
        `
          SELECT ${SELECT_IMAGE_COLUMNS}
          FROM images
          LEFT JOIN categories ON categories.id = images.category_id
          WHERE images.id = ?
        `,
        [imageId],
      );

      if (!image) {
        return null;
      }

      return attachTagNames([mapImageRow(image)], await getImageTagRows(database, [image.id]))[0];
    },

    async listImages() {
      await ensureSchema();

      const imageRows = await all(
        database,
        `
          SELECT ${SELECT_IMAGE_COLUMNS}
          FROM images
          LEFT JOIN categories ON categories.id = images.category_id
          ORDER BY images.created_at DESC, images.id DESC
        `,
      );

      const images = imageRows.map(mapImageRow);
      return attachTagNames(images, await getImageTagRows(database, images.map((image) => image.id)));
    },

    async updateImage(imageId, changes) {
      await ensureSchema();

      const current = await this.getImageById(imageId);
      if (!current) {
        return null;
      }

      await run(
        database,
        `
          UPDATE images
          SET storage_key = ?,
              file_name = ?,
              file_url = ?,
              width = ?,
              height = ?,
              sync_status = ?,
              note = ?,
              category_id = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        [
          changes.storageKey ?? current.storageKey,
          changes.fileName ?? current.fileName,
          changes.fileUrl ?? current.fileUrl,
          changes.width ?? current.width ?? null,
          changes.height ?? current.height ?? null,
          changes.syncStatus ?? current.syncStatus ?? "ok",
          changes.note === undefined ? current.note ?? null : changes.note,
          changes.categoryId === undefined ? current.category?.id ?? null : changes.categoryId,
          imageId,
        ],
      );

      return await this.getImageById(imageId);
    },

    async updateImageSyncState(imageId, { syncStatus, note = null }) {
      await ensureSchema();

      await run(
        database,
        `
          UPDATE images
          SET sync_status = ?, note = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        [syncStatus, note, imageId],
      );

      return await this.getImageById(imageId);
    },

    async deleteImage(imageId) {
      await ensureSchema();

      await run(database, `DELETE FROM image_tags WHERE image_id = ?`, [imageId]);
      await run(database, `DELETE FROM featured_images WHERE image_id = ?`, [imageId]);
      const result = await run(database, `DELETE FROM images WHERE id = ?`, [imageId]);

      return Number(result?.meta?.changes ?? result?.changes ?? 0) > 0;
    },

    async replaceImageTags(imageId, tagIds) {
      await ensureSchema();

      await run(database, `DELETE FROM image_tags WHERE image_id = ?`, [imageId]);

      for (const tagId of tagIds) {
        await run(
          database,
          `
            INSERT INTO image_tags (image_id, tag_id)
            VALUES (?, ?)
          `,
          [imageId, tagId],
        );
      }
    },

    async listImagesByTagSlug(tagSlug) {
      await ensureSchema();

      const imageRows = await all(
        database,
        `
          SELECT DISTINCT ${SELECT_IMAGE_COLUMNS}
          FROM images
          LEFT JOIN categories ON categories.id = images.category_id
          INNER JOIN image_tags ON image_tags.image_id = images.id
          INNER JOIN tags ON tags.id = image_tags.tag_id
          WHERE tags.slug = ?
          ORDER BY images.created_at DESC, images.id DESC
        `,
        [tagSlug],
      );

      const images = imageRows.map(mapImageRow);
      return attachTagNames(images, await getImageTagRows(database, images.map((image) => image.id)));
    },
  };
}

