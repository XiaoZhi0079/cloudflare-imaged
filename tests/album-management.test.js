import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const moduleUrl = new URL("../public/assets/admin/album-management.js", import.meta.url);

test("album management controller owns multi-album operations", () => {
  assert.equal(existsSync(moduleUrl), true);
  const source = readFileSync(moduleUrl, "utf8");
  for (const contract of [
    "/api/admin/albums", "/api/admin/images", "createAlbumManagementController",
    "create-album", "save-album", "delete-album", "add-images",
    "move-up", "move-down", "remove", "coverImageId", "isHome",
    "轮播可用", "非轮播比例",
  ]) assert.match(source, new RegExp(contract));
});
