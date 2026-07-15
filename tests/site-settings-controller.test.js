import test from "node:test";
import assert from "node:assert/strict";

import { mergeFeaturedSelection } from "../public/assets/admin/site-settings.js";

test("featured selection keeps existing order and appends new images in library order", () => {
  const current = [{ id: 3 }, { id: 1 }, { id: 2 }];
  const library = [{ id: 4 }, { id: 3 }, { id: 2 }, { id: 1 }, { id: 5 }];

  const merged = mergeFeaturedSelection(current, library, [1, 3, 4, 5]);

  assert.deepEqual(merged.map((image) => image.id), [3, 1, 4, 5]);
});
