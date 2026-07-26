export type ResponseFormat = "json" | "markdown";

export interface GalleryMcpConfig {
  baseUrl: string;
  adminKey: string;
  uploadRoots: string[];
  requestTimeoutMs: number;
  uploadTimeoutMs: number;
  maxFileBytes: number;
  uploadConcurrency: number;
  uploadChunkSize: number;
}

export interface TagGroup {
  id: number;
  name: string;
  slug: string;
  sortOrder: number;
  tagCount: number;
}

export interface Tag {
  id: number;
  name: string;
  slug: string;
  sortOrder: number;
  isVisible: boolean;
  groupId?: number;
  group?: {
    id: number;
    name: string;
    slug: string;
    sortOrder: number;
  };
}

export interface Category {
  id: number;
  name: string;
  directorySlug: string;
  sortOrder: number;
}

export interface GalleryImage {
  id: number;
  fileName: string;
  fileUrl: string;
  width: number | null;
  height: number | null;
  tags: string[];
  category?: Category;
  syncStatus?: string;
  note?: string | null;
}

export interface GalleryTaxonomy {
  tagGroups: TagGroup[];
  tags: Tag[];
  categories: Category[];
}

export interface TagSelection {
  groupId: number;
  tagIds: number[];
}

export interface UploadDraft {
  uploadId?: string;
  clientItemId?: string;
  categoryId?: number;
  tagIds?: number[];
  name: string;
  type: string;
  size: number;
  width: number;
  height: number;
}

export interface UploadDescriptor {
  uploadId: string;
  operationId: string;
  clientItemId?: string | null;
  storageKey: string;
  fileName: string;
  fileUrl: string;
  contentType: string;
  method: "PUT";
  headers: Record<string, string>;
  uploadUrl: string;
}

export interface InspectedUploadFile extends UploadDraft {
  absolutePath: string;
  bytes: Buffer;
}

export interface InspectedUploadFileMetadata extends UploadDraft {
  absolutePath: string;
}

export interface UploadManifestItem {
  clientItemId: string;
  localPath: string;
  directoryId: number;
  tagSelections: TagSelection[];
}

export interface ValidatedUploadSelection {
  directoryId: number;
  tagIds: number[];
  tagSelections: TagSelection[];
}

export interface UploadImageResult {
  image: GalleryImage;
  localFileName: string;
  storageKey: string;
  uploadId: string;
  operationId: string;
}

export type ManifestResultDetail = "summary" | "failures" | "all";

export interface ToolErrorOutput {
  [key: string]: unknown;
  error: string;
  code: string;
  status?: number;
  retryable: boolean;
  suggestion?: string;
  details?: Record<string, unknown>;
}
