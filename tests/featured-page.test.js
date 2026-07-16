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
  assert.match(source, /retry:\s*document\.querySelector\("#featured-retry"\)/);
  assert.match(source, /elements\.retry\.addEventListener\("click"/);
  assert.match(source, /elements\.retry\.hidden = false/);
  assert.match(source, /elements\.retry\.hidden = true/);
  assert.match(source, /elements\.retry\.disabled = true/);
  assert.match(source, /elements\.logout\.disabled = true/);
  assert.match(source, /elements\.logout\.disabled = false/);
});

test("featured entry ignores a pending reload after logout", () => {
  const source = readFileSync(entryUrl, "utf8");
  assert.match(source, /let authAttempt = 0/);
  assert.match(source, /const attempt = \+\+authAttempt/);
  assert.match(source, /if \(attempt !== authAttempt\) return/);
  assert.match(
    source,
    /elements\.logout\.addEventListener[\s\S]*authAttempt \+= 1[\s\S]*keyStore\.clear\(\)/,
  );
});
