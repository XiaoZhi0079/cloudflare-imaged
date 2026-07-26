import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { runTool } from "../response.js";
import type { ResponseFormat } from "../types.js";
import { TaxonomyService } from "../services/taxonomy-service.js";

const ResponseFormat = z.enum(["json", "markdown"]).default("json");

function taxonomyView(taxonomy: Awaited<ReturnType<TaxonomyService["get"]>>) {
  const tagsByGroup = new Map<number, typeof taxonomy.tags>();
  for (const tag of taxonomy.tags) {
    const groupId = Number(tag.groupId ?? tag.group?.id ?? 0);
    const current = tagsByGroup.get(groupId) ?? [];
    current.push(tag);
    tagsByGroup.set(groupId, current);
  }

  return {
    tag_groups: taxonomy.tagGroups.map((group) => ({
      id: group.id,
      name: group.name,
      slug: group.slug,
      sort_order: group.sortOrder,
      tag_count: (tagsByGroup.get(group.id) ?? []).length,
      tags: (tagsByGroup.get(group.id) ?? []).map((tag) => ({
        id: tag.id,
        name: tag.name,
        slug: tag.slug,
        sort_order: tag.sortOrder,
        is_visible: tag.isVisible,
      })),
    })),
    ungrouped_tags: (tagsByGroup.get(0) ?? []).map((tag) => ({
      id: tag.id,
      name: tag.name,
      slug: tag.slug,
      sort_order: tag.sortOrder,
      is_visible: tag.isVisible,
    })),
    directories: taxonomy.categories.map((directory) => ({
      id: directory.id,
      name: directory.name,
      directory_slug: directory.directorySlug,
      sort_order: directory.sortOrder,
    })),
  };
}

export function registerTaxonomyTools(server: McpServer, taxonomy: TaxonomyService): void {
  server.registerTool(
    "gallery_get_taxonomy",
    {
      title: "Get Gallery Taxonomy",
      description: "Read the current two-level tag tree and main upload directories. Call this before assigning or creating tags.",
      inputSchema: z.object({
        response_format: ResponseFormat.describe("Return JSON or a Markdown code block."),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ response_format }) => runTool(response_format as ResponseFormat, async () => taxonomyView(await taxonomy.get())),
  );

  server.registerTool(
    "gallery_ensure_tag_group",
    {
      title: "Ensure Gallery Tag Group",
      description: "Find a parent tag group by name, creating it only when absent. Repeated calls are safe and return the existing group.",
      inputSchema: z.object({
        name: z.string().trim().min(1).max(80).describe("Parent group name, such as Clothing or Scene."),
        sort_order: z.number().int().min(0).max(10000).default(0).describe("Optional display order."),
        response_format: ResponseFormat.describe("Return JSON or a Markdown code block."),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ name, sort_order, response_format }) => runTool(response_format as ResponseFormat, async () => {
      const result = await taxonomy.ensureTagGroup(name, sort_order);
      return { tag_group: result.tagGroup, created: result.created };
    }),
  );

  server.registerTool(
    "gallery_ensure_tag",
    {
      title: "Ensure Gallery Tag",
      description: "Find a child tag by name inside a specified parent group, creating it only when absent. It refuses to silently move an existing tag between groups.",
      inputSchema: z.object({
        name: z.string().trim().min(1).max(80).describe("Child tag name, such as Bikini or Floor-to-ceiling window."),
        group_id: z.number().int().positive().describe("Existing parent tag group ID from gallery_get_taxonomy."),
        sort_order: z.number().int().min(0).max(10000).default(0).describe("Optional display order."),
        response_format: ResponseFormat.describe("Return JSON or a Markdown code block."),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ name, group_id, sort_order, response_format }) => runTool(response_format as ResponseFormat, async () => {
      const result = await taxonomy.ensureTag(name, group_id, sort_order);
      return { tag: result.tag, created: result.created };
    }),
  );
}

export { taxonomyView };
