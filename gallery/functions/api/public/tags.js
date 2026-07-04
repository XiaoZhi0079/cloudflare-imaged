import { getRepository, toApiTag } from "../admin/_shared.js";
import { jsonResponse } from "../../../src/shared/http.js";

export async function onRequest({ env }) {
  const repository = getRepository(env);
  const tags = await repository.listVisibleTags();

  return jsonResponse({
    tags: tags.map((tag) => {
      const apiTag = toApiTag(tag);

      return {
        id: apiTag.id,
        name: apiTag.name,
        slug: apiTag.slug,
        sortOrder: apiTag.sortOrder,
      };
    }),
  });
}
