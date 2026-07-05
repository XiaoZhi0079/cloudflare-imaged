import { jsonResponse } from "../../../../../src/shared/http.js";

export async function onRequest() {
  return jsonResponse(
    {
      error: "Gallery 已改为直传 R2，请使用 /api/admin/images/upload/init 和 /api/admin/images/upload/complete。",
    },
    410,
  );
}
