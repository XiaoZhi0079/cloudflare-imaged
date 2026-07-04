import test from "node:test";
import assert from "node:assert/strict";

import { jsonResponse, parseRequestJson } from "../src/shared/http.js";

test("jsonResponse returns JSON body and default content type", async () => {
  const response = jsonResponse({ ok: true }, 201);

  assert.equal(response.status, 201);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.deepEqual(await response.json(), { ok: true });
});

test("parseRequestJson reads a valid JSON request body", async () => {
  const request = new Request("https://gallery.test/api", {
    method: "POST",
    body: JSON.stringify({ tag: "日本美女" }),
    headers: { "content-type": "application/json" },
  });

  assert.deepEqual(await parseRequestJson(request), { tag: "日本美女" });
});
