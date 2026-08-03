export type ResponseFormat = "json" | "markdown";

export interface GalleryMcpConfig {
  baseUrl: string;
  adminKey: string;
  uploadRoots: string[];
  remoteCacheRoot: string;
  remoteCacheConcurrency: number;
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
  publicId: string;
  contentSha256?: string | null;
  storageKey?: string;
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
  contentSha256: string;
}

export interface UploadDescriptor {
  uploadId: string;
  publicId: string;
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

export interface DuplicateImageReference {
  id: number;
  publicId?: string;
  fileName?: string;
  fileUrl?: string;
}

export interface DuplicateImageContentDetail {
  uploadId?: string;
  clientItemId?: string;
  fileName?: string;
  contentSha256?: string;
  reason?: string;
  existingImage?: DuplicateImageReference;
  pendingUploadId?: string;
  pendingFileName?: string;
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

export interface RecognitionManifestItem {
  clientItemId: string;
  publicId: string;
  expectedContentSha256: string;
  fileName: string;
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

export interface AiAnalysisBatch {
  id: string;
  name: string;
  status: string;
  source: string;
  snapshotMaxImageId: number | null;
  operationId: string | null;
  imageCount: number;
  pendingCount: number;
  proposedCount: number;
  appliedCount: number;
}

export interface AiTagCandidateInput {
  name: string;
  groupId: number;
}

export interface AiImageProposal {
  id: string;
  batchId: string;
  batchName: string;
  imageId: number;
  imagePublicId: string;
  currentFileName: string;
  currentStorageKey: string;
  currentFileUrl: string;
  proposedFileName: string;
  proposedCategoryId: number;
  proposedCategoryName: string;
  proposedTagIds: number[];
  candidateTagIds: number[];
  rationale: string;
  confidence: number | null;
  status: string;
  proposedTags?: Array<{ id: number; name: string }>;
  tagCandidates?: Array<{ id: number; name: string; groupId: number; groupName: string; status: string }>;
}
