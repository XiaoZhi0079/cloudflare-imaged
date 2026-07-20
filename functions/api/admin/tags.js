import { getRepository, requireAdminKey, toApiTag, toApiTagGroup } from "./_shared.js";
import { jsonResponse, parseRequestJson } from "../../../src/shared/http.js";

function normalizeOptionalTagName(value) {
  if (value === undefined) {
    return undefined;
  }

  return String(value ?? "").trim();
}

function isDuplicateTagError(error) {
  return /unique constraint failed/i.test(String(error?.message ?? ""));
}

export async function onRequest({ env, request }) {
  const authFailure = requireAdminKey(request, env);
  if (authFailure) {
    return authFailure;
  }

  const repository = getRepository(env);

  if (request.method === "GET") {
    const tags = await repository.listTags();
    const groups = await repository.listTagGroups();

    return jsonResponse({
      tags: tags.map(toApiTag),
      tagGroups: groups.map(toApiTagGroup),
    });
  }

  if (request.method === "POST") {
    const body = await parseRequestJson(request);
    const name = normalizeOptionalTagName(body.name);

    if (!name) {
      return jsonResponse({ error: "标签名称不能为空。" }, 400);
    }
    const groupId = Number(body.groupId);
    if (!Number.isInteger(groupId) || groupId <= 0) {
      return jsonResponse({ error: "请选择标签分类。" }, 400);
    }

    try {
      const tag = await repository.createTag({
        name,
        groupId,
        sortOrder: body.sortOrder ?? 0,
        isVisible: body.isVisible ?? true,
      });

      return jsonResponse(
        {
          tag: toApiTag(tag),
        },
        201,
      );
    } catch (error) {
      if (isDuplicateTagError(error)) {
        return jsonResponse({ error: "标签已存在。" }, 409);
      }

      throw error;
    }
  }

  if (request.method === "PATCH") {
    const body = await parseRequestJson(request);

    if (!Number.isInteger(body.id) || body.id <= 0) {
      return jsonResponse({ error: "Tag id is required" }, 400);
    }

    const name = normalizeOptionalTagName(body.name);
    if (body.name !== undefined && !name) {
      return jsonResponse({ error: "标签名称不能为空。" }, 400);
    }
    const groupId = body.groupId === undefined ? undefined : Number(body.groupId);
    if (body.groupId !== undefined && (!Number.isInteger(groupId) || groupId <= 0)) {
      return jsonResponse({ error: "请选择标签分类。" }, 400);
    }

    try {
      const tag = await repository.updateTag(body.id, {
        name,
        groupId,
        sortOrder: body.sortOrder,
        isVisible: body.isVisible,
      });

      if (!tag) {
        return jsonResponse({ error: "Tag not found" }, 404);
      }

      return jsonResponse({
        tag: toApiTag(tag),
      });
    } catch (error) {
      if (isDuplicateTagError(error)) {
        return jsonResponse({ error: "标签已存在。" }, 409);
      }

      throw error;
    }
  }

  if (request.method === "DELETE") {
    const body = await parseRequestJson(request);

    if (!Number.isInteger(body.id) || body.id <= 0) {
      return jsonResponse({ error: "Tag id is required" }, 400);
    }

    const deleted = await repository.deleteTag(body.id);

    if (!deleted) {
      return jsonResponse({ error: "Tag not found" }, 404);
    }

    return jsonResponse({
      deletedTagId: body.id,
    });
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
}
