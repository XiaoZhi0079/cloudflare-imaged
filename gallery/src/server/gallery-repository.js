import { normalizeTagName, slugifyTagName } from "../shared/tag-utils.js";

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
    CREATE TABLE IF NOT EXISTS images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      imgbed_file_id TEXT NOT NULL UNIQUE,
      file_name TEXT NOT NULL,
      file_url TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      sync_status TEXT NOT NULL DEFAULT 'ok',
      note TEXT
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
  `CREATE INDEX IF NOT EXISTS idx_tags_visible_order ON tags(is_visible, sort_order, name)`,
  `CREATE INDEX IF NOT EXISTS idx_images_file_id ON images(imgbed_file_id)`,
  `CREATE INDEX IF NOT EXISTS idx_image_tags_image_id ON image_tags(image_id)`,
  `CREATE INDEX IF NOT EXISTS idx_image_tags_tag_id ON image_tags(tag_id)`,
];

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

function clampTagPosition(sortOrder, maxPosition, fallbackPosition = maxPosition) {
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

async function normalizeTagSortOrders(database) {
  return await applyContiguousTagOrder(database, await listTagsOrdered(database));
}

export function createGalleryRepository(database) {
  let schemaReady;

  async function ensureSchema() {
    if (!schemaReady) {
      schemaReady = (async () => {
        for (const statement of SCHEMA_STATEMENTS) {
          await run(database, statement);
        }
      })();
    }

    await schemaReady;
  }

  return {
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
      const normalizedName =
        changes.name === undefined ? current.name : normalizeTagName(changes.name);
      const slug = changes.name === undefined ? current.slug : slugifyTagName(normalizedName);
      const targetPosition =
        changes.sortOrder === undefined
          ? currentPosition
          : clampTagPosition(changes.sortOrder, orderedTags.length, currentPosition);
      const isVisible =
        changes.isVisible === undefined
          ? Number(current.is_visible)
          : changes.isVisible
            ? 1
            : 0;

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

    async upsertImage({ imgbedFileId, fileName, fileUrl, width, height, syncStatus, note = null }) {
      await ensureSchema();

      await run(
        database,
        `
          INSERT INTO images (imgbed_file_id, file_name, file_url, width, height, sync_status, note)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(imgbed_file_id) DO UPDATE SET
            file_name = excluded.file_name,
            file_url = excluded.file_url,
            width = excluded.width,
            height = excluded.height,
            sync_status = excluded.sync_status,
            note = excluded.note,
            updated_at = CURRENT_TIMESTAMP
        `,
        [imgbedFileId, fileName, fileUrl, width ?? null, height ?? null, syncStatus ?? "ok", note],
      );

      return await first(
        database,
        `
          SELECT id, imgbed_file_id AS imgbedFileId, file_name AS fileName, file_url AS fileUrl,
                 width, height, sync_status AS syncStatus, note
          FROM images
          WHERE imgbed_file_id = ?
        `,
        [imgbedFileId],
      );
    },

    async getImageById(imageId) {
      await ensureSchema();

      const image = await first(
        database,
        `
          SELECT id, imgbed_file_id AS imgbedFileId, file_name AS fileName, file_url AS fileUrl,
                 width, height, sync_status AS syncStatus, note
          FROM images
          WHERE id = ?
        `,
        [imageId],
      );

      if (!image) {
        return null;
      }

      return attachTagNames([image], await getImageTagRows(database, [image.id]))[0];
    },

    async listImages() {
      await ensureSchema();

      const images = await all(
        database,
        `
          SELECT id, imgbed_file_id AS imgbedFileId, file_name AS fileName, file_url AS fileUrl,
                 width, height, sync_status AS syncStatus, note
          FROM images
          ORDER BY created_at DESC, id DESC
        `,
      );

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
          SET imgbed_file_id = ?,
              file_name = ?,
              file_url = ?,
              width = ?,
              height = ?,
              sync_status = ?,
              note = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        [
          changes.imgbedFileId ?? current.imgbedFileId,
          changes.fileName ?? current.fileName,
          changes.fileUrl ?? current.fileUrl,
          changes.width ?? current.width ?? null,
          changes.height ?? current.height ?? null,
          changes.syncStatus ?? current.syncStatus ?? "ok",
          changes.note === undefined ? current.note ?? null : changes.note,
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

      const images = await all(
        database,
        `
          SELECT DISTINCT images.id,
                 images.imgbed_file_id AS imgbedFileId,
                 images.file_name AS fileName,
                 images.file_url AS fileUrl,
                 images.width,
                 images.height,
                 images.sync_status AS syncStatus,
                 images.note
          FROM images
          INNER JOIN image_tags ON image_tags.image_id = images.id
          INNER JOIN tags ON tags.id = image_tags.tag_id
          WHERE tags.slug = ?
          ORDER BY images.created_at DESC, images.id DESC
        `,
        [tagSlug],
      );

      return attachTagNames(images, await getImageTagRows(database, images.map((image) => image.id)));
    },
  };
}
