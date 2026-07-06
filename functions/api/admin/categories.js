import { getRepository, requireAdminKey, toApiCategory } from "./_shared.js";
import { jsonResponse, parseRequestJson } from "../../../src/shared/http.js";

function normalizeOptionalName(value) {
  if (value === undefined) {
    return undefined;
  }

  return String(value ?? "").trim();
}

function normalizeOptionalDirectorySlug(value) {
  if (value === undefined) {
    return undefined;
  }

  return String(value ?? "").trim();
}

function isDuplicateCategoryError(error) {
  return /unique constraint failed/i.test(String(error?.message ?? ""));
}

export async function onRequest({ env, request }) {
  const authFailure = requireAdminKey(request, env);
  if (authFailure) {
    return authFailure;
  }

  const repository = getRepository(env);

  if (request.method === "GET") {
    const categories = await repository.listCategories();
    return jsonResponse({
      categories: categories.map(toApiCategory),
    });
  }

  if (request.method === "POST") {
    const body = await parseRequestJson(request);
    const name = normalizeOptionalName(body.name);
    const directorySlug = normalizeOptionalDirectorySlug(body.directorySlug);

    if (!name) {
      return jsonResponse({ error: "分类名称不能为空。" }, 400);
    }

    if (!directorySlug) {
      return jsonResponse({ error: "分类目录不能为空。" }, 400);
    }

    try {
      const category = await repository.createCategory({
        name,
        directorySlug,
        sortOrder: body.sortOrder ?? 0,
      });

      return jsonResponse({
        category: toApiCategory(category),
      }, 201);
    } catch (error) {
      if (isDuplicateCategoryError(error)) {
        return jsonResponse({ error: "分类名称或目录已存在。" }, 409);
      }

      throw error;
    }
  }

  if (request.method === "PATCH") {
    const body = await parseRequestJson(request);
    const categoryId = Number(body?.id);

    if (!Number.isInteger(categoryId) || categoryId <= 0) {
      return jsonResponse({ error: "Category id is required" }, 400);
    }

    const name = normalizeOptionalName(body.name);
    if (body.name !== undefined && !name) {
      return jsonResponse({ error: "分类名称不能为空。" }, 400);
    }

    try {
      const category = await repository.updateCategory(categoryId, {
        name,
        sortOrder: body.sortOrder,
      });

      if (!category) {
        return jsonResponse({ error: "Category not found" }, 404);
      }

      return jsonResponse({
        category: toApiCategory(category),
      });
    } catch (error) {
      if (isDuplicateCategoryError(error)) {
        return jsonResponse({ error: "分类名称已存在。" }, 409);
      }

      throw error;
    }
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
}
