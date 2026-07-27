import { z } from "zod";

import type { TagSelection } from "../types.js";

export const ResponseFormatSchema = z.enum(["json", "markdown"]).default("json");
export const TagIdsSchema = z.array(z.number().int().positive()).min(1).max(100);
export const TagSelectionSchema = z.object({
  group_id: z.number().int().positive().describe("Parent tag group ID from gallery_get_taxonomy."),
  tag_ids: TagIdsSchema.describe("Child tag IDs that belong to this parent group."),
}).strict();
export const TagSelectionsSchema = z.array(TagSelectionSchema).min(1).max(50)
  .describe("Grouped child tag selections. Each parent group may appear only once.");

export type ExternalTagSelection = z.infer<typeof TagSelectionSchema>;

export function internalTagSelections(selections: ExternalTagSelection[]): TagSelection[] {
  return selections.map((selection) => ({
    groupId: selection.group_id,
    tagIds: selection.tag_ids,
  }));
}

