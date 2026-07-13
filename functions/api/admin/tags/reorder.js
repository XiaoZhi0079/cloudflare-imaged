import {
  getRepository,
  parseCompleteOrder,
  requireAdminKey,
  toApiTag,
} from "../_shared.js";
import { jsonResponse, parseRequestJson } from "../../../../src/shared/http.js";

export async function onRequest({ env, request }) {
  const authFailure = requireAdminKey(request, env);
  if (authFailure) {
    return authFailure;
  }

  if (request.method !== "PATCH") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const parsed = parseCompleteOrder((await parseRequestJson(request)).items);
  if (parsed.error) {
    return jsonResponse({ error: parsed.error }, 400);
  }

  try {
    const tags = await getRepository(env).reorderTags(parsed.items.map((item) => item.id));
    return jsonResponse({ tags: tags.map(toApiTag) });
  } catch (error) {
    if (error instanceof RangeError) {
      return jsonResponse({ error: "排序内容必须包含全部标签。" }, 400);
    }
    throw error;
  }
}
