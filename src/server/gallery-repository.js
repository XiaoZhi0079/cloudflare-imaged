import { normalizeTagName, slugifyTagName } from "../shared/tag-utils.js";
import { classifyFeaturedImage } from "../shared/featured-image-rules.js";
import { getFileExtension, sanitizeFileName } from "./gallery-storage.js";

const DEFAULT_SITE_SETTINGS = {
  issue_name: "图集",
  hero_copy: "慢慢看，挑一份喜欢的气质。本期以红调与侧光为主，适合夜色、轮廓与留白。",
};

const SELECT_IMAGE_COLUMNS = `
  images.id,
  images.public_id AS publicId,
  images.content_sha256 AS contentSha256,
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

const SELECT_UPLOAD_SESSION_COLUMNS = `
  id,
  public_id AS publicId,
  content_sha256 AS contentSha256,
  storage_key AS storageKey,
  file_name AS fileName,
  file_url AS fileUrl,
  content_type AS contentType,
  file_size AS fileSize,
  width,
  height,
  category_id AS categoryId,
  tag_ids AS tagIdsJson,
  operation_id AS operationId,
  client_item_id AS clientItemId,
  status,
  phase,
  error_code AS errorCode,
  error_message AS errorMessage,
  duration_ms AS durationMs,
  completed_at AS completedAt,
  image_id AS imageId,
  created_at AS createdAt,
  updated_at AS updatedAt,
  expires_at AS expiresAt
`;

const SELECT_AI_PROPOSAL_COLUMNS = `
  proposals.id,
  proposals.batch_id AS batchId,
  proposals.image_id AS imageId,
  proposals.proposed_file_name AS proposedFileName,
  proposals.proposed_category_id AS proposedCategoryId,
  proposals.proposed_tag_ids AS proposedTagIdsJson,
  proposals.candidate_tag_ids AS candidateTagIdsJson,
  proposals.rationale,
  proposals.confidence,
  proposals.status,
  proposals.review_note AS reviewNote,
  proposals.reviewed_at AS reviewedAt,
  proposals.applied_at AS appliedAt,
  proposals.error_code AS errorCode,
  proposals.error_message AS errorMessage,
  proposals.created_at AS createdAt,
  proposals.updated_at AS updatedAt,
  batches.name AS batchName,
  images.public_id AS imagePublicId,
  images.file_name AS currentFileName,
  images.storage_key AS currentStorageKey,
  images.file_url AS currentFileUrl,
  images.width,
  images.height,
  images.category_id AS currentCategoryId,
  current_categories.name AS currentCategoryName,
  proposed_categories.name AS proposedCategoryName,
  proposed_categories.directory_slug AS proposedCategoryDirectorySlug
`;

const D1_MAX_BOUND_PARAMETERS = 100;

function parameterBatches(values, batchSize = D1_MAX_BOUND_PARAMETERS) {
  const batches = [];
  for (let index = 0; index < values.length; index += batchSize) {
    batches.push(values.slice(index, index + batchSize));
  }
  return batches;
}

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
    publicId: row.publicId ?? null,
    contentSha256: row.contentSha256 ?? null,
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

  const uniqueImageIds = [...new Set(imageIds.map(Number).filter(Number.isInteger))];
  const rows = [];
  for (const batch of parameterBatches(uniqueImageIds)) {
    const placeholders = batch.map(() => "?").join(", ");
    rows.push(...await all(
      database,
      `
        SELECT image_tags.image_id, image_tags.tag_id AS tagId, tags.name
        FROM image_tags
        INNER JOIN tags ON tags.id = image_tags.tag_id
        WHERE image_tags.image_id IN (${placeholders})
        ORDER BY tags.sort_order ASC, tags.name ASC
      `,
      batch,
    ));
  }

  return rows;
}

function normalizeIntegerIds(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(Number)
    .filter((value) => Number.isInteger(value) && value > 0))]
    .sort((left, right) => left - right);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

function normalizePublicId(value, fallback = null) {
  const normalized = String(value ?? fallback ?? "").trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw repositoryError("INVALID_PUBLIC_ID", "Image public IDs must be UUID v4 values.");
  }
  return normalized;
}

function normalizeContentSha256(value, { required = false } = {}) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized && !required) return null;
  if (!SHA256_PATTERN.test(normalized)) {
    throw repositoryError("INVALID_CONTENT_SHA256", "Image content hashes must be 64-character SHA-256 values.");
  }
  return normalized;
}

function mapUploadSession(row) {
  if (!row) return null;

  let parsedTagIds = [];
  try {
    parsedTagIds = JSON.parse(row.tagIdsJson);
  } catch {
    parsedTagIds = [];
  }

  return {
    id: row.id,
    publicId: row.publicId ?? null,
    contentSha256: row.contentSha256 ?? null,
    storageKey: row.storageKey,
    fileName: row.fileName,
    fileUrl: row.fileUrl,
    contentType: row.contentType,
    fileSize: Number(row.fileSize ?? 0),
    width: row.width === null ? null : Number(row.width),
    height: row.height === null ? null : Number(row.height),
    categoryId: row.categoryId === null ? null : Number(row.categoryId),
    tagIds: normalizeIntegerIds(parsedTagIds),
    operationId: row.operationId ?? null,
    clientItemId: row.clientItemId ?? null,
    status: row.status,
    phase: row.phase ?? (row.status === "completed" ? "completed" : "reserved"),
    errorCode: row.errorCode ?? null,
    errorMessage: row.errorMessage ?? null,
    durationMs: row.durationMs === null || row.durationMs === undefined ? null : Number(row.durationMs),
    completedAt: row.completedAt ?? null,
    imageId: row.imageId === null ? null : Number(row.imageId),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    expiresAt: row.expiresAt,
  };
}

function sameIntegerIds(left, right) {
  const normalizedLeft = normalizeIntegerIds(left);
  const normalizedRight = normalizeIntegerIds(right);
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function jsonIntegerIds(value) {
  try {
    return normalizeIntegerIds(JSON.parse(value ?? "[]"));
  } catch {
    return [];
  }
}

function mapAiProposal(row) {
  return row ? {
    id: row.id,
    batchId: row.batchId,
    batchName: row.batchName,
    imageId: Number(row.imageId),
    imagePublicId: row.imagePublicId,
    currentFileName: row.currentFileName,
    currentStorageKey: row.currentStorageKey,
    currentFileUrl: row.currentFileUrl,
    width: row.width === null ? null : Number(row.width),
    height: row.height === null ? null : Number(row.height),
    currentCategoryId: row.currentCategoryId === null ? null : Number(row.currentCategoryId),
    currentCategoryName: row.currentCategoryName ?? null,
    proposedFileName: row.proposedFileName,
    proposedCategoryId: Number(row.proposedCategoryId),
    proposedCategoryName: row.proposedCategoryName,
    proposedCategoryDirectorySlug: row.proposedCategoryDirectorySlug,
    proposedTagIds: jsonIntegerIds(row.proposedTagIdsJson),
    candidateTagIds: jsonIntegerIds(row.candidateTagIdsJson),
    rationale: row.rationale ?? "",
    confidence: row.confidence === null ? null : Number(row.confidence),
    status: row.status,
    reviewNote: row.reviewNote ?? null,
    reviewedAt: row.reviewedAt ?? null,
    appliedAt: row.appliedAt ?? null,
    errorCode: row.errorCode ?? null,
    errorMessage: row.errorMessage ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  } : null;
}

function repositoryError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function normalizeTagAssignments(assignments) {
  const normalized = (Array.isArray(assignments) ? assignments : []).map((assignment) => ({
    imageId: Number(assignment?.imageId),
    tagIds: normalizeIntegerIds(assignment?.tagIds),
  }));
  if (normalized.some((assignment) => !Number.isInteger(assignment.imageId) || assignment.imageId <= 0)) {
    throw repositoryError("INVALID_IMAGE_ASSIGNMENT", "Every tag assignment requires a positive image ID.");
  }
  if (new Set(normalized.map((assignment) => assignment.imageId)).size !== normalized.length) {
    throw repositoryError("DUPLICATE_IMAGE_ASSIGNMENT", "Each image may appear only once in a tag assignment batch.");
  }
  return normalized;
}

function tagAssignmentEntries(assignmentsJson) {
  return [
    {
      sql: `
        DELETE FROM image_tags
        WHERE image_id IN (
          SELECT CAST(json_extract(value, '$.imageId') AS INTEGER)
          FROM json_each(?)
        )
      `,
      params: [assignmentsJson],
    },
    {
      sql: `
        INSERT INTO image_tags (image_id, tag_id)
        SELECT
          CAST(json_extract(assignment.value, '$.imageId') AS INTEGER),
          CAST(tag.value AS INTEGER)
        FROM json_each(?) AS assignment
        CROSS JOIN json_each(json_extract(assignment.value, '$.tagIds')) AS tag
      `,
      params: [assignmentsJson],
    },
  ];
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
      SELECT tags.id, tags.name, tags.slug, tags.sort_order, tags.is_visible,
             tag_groups.id AS group_id, tag_groups.name AS group_name,
             tag_groups.slug AS group_slug, tag_groups.sort_order AS group_sort_order
      FROM tags
      LEFT JOIN tag_groups ON tag_groups.id = tags.group_id
      WHERE tags.id = ?
    `,
    [tagId],
  );
}

async function loadImagesByIds(database, imageIds) {
  const ids = [...new Set((imageIds ?? [])
    .map(Number)
    .filter((imageId) => Number.isInteger(imageId) && imageId > 0))];
  if (!ids.length) return [];

  const rows = [];
  for (const batch of parameterBatches(ids)) {
    const placeholders = batch.map(() => "?").join(", ");
    rows.push(...await all(
      database,
      `
        SELECT ${SELECT_IMAGE_COLUMNS}
        FROM images
        LEFT JOIN categories ON categories.id = images.category_id
        WHERE images.id IN (${placeholders})
      `,
      batch,
    ));
  }

  const imagesById = new Map(rows.map((row) => [Number(row.id), mapImageRow(row)]));
  const images = ids.map((imageId) => imagesById.get(imageId)).filter(Boolean);
  return attachTagNames(images, await getImageTagRows(database, images.map((image) => image.id)));
}

async function getTagGroupById(database, groupId) {
  return await first(
    database,
    `SELECT id, name, slug, sort_order FROM tag_groups WHERE id = ?`,
    [groupId],
  );
}

async function getDefaultTagGroup(database) {
  return await first(
    database,
    `SELECT id, name, slug, sort_order FROM tag_groups ORDER BY CASE WHEN slug = 'uncategorized' THEN 0 ELSE 1 END, sort_order, id LIMIT 1`,
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
      SELECT tags.id, tags.name, tags.slug, tags.sort_order, tags.is_visible,
             tag_groups.id AS group_id, tag_groups.name AS group_name,
             tag_groups.slug AS group_slug, tag_groups.sort_order AS group_sort_order
      FROM tags
      LEFT JOIN tag_groups ON tag_groups.id = tags.group_id
      ORDER BY tag_groups.sort_order ASC, tags.sort_order ASC, tags.name ASC, tags.id ASC
    `,
  );
}

async function listTagGroupsOrdered(database) {
  return await all(
    database,
    `SELECT id, name, slug, sort_order FROM tag_groups ORDER BY sort_order ASC, name ASC, id ASC`,
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

async function applyContiguousTagGroupOrder(database, orderedGroups) {
  for (let index = 0; index < orderedGroups.length; index += 1) {
    const group = orderedGroups[index];
    const nextSortOrder = index + 1;
    if (Number(group.sort_order) !== nextSortOrder) {
      await run(database, `UPDATE tag_groups SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [nextSortOrder, group.id]);
    }
    group.sort_order = nextSortOrder;
  }
  return orderedGroups;
}

async function normalizeTagSortOrders(database) {
  return await applyContiguousTagOrder(database, await listTagsOrdered(database));
}

async function normalizeCategorySortOrders(database) {
  return await applyContiguousCategoryOrder(database, await listCategoriesOrdered(database));
}

async function normalizeTagGroupSortOrders(database) {
  return await applyContiguousTagGroupOrder(database, await listTagGroupsOrdered(database));
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

function validateAlbumImageIds(value) {
  if (!Array.isArray(value)) {
    throw new TypeError("album imageIds must be an array");
  }
  if (value.some((imageId) => !Number.isInteger(imageId) || imageId <= 0)) {
    throw new RangeError("album imageIds must contain positive integers");
  }
  if (new Set(value).size !== value.length) {
    throw new RangeError("album imageIds must not contain duplicates");
  }
  return [...value];
}

async function nextAlbumSlug(database, name) {
  const base = slugifyTagName(name) || "album";
  let slug = base;
  let suffix = 2;
  while (await first(database, `SELECT id FROM albums WHERE slug = ?`, [slug])) {
    slug = `${base}-${suffix}`;
    suffix += 1;
  }
  return slug;
}

async function loadAlbums(database, whereSql = "", params = []) {
  const rows = await all(
    database,
    `
      SELECT id, name, slug, description, cover_image_id, is_home, sort_order
      FROM albums
      ${whereSql}
      ORDER BY sort_order ASC, id ASC
    `,
    params,
  );
  if (!rows.length) return [];

  const albumIds = rows.map((row) => Number(row.id));
  const placeholders = albumIds.map(() => "?").join(", ");
  const imageRows = await all(
    database,
    `
      SELECT album_images.album_id AS albumId, album_images.sort_order AS albumSortOrder,
             ${SELECT_IMAGE_COLUMNS}
      FROM album_images
      INNER JOIN images ON images.id = album_images.image_id
      LEFT JOIN categories ON categories.id = images.category_id
      WHERE album_images.album_id IN (${placeholders})
      ORDER BY album_images.album_id, album_images.sort_order, album_images.image_id
    `,
    albumIds,
  );
  const images = attachTagNames(
    imageRows.map((row) => ({ ...mapImageRow(row), albumId: Number(row.albumId) })),
    await getImageTagRows(database, imageRows.map((row) => Number(row.id))),
  );
  const imagesByAlbum = new Map();
  for (const image of images) {
    const current = imagesByAlbum.get(image.albumId) ?? [];
    const { albumId, ...record } = image;
    current.push(record);
    imagesByAlbum.set(albumId, current);
  }

  return rows.map((row) => {
    const albumImages = imagesByAlbum.get(Number(row.id)) ?? [];
    const coverImageId = Number.isInteger(Number(row.cover_image_id))
      ? Number(row.cover_image_id)
      : null;
    return {
      id: Number(row.id),
      name: row.name,
      slug: row.slug,
      description: row.description ?? "",
      coverImageId,
      coverImage: albumImages.find((image) => Number(image.id) === coverImageId) ?? null,
      isHome: Number(row.is_home) === 1,
      sortOrder: Number(row.sort_order ?? 0),
      imageCount: albumImages.length,
      images: albumImages,
    };
  });
}

export function createGalleryRepository(database) {
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
        `featured images must be within 0.5% of 16:9 and at least 1600x900: ${invalidIds.join(", ")}`,
      );
    }
  }

  return {
    async listAlbums() {
      return await loadAlbums(database);
    },

    async getAlbumById(albumId) {
      return (await loadAlbums(database, `WHERE id = ?`, [albumId]))[0] ?? null;
    },

    async getAlbumBySlug(slug) {
      return (await loadAlbums(database, `WHERE slug = ?`, [slug]))[0] ?? null;
    },

    async createAlbum({ name, description = "" } = {}) {
      const normalizedName = String(name ?? "").trim();
      if (!normalizedName) throw new RangeError("album name is required");
      const slug = await nextAlbumSlug(database, normalizedName);
      const order = await first(database, `SELECT COALESCE(MAX(sort_order), 0) + 1 AS nextOrder FROM albums`);
      await run(
        database,
        `INSERT INTO albums (name, slug, description, sort_order) VALUES (?, ?, ?, ?)`,
        [normalizedName, slug, String(description ?? "").trim(), Number(order?.nextOrder ?? 1)],
      );
      return await this.getAlbumBySlug(slug);
    },

    async updateAlbum(albumId, changes = {}) {
      const current = await this.getAlbumById(albumId);
      if (!current) return null;
      const imageIds = changes.imageIds === undefined
        ? current.images.map((image) => Number(image.id))
        : validateAlbumImageIds(changes.imageIds);
      if (imageIds.length) {
        const placeholders = imageIds.map(() => "?").join(", ");
        const existing = await all(database, `SELECT id FROM images WHERE id IN (${placeholders})`, imageIds);
        if (existing.length !== imageIds.length) throw new RangeError("unknown album image ids");
      }
      const explicitCover = changes.coverImageId === null || changes.coverImageId === undefined
        ? null
        : Number(changes.coverImageId);
      if (explicitCover !== null && !imageIds.includes(explicitCover)) {
        throw new RangeError("cover image must belong to album");
      }
      const preservedCover = imageIds.includes(Number(current.coverImageId)) ? Number(current.coverImageId) : null;
      const coverImageId = explicitCover ?? preservedCover ?? imageIds[0] ?? null;
      const name = changes.name === undefined ? current.name : String(changes.name ?? "").trim();
      if (!name) throw new RangeError("album name is required");
      const description = changes.description === undefined
        ? current.description
        : String(changes.description ?? "").trim();
      const sortOrder = changes.sortOrder === undefined ? current.sortOrder : Number(changes.sortOrder);
      const isHome = changes.isHome === undefined ? current.isHome : changes.isHome === true;
      const entries = [];
      if (isHome) entries.push({ sql: `UPDATE albums SET is_home = 0 WHERE is_home = 1`, params: [] });
      entries.push({
        sql: `UPDATE albums SET name = ?, description = ?, cover_image_id = ?, is_home = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        params: [name, description, coverImageId, isHome ? 1 : 0, sortOrder, albumId],
      });
      if (changes.imageIds !== undefined) {
        entries.push({ sql: `DELETE FROM album_images WHERE album_id = ?`, params: [albumId] });
        imageIds.forEach((imageId, index) => entries.push({
          sql: `INSERT INTO album_images (album_id, image_id, sort_order) VALUES (?, ?, ?)`,
          params: [albumId, imageId, index + 1],
        }));
      }
      await runBatch(database, entries);
      return await this.getAlbumById(albumId);
    },

    async deleteAlbum(albumId) {
      const current = await this.getAlbumById(albumId);
      if (!current) return false;
      if (current.isHome) throw new RangeError("home album cannot be deleted");
      const result = await run(database, `DELETE FROM albums WHERE id = ?`, [albumId]);
      return Number(result?.meta?.changes ?? result?.changes ?? 0) > 0;
    },

    async getSiteSettings() {
      const rows = await all(database, `SELECT key, value FROM site_settings`);
      return mapSiteSettings(rows);
    },

    async updateSiteSettings(changes = {}) {
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

    async createTag({ name, groupId, sortOrder = 0, isVisible = true }) {
      const normalizedName = normalizeTagName(name);
      const slug = slugifyTagName(normalizedName);
      const group = groupId === undefined
        ? await getDefaultTagGroup(database)
        : await getTagGroupById(database, Number(groupId));
      if (!group) throw new RangeError("tag group is required");
      const orderedTags = await normalizeTagSortOrders(database);
      const targetPosition = clampTagPosition(sortOrder, orderedTags.length + 1, orderedTags.length + 1);

      await run(
        database,
        `
          INSERT INTO tags (name, slug, sort_order, is_visible, group_id)
          VALUES (?, ?, ?, ?, ?)
        `,
        [normalizedName, slug, targetPosition, isVisible ? 1 : 0, group.id],
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
      const group = changes.groupId === undefined
        ? await getTagGroupById(database, current.group_id)
        : await getTagGroupById(database, Number(changes.groupId));
      if (!group) throw new RangeError("tag group is required");

      await run(
        database,
        `
          UPDATE tags
          SET name = ?, slug = ?, sort_order = ?, is_visible = ?, group_id = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        [normalizedName, slug, currentPosition, isVisible, group.id, tagId],
      );

      const updated = await getTagById(database, tagId);
      const reorderedTags = orderedTags.filter((tag) => Number(tag.id) !== Number(tagId));
      reorderedTags.splice(targetPosition - 1, 0, updated);
      await applyContiguousTagOrder(database, reorderedTags);

      return await getTagById(database, tagId);
    },

    async deleteTag(tagId) {
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
      return await listTagsOrdered(database);
    },

    async reorderTags(orderedIds) {
      const records = recordsInSubmittedOrder(await listTagsOrdered(database), orderedIds);
      await applyExactOrder(database, "tags", records);
      return await listTagsOrdered(database);
    },

    async listVisibleTags() {
      return await all(
        database,
        `
          SELECT tags.id, tags.name, tags.slug, tags.sort_order, tags.is_visible,
                 tag_groups.id AS group_id, tag_groups.name AS group_name,
                 tag_groups.slug AS group_slug, tag_groups.sort_order AS group_sort_order
          FROM tags
          INNER JOIN tag_groups ON tag_groups.id = tags.group_id
          WHERE tags.is_visible = 1
          ORDER BY tag_groups.sort_order ASC, tags.sort_order ASC, tags.name ASC, tags.id ASC
        `,
      );
    },

    async listTagGroups() {
      return await listTagGroupsOrdered(database);
    },

    async getTagGroupById(groupId) {
      return await getTagGroupById(database, groupId);
    },

    async createTagGroup({ name, sortOrder = 0 }) {
      const normalizedName = normalizeTagName(name);
      if (!normalizedName) throw new RangeError("tag group name is required");
      const slug = slugifyTagName(normalizedName);
      const orderedGroups = await normalizeTagGroupSortOrders(database);
      const targetPosition = clampCategoryPosition(sortOrder, orderedGroups.length + 1, orderedGroups.length + 1);
      await run(database, `INSERT INTO tag_groups (name, slug, sort_order) VALUES (?, ?, ?)`, [normalizedName, slug, targetPosition]);
      const created = await first(database, `SELECT id, name, slug, sort_order FROM tag_groups WHERE slug = ?`, [slug]);
      orderedGroups.splice(targetPosition - 1, 0, created);
      await applyContiguousTagGroupOrder(database, orderedGroups);
      return await getTagGroupById(database, created.id);
    },

    async updateTagGroup(groupId, changes = {}) {
      const current = await getTagGroupById(database, groupId);
      if (!current) return null;
      const orderedGroups = await normalizeTagGroupSortOrders(database);
      const currentIndex = orderedGroups.findIndex((group) => Number(group.id) === Number(groupId));
      const currentPosition = currentIndex + 1;
      const name = changes.name === undefined ? current.name : normalizeTagName(changes.name);
      if (!name) throw new RangeError("tag group name is required");
      const slug = changes.name === undefined ? current.slug : slugifyTagName(name);
      const targetPosition = changes.sortOrder === undefined
        ? currentPosition
        : clampCategoryPosition(changes.sortOrder, orderedGroups.length, currentPosition);
      await run(database, `UPDATE tag_groups SET name = ?, slug = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [name, slug, currentPosition, groupId]);
      const updated = await getTagGroupById(database, groupId);
      const reordered = orderedGroups.filter((group) => Number(group.id) !== Number(groupId));
      reordered.splice(targetPosition - 1, 0, updated);
      await applyContiguousTagGroupOrder(database, reordered);
      return await getTagGroupById(database, groupId);
    },

    async deleteTagGroup(groupId) {
      const current = await getTagGroupById(database, groupId);
      if (!current) return false;
      const count = await first(database, `SELECT COUNT(*) AS count FROM tags WHERE group_id = ?`, [groupId]);
      if (Number(count?.count ?? 0) > 0) throw new RangeError("tag group must be empty");
      await run(database, `DELETE FROM tag_groups WHERE id = ?`, [groupId]);
      await normalizeTagGroupSortOrders(database);
      return true;
    },

    async reorderTagGroups(orderedIds) {
      const records = recordsInSubmittedOrder(await listTagGroupsOrdered(database), orderedIds);
      await applyExactOrder(database, "tag_groups", records);
      return await listTagGroupsOrdered(database);
    },

    async getExistingTagIds(tagIds) {
      return await getExistingTagIds(database, tagIds);
    },

    async listCategories() {
      return await listCategoriesOrdered(database);
    },

    async reorderCategories(orderedIds) {
      const records = recordsInSubmittedOrder(await listCategoriesOrdered(database), orderedIds);
      await applyExactOrder(database, "categories", records);
      return await listCategoriesOrdered(database);
    },

    async getCategoryById(categoryId) {
      return await getCategoryById(database, categoryId);
    },

    async getCategoriesByIds(categoryIds) {
      const ids = normalizeIntegerIds(categoryIds);
      if (!ids.length) return [];
      const rows = await all(
        database,
        `
          SELECT id, name, directory_slug, sort_order
          FROM categories
          WHERE id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
        `,
        [JSON.stringify(ids)],
      );
      const rowsById = new Map(rows.map((row) => [Number(row.id), row]));
      return ids.map((id) => rowsById.get(id)).filter(Boolean);
    },

    async createCategory({ name, directorySlug, sortOrder = 0 }) {
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

    async getUploadSessionById(uploadId) {
      return mapUploadSession(await first(
        database,
        `SELECT ${SELECT_UPLOAD_SESSION_COLUMNS} FROM upload_sessions WHERE id = ?`,
        [uploadId],
      ));
    },

    async getUploadSessionByStorageKey(storageKey) {
      return mapUploadSession(await first(
        database,
        `SELECT ${SELECT_UPLOAD_SESSION_COLUMNS} FROM upload_sessions WHERE storage_key = ?`,
        [storageKey],
      ));
    },

    async getUploadSessionsByIds(uploadIds) {
      const ids = [...new Set((Array.isArray(uploadIds) ? uploadIds : [])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean))];
      if (!ids.length) return [];
      const rows = await all(
        database,
        `
          SELECT ${SELECT_UPLOAD_SESSION_COLUMNS}
          FROM upload_sessions
          WHERE id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
        `,
        [JSON.stringify(ids)],
      );
      const sessionsById = new Map(rows.map((row) => [row.id, mapUploadSession(row)]));
      return ids.map((id) => sessionsById.get(id)).filter(Boolean);
    },

    async listUploadSessionsByOperation(operationId) {
      const normalized = String(operationId ?? "").trim();
      if (!normalized) return [];
      const rows = await all(
        database,
        `
          SELECT ${SELECT_UPLOAD_SESSION_COLUMNS}
          FROM upload_sessions
          WHERE operation_id = ?
          ORDER BY created_at ASC, id ASC
          LIMIT 50
        `,
        [normalized],
      );
      return rows.map(mapUploadSession);
    },

    async updateUploadSessionPhase(uploadIds, { phase, errorCode = null, errorMessage = null } = {}) {
      const ids = [...new Set((Array.isArray(uploadIds) ? uploadIds : [uploadIds])
        .map((value) => String(value ?? "").trim()).filter(Boolean))];
      const allowed = new Set(["reserved", "object_uploaded", "database_commit", "completed", "failed"]);
      if (!ids.length || !allowed.has(phase)) {
        throw repositoryError("INVALID_UPLOAD_PHASE", "Upload phase and upload IDs are required.");
      }
      await run(
        database,
        `
          UPDATE upload_sessions
          SET phase = ?, error_code = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
        `,
        [phase, errorCode, errorMessage, JSON.stringify(ids)],
      );
      return await this.getUploadSessionsByIds(ids);
    },

    async reserveUploadSession({
      id,
      publicId = null,
      contentSha256 = null,
      storageKey,
      fileName,
      fileUrl,
      contentType,
      fileSize = 0,
      width = null,
      height = null,
      categoryId = null,
      tagIds,
      operationId = null,
      clientItemId = null,
    }) {
      return (await this.reserveUploadSessions([{
        id,
        publicId,
        contentSha256,
        storageKey,
        fileName,
        fileUrl,
        contentType,
        fileSize,
        width,
        height,
        categoryId,
        tagIds,
        operationId,
        clientItemId,
      }]))[0];
    },

    async reserveUploadSessions(uploadDrafts) {
      const drafts = (Array.isArray(uploadDrafts) ? uploadDrafts : []).map((draft) => ({
        id: String(draft?.id ?? "").trim(),
        publicId: normalizePublicId(draft?.publicId, draft?.id),
        contentSha256: normalizeContentSha256(draft?.contentSha256),
        storageKey: String(draft?.storageKey ?? "").trim(),
        fileName: String(draft?.fileName ?? "").trim(),
        fileUrl: String(draft?.fileUrl ?? "").trim(),
        contentType: String(draft?.contentType ?? "").trim(),
        fileSize: Number(draft?.fileSize ?? 0),
        width: draft?.width ?? null,
        height: draft?.height ?? null,
        categoryId: draft?.categoryId ?? null,
        tagIds: normalizeIntegerIds(draft?.tagIds),
        operationId: draft?.operationId ?? null,
        clientItemId: draft?.clientItemId ?? null,
      }));
      if (!drafts.length) return [];
      if (drafts.length > 50) throw new RangeError("No more than 50 upload sessions may be reserved at once.");
      if (drafts.some((draft) => !draft.id || !draft.storageKey || !draft.fileName || !draft.fileUrl || !draft.contentType)) {
        throw repositoryError("INVALID_UPLOAD_SESSION", "Every upload session requires complete file metadata.");
      }
      if (new Set(drafts.map((draft) => draft.id)).size !== drafts.length
        || new Set(drafts.map((draft) => draft.storageKey)).size !== drafts.length) {
        throw repositoryError("DUPLICATE_UPLOAD_SESSION", "Upload IDs and storage keys must be unique within a batch.");
      }
      const contentHashes = drafts.map((draft) => draft.contentSha256).filter(Boolean);
      if (new Set(contentHashes).size !== contentHashes.length) {
        throw repositoryError(
          "DUPLICATE_IMAGE_CONTENT",
          "Upload drafts must not contain duplicate image content.",
        );
      }

      const serializedDrafts = drafts.map((draft) => ({
        ...draft,
        tagIdsJson: JSON.stringify(draft.tagIds),
      }));
      const draftsJson = JSON.stringify(serializedDrafts);
      await runBatch(database, [
        {
          sql: `
            DELETE FROM upload_sessions
            WHERE status = 'pending'
              AND expires_at <= CURRENT_TIMESTAMP
              AND (
                storage_key IN (
                  SELECT json_extract(value, '$.storageKey') FROM json_each(?)
                )
                OR content_sha256 IN (
                  SELECT json_extract(value, '$.contentSha256')
                  FROM json_each(?)
                  WHERE json_extract(value, '$.contentSha256') IS NOT NULL
                )
              )
          `,
          params: [draftsJson, draftsJson],
        },
        {
          sql: `
            WITH drafts AS (
              SELECT
                json_extract(value, '$.id') AS id,
                json_extract(value, '$.publicId') AS public_id,
                json_extract(value, '$.contentSha256') AS content_sha256,
                json_extract(value, '$.storageKey') AS storage_key,
                json_extract(value, '$.fileName') AS file_name,
                json_extract(value, '$.fileUrl') AS file_url,
                json_extract(value, '$.contentType') AS content_type,
                CAST(json_extract(value, '$.fileSize') AS INTEGER) AS file_size,
                CAST(json_extract(value, '$.width') AS INTEGER) AS width,
                CAST(json_extract(value, '$.height') AS INTEGER) AS height,
                CAST(json_extract(value, '$.categoryId') AS INTEGER) AS category_id,
                json_extract(value, '$.tagIdsJson') AS tag_ids,
                json_extract(value, '$.operationId') AS operation_id,
                json_extract(value, '$.clientItemId') AS client_item_id
              FROM json_each(?)
            )
            INSERT OR IGNORE INTO upload_sessions (
              id, public_id, content_sha256, storage_key, file_name, file_url, content_type, file_size,
              width, height, category_id, tag_ids, operation_id, client_item_id
            )
            SELECT
              draft.id, draft.public_id, draft.content_sha256, draft.storage_key, draft.file_name, draft.file_url,
              draft.content_type, draft.file_size, draft.width, draft.height,
              draft.category_id, draft.tag_ids, draft.operation_id, draft.client_item_id
            FROM drafts AS draft
            WHERE NOT EXISTS (
              SELECT 1
              FROM drafts AS candidate
              INNER JOIN upload_sessions AS existing
                ON existing.id = candidate.id OR existing.storage_key = candidate.storage_key
              WHERE existing.status <> 'pending'
                 OR existing.id <> candidate.id
                 OR existing.public_id <> candidate.public_id
                 OR NOT (existing.content_sha256 IS candidate.content_sha256)
                 OR existing.storage_key <> candidate.storage_key
                 OR existing.file_name <> candidate.file_name
                 OR existing.file_url <> candidate.file_url
                 OR existing.content_type <> candidate.content_type
                 OR existing.file_size <> candidate.file_size
                 OR NOT (existing.width IS candidate.width)
                 OR NOT (existing.height IS candidate.height)
                 OR NOT (existing.category_id IS candidate.category_id)
                 OR existing.tag_ids <> candidate.tag_ids
                 OR NOT (existing.operation_id IS candidate.operation_id)
                 OR NOT (existing.client_item_id IS candidate.client_item_id)
            )
              AND NOT EXISTS (
                SELECT 1
                FROM drafts AS candidate
                INNER JOIN images ON images.storage_key = candidate.storage_key
              )
              AND NOT EXISTS (
                SELECT 1
                FROM drafts AS candidate
                INNER JOIN images ON images.content_sha256 = candidate.content_sha256
                WHERE candidate.content_sha256 IS NOT NULL
              )
              AND NOT EXISTS (
                SELECT 1
                FROM drafts AS candidate
                INNER JOIN upload_sessions AS existing
                  ON existing.content_sha256 = candidate.content_sha256
                WHERE candidate.content_sha256 IS NOT NULL
                  AND existing.status = 'pending'
                  AND existing.id <> candidate.id
              )
              AND NOT EXISTS (SELECT 1 FROM upload_sessions WHERE id = draft.id)
          `,
          params: [draftsJson],
        },
      ]);

      const sessions = await this.getUploadSessionsByIds(drafts.map((draft) => draft.id));
      const sessionsById = new Map(sessions.map((session) => [session.id, session]));
      const missingDrafts = drafts.filter((draft) => !sessionsById.has(draft.id));
      let storageSessionsByKey = new Map();
      let imagesByStorageKey = new Map();
      let contentSessionsByHash = new Map();
      let imagesByContentHash = new Map();
      if (missingDrafts.length) {
        const storageKeysJson = JSON.stringify(missingDrafts.map((draft) => draft.storageKey));
        const contentHashesJson = JSON.stringify(missingDrafts.map((draft) => draft.contentSha256).filter(Boolean));
        const storageSessions = await all(
          database,
          `
            SELECT ${SELECT_UPLOAD_SESSION_COLUMNS}
            FROM upload_sessions
            WHERE storage_key IN (SELECT CAST(value AS TEXT) FROM json_each(?))
          `,
          [storageKeysJson],
        );
        storageSessionsByKey = new Map(storageSessions.map((row) => {
          const session = mapUploadSession(row);
          return [session.storageKey, session];
        }));
        const imageRows = await all(
          database,
          `
            SELECT ${SELECT_IMAGE_COLUMNS}
            FROM images
            LEFT JOIN categories ON categories.id = images.category_id
            WHERE images.storage_key IN (SELECT CAST(value AS TEXT) FROM json_each(?))
          `,
          [storageKeysJson],
        );
        imagesByStorageKey = new Map(imageRows.map((row) => {
          const image = mapImageRow(row);
          return [image.storageKey, image];
        }));
        if (contentHashesJson !== "[]") {
          const contentSessions = await all(
            database,
            `
              SELECT ${SELECT_UPLOAD_SESSION_COLUMNS}
              FROM upload_sessions
              WHERE status = 'pending'
                AND content_sha256 IN (SELECT CAST(value AS TEXT) FROM json_each(?))
            `,
            [contentHashesJson],
          );
          contentSessionsByHash = new Map(contentSessions.map((row) => {
            const session = mapUploadSession(row);
            return [session.contentSha256, session];
          }));
          const contentImageRows = await all(
            database,
            `
              SELECT ${SELECT_IMAGE_COLUMNS}
              FROM images
              LEFT JOIN categories ON categories.id = images.category_id
              WHERE images.content_sha256 IN (SELECT CAST(value AS TEXT) FROM json_each(?))
            `,
            [contentHashesJson],
          );
          imagesByContentHash = new Map(contentImageRows.map((row) => {
            const image = mapImageRow(row);
            return [image.contentSha256, image];
          }));
        }
      }

      return drafts.map((draft) => {
        const session = sessionsById.get(draft.id) ?? null;
        return {
          session,
          storageSession: session?.storageKey === draft.storageKey
            ? session
            : storageSessionsByKey.get(draft.storageKey) ?? null,
          existingImage: imagesByStorageKey.get(draft.storageKey) ?? null,
          contentSession: session?.contentSha256 === draft.contentSha256
            ? session
            : contentSessionsByHash.get(draft.contentSha256) ?? null,
          existingContentImage: imagesByContentHash.get(draft.contentSha256) ?? null,
        };
      });
    },

    async deletePendingUploadSession(uploadId) {
      return (await this.deletePendingUploadSessions([uploadId])) > 0;
    },

    async deletePendingUploadSessions(uploadIds) {
      const ids = [...new Set((Array.isArray(uploadIds) ? uploadIds : [])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean))];
      if (!ids.length) return 0;
      const result = await run(
        database,
        `
          DELETE FROM upload_sessions
          WHERE status = 'pending'
            AND id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
        `,
        [JSON.stringify(ids)],
      );
      return Number(result?.meta?.changes ?? result?.changes ?? 0);
    },

    async getImageTagIds(imageId) {
      const rows = await all(
        database,
        `SELECT tag_id AS tagId FROM image_tags WHERE image_id = ? ORDER BY tag_id`,
        [imageId],
      );
      return normalizeIntegerIds(rows.map((row) => row.tagId));
    },

    async completeUploadSession(uploadId) {
      try {
        return (await this.completeUploadSessions([uploadId]))[0] ?? null;
      } catch (error) {
        if (error?.code === "UPLOAD_SESSION_NOT_FOUND") return null;
        throw error;
      }
    },

    async completeUploadSessions(uploadIds) {
      const ids = [...new Set((Array.isArray(uploadIds) ? uploadIds : [])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean))];
      if (!ids.length) return [];
      if (ids.length > 50) throw new RangeError("No more than 50 upload sessions may be completed at once.");

      const initialSessions = await this.getUploadSessionsByIds(ids);
      const initialById = new Map(initialSessions.map((session) => [session.id, session]));
      const missingUploadIds = ids.filter((id) => !initialById.has(id));
      if (missingUploadIds.length) {
        throw repositoryError("UPLOAD_SESSION_NOT_FOUND", "One or more upload sessions do not exist.", { missingUploadIds });
      }
      const pendingIds = initialSessions
        .filter((session) => session.status === "pending")
        .map((session) => session.id);
      if (pendingIds.length) {
        const pendingJson = JSON.stringify(pendingIds);
        try {
          await runBatch(database, [
            {
              sql: `
                INSERT INTO images (
                  public_id, content_sha256, storage_key, file_name, file_url, width, height,
                  sync_status, note, category_id, upload_id
                )
                SELECT
                  public_id, content_sha256, storage_key, file_name, file_url, width, height,
                  'ok', NULL, category_id, id
                FROM upload_sessions
                WHERE status = 'pending'
                  AND id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
              `,
              params: [pendingJson],
            },
            {
              sql: `
                INSERT INTO image_tags (image_id, tag_id)
                SELECT images.id, CAST(tag.value AS INTEGER)
                FROM upload_sessions
                INNER JOIN images ON images.upload_id = upload_sessions.id
                CROSS JOIN json_each(upload_sessions.tag_ids) AS tag
                WHERE upload_sessions.status = 'pending'
                  AND upload_sessions.id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
              `,
              params: [pendingJson],
            },
            {
              sql: `
                UPDATE upload_sessions
                SET
                  status = 'completed',
                  phase = 'completed',
                  error_code = NULL,
                  error_message = NULL,
                  image_id = (SELECT id FROM images WHERE images.upload_id = upload_sessions.id),
                  duration_ms = MAX(0, CAST((julianday('now') - julianday(created_at)) * 86400000 AS INTEGER)),
                  completed_at = CURRENT_TIMESTAMP,
                  updated_at = CURRENT_TIMESTAMP
                WHERE status = 'pending'
                  AND id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
              `,
              params: [pendingJson],
            },
          ]);
        } catch (error) {
          if (/unique constraint|constraint failed/i.test(String(error?.message ?? error))) {
            if (/images\.content_sha256/i.test(String(error?.message ?? error))) {
              const duplicates = await this.getImagesByContentHashes(
                initialSessions.map((session) => session.contentSha256).filter(Boolean),
              );
              throw repositoryError("DUPLICATE_IMAGE_CONTENT", "Image content already exists.", {
                uploadIds: pendingIds,
                duplicates,
              });
            }
            throw repositoryError("UPLOAD_STORAGE_CONFLICT", "An upload storage key is already owned by another image.", {
              uploadIds: pendingIds,
            });
          }
          throw error;
        }
      }

      const sessions = await this.getUploadSessionsByIds(ids);
      const incomplete = sessions.find((session) => session.status !== "completed" || !session.imageId);
      if (incomplete) {
        throw repositoryError("UPLOAD_IMAGE_MISSING", "A completed upload session has no image record.", {
          uploadId: incomplete.id,
        });
      }
      const images = await loadImagesByIds(database, sessions.map((session) => session.imageId));
      const imagesById = new Map(images.map((image) => [image.id, image]));
      const actualRows = await all(
        database,
        `
          SELECT image_id AS imageId, tag_id AS tagId
          FROM image_tags
          WHERE image_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
          ORDER BY image_id, tag_id
        `,
        [JSON.stringify(sessions.map((session) => session.imageId))],
      );
      const actualByImageId = new Map();
      for (const row of actualRows) {
        const current = actualByImageId.get(Number(row.imageId)) ?? [];
        current.push(Number(row.tagId));
        actualByImageId.set(Number(row.imageId), current);
      }

      return sessions.map((session) => {
        const image = imagesById.get(session.imageId);
        if (!image) {
          throw repositoryError("UPLOAD_IMAGE_MISSING", "A completed upload session has no image record.", {
            uploadId: session.id,
          });
        }
        const actualTagIds = normalizeIntegerIds(actualByImageId.get(session.imageId) ?? []);
        if (!sameIntegerIds(session.tagIds, actualTagIds)) {
          throw repositoryError("IMAGE_TAG_VERIFICATION_FAILED", "The saved image tags do not match the upload session.", {
            uploadId: session.id,
            imageId: image.id,
            expectedTagIds: session.tagIds,
            actualTagIds,
          });
        }
        return {
          session,
          image,
          expectedTagIds: [...session.tagIds],
          actualTagIds,
          idempotent: initialById.get(session.id)?.status === "completed",
        };
      });
    },

    async upsertImage({
      publicId = globalThis.crypto.randomUUID(),
      contentSha256 = null,
      storageKey,
      fileName,
      fileUrl,
      width,
      height,
      syncStatus,
      note = null,
      categoryId = null,
    }) {
      const normalizedPublicId = normalizePublicId(publicId);
      const normalizedContentSha256 = normalizeContentSha256(contentSha256);
      await run(
        database,
        `
          INSERT INTO images (
            public_id, content_sha256, storage_key, file_name, file_url,
            width, height, sync_status, note, category_id
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(storage_key) DO UPDATE SET
            file_name = excluded.file_name,
            file_url = excluded.file_url,
            width = excluded.width,
            height = excluded.height,
            sync_status = excluded.sync_status,
            note = excluded.note,
            category_id = excluded.category_id,
            content_sha256 = COALESCE(excluded.content_sha256, images.content_sha256),
            updated_at = CURRENT_TIMESTAMP
        `,
        [
          normalizedPublicId,
          normalizedContentSha256,
          storageKey,
          fileName,
          fileUrl,
          width ?? null,
          height ?? null,
          syncStatus ?? "ok",
          note,
          categoryId ?? null,
        ],
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

    async getImageByPublicId(publicId) {
      const normalizedPublicId = normalizePublicId(publicId);
      const image = await first(
        database,
        `
          SELECT ${SELECT_IMAGE_COLUMNS}
          FROM images
          LEFT JOIN categories ON categories.id = images.category_id
          WHERE images.public_id = ?
        `,
        [normalizedPublicId],
      );

      if (!image) return null;
      return attachTagNames([mapImageRow(image)], await getImageTagRows(database, [image.id]))[0];
    },

    async getImageByStorageKey(storageKey) {
      const image = await first(
        database,
        `
          SELECT ${SELECT_IMAGE_COLUMNS}
          FROM images
          LEFT JOIN categories ON categories.id = images.category_id
          WHERE images.storage_key = ?
        `,
        [storageKey],
      );

      if (!image) {
        return null;
      }

      return attachTagNames([mapImageRow(image)], await getImageTagRows(database, [image.id]))[0];
    },

    async getImagesByContentHashes(contentHashes) {
      const hashes = [...new Set((Array.isArray(contentHashes) ? contentHashes : [])
        .map((value) => normalizeContentSha256(value))
        .filter(Boolean))];
      if (!hashes.length) return [];
      if (hashes.length > 50) throw new RangeError("No more than 50 content hashes may be queried at once.");
      const rows = await all(
        database,
        `
          SELECT ${SELECT_IMAGE_COLUMNS}
          FROM images
          LEFT JOIN categories ON categories.id = images.category_id
          WHERE images.content_sha256 IN (SELECT CAST(value AS TEXT) FROM json_each(?))
        `,
        [JSON.stringify(hashes)],
      );
      const imagesByHash = new Map(rows.map((row) => {
        const image = mapImageRow(row);
        return [image.contentSha256, image];
      }));
      return hashes.map((hash) => imagesByHash.get(hash)).filter(Boolean);
    },

    async getExistingImageIds(imageIds) {
      const normalizedImageIds = normalizeIntegerIds(imageIds);
      if (!normalizedImageIds.length) return [];
      const rows = await all(
        database,
        `
          SELECT id
          FROM images
          WHERE id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
          ORDER BY id
        `,
        [JSON.stringify(normalizedImageIds)],
      );
      return normalizeIntegerIds(rows.map((row) => row.id));
    },

    async setImageContentHashes(assignments) {
      const normalized = (Array.isArray(assignments) ? assignments : []).map((assignment) => ({
        imageId: Number(assignment?.imageId),
        expectedStorageKey: String(assignment?.expectedStorageKey ?? "").trim(),
        expectedFileUrl: String(assignment?.expectedFileUrl ?? "").trim(),
        contentSha256: normalizeContentSha256(assignment?.contentSha256, { required: true }),
      }));
      if (!normalized.length || normalized.length > 100) {
        throw new RangeError("Content hash updates require between 1 and 100 images.");
      }
      if (normalized.some((assignment) => !Number.isInteger(assignment.imageId)
        || assignment.imageId <= 0
        || !assignment.expectedStorageKey
        || !assignment.expectedFileUrl)) {
        throw repositoryError("INVALID_CONTENT_HASH_ASSIGNMENT", "Every content hash update requires an image ID and expected file identity.");
      }
      if (new Set(normalized.map((assignment) => assignment.imageId)).size !== normalized.length) {
        throw repositoryError("DUPLICATE_CONTENT_HASH_ASSIGNMENT", "Each image may appear only once in a content hash batch.");
      }

      const assignmentsJson = JSON.stringify(normalized);
      const existingRows = await all(
        database,
        `
          SELECT id, storage_key AS storageKey, file_url AS fileUrl
          FROM images
          WHERE id IN (
            SELECT CAST(json_extract(value, '$.imageId') AS INTEGER)
            FROM json_each(?)
          )
        `,
        [assignmentsJson],
      );
      const existingById = new Map(existingRows.map((row) => [Number(row.id), row]));
      const missingImageIds = normalized
        .filter((assignment) => !existingById.has(assignment.imageId))
        .map((assignment) => assignment.imageId);
      if (missingImageIds.length) {
        throw repositoryError("IMAGE_NOT_FOUND", "One or more images do not exist.", { missingImageIds });
      }
      const changed = normalized.find((assignment) => {
        const current = existingById.get(assignment.imageId);
        return current.storageKey !== assignment.expectedStorageKey
          || current.fileUrl !== assignment.expectedFileUrl;
      });
      if (changed) {
        throw repositoryError("IMAGE_IDENTITY_CHANGED", "An image moved while its content hash was being calculated.", {
          imageId: changed.imageId,
        });
      }

      await run(
        database,
        `
          WITH assignments AS (
            SELECT
              CAST(json_extract(value, '$.imageId') AS INTEGER) AS image_id,
              json_extract(value, '$.contentSha256') AS content_sha256
            FROM json_each(?)
          )
          UPDATE images
          SET
            content_sha256 = (
              SELECT assignments.content_sha256
              FROM assignments
              WHERE assignments.image_id = images.id
            ),
            updated_at = CURRENT_TIMESTAMP
          WHERE id IN (SELECT image_id FROM assignments)
        `,
        [assignmentsJson],
      );

      const verifiedRows = await all(
        database,
        `
          SELECT id AS imageId, content_sha256 AS contentSha256
          FROM images
          WHERE id IN (
            SELECT CAST(json_extract(value, '$.imageId') AS INTEGER)
            FROM json_each(?)
          )
          ORDER BY id
        `,
        [assignmentsJson],
      );
      const actualById = new Map(verifiedRows.map((row) => [Number(row.imageId), row.contentSha256]));
      const mismatch = normalized.find((assignment) => actualById.get(assignment.imageId) !== assignment.contentSha256);
      if (mismatch) {
        throw repositoryError("IMAGE_HASH_VERIFICATION_FAILED", "The saved image content hash did not match the expected value.", {
          imageId: mismatch.imageId,
        });
      }
      return normalized;
    },

    async listImages() {
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

    async scanImageIds({ afterImageId = 0, snapshotMaxImageId = null, limit = 50 } = {}) {
      const normalizedAfterImageId = Number(afterImageId);
      const normalizedLimit = Number(limit);
      if (!Number.isInteger(normalizedAfterImageId) || normalizedAfterImageId < 0) {
        throw new RangeError("afterImageId must be a non-negative integer");
      }
      if (!Number.isInteger(normalizedLimit) || normalizedLimit < 1 || normalizedLimit > 100) {
        throw new RangeError("limit must be an integer between 1 and 100");
      }

      let normalizedSnapshotMaxImageId;
      if (snapshotMaxImageId === null || snapshotMaxImageId === undefined) {
        const snapshot = await first(database, `SELECT COALESCE(MAX(id), 0) AS snapshotMaxImageId FROM images`);
        normalizedSnapshotMaxImageId = Number(snapshot?.snapshotMaxImageId ?? 0);
      } else {
        normalizedSnapshotMaxImageId = Number(snapshotMaxImageId);
      }
      if (!Number.isInteger(normalizedSnapshotMaxImageId) || normalizedSnapshotMaxImageId < 0) {
        throw new RangeError("snapshotMaxImageId must be a non-negative integer");
      }
      if (normalizedAfterImageId > normalizedSnapshotMaxImageId) {
        throw new RangeError("afterImageId must not exceed snapshotMaxImageId");
      }

      const rows = await all(
        database,
        `
          SELECT
            id AS imageId,
            public_id AS publicId,
            content_sha256 AS contentSha256
          FROM images
          WHERE id > ? AND id <= ?
          ORDER BY id ASC
          LIMIT ?
        `,
        [normalizedAfterImageId, normalizedSnapshotMaxImageId, normalizedLimit + 1],
      );
      const hasMore = rows.length > normalizedLimit;
      const items = rows.slice(0, normalizedLimit).map((row) => ({
        imageId: Number(row.imageId),
        publicId: row.publicId ?? null,
        contentSha256: row.contentSha256 ?? null,
      }));
      const lastItem = items.at(-1);
      return {
        snapshotMaxImageId: normalizedSnapshotMaxImageId,
        afterImageId: normalizedAfterImageId,
        count: items.length,
        limit: normalizedLimit,
        hasMore,
        nextAfterImageId: hasMore ? lastItem?.imageId ?? null : null,
        items,
      };
    },

    async listImagesPage({ query = "", fileNameQuery = null, tagIds = [], sort = "newest", limit = 50, offset = 0 } = {}) {
      const fileNameOnly = fileNameQuery !== null && fileNameQuery !== undefined;
      const normalizedQuery = String(fileNameOnly ? fileNameQuery : query ?? "").trim();
      const normalizedLimit = Number(limit);
      const normalizedOffset = Number(offset);
      if (!Number.isInteger(normalizedLimit) || normalizedLimit < 1 || normalizedLimit > 100) {
        throw new RangeError("limit must be an integer between 1 and 100");
      }
      if (!Number.isInteger(normalizedOffset) || normalizedOffset < 0) {
        throw new RangeError("offset must be a non-negative integer");
      }
      if (normalizedQuery.length > 200) {
        throw new RangeError("query must not exceed 200 characters");
      }
      const normalizedTagIds = normalizeIntegerIds(tagIds);
      const normalizedSort = sort === "name" ? "name" : "newest";
      const whereParts = [];
      const filterParams = [];
      if (normalizedQuery) {
        if (fileNameOnly) {
          whereParts.push(`instr(lower(images.file_name), lower(?)) > 0`);
          filterParams.push(normalizedQuery);
        } else {
          whereParts.push(`(
            instr(lower(images.file_name), lower(?)) > 0
            OR instr(lower(categories.name), lower(?)) > 0
            OR EXISTS (
              SELECT 1 FROM image_tags
              INNER JOIN tags ON tags.id = image_tags.tag_id
              WHERE image_tags.image_id = images.id
                AND instr(lower(tags.name), lower(?)) > 0
            )
          )`);
          filterParams.push(normalizedQuery, normalizedQuery, normalizedQuery);
        }
      }
      if (normalizedTagIds.length) {
        whereParts.push(`images.id IN (
          SELECT image_id FROM image_tags
          WHERE tag_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
          GROUP BY image_id
          HAVING COUNT(DISTINCT tag_id) = ?
        )`);
        filterParams.push(JSON.stringify(normalizedTagIds), normalizedTagIds.length);
      }
      const whereSql = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
      const orderSql = normalizedSort === "name"
        ? "lower(images.file_name) ASC, images.id ASC"
        : "images.created_at DESC, images.id DESC";
      const countRow = await first(
        database,
        `
          SELECT COUNT(*) AS totalCount
          FROM images
          LEFT JOIN categories ON categories.id = images.category_id
          ${whereSql}
        `,
        filterParams,
      );
      const imageRows = await all(
        database,
        `
          SELECT ${SELECT_IMAGE_COLUMNS}
          FROM images
          LEFT JOIN categories ON categories.id = images.category_id
          ${whereSql}
          ORDER BY ${orderSql}
          LIMIT ? OFFSET ?
        `,
        [...filterParams, normalizedLimit, normalizedOffset],
      );
      const images = imageRows.map(mapImageRow);
      const taggedImages = attachTagNames(
        images,
        await getImageTagRows(database, images.map((image) => image.id)),
      );
      const totalCount = Number(countRow?.totalCount ?? 0);
      return {
        images: taggedImages,
        totalCount,
        count: taggedImages.length,
        offset: normalizedOffset,
        limit: normalizedLimit,
        sort: normalizedSort,
        tagIds: normalizedTagIds,
        hasMore: normalizedOffset + taggedImages.length < totalCount,
        nextOffset: normalizedOffset + taggedImages.length < totalCount
          ? normalizedOffset + taggedImages.length
          : null,
      };
    },

    async listImagesByIds(imageIds) {
      return await loadImagesByIds(database, imageIds);
    },

    async updateImage(imageId, changes) {
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

    async updateImageStorage(imageId, { storageKey, fileName, fileUrl, syncStatus = "ok", note = null }) {
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
              sync_status = ?,
              note = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        [storageKey, fileName, fileUrl, syncStatus, note, imageId],
      );

      return {
        ...current,
        storageKey,
        fileName,
        fileUrl,
        syncStatus,
        note,
      };
    },

    async updateImageSyncState(imageId, { syncStatus, note = null }) {
      const current = await this.getImageById(imageId);
      if (!current) {
        return null;
      }

      await run(
        database,
        `
          UPDATE images
          SET sync_status = ?, note = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        [syncStatus, note, imageId],
      );

      return {
        ...current,
        syncStatus,
        note,
      };
    },

    async deleteImage(imageId) {
      await run(database, `DELETE FROM image_tags WHERE image_id = ?`, [imageId]);
      await run(database, `DELETE FROM featured_images WHERE image_id = ?`, [imageId]);
      await run(database, `DELETE FROM album_images WHERE image_id = ?`, [imageId]);
      const result = await run(database, `DELETE FROM images WHERE id = ?`, [imageId]);

      return Number(result?.meta?.changes ?? result?.changes ?? 0) > 0;
    },

    async replaceImageTags(imageId, tagIds) {
      return (await this.replaceImageTagAssignments([{ imageId, tagIds }]))[0];
    },

    async replaceImageTagsForImages(imageIds, tagIds) {
      const normalizedImageIds = normalizeIntegerIds(imageIds);
      if (!normalizedImageIds.length) return;
      return await this.replaceImageTagAssignments(
        normalizedImageIds.map((imageId) => ({ imageId, tagIds })),
      );
    },

    async replaceImageTagAssignments(assignments) {
      const normalizedAssignments = normalizeTagAssignments(assignments);
      if (!normalizedAssignments.length) return [];
      const imageIds = normalizedAssignments.map((assignment) => assignment.imageId);
      const existingImageIds = new Set(await this.getExistingImageIds(imageIds));
      const missingImageIds = imageIds.filter((imageId) => !existingImageIds.has(imageId));
      if (missingImageIds.length) {
        throw repositoryError("IMAGE_NOT_FOUND", "One or more images do not exist.", { missingImageIds });
      }

      const expectedTagIds = normalizeIntegerIds(normalizedAssignments.flatMap((assignment) => assignment.tagIds));
      const existingTagIds = new Set(await this.getExistingTagIds(expectedTagIds));
      const missingTagIds = expectedTagIds.filter((tagId) => !existingTagIds.has(tagId));
      if (missingTagIds.length) {
        throw repositoryError("TAG_NOT_FOUND", "One or more tags do not exist.", { missingTagIds });
      }

      const assignmentsJson = JSON.stringify(normalizedAssignments);
      await runBatch(database, tagAssignmentEntries(assignmentsJson));
      const actualRows = await all(
        database,
        `
          SELECT image_id AS imageId, tag_id AS tagId
          FROM image_tags
          WHERE image_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
          ORDER BY image_id, tag_id
        `,
        [JSON.stringify(imageIds)],
      );
      const actualByImageId = new Map();
      for (const row of actualRows) {
        const current = actualByImageId.get(Number(row.imageId)) ?? [];
        current.push(Number(row.tagId));
        actualByImageId.set(Number(row.imageId), current);
      }
      const verified = normalizedAssignments.map((assignment) => ({
        imageId: assignment.imageId,
        tagIds: normalizeIntegerIds(actualByImageId.get(assignment.imageId) ?? []),
      }));
      const mismatch = normalizedAssignments.find((assignment, index) => (
        !sameIntegerIds(assignment.tagIds, verified[index].tagIds)
      ));
      if (mismatch) {
        const actual = verified.find((assignment) => assignment.imageId === mismatch.imageId);
        throw repositoryError(
          "IMAGE_TAG_VERIFICATION_FAILED",
          "The saved image tags do not match the requested tag set.",
          {
            imageId: mismatch.imageId,
            expectedTagIds: mismatch.tagIds,
            actualTagIds: actual?.tagIds ?? [],
          },
        );
      }
      return verified;
    },

    async createAiAnalysisBatch({ id, name, imageIds, snapshotMaxImageId = null, operationId = null, source = "mcp" }) {
      const batchId = String(id ?? "").trim();
      const normalizedName = String(name ?? "").trim().slice(0, 160);
      const normalizedImageIds = normalizeIntegerIds(imageIds);
      if (!UUID_PATTERN.test(batchId) || !normalizedName || !normalizedImageIds.length || normalizedImageIds.length > 100) {
        throw repositoryError("INVALID_AI_ANALYSIS_BATCH", "A UUID, name, and 1-100 image IDs are required.");
      }
      const existingIds = new Set(await this.getExistingImageIds(normalizedImageIds));
      const missingImageIds = normalizedImageIds.filter((imageId) => !existingIds.has(imageId));
      if (missingImageIds.length) throw repositoryError("IMAGE_NOT_FOUND", "One or more images do not exist.", { missingImageIds });
      const itemsJson = JSON.stringify(normalizedImageIds);
      await runBatch(database, [
        {
          sql: `INSERT INTO ai_analysis_batches (id, name, source, snapshot_max_image_id, operation_id) VALUES (?, ?, ?, ?, ?)`,
          params: [batchId, normalizedName, String(source ?? "mcp").slice(0, 40), snapshotMaxImageId, operationId],
        },
        {
          sql: `
            INSERT INTO ai_analysis_items (batch_id, image_id, content_sha256)
            SELECT ?, images.id, images.content_sha256
            FROM images
            WHERE images.id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
          `,
          params: [batchId, itemsJson],
        },
      ]);
      return await this.getAiAnalysisBatch(batchId);
    },

    async getAiAnalysisBatch(batchId) {
      const row = await first(database, `
        SELECT batches.id, batches.name, batches.status, batches.source,
          batches.snapshot_max_image_id AS snapshotMaxImageId,
          batches.operation_id AS operationId,
          batches.created_at AS createdAt, batches.updated_at AS updatedAt,
          COUNT(items.image_id) AS imageCount,
          SUM(CASE WHEN items.status = 'pending' THEN 1 ELSE 0 END) AS pendingCount,
          SUM(CASE WHEN items.status = 'proposed' THEN 1 ELSE 0 END) AS proposedCount,
          SUM(CASE WHEN items.status = 'applied' THEN 1 ELSE 0 END) AS appliedCount
        FROM ai_analysis_batches AS batches
        LEFT JOIN ai_analysis_items AS items ON items.batch_id = batches.id
        WHERE batches.id = ? GROUP BY batches.id
      `, [batchId]);
      return row ? {
        ...row,
        snapshotMaxImageId: row.snapshotMaxImageId === null ? null : Number(row.snapshotMaxImageId),
        imageCount: Number(row.imageCount ?? 0), pendingCount: Number(row.pendingCount ?? 0),
        proposedCount: Number(row.proposedCount ?? 0), appliedCount: Number(row.appliedCount ?? 0),
      } : null;
    },

    async listAiAnalysisBatches({ limit = 20, offset = 0 } = {}) {
      const ids = await all(database, `SELECT id FROM ai_analysis_batches ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`, [limit, offset]);
      return (await Promise.all(ids.map((row) => this.getAiAnalysisBatch(row.id)))).filter(Boolean);
    },

    async submitAiImageProposal({
      id, batchId, imageId, proposedFileName, proposedCategoryId, proposedTagIds = [],
      newTagCandidates = [], rationale = "", confidence = null,
    }) {
      const proposalId = String(id ?? "").trim();
      const normalizedImageId = Number(imageId);
      const categoryId = Number(proposedCategoryId);
      const tagIds = normalizeIntegerIds(proposedTagIds);
      const fileName = String(proposedFileName ?? "").trim();
      if (!UUID_PATTERN.test(proposalId) || !UUID_PATTERN.test(String(batchId ?? ""))
        || !Number.isInteger(normalizedImageId) || !Number.isInteger(categoryId) || !fileName) {
        throw repositoryError("INVALID_AI_PROPOSAL", "Proposal identity, image, file name, and category are required.");
      }
      const currentImage = await this.getImageById(normalizedImageId);
      if (!currentImage) throw repositoryError("IMAGE_NOT_FOUND", "The proposed image does not exist.");
      if (sanitizeFileName(fileName) !== fileName || /[\\/\u0000-\u001f\u007f]/.test(fileName)
        || getFileExtension(fileName).toLocaleLowerCase("en-US") !== getFileExtension(currentImage.fileName).toLocaleLowerCase("en-US")) {
        throw repositoryError("INVALID_PROPOSED_FILE_NAME", "The proposed basename must be safe and keep the original file extension.");
      }
      const item = await first(database, `SELECT status FROM ai_analysis_items WHERE batch_id = ? AND image_id = ?`, [batchId, normalizedImageId]);
      if (!item) throw repositoryError("ANALYSIS_ITEM_NOT_FOUND", "The image is not part of this analysis batch.");
      const category = await this.getCategoryById(categoryId);
      if (!category) throw repositoryError("CATEGORY_NOT_FOUND", "The proposed category does not exist.");
      const existingTagIds = new Set(await this.getExistingTagIds(tagIds));
      const missingTagIds = tagIds.filter((tagId) => !existingTagIds.has(tagId));
      if (missingTagIds.length) throw repositoryError("TAG_NOT_FOUND", "One or more proposed tags do not exist.", { missingTagIds });

      const candidates = (Array.isArray(newTagCandidates) ? newTagCandidates : []).map((candidate) => ({
        displayName: normalizeTagName(candidate?.name),
        normalizedName: normalizeTagName(candidate?.name).toLocaleLowerCase("zh-CN"),
        groupId: Number(candidate?.groupId),
      })).filter((candidate) => candidate.displayName && Number.isInteger(candidate.groupId) && candidate.groupId > 0);
      if (candidates.length > 20) throw repositoryError("TOO_MANY_TAG_CANDIDATES", "A proposal may suggest at most 20 new tags.");
      const groupIds = normalizeIntegerIds(candidates.map((candidate) => candidate.groupId));
      const existingGroupIds = new Set((await Promise.all(groupIds.map((groupId) => this.getTagGroupById(groupId))))
        .filter(Boolean).map((group) => Number(group.id)));
      const missingGroupIds = groupIds.filter((groupId) => !existingGroupIds.has(groupId));
      if (missingGroupIds.length) throw repositoryError("TAG_GROUP_NOT_FOUND", "One or more suggested tag groups do not exist.", { missingGroupIds });

      for (const candidate of candidates) {
        await run(database, `
          INSERT INTO ai_tag_candidates (normalized_name, display_name, suggested_group_id)
          VALUES (?, ?, ?)
          ON CONFLICT(normalized_name, suggested_group_id) DO UPDATE SET
            display_name = excluded.display_name, updated_at = CURRENT_TIMESTAMP
        `, [candidate.normalizedName, candidate.displayName, candidate.groupId]);
      }
      const candidateRows = candidates.length ? await all(database, `
        SELECT id FROM ai_tag_candidates
        WHERE (normalized_name || ':' || suggested_group_id) IN (
          SELECT json_extract(value, '$.normalizedName') || ':' || json_extract(value, '$.groupId') FROM json_each(?)
        )
      `, [JSON.stringify(candidates)]) : [];
      const candidateIds = normalizeIntegerIds(candidateRows.map((row) => row.id));
      const candidateIdsJson = JSON.stringify(candidateIds);
      await runBatch(database, [
        {
          sql: `
            INSERT INTO ai_image_proposals (
              id, batch_id, image_id, proposed_file_name, proposed_category_id,
              proposed_tag_ids, candidate_tag_ids, rationale, confidence
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(batch_id, image_id) DO UPDATE SET
              proposed_file_name = excluded.proposed_file_name,
              proposed_category_id = excluded.proposed_category_id,
              proposed_tag_ids = excluded.proposed_tag_ids,
              candidate_tag_ids = excluded.candidate_tag_ids,
              rationale = excluded.rationale,
              confidence = excluded.confidence,
              status = 'pending', review_note = NULL, reviewed_at = NULL,
              error_code = NULL, error_message = NULL, updated_at = CURRENT_TIMESTAMP
          `,
          params: [proposalId, batchId, normalizedImageId, fileName, categoryId, JSON.stringify(tagIds), candidateIdsJson, String(rationale ?? "").slice(0, 2000), confidence],
        },
        { sql: `DELETE FROM ai_proposal_candidate_tags WHERE proposal_id = (SELECT id FROM ai_image_proposals WHERE batch_id = ? AND image_id = ?)`, params: [batchId, normalizedImageId] },
        {
          sql: `
            INSERT INTO ai_proposal_candidate_tags (proposal_id, candidate_id)
            SELECT proposals.id, CAST(value AS INTEGER)
            FROM ai_image_proposals AS proposals, json_each(?)
            WHERE proposals.batch_id = ? AND proposals.image_id = ?
          `,
          params: [candidateIdsJson, batchId, normalizedImageId],
        },
        { sql: `UPDATE ai_analysis_items SET status = 'proposed', updated_at = CURRENT_TIMESTAMP WHERE batch_id = ? AND image_id = ?`, params: [batchId, normalizedImageId] },
        { sql: `UPDATE ai_analysis_batches SET status = 'reviewing', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, params: [batchId] },
      ]);
      await run(database, `
        UPDATE ai_tag_candidates SET occurrence_count = MAX(1, (
          SELECT COUNT(*) FROM ai_proposal_candidate_tags WHERE candidate_id = ai_tag_candidates.id
        )), updated_at = CURRENT_TIMESTAMP
        WHERE id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
      `, [candidateIdsJson]);
      return await this.getAiImageProposalByBatchImage(batchId, normalizedImageId);
    },

    async getAiImageProposalByBatchImage(batchId, imageId) {
      const row = await first(database, `
        SELECT ${SELECT_AI_PROPOSAL_COLUMNS}
        FROM ai_image_proposals AS proposals
        INNER JOIN ai_analysis_batches AS batches ON batches.id = proposals.batch_id
        INNER JOIN images ON images.id = proposals.image_id
        LEFT JOIN categories AS current_categories ON current_categories.id = images.category_id
        INNER JOIN categories AS proposed_categories ON proposed_categories.id = proposals.proposed_category_id
        WHERE proposals.batch_id = ? AND proposals.image_id = ?
      `, [batchId, imageId]);
      return mapAiProposal(row);
    },

    async getAiImageProposal(proposalId) {
      const row = await first(database, `
        SELECT ${SELECT_AI_PROPOSAL_COLUMNS}
        FROM ai_image_proposals AS proposals
        INNER JOIN ai_analysis_batches AS batches ON batches.id = proposals.batch_id
        INNER JOIN images ON images.id = proposals.image_id
        LEFT JOIN categories AS current_categories ON current_categories.id = images.category_id
        INNER JOIN categories AS proposed_categories ON proposed_categories.id = proposals.proposed_category_id
        WHERE proposals.id = ?
      `, [proposalId]);
      return mapAiProposal(row);
    },

    async listAiImageProposals({ status = "pending", batchId = null, limit = 50, offset = 0 } = {}) {
      const where = ["(? = 'all' OR proposals.status = ?)", "(? IS NULL OR proposals.batch_id = ?)"];
      const params = [status, status, batchId, batchId];
      const countRow = await first(database, `SELECT COUNT(*) AS totalCount FROM ai_image_proposals AS proposals WHERE ${where.join(" AND ")}`, params);
      const rows = await all(database, `
        SELECT ${SELECT_AI_PROPOSAL_COLUMNS}
        FROM ai_image_proposals AS proposals
        INNER JOIN ai_analysis_batches AS batches ON batches.id = proposals.batch_id
        INNER JOIN images ON images.id = proposals.image_id
        LEFT JOIN categories AS current_categories ON current_categories.id = images.category_id
        INNER JOIN categories AS proposed_categories ON proposed_categories.id = proposals.proposed_category_id
        WHERE ${where.join(" AND ")}
        ORDER BY proposals.created_at DESC, proposals.id DESC LIMIT ? OFFSET ?
      `, [...params, limit, offset]);
      const proposals = rows.map(mapAiProposal);
      const candidateIds = normalizeIntegerIds(proposals.flatMap((proposal) => proposal.candidateTagIds));
      const candidateRows = candidateIds.length ? await all(database, `
        SELECT candidates.id, candidates.display_name AS name, candidates.suggested_group_id AS groupId,
          candidates.status, candidates.occurrence_count AS occurrenceCount,
          candidates.created_tag_id AS createdTagId, tag_groups.name AS groupName
        FROM ai_tag_candidates AS candidates
        INNER JOIN tag_groups ON tag_groups.id = candidates.suggested_group_id
        WHERE candidates.id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
      `, [JSON.stringify(candidateIds)]) : [];
      const candidateById = new Map(candidateRows.map((candidate) => [Number(candidate.id), { ...candidate, id: Number(candidate.id), groupId: Number(candidate.groupId), occurrenceCount: Number(candidate.occurrenceCount), createdTagId: candidate.createdTagId === null ? null : Number(candidate.createdTagId) }]));
      const tagRows = await this.listTags();
      const tagById = new Map(tagRows.map((tag) => [Number(tag.id), { id: Number(tag.id), name: tag.name }]));
      return {
        proposals: proposals.map((proposal) => ({
          ...proposal,
          proposedTags: proposal.proposedTagIds.map((id) => tagById.get(id)).filter(Boolean),
          tagCandidates: proposal.candidateTagIds.map((id) => candidateById.get(id)).filter(Boolean),
        })),
        totalCount: Number(countRow?.totalCount ?? 0), count: proposals.length, limit, offset,
        hasMore: offset + proposals.length < Number(countRow?.totalCount ?? 0),
        nextOffset: offset + proposals.length < Number(countRow?.totalCount ?? 0) ? offset + proposals.length : null,
      };
    },

    async reviewAiImageProposals(proposalIds, { status, note = "" } = {}) {
      const ids = [...new Set((Array.isArray(proposalIds) ? proposalIds : []).map(String).filter((id) => UUID_PATTERN.test(id)))];
      if (!ids.length || !["approved", "rejected"].includes(status)) throw repositoryError("INVALID_PROPOSAL_REVIEW", "Proposal IDs and an approved/rejected status are required.");
      await runBatch(database, [
        {
          sql: `UPDATE ai_image_proposals SET status = ?, review_note = ?, reviewed_at = CURRENT_TIMESTAMP, error_code = NULL, error_message = NULL, updated_at = CURRENT_TIMESTAMP WHERE status IN ('pending','approved','rejected','failed') AND id IN (SELECT CAST(value AS TEXT) FROM json_each(?))`,
          params: [status, String(note ?? "").slice(0, 1000), JSON.stringify(ids)],
        },
        {
          sql: `UPDATE ai_analysis_items SET status = 'reviewed', updated_at = CURRENT_TIMESTAMP WHERE (batch_id, image_id) IN (SELECT batch_id, image_id FROM ai_image_proposals WHERE id IN (SELECT CAST(value AS TEXT) FROM json_each(?)))`,
          params: [JSON.stringify(ids)],
        },
      ]);
      return (await Promise.all(ids.map((id) => this.getAiImageProposal(id)))).filter(Boolean);
    },

    async listAiTagCandidates({ status = "pending", limit = 50, offset = 0 } = {}) {
      return await all(database, `
        SELECT candidates.id, candidates.display_name AS name, candidates.suggested_group_id AS groupId,
          tag_groups.name AS groupName, candidates.status, candidates.occurrence_count AS occurrenceCount,
          candidates.created_tag_id AS createdTagId, candidates.created_at AS createdAt
        FROM ai_tag_candidates AS candidates INNER JOIN tag_groups ON tag_groups.id = candidates.suggested_group_id
        WHERE (? = 'all' OR candidates.status = ?)
        ORDER BY candidates.occurrence_count DESC, candidates.id DESC LIMIT ? OFFSET ?
      `, [status, status, limit, offset]).then((rows) => rows.map((row) => ({ ...row, id: Number(row.id), groupId: Number(row.groupId), occurrenceCount: Number(row.occurrenceCount), createdTagId: row.createdTagId === null ? null : Number(row.createdTagId) })));
    },

    async reviewAiTagCandidate(candidateId, { status } = {}) {
      const id = Number(candidateId);
      if (!Number.isInteger(id) || !["approved", "rejected"].includes(status)) throw repositoryError("INVALID_TAG_CANDIDATE_REVIEW", "Candidate ID and approved/rejected status are required.");
      const candidate = await first(database, `SELECT * FROM ai_tag_candidates WHERE id = ?`, [id]);
      if (!candidate) return null;
      let createdTagId = candidate.created_tag_id === null ? null : Number(candidate.created_tag_id);
      if (status === "approved" && !createdTagId) {
        const existing = await first(database, `SELECT id, group_id AS groupId FROM tags WHERE lower(name) = lower(?)`, [candidate.display_name]);
        if (existing && Number(existing.groupId) !== Number(candidate.suggested_group_id)) {
          throw repositoryError("AI_TAG_GROUP_CONFLICT", "A tag with this name already exists in another parent group.");
        }
        const tag = existing ?? await this.createTag({ name: candidate.display_name, groupId: Number(candidate.suggested_group_id) });
        createdTagId = Number(tag.id);
      }
      await run(database, `UPDATE ai_tag_candidates SET status = ?, created_tag_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [status, createdTagId, id]);
      return (await this.listAiTagCandidates({ status: "all", limit: 100, offset: 0 })).find((item) => item.id === id) ?? null;
    },

    async applyAiProposalMetadata(proposalId, { storageKey, fileName, fileUrl }) {
      const proposal = await this.getAiImageProposal(proposalId);
      if (!proposal) throw repositoryError("AI_PROPOSAL_NOT_FOUND", "Proposal not found.");
      if (proposal.status !== "approved") throw repositoryError("AI_PROPOSAL_NOT_APPROVED", "Only approved proposals may be applied.");
      const candidates = proposal.candidateTagIds.length ? await all(database, `SELECT id, status, created_tag_id AS createdTagId FROM ai_tag_candidates WHERE id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))`, [JSON.stringify(proposal.candidateTagIds)]) : [];
      const unresolved = candidates.filter((candidate) => candidate.status === "pending" || (candidate.status === "approved" && !candidate.createdTagId));
      if (unresolved.length) throw repositoryError("AI_TAG_CANDIDATES_UNRESOLVED", "Approve or reject every proposed new tag before applying this image.", { candidateIds: unresolved.map((item) => Number(item.id)) });
      const tagIds = normalizeIntegerIds([...proposal.proposedTagIds, ...candidates.filter((candidate) => candidate.status === "approved").map((candidate) => candidate.createdTagId)]);
      const assignmentsJson = JSON.stringify([{ imageId: proposal.imageId, tagIds }]);
      await runBatch(database, [
        { sql: `UPDATE images SET storage_key = ?, file_name = ?, file_url = ?, category_id = ?, sync_status = 'ok', note = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, params: [storageKey, fileName, fileUrl, proposal.proposedCategoryId, proposal.imageId] },
        ...tagAssignmentEntries(assignmentsJson),
        { sql: `UPDATE ai_image_proposals SET status = 'applied', applied_at = CURRENT_TIMESTAMP, error_code = NULL, error_message = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'approved'`, params: [proposalId] },
        { sql: `UPDATE ai_analysis_items SET status = 'applied', updated_at = CURRENT_TIMESTAMP WHERE batch_id = ? AND image_id = ?`, params: [proposal.batchId, proposal.imageId] },
      ]);
      const actualTagIds = await this.getImageTagIds(proposal.imageId);
      if (!sameIntegerIds(actualTagIds, tagIds)) throw repositoryError("IMAGE_TAG_VERIFICATION_FAILED", "Applied proposal tags did not verify.", { expectedTagIds: tagIds, actualTagIds });
      const appliedProposal = await this.getAiImageProposal(proposalId);
      const appliedImage = await this.getImageById(proposal.imageId);
      if (!appliedProposal || appliedProposal.status !== "applied" || !appliedImage
        || appliedImage.storageKey !== storageKey || appliedImage.fileName !== fileName
        || Number(appliedImage.category?.id) !== Number(proposal.proposedCategoryId)) {
        throw repositoryError("AI_PROPOSAL_VERIFICATION_FAILED", "Applied proposal metadata did not verify.");
      }
      return { proposal: appliedProposal, image: appliedImage, tagIds };
    },

    async failAiImageProposal(proposalId, error) {
      await run(database, `UPDATE ai_image_proposals SET status = 'failed', error_code = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [String(error?.code ?? "AI_PROPOSAL_APPLY_FAILED").slice(0, 80), String(error?.message ?? error).replace(/\s+/g, " ").slice(0, 240), proposalId]);
    },

    async listImagesByTagSlugs(tagSlugs) {
      const normalizedSlugs = [...new Set((Array.isArray(tagSlugs) ? tagSlugs : [tagSlugs]).map((slug) => String(slug ?? "").trim()).filter(Boolean))];
      if (!normalizedSlugs.length) return [];
      const placeholders = normalizedSlugs.map(() => "?").join(", ");
      const imageRows = await all(
        database,
        `
          SELECT DISTINCT ${SELECT_IMAGE_COLUMNS}
          FROM images
          LEFT JOIN categories ON categories.id = images.category_id
          WHERE images.id IN (
            SELECT image_tags.image_id
            FROM image_tags
            INNER JOIN tags ON tags.id = image_tags.tag_id
            WHERE tags.slug IN (${placeholders})
              AND tags.is_visible = 1
            GROUP BY image_tags.image_id
            HAVING COUNT(DISTINCT tags.slug) = ?
          )
          ORDER BY images.created_at DESC, images.id DESC
        `,
        [...normalizedSlugs, normalizedSlugs.length],
      );

      const images = imageRows.map(mapImageRow);
      return attachTagNames(images, await getImageTagRows(database, images.map((image) => image.id)));
    },

    async listImagesByTagSlug(tagSlug) {
      return await this.listImagesByTagSlugs([tagSlug]);
    },
  };
}

