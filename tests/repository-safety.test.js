import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

test("generated demo assets are ignored by Git", () => {
  const gitignore = readFileSync(new URL("../.gitignore", import.meta.url), "utf8");
  assert.match(gitignore, /^public\/demo\/$/m);
});

test("local launchers expose runtime configuration as Wrangler bindings", () => {
  const launchers = [
    readFileSync(new URL("../start-local.cmd", import.meta.url), "utf8"),
    readFileSync(new URL("../start-local.sh", import.meta.url), "utf8"),
  ];
  const bindingNames = [
    "GALLERY_ADMIN_KEY",
    "GALLERY_PUBLIC_BASE_URL",
    "GALLERY_UPLOAD_NAME_TYPE",
    "GALLERY_UPLOAD_FOLDER",
    "R2_BUCKET_NAME",
  ];

  for (const launcher of launchers) {
    for (const bindingName of bindingNames) {
      assert.match(
        launcher,
        new RegExp(`--binding[ \\t]+["']?${bindingName}=`),
        `missing Wrangler binding for ${bindingName}`,
      );
    }
  }
});

test("local launchers listen on loopback by default", () => {
  const launchers = [
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    readFileSync(new URL("../start-local.cmd", import.meta.url), "utf8"),
    readFileSync(new URL("../start-local.sh", import.meta.url), "utf8"),
  ];

  for (const launcher of launchers) {
    assert.doesNotMatch(launcher, /--ip[ \t]+0\.0\.0\.0/);
    assert.match(launcher, /--ip[ \t]+127\.0\.0\.1/);
  }
});

test("local launchers apply D1 migrations before starting Pages", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const windowsLauncher = readFileSync(new URL("../start-local.cmd", import.meta.url), "utf8");
  const shellLauncher = readFileSync(new URL("../start-local.sh", import.meta.url), "utf8");
  const migrationCommand = "npx wrangler d1 migrations apply GALLERY_DB --local --persist-to ./.wrangler/state";

  assert.equal(packageJson.scripts["db:migrate:local"], migrationCommand);
  assert.match(packageJson.scripts.dev, /^npm run db:migrate:local && /);

  for (const launcher of [windowsLauncher, shellLauncher]) {
    const migrationIndex = launcher.indexOf("wrangler d1 migrations apply GALLERY_DB");
    const pagesIndex = launcher.indexOf("wrangler pages dev");
    assert.notEqual(migrationIndex, -1, "launcher must apply migrations");
    assert.ok(migrationIndex < pagesIndex, "migration must run before Pages");
  }

  assert.match(windowsLauncher, /if errorlevel 1 exit \/b 1/i);
  assert.match(shellLauncher, /set -euo pipefail/);
});

test("local Pages launchers reuse the D1 identity from wrangler.toml", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const launchersAndGuidance = [
    packageJson.scripts.dev,
    readFileSync(new URL("../start-local.cmd", import.meta.url), "utf8"),
    readFileSync(new URL("../start-local.sh", import.meta.url), "utf8"),
    readFileSync(new URL("../scripts/seed-local-demo.mjs", import.meta.url), "utf8"),
  ];

  for (const source of launchersAndGuidance) {
    assert.doesNotMatch(
      source,
      /--d1[ \t]+GALLERY_DB/,
      "--d1 creates a local-GALLERY_DB alias that differs from the migration database",
    );
  }
});

test("advanced prototype uses portable committed demo assets", () => {
  const prototypeUrl = new URL(
    "../docs/prototypes/magazine/advanced-01-03.html",
    import.meta.url,
  );
  const prototype = readFileSync(prototypeUrl, "utf8");
  const assetPaths = [...prototype.matchAll(/["'](\.\/assets\/[^"']+\.svg)["']/g)]
    .map((match) => match[1]);

  assert.doesNotMatch(prototype, /file:\/\/\/|[A-Z]:\\Users\\/i);
  assert.ok(assetPaths.length > 0, "prototype should reference repository demo assets");
  for (const assetPath of new Set(assetPaths)) {
    assert.equal(existsSync(new URL(assetPath, prototypeUrl)), true, `missing ${assetPath}`);
  }
});

test("GitHub sync uses protected normal push instead of force push", () => {
  const script = readFileSync(new URL("../sync-github.cmd", import.meta.url), "utf8");
  assert.doesNotMatch(script, /push[^\r\n]*--force/i);
  assert.match(script, /push -u origin main\r?$/m);
});

test("Cloudflare deployment guide never recommends overwriting remote history", () => {
  const guide = readFileSync(
    new URL("../docs/cloudflare-pages-deploy.zh-CN.md", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(guide, /git push[^\r\n]*--force/i);
  assert.doesNotMatch(guide, /执行强推|覆盖远端主分支|旧的大仓库结构/);
  assert.match(guide, /git push -u origin main/);
});

test("Cloudflare deployment guide migrates the reviewed main SHA before pushing it", () => {
  const guide = readFileSync(
    new URL("../docs/cloudflare-pages-deploy.zh-CN.md", import.meta.url),
    "utf8",
  );
  const mainIndex = guide.indexOf("git switch main");
  const configIndex = guide.indexOf("Get-Content .\\wrangler.toml");
  const releaseShaIndex = guide.indexOf("$releaseSha = git rev-parse HEAD");
  const migrationIndex = guide.indexOf(
    "npx wrangler d1 migrations apply GALLERY_DB --remote",
  );
  const pushIndex = guide.indexOf("git push -u origin main");

  assert.ok(mainIndex >= 0, "guide must start the release from local main");
  assert.ok(configIndex > mainIndex, "guide must inspect wrangler.toml from local main");
  assert.ok(releaseShaIndex > configIndex, "guide must pin the final reviewed SHA");
  assert.ok(migrationIndex > releaseShaIndex, "remote migration must target the pinned release");
  assert.ok(pushIndex > migrationIndex, "the same SHA is pushed only after migration succeeds");
});

test("Cloudflare D1 preflight documents every table, foreign key, and index", () => {
  const guide = readFileSync(
    new URL("../docs/cloudflare-pages-deploy.zh-CN.md", import.meta.url),
    "utf8",
  );
  const tables = [
    "tags",
    "categories",
    "images",
    "image_tags",
    "site_settings",
    "featured_images",
  ];
  const indexes = [
    "idx_tags_visible_order",
    "idx_categories_order",
    "idx_images_file_id",
    "idx_images_category_id",
    "idx_image_tags_image_id",
    "idx_image_tags_tag_id",
    "idx_featured_images_order",
  ];

  for (const table of tables) {
    assert.match(guide, new RegExp(`PRAGMA table_info\\(${table}\\)`));
    assert.match(guide, new RegExp(`PRAGMA foreign_key_list\\(${table}\\)`));
  }
  for (const index of indexes) {
    assert.match(guide, new RegExp(`\\b${index}\\b`));
  }
  assert.match(guide, /COUNT\(DISTINCT sort_order\)/);
  assert.match(guide, /d1 migrations list GALLERY_DB --remote/);
});
