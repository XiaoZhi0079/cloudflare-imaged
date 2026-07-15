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
