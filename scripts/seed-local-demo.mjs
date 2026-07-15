import { mkdirSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { createGalleryRepository } from "../src/server/gallery-repository.js";
import { selectLargestFile } from "./demo-db-files.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const demoDir = join(root, "public", "demo");
const d1Dir = join(root, ".wrangler", "state", "v3", "d1", "miniflare-D1DatabaseObject");

const BASE_URL = process.env.GALLERY_PUBLIC_ORIGIN || "http://127.0.0.1:8788";

const DEMO_IMAGES = [
  { key: "seed-01", title: "侧光", color: "#8b5a44", accent: "#2a1d18" },
  { key: "seed-02", title: "红调", color: "#9a3f3a", accent: "#2b1212" },
  { key: "seed-03", title: "蓝裙", color: "#3f5f8a", accent: "#121a2b" },
  { key: "seed-04", title: "柔光", color: "#8a6d4d", accent: "#2c2118" },
  { key: "seed-05", title: "冷调", color: "#4f6674", accent: "#152027" },
  { key: "seed-06", title: "轮廓", color: "#6a4f62", accent: "#1d151c" },
];

const DEMO_TAGS = [
  { name: "人像", sortOrder: 1 },
  { name: "侧光", sortOrder: 2 },
  { name: "红调", sortOrder: 3 },
];

function findLocalD1Path() {
  if (!existsSync(d1Dir)) {
    throw new Error(
      "未找到本地 D1 数据库。请先启动一次本地服务：\n" +
      "  bash start-local.sh\n" +
      "或：\n" +
      "  npm run dev",
    );
  }

  const files = readdirSync(d1Dir)
    .filter((name) => name.endsWith(".sqlite") && name !== "metadata.sqlite")
    .map((name) => join(d1Dir, name));

  if (!files.length) {
    throw new Error("本地 D1 目录存在，但没有数据库文件。请先启动一次本地服务。");
  }

  // Prefer the largest non-metadata sqlite (actual data object).
  return selectLargestFile(files);
}

function writeDemoSvg({ key, title, color, accent }) {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600" viewBox="0 0 1200 1600">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${color}"/>
      <stop offset="100%" stop-color="${accent}"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="1600" fill="url(#g)"/>
  <circle cx="920" cy="280" r="180" fill="rgba(255,255,255,0.08)"/>
  <circle cx="220" cy="1280" r="260" fill="rgba(0,0,0,0.14)"/>
  <text x="90" y="1400" fill="rgba(255,248,240,0.92)" font-size="72" font-family="Georgia, serif">${title}</text>
  <text x="90" y="1480" fill="rgba(255,248,240,0.62)" font-size="34" font-family="Georgia, serif">Demo · ${key}</text>
</svg>
`;
  writeFileSync(join(demoDir, `${key}.svg`), svg, "utf8");
}

async function main() {
  mkdirSync(demoDir, { recursive: true });
  for (const item of DEMO_IMAGES) {
    writeDemoSvg(item);
  }

  const dbPath = findLocalD1Path();
  console.log(`Using local D1: ${dbPath}`);

  const database = new DatabaseSync(dbPath);
  try {
    database.exec("PRAGMA foreign_keys = ON");
  } catch {
    // ignore
  }

  const repository = createGalleryRepository(database);

  const tags = [];
  for (const tag of DEMO_TAGS) {
    const existing = (await repository.listTags()).find((item) => item.name === tag.name);
    if (existing) {
      tags.push(existing);
      continue;
    }
    tags.push(await repository.createTag({ ...tag, isVisible: true }));
  }

  const portrait = tags.find((tag) => tag.name === "人像") ?? tags[0];
  const sideLight = tags.find((tag) => tag.name === "侧光");
  const redTone = tags.find((tag) => tag.name === "红调");

  const createdImages = [];
  for (const [index, item] of DEMO_IMAGES.entries()) {
    const storageKey = `demo/${item.key}.svg`;
    const fileUrl = `${BASE_URL}/demo/${item.key}.svg`;
    const image = await repository.upsertImage({
      storageKey,
      fileName: `${item.key}.svg`,
      fileUrl,
      width: 1200,
      height: 1600,
      syncStatus: "ok",
    });

    const tagIds = [portrait.id];
    if (index % 2 === 0 && sideLight) tagIds.push(sideLight.id);
    if (index % 3 === 0 && redTone) tagIds.push(redTone.id);
    await repository.replaceImageTags(image.id, tagIds);
    createdImages.push(image);
  }

  await repository.updateSiteSettings({
    issueName: "演示期",
    heroCopy: "慢慢看，挑一份喜欢的气质。本期以红调与侧光为主，适合夜色、轮廓与留白。",
  });

  const featuredIds = createdImages.slice(0, 4).map((image) => image.id);
  await repository.setFeaturedImages(featuredIds);

  console.log("Demo seed complete.");
  console.log(`- Demo images: ${createdImages.length} -> ${BASE_URL}/demo/`);
  console.log(`- Tags: ${tags.map((tag) => tag.name).join(", ")}`);
  console.log(`- Featured: ${featuredIds.join(", ")}`);
  console.log("");
  console.log("Next:");
  console.log("1) Start local server (if not running)");
  console.log("2) Open homepage:  http://127.0.0.1:8788/");
  console.log("3) Open settings:  http://127.0.0.1:8788/admin/settings.html  (tab: 站点)");
  console.log("   admin key default: gallery-secret");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
