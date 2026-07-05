import { requireAdminKey } from "../_shared.js";
import { jsonResponse } from "../../../../src/shared/http.js";

export async function onRequest({ env, request }) {
  const authFailure = requireAdminKey(request, env);
  if (authFailure) {
    return authFailure;
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  return jsonResponse({
    error: "Image import has been removed from Gallery.",
  }, 410);
}
