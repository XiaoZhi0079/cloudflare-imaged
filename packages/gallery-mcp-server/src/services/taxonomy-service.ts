import { GalleryApiError, GalleryMcpError } from "../errors.js";
import type { GalleryApiClient } from "./gallery-client.js";
import type { GalleryTaxonomy, Tag, TagGroup, TagSelection } from "../types.js";

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase("zh-CN");
}

export class TaxonomyService {
  private cache: { value: GalleryTaxonomy; expiresAt: number } | null = null;

  constructor(private readonly api: GalleryApiClient, private readonly cacheTtlMs = 30_000) {}

  invalidate(): void {
    this.cache = null;
  }

  async get(): Promise<GalleryTaxonomy> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.value;
    const value = await this.api.getTaxonomy();
    this.cache = { value, expiresAt: Date.now() + this.cacheTtlMs };
    return value;
  }

  private tagIdsFromSelections(taxonomy: GalleryTaxonomy, selections: TagSelection[]): number[] {
    if (!selections.length) {
      throw new GalleryMcpError("At least one grouped tag selection is required.", {
        code: "TAG_SELECTIONS_REQUIRED",
        suggestion: "Call gallery_get_taxonomy and select one or more child tags under their parent groups.",
      });
    }

    const knownGroups = new Map(taxonomy.tagGroups.map((group) => [group.id, group]));
    const knownTags = new Map(taxonomy.tags.map((tag) => [tag.id, tag]));
    const selectedGroups = new Set<number>();
    const selectedTags = new Set<number>();
    const tagIds: number[] = [];

    for (const selection of selections) {
      if (selectedGroups.has(selection.groupId)) {
        throw new GalleryMcpError(`Tag group ${selection.groupId} appears more than once.`, {
          code: "DUPLICATE_TAG_GROUP_SELECTION",
          suggestion: "Merge tags from the same parent group into one tag_selections item.",
        });
      }
      selectedGroups.add(selection.groupId);

      if (!knownGroups.has(selection.groupId)) {
        throw new GalleryMcpError(`Tag group ${selection.groupId} does not exist.`, {
          code: "TAG_GROUP_NOT_FOUND",
          status: 404,
          suggestion: "Call gallery_get_taxonomy and use a current parent group ID.",
        });
      }

      if (!selection.tagIds.length) {
        throw new GalleryMcpError(`Tag group ${selection.groupId} has no selected child tags.`, {
          code: "EMPTY_TAG_GROUP_SELECTION",
          suggestion: "Remove the empty group or select at least one child tag under it.",
        });
      }

      for (const tagId of selection.tagIds) {
        if (selectedTags.has(tagId)) {
          throw new GalleryMcpError(`Tag ${tagId} appears more than once.`, {
            code: "DUPLICATE_TAG_SELECTION",
            suggestion: "Include each child tag exactly once in tag_selections.",
          });
        }
        selectedTags.add(tagId);

        const tag = knownTags.get(tagId);
        if (!tag) {
          throw new GalleryMcpError(`Tag ${tagId} does not exist.`, {
            code: "TAG_NOT_FOUND",
            status: 404,
            suggestion: "Call gallery_get_taxonomy, ensure the missing child tag, and retry.",
          });
        }
        const actualGroupId = Number(tag.groupId ?? tag.group?.id ?? 0);
        if (actualGroupId !== selection.groupId) {
          throw new GalleryMcpError(`Tag ${tagId} does not belong to tag group ${selection.groupId}.`, {
            code: "TAG_GROUP_MISMATCH",
            status: 409,
            suggestion: `Place tag ${tagId} under its actual parent group ${actualGroupId || "shown by gallery_get_taxonomy"}.`,
            details: {
              tag_id: tagId,
              declared_group_id: selection.groupId,
              actual_group_id: actualGroupId || null,
            },
          });
        }
        tagIds.push(tagId);
      }
    }

    if (tagIds.length > 100) {
      throw new GalleryMcpError("No more than 100 child tags may be assigned in one operation.", {
        code: "TOO_MANY_TAG_SELECTIONS",
        suggestion: "Reduce tag_selections to the most relevant child tags.",
      });
    }
    return tagIds;
  }

  async validateTagSelections(selections: TagSelection[]): Promise<number[]> {
    return this.tagIdsFromSelections(await this.get(), selections);
  }

  async validateUploadSelection(directoryId: number, selections: TagSelection[]): Promise<number[]> {
    const taxonomy = await this.get();
    if (!taxonomy.categories.some((directory) => directory.id === directoryId)) {
      throw new GalleryMcpError(`Upload directory ${directoryId} does not exist.`, {
        code: "DIRECTORY_NOT_FOUND",
        status: 404,
        suggestion: "Call gallery_get_taxonomy and use a current directory ID.",
      });
    }
    return this.tagIdsFromSelections(taxonomy, selections);
  }

  async ensureTagGroup(name: string, sortOrder = 0): Promise<{ tagGroup: TagGroup; created: boolean }> {
    const existing = (await this.get()).tagGroups.find((group) => normalized(group.name) === normalized(name));
    if (existing) return { tagGroup: existing, created: false };

    try {
      const tagGroup = await this.api.createTagGroup(name, sortOrder);
      this.invalidate();
      return { tagGroup, created: true };
    } catch (error) {
      if (!(error instanceof GalleryApiError) || error.status !== 409) throw error;
      this.invalidate();
      const concurrent = (await this.get()).tagGroups.find((group) => normalized(group.name) === normalized(name));
      if (concurrent) return { tagGroup: concurrent, created: false };
      throw new GalleryMcpError("Gallery rejected the new tag group as a duplicate, but the existing group could not be found.", {
        code: "TAXONOMY_CONFLICT_UNRESOLVED",
        status: 409,
        suggestion: "Refresh the taxonomy and retry the operation.",
        cause: error,
      });
    }
  }

  async ensureTag(
    name: string,
    groupId: number,
    sortOrder = 0,
  ): Promise<{ tag: Tag; created: boolean }> {
    const taxonomy = await this.get();
    const group = taxonomy.tagGroups.find((item) => item.id === groupId);
    if (!group) {
      throw new GalleryMcpError(`Tag group ${groupId} does not exist.`, {
        code: "TAG_GROUP_NOT_FOUND",
        status: 404,
        suggestion: "Call gallery_get_taxonomy and use a current group ID.",
      });
    }
    const existing = taxonomy.tags.find((tag) => normalized(tag.name) === normalized(name));
    if (existing) {
      if (existing.groupId !== groupId) {
        throw new GalleryMcpError(`Tag '${name}' already belongs to another tag group.`, {
          code: "TAG_GROUP_CONFLICT",
          status: 409,
          suggestion: "Use the existing tag or move it explicitly in the admin UI.",
        });
      }
      return { tag: existing, created: false };
    }

    try {
      const tag = await this.api.createTag({ name, groupId, sortOrder });
      this.invalidate();
      return { tag, created: true };
    } catch (error) {
      if (!(error instanceof GalleryApiError) || error.status !== 409) throw error;
      this.invalidate();
      const concurrent = (await this.get()).tags.find((tag) => normalized(tag.name) === normalized(name));
      if (concurrent && concurrent.groupId === groupId) return { tag: concurrent, created: false };
      throw new GalleryMcpError("Gallery rejected the new tag as a duplicate, but it could not be safely reused.", {
        code: "TAXONOMY_CONFLICT_UNRESOLVED",
        status: 409,
        suggestion: "Refresh the taxonomy and resolve the tag conflict before uploading.",
        cause: error,
      });
    }
  }
}
