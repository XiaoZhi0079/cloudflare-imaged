import test from "node:test";
import assert from "node:assert/strict";

import { selectLargestFile } from "../scripts/demo-db-files.mjs";

test("selectLargestFile compares byte sizes instead of path lengths", () => {
  const sizes = new Map([
    ["short.sqlite", 64],
    ["a-much-longer-name.sqlite", 8],
    ["data.sqlite", 512],
  ]);

  const selected = selectLargestFile([...sizes.keys()], (path) => sizes.get(path));

  assert.equal(selected, "data.sqlite");
});

test("selectLargestFile returns null for an empty list", () => {
  assert.equal(selectLargestFile([], () => 0), null);
});
