import { getImgBedClient, getRepository, requireAdminKey } from "../_shared.js";
import { jsonResponse, parseRequestJson } from "../../../../src/shared/http.js";

export async function onRequest({ env, request }) {
  const authFailure = requireAdminKey(request, env);
  if (authFailure) {
    return authFailure;
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const body = await parseRequestJson(request);
  const repository = getRepository(env);
  const client = getImgBedClient(env);
  const records = await client.listImagesFromManageApi({
    recursive: body.recursive ?? true,
    dir: body.dir ?? "",
  });

  for (const record of records) {
    await repository.upsertImage(record);
  }

  return jsonResponse({
    importedCount: records.length,
  });
}
