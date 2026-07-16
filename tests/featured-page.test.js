import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const entryUrl = new URL("../public/assets/admin/featured-page.js", import.meta.url);

test("featured entry owns authentication and loads only featured settings", () => {
  assert.equal(existsSync(entryUrl), true, "featured entry module must exist");
  const source = readFileSync(entryUrl, "utf8");
  assert.match(source, /createAdminApiClient/);
  assert.match(source, /createAdminKeyStore/);
  assert.match(source, /createSiteSettingsController/);
  assert.match(source, /featuredController\.load\(\)/);
  assert.match(source, /featuredController\.bind\(\)/);
  assert.doesNotMatch(source, /verifyAdminKey|createSettingsState|\/api\/admin\/categories/);
});

test("featured entry handles logout unauthorized and safe load failures", () => {
  const source = readFileSync(entryUrl, "utf8");
  assert.match(source, /onUnauthorized:[\s\S]*keyStore\.clear\(\)[\s\S]*showAuth/);
  assert.match(source, /AdminUnauthorizedError/);
  assert.match(source, /notifier\.error\(messageFor\(error\)\)/);
  assert.match(source, /elements\.logout\.addEventListener/);
  assert.match(source, /keyStore\.get\(\)/);
});
