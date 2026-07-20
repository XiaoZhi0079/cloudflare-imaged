import { getRepository, requireAdminKey, toApiTagGroup } from "./_shared.js";
import { jsonResponse, parseRequestJson } from "../../../src/shared/http.js";

function duplicate(error) {
  return /unique constraint failed/i.test(String(error?.message ?? error));
}

export async function onRequest({ env, request }) {
  const authFailure = requireAdminKey(request, env);
  if (authFailure) return authFailure;
  const repository = getRepository(env);

  if (request.method === "GET") {
    const groups = await repository.listTagGroups();
    const tags = await repository.listTags();
    const counts = new Map();
    for (const tag of tags) counts.set(Number(tag.group_id), (counts.get(Number(tag.group_id)) ?? 0) + 1);
    return jsonResponse({ tagGroups: groups.map((group) => toApiTagGroup({ ...group, tagCount: counts.get(Number(group.id)) ?? 0 })) });
  }

  const body = await parseRequestJson(request);
  try {
    if (request.method === "POST") {
      const group = await repository.createTagGroup({ name: body?.name, sortOrder: body?.sortOrder ?? 0 });
      return jsonResponse({ tagGroup: toApiTagGroup(group) }, 201);
    }
    const id = Number(body?.id);
    if (!Number.isInteger(id) || id <= 0) return jsonResponse({ error: "Tag group id is required" }, 400);
    if (request.method === "PATCH") {
      const group = await repository.updateTagGroup(id, { name: body.name, sortOrder: body.sortOrder });
      return group ? jsonResponse({ tagGroup: toApiTagGroup(group) }) : jsonResponse({ error: "Tag group not found" }, 404);
    }
    if (request.method === "DELETE") {
      const deleted = await repository.deleteTagGroup(id);
      return deleted
        ? jsonResponse({ deletedTagGroupId: id })
        : jsonResponse({ error: "Tag group not found" }, 404);
    }
    return jsonResponse({ error: "Method not allowed" }, 405);
  } catch (error) {
    if (duplicate(error)) return jsonResponse({ error: "标签分类已存在。" }, 409);
    if (/required|empty|must be empty/i.test(String(error?.message ?? error))) return jsonResponse({ error: "标签分类名称不能为空，且删除前必须清空分类内标签。" }, 400);
    throw error;
  }
}
