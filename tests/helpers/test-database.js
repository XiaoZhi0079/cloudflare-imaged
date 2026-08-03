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
) + "\n" + readFileSync(
  new URL("../../migrations/0004_upload_sessions.sql", import.meta.url),
  "utf8",
) + "\n" + readFileSync(
  new URL("../../migrations/0005_upload_operations_and_paging.sql", import.meta.url),
  "utf8",
) + "\n" + readFileSync(
  new URL("../../migrations/0006_image_identity_and_hash.sql", import.meta.url),
  "utf8",
) + "\n" + readFileSync(
  new URL("../../migrations/0007_unique_image_content.sql", import.meta.url),
  "utf8",
) + "\n" + readFileSync(
  new URL("../../migrations/0008_upload_task_tracking.sql", import.meta.url),
  "utf8",
) + "\n" + readFileSync(
  new URL("../../migrations/0009_ai_organization_workflow.sql", import.meta.url),
  "utf8",
);

export function createTestDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(BASELINE_SQL);
  return database;
}

export function enforceBoundParameterLimit(database, limit = 100) {
  const parameterCounts = [];
  const wrapStatement = (statement) => new Proxy(statement, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== "function" || !["all", "get", "run"].includes(property)) {
        return typeof value === "function" ? value.bind(target) : value;
      }
      return (...params) => {
        parameterCounts.push(params.length);
        if (params.length > limit) throw new RangeError(`too many bound parameters: ${params.length}`);
        return value.apply(target, params);
      };
    },
  });
  const guarded = new Proxy(database, {
    get(target, property) {
      if (property === "prepare") return (sql) => wrapStatement(target.prepare(sql));
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { database: guarded, parameterCounts };
}
