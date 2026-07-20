import { getRepository, toApiTag } from "../admin/_shared.js";
import { jsonResponse } from "../../../src/shared/http.js";

export async function onRequest({ env }) {
  try {
    const repository = getRepository(env);
    const tags = await repository.listVisibleTags();

    const apiTags = tags.map((tag) => {
      const apiTag = toApiTag(tag);

      return {
        id: apiTag.id,
        name: apiTag.name,
        slug: apiTag.slug,
        sortOrder: apiTag.sortOrder,
        groupId: apiTag.groupId,
        group: apiTag.group,
      };
    });
    const groupsById = new Map();
    for (const tag of apiTags) {
      const group = tag.group;
      if (!group) continue;
      const current = groupsById.get(Number(group.id)) ?? { ...group, tags: [] };
      current.tags.push({ id: tag.id, name: tag.name, slug: tag.slug, sortOrder: tag.sortOrder });
      groupsById.set(Number(group.id), current);
    }
    return jsonResponse({
      tags: apiTags,
      tagGroups: [...groupsById.values()],
    });
  } catch (error) {
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
}
