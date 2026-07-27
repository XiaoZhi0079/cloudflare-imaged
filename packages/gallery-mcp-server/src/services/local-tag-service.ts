import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { GalleryMcpError } from "../errors.js";
import type { GalleryMcpConfig, TagSelection } from "../types.js";
import { inspectUploadFileMetadata } from "./path-security.js";
import { TaxonomyService } from "./taxonomy-service.js";

const LocalTagDocumentSchema = z.object({
  schema_version: z.literal(1),
  scope: z.literal("local-only"),
  image: z.object({
    file_name: z.string().min(1),
    size_bytes: z.number().int().positive(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }).strict(),
  tag_selections: z.array(z.object({
    group_id: z.number().int().positive(),
    group_name: z.string().min(1),
    group_slug: z.string().min(1),
    tags: z.array(z.object({
      id: z.number().int().positive(),
      name: z.string().min(1),
      slug: z.string().min(1),
    }).strict()).min(1),
  }).strict()).min(1),
  tag_ids: z.array(z.number().int().positive()).min(1),
  updated_at: z.string().min(1),
}).strict();

export type LocalTagDocument = z.infer<typeof LocalTagDocumentSchema>;

function localTagSidecarPath(imagePath: string): string {
  return `${imagePath}.gallery-tags.json`;
}

async function readSidecar(sidecarPath: string): Promise<LocalTagDocument | null> {
  let text: string;
  try {
    text = await readFile(sidecarPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new GalleryMcpError("The local tag sidecar could not be read.", {
      code: "LOCAL_TAG_SIDECAR_READ_FAILED",
      suggestion: "Check file permissions for the image directory and retry.",
      cause: error,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new GalleryMcpError("The local tag sidecar is not valid JSON.", {
      code: "LOCAL_TAG_SIDECAR_INVALID",
      suggestion: "Repair or remove the sidecar, then set the local image tags again.",
      cause: error,
    });
  }
  const result = LocalTagDocumentSchema.safeParse(parsed);
  if (!result.success) {
    throw new GalleryMcpError("The local tag sidecar does not match the supported schema.", {
      code: "LOCAL_TAG_SIDECAR_INVALID",
      suggestion: "Repair or remove the sidecar, then set the local image tags again.",
    });
  }
  return result.data;
}

async function writeSidecarAtomically(sidecarPath: string, document: LocalTagDocument): Promise<void> {
  const temporaryPath = path.join(
    path.dirname(sidecarPath),
    `.${path.basename(sidecarPath)}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, sidecarPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw new GalleryMcpError("The local tag sidecar could not be written.", {
      code: "LOCAL_TAG_SIDECAR_WRITE_FAILED",
      suggestion: "Check write permissions for the image directory and retry.",
      cause: error,
    });
  }
}

function stableDocumentState(document: LocalTagDocument): string {
  return JSON.stringify({
    schema_version: document.schema_version,
    scope: document.scope,
    image: document.image,
    tag_selections: document.tag_selections,
    tag_ids: document.tag_ids,
  });
}

export class LocalTagService {
  constructor(
    private readonly taxonomy: TaxonomyService,
    private readonly config: GalleryMcpConfig,
  ) {}

  async get(localPath: string): Promise<{ imagePath: string; sidecarPath: string; document: LocalTagDocument }> {
    const image = await inspectUploadFileMetadata(localPath, this.config.uploadRoots, this.config.maxFileBytes);
    const sidecarPath = localTagSidecarPath(image.absolutePath);
    const document = await readSidecar(sidecarPath);
    if (!document) {
      throw new GalleryMcpError("No local tag sidecar exists for this image.", {
        code: "LOCAL_TAGS_NOT_FOUND",
        status: 404,
        suggestion: "Use gallery_set_local_image_tags to create local-only tags without uploading the image.",
      });
    }
    return { imagePath: image.absolutePath, sidecarPath, document };
  }

  async set(localPath: string, selections: TagSelection[]): Promise<{
    changed: boolean;
    imagePath: string;
    sidecarPath: string;
    document: LocalTagDocument;
  }> {
    const image = await inspectUploadFileMetadata(localPath, this.config.uploadRoots, this.config.maxFileBytes);
    const tagIds = await this.taxonomy.validateTagSelections(selections);
    const taxonomy = await this.taxonomy.get();
    const groups = new Map(taxonomy.tagGroups.map((group) => [group.id, group]));
    const tags = new Map(taxonomy.tags.map((tag) => [tag.id, tag]));
    const resolvedSelections = selections
      .map((selection) => {
        const group = groups.get(selection.groupId);
        if (!group) throw new Error("Validated tag group disappeared from the taxonomy cache.");
        return {
          group_id: group.id,
          group_name: group.name,
          group_slug: group.slug,
          tags: selection.tagIds.map((tagId) => {
            const tag = tags.get(tagId);
            if (!tag) throw new Error("Validated tag disappeared from the taxonomy cache.");
            return { id: tag.id, name: tag.name, slug: tag.slug };
          }).sort((left, right) => left.id - right.id),
        };
      })
      .sort((left, right) => left.group_id - right.group_id);
    const document: LocalTagDocument = {
      schema_version: 1,
      scope: "local-only",
      image: {
        file_name: image.name,
        size_bytes: image.size,
        width: image.width,
        height: image.height,
      },
      tag_selections: resolvedSelections,
      tag_ids: [...tagIds].sort((left, right) => left - right),
      updated_at: new Date().toISOString(),
    };
    const sidecarPath = localTagSidecarPath(image.absolutePath);
    const existing = await readSidecar(sidecarPath);
    if (existing && stableDocumentState(existing) === stableDocumentState(document)) {
      return { changed: false, imagePath: image.absolutePath, sidecarPath, document: existing };
    }
    await writeSidecarAtomically(sidecarPath, document);
    return { changed: true, imagePath: image.absolutePath, sidecarPath, document };
  }
}

