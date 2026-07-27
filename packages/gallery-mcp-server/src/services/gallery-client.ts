import { GalleryApiError, GalleryMcpError, apiErrorFromResponse } from "../errors.js";
import type {
  Category,
  GalleryImage,
  GalleryMcpConfig,
  GalleryTaxonomy,
  Tag,
  TagGroup,
  UploadDescriptor,
  UploadDraft,
} from "../types.js";

type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  retry?: boolean;
}

interface GalleryClientOptions {
  fetchImpl?: FetchImplementation;
  retryDelayMs?: number;
}

interface TagsResponse {
  tags: Tag[];
  tagGroups: TagGroup[];
}

interface CategoriesResponse {
  categories: Category[];
}

interface ImagesResponse {
  images: GalleryImage[];
}

interface ImagesPageResponse extends ImagesResponse {
  totalCount: number;
  count: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  nextOffset: number | null;
}

interface ImageIdScanResponse {
  snapshotMaxImageId: number;
  afterImageId: number;
  count: number;
  limit: number;
  hasMore: boolean;
  nextAfterImageId: number | null;
  items: Array<{
    imageId: number;
    publicId: string | null;
    contentSha256: string | null;
  }>;
}

interface UploadInitResponse {
  uploads: UploadDescriptor[];
}

interface UploadCompleteResponse {
  uploadedCount: number;
  images: GalleryImage[];
}

interface MoveImagesResponse {
  images: GalleryImage[];
  failed: Array<{ imageId: number; error: string }>;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parseResponsePayload(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text.slice(0, 400);
  }
}

function networkError(error: unknown): GalleryMcpError {
  if (error instanceof GalleryMcpError) return error;
  const timedOut = error instanceof Error && error.name === "AbortError";
  return new GalleryMcpError(
    timedOut ? "Gallery API request timed out." : "Could not connect to the Gallery API.",
    {
      code: timedOut ? "GALLERY_TIMEOUT" : "GALLERY_UNREACHABLE",
      retryable: true,
      suggestion: "Check the Gallery URL and network connection, then retry.",
      cause: error,
    },
  );
}

export class GalleryApiClient {
  private readonly baseUrl: string;
  private readonly adminKey: string;
  private readonly requestTimeoutMs: number;
  private readonly uploadTimeoutMs: number;
  private readonly fetchImpl: FetchImplementation;
  private readonly retryDelayMs: number;

  constructor(config: GalleryMcpConfig, options: GalleryClientOptions = {}) {
    this.baseUrl = config.baseUrl;
    this.adminKey = config.adminKey;
    this.requestTimeoutMs = config.requestTimeoutMs;
    this.uploadTimeoutMs = config.uploadTimeoutMs;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.retryDelayMs = options.retryDelayMs ?? 250;
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const attempts = options.retry === false ? 1 : 3;
    let lastError: unknown;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
      try {
        const response = await this.fetchImpl(new URL(path, `${this.baseUrl}/`), {
          method: options.method ?? "GET",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            "x-gallery-admin-key": this.adminKey,
          },
          ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
          signal: controller.signal,
        });
        const payload = parseResponsePayload(await response.text());
        if (!response.ok) {
          const error = apiErrorFromResponse(response.status, payload);
          if (error.retryable && attempt + 1 < attempts) {
            lastError = error;
            await sleep(this.retryDelayMs * (2 ** attempt));
            continue;
          }
          throw error;
        }
        return payload as T;
      } catch (error) {
        const mapped = error instanceof GalleryApiError ? error : networkError(error);
        if (mapped.retryable && attempt + 1 < attempts) {
          lastError = mapped;
          await sleep(this.retryDelayMs * (2 ** attempt));
          continue;
        }
        throw mapped;
      } finally {
        clearTimeout(timer);
      }
    }

    throw networkError(lastError);
  }

  async getTaxonomy(): Promise<GalleryTaxonomy> {
    const [tagData, categoryData] = await Promise.all([
      this.request<TagsResponse>("api/admin/tags"),
      this.request<CategoriesResponse>("api/admin/categories"),
    ]);
    return {
      tagGroups: tagData.tagGroups ?? [],
      tags: tagData.tags ?? [],
      categories: categoryData.categories ?? [],
    };
  }

  async createTagGroup(name: string, sortOrder = 0): Promise<TagGroup> {
    const payload = await this.request<{ tagGroup: TagGroup }>("api/admin/tag-groups", {
      method: "POST",
      body: { name, sortOrder },
      retry: false,
    });
    return payload.tagGroup;
  }

  async createTag(input: { name: string; groupId: number; sortOrder?: number; isVisible?: boolean }): Promise<Tag> {
    const payload = await this.request<{ tag: Tag }>("api/admin/tags", {
      method: "POST",
      body: {
        name: input.name,
        groupId: input.groupId,
        sortOrder: input.sortOrder ?? 0,
        isVisible: input.isVisible ?? true,
      },
      retry: false,
    });
    return payload.tag;
  }

  async listImages(): Promise<GalleryImage[]> {
    const payload = await this.request<ImagesResponse>("api/admin/images");
    return payload.images ?? [];
  }

  async listImagesPage(query: string, limit: number, offset: number): Promise<ImagesPageResponse> {
    const params = new URLSearchParams({ query, limit: String(limit), offset: String(offset) });
    return await this.request<ImagesPageResponse>(`api/admin/images?${params.toString()}`);
  }

  async searchImagesByName(nameQuery: string, limit: number, offset: number): Promise<ImagesPageResponse> {
    const params = new URLSearchParams({ file_name: nameQuery, limit: String(limit), offset: String(offset) });
    return await this.request<ImagesPageResponse>(`api/admin/images?${params.toString()}`);
  }

  async scanImageIds(
    afterImageId: number,
    snapshotMaxImageId: number | null,
    limit: number,
  ): Promise<ImageIdScanResponse> {
    const params = new URLSearchParams({ after_id: String(afterImageId), limit: String(limit) });
    if (snapshotMaxImageId !== null) params.set("snapshot_max_id", String(snapshotMaxImageId));
    return await this.request<ImageIdScanResponse>(`api/admin/images/scan?${params.toString()}`);
  }

  async getImage(identifier: number | string): Promise<GalleryImage> {
    const payload = await this.request<{ image: GalleryImage }>(`api/admin/images/${encodeURIComponent(String(identifier))}`);
    return payload.image;
  }

  async renameImage(imageId: number, fileName: string): Promise<GalleryImage> {
    const payload = await this.request<{ image: GalleryImage }>("api/admin/images", {
      method: "PATCH",
      body: { imageId, fileName },
      retry: false,
    });
    return payload.image;
  }

  async moveImagesToCategory(imageIds: number[], categoryId: number): Promise<MoveImagesResponse> {
    return await this.request<MoveImagesResponse>("api/admin/images/category-assignments/bulk", {
      method: "POST",
      body: { imageIds, categoryId },
      retry: false,
    });
  }

  async setImageTags(identifier: number | string, tagIds: number[]): Promise<{ imageId: number; publicId?: string; tagIds: number[] }> {
    return await this.request<{ imageId: number; publicId?: string; tagIds: number[] }>("api/admin/images/tag-assignments", {
      method: "POST",
      body: typeof identifier === "number" ? { imageId: identifier, tagIds } : { publicId: identifier, tagIds },
      retry: false,
    });
  }

  async setImageTagsBatch(assignments: Array<{ imageId: number; tagIds: number[] }>): Promise<{
    updatedCount: number;
    assignments: Array<{ imageId: number; tagIds: number[] }>;
  }> {
    return await this.request("api/admin/images/tag-assignments/bulk", {
      method: "POST",
      body: { assignments },
      retry: false,
    });
  }

  async initUpload(
    files: UploadDraft[],
    categoryId: number | null,
    tagIds: number[] | null,
    options: { operationId?: string; namingStrategy?: "original-unique" | "origin" } = {},
  ): Promise<UploadDescriptor[]> {
    const payload = await this.request<UploadInitResponse>("api/admin/images/upload/init", {
      method: "POST",
      body: {
        files,
        ...(categoryId === null ? {} : { categoryId }),
        ...(tagIds === null ? {} : { tagIds }),
        ...(options.operationId ? { operationId: options.operationId } : {}),
        namingStrategy: options.namingStrategy ?? "original-unique",
      },
      retry: false,
    });
    return payload.uploads ?? [];
  }

  async putObject(upload: UploadDescriptor, bytes: Buffer): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.uploadTimeoutMs);
    try {
      const response = await this.fetchImpl(upload.uploadUrl, {
        method: upload.method,
        headers: upload.headers,
        body: bytes as unknown as BodyInit,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new GalleryApiError(`R2 upload failed with HTTP ${response.status}.`, {
          status: response.status,
          code: "R2_UPLOAD_FAILED",
          retryable: response.status === 429 || response.status >= 500,
          suggestion: "Request a new upload session and retry this file.",
        });
      }
    } catch (error) {
      if (error instanceof GalleryApiError) throw error;
      throw networkError(error);
    } finally {
      clearTimeout(timer);
    }
  }

  async completeUpload(
    files: Array<{ uploadId: string; storageKey: string; fileName: string; width: number; height: number }>,
    categoryId: number | null,
    tagIds: number[] | null,
  ): Promise<GalleryImage[]> {
    const payload = await this.request<UploadCompleteResponse>("api/admin/images/upload/complete", {
      method: "POST",
      body: {
        files,
        ...(categoryId === null ? {} : { categoryId }),
        ...(tagIds === null ? {} : { tagIds }),
      },
    });
    return payload.images ?? [];
  }
}
