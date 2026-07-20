import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export const BASELINE_SQL = readFileSync(
  new URL("../../migrations/0001_baseline.sql", import.meta.url),
  "utf8",
) + "\n" + readFileSync(
  new URL("../../migrations/0002_albums.sql", import.meta.url),
  "utf8",
) + "\n" + readFileSync(
  new URL("../../migrations/0003_tag_groups.sql", import.meta.url),
  "utf8",
);

export function createTestDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(BASELINE_SQL);
  return database;
}
