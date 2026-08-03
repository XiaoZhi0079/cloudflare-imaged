# Gallery MCP Server

Current local protocol version: **0.12.0**.

## AI organization proposal workflow

The MCP server deliberately does not embed or call a vision model. Codex, Claude, or another external Agent uses its own authorized visual capability, while Gallery provides durable workflow tools:

1. `gallery_scan_image_ids` fixes a stable numeric-ID snapshot.
2. `gallery_cache_remote_images` stores verified originals in the local content-addressed cache.
3. `gallery_create_analysis_batch` records the exact image IDs being analyzed.
4. `gallery_get_taxonomy` supplies the current directories and two-level tag tree.
5. `gallery_submit_image_proposal` submits a complete proposed name, directory, existing tags, and optional missing-tag candidates. Candidates recommend a parent tag group but do not create tags.
6. A human reviews tag candidates and image proposals at `/admin/ai.html`.
7. `gallery_apply_approved_proposals` applies only approved proposals. Numeric IDs, permanent public UUIDs, content SHA-256 values, and image bytes remain unchanged.

This separation prevents a one-off visual observation from silently expanding the live taxonomy. Repeated candidate concepts accumulate an occurrence count for review.

`gallery-mcp-server` exposes strictly separated local-file labeling and online Gallery administration tools. An external Agent analyzes images and chooses tags; this server validates grouped taxonomy selections. Local labeling writes sidecar JSON without uploading, while explicitly named remote/upload tools mutate Gallery.

## Requirements

- Node.js 20 or newer
- A valid Gallery admin key
- One or more local directories containing uploadable images

## Install and build

```powershell
cd D:\GoodTry\Image-Gallery\packages\gallery-mcp-server
npm install
npm run build
```

## Configuration

Set configuration in the environment that launches the MCP process:

```powershell
$env:GALLERY_BASE_URL = "https://gallery.140079.xyz"
$env:GALLERY_ADMIN_KEY_FILE = "C:\Users\YourName\.mcp-secrets\gallery_admin_key.txt"
$env:GALLERY_UPLOAD_ROOTS = "D:\GoodTry"
$env:GALLERY_REMOTE_CACHE_ROOT = "D:\GalleryRemoteCache"
$env:GALLERY_REMOTE_CACHE_CONCURRENCY = "4"
```

Set exactly one of `GALLERY_ADMIN_KEY_FILE` or `GALLERY_ADMIN_KEY`. The file option is recommended because it keeps the secret out of MCP client configuration. `GALLERY_UPLOAD_ROOTS` is required for local sidecar tools and upload tools. Every local path is resolved through the filesystem and must remain inside one of these roots, including through symlinks.

`GALLERY_REMOTE_CACHE_ROOT` stores online originals in a persistent, content-addressed local cache. When omitted, it defaults to the operating system's local cache directory under `gallery-mcp/remote-images`. It must be completely separate from every `GALLERY_UPLOAD_ROOTS` path; startup fails when either location contains the other, so caching an online image never makes it an upload candidate.

Optional limits:

| Variable | Default |
|---|---:|
| `GALLERY_REQUEST_TIMEOUT_MS` | `30000` |
| `GALLERY_UPLOAD_TIMEOUT_MS` | `120000` |
| `GALLERY_MAX_FILE_BYTES` | `52428800` |
| `GALLERY_REMOTE_CACHE_ROOT` | OS local cache directory |
| `GALLERY_REMOTE_CACHE_CONCURRENCY` | `4` (range `1`-`8`) |
| `GALLERY_UPLOAD_CONCURRENCY` | `4` (range `1`-`8`) |
| `GALLERY_UPLOAD_CHUNK_SIZE` | `20` (range `1`-`50`) |

## Agent configuration

Use the compiled entry point as a local stdio MCP server:

```json
{
  "mcpServers": {
    "gallery": {
      "command": "node",
      "args": [
        "D:/GoodTry/Image-Gallery/packages/gallery-mcp-server/dist/index.js"
      ]
    }
  }
}
```

Configure secrets through the Agent application's protected environment settings or the operating system. Do not place the real admin key in a committed JSON file.

## Tools

| Tool | Behavior |
|---|---|
| `gallery_get_taxonomy` | Returns parent groups, nested child tags, and upload directories. |
| `gallery_ensure_tag_group` | Reuses or creates a parent tag group by name. |
| `gallery_ensure_tag` | Reuses or creates a child tag in an existing group. |
| `gallery_health_check` | Checks credentials and taxonomy access without uploading. |
| `gallery_list_images` | Lists one OFFSET-based page for interactive filename, directory, or tag search. |
| `gallery_search_images_by_name` | Searches one server-side page by file-name substring only, without downloading image bytes. |
| `gallery_scan_image_ids` | Scans an exhaustive, fixed numeric-ID snapshot without OFFSET pagination or image downloads. |
| `gallery_get_image` | Gets one image by permanent `public_id` or legacy numeric `image_id` without downloading content. |
| `gallery_cache_remote_image` | Caches one online original by permanent identity and full SHA-256 without changing Gallery. |
| `gallery_cache_remote_images` | Caches up to 50 originals with bounded concurrency and actionable output. |
| `gallery_get_remote_image_cache_status` | Reports cached/analyzed state for one image and analysis version. |
| `gallery_get_remote_image_cache_status_batch` | Checks up to 100 cache records with bounded concurrency. |
| `gallery_mark_remote_image_analyzed` | Marks exact cached content analyzed only after the Agent inspected it. |
| `gallery_get_local_image_tags` | Reads a local image's adjacent `.gallery-tags.json` sidecar; no online mutation. |
| `gallery_set_local_image_tags` | Writes local-only tags to an adjacent sidecar; never uploads. |
| `gallery_set_local_image_tags_batch` | Writes local-only sidecars for up to 100 images; never uploads. |
| `gallery_set_remote_image_tags` | Replaces tags on one online image by permanent `public_id` or legacy numeric `image_id`. |
| `gallery_set_remote_image_tags_batch` | Atomically replaces tags on up to 100 existing online images. |
| `gallery_apply_recognition_manifest` | Preflights and applies names, directories, and complete tag sets to up to 50 existing images with permanent-ID and content-hash guards. |
| `gallery_upload_image` | Runs upload init, direct R2 PUT, and D1 completion for one file. |
| `gallery_upload_images` | Compatibility convenience for up to 12 files sharing one directory and tag set. Prefer the upload manifest for new workflows. |
| `gallery_upload_manifest` | Preflights up to 50 images, then uploads in bounded concurrent chunks with per-image directories and tags. |
| `gallery_resume_upload` | Completes D1 after an R2 upload succeeded but completion failed. |

The server intentionally excludes image deletion, tag deletion, and tag merging. Existing-image relocation is available only through the guarded recognition manifest workflow.

Upload tools calculate SHA-256 from the exact local file bytes before requesting an R2 URL. Gallery reserves a permanent `public_id`, the content hash, and a stable upload session before R2 receives bytes. Repeating completion with the same upload ID is idempotent, while a different upload targeting an occupied object key is rejected. Remote tag tools remain destructive because they replace complete online tag sets.

## File-name search and reanalysis

Use `gallery_search_images_by_name` when an Agent starts from part of an existing file name. It calls the Gallery admin pagination API with the dedicated `file_name` filter, so tags and directory names cannot create false matches and the MCP never reads the full library.

```json
{
  "name_query": "asian-dress-studio",
  "limit": 20,
  "offset": 0,
  "response_format": "json"
}
```

Continue with `next_offset` only when `has_more` is true. Each result includes `image_id`, `public_id`, `content_sha256`, `file_url`, dimensions, directory, and current tags. A typical reanalysis workflow is: search by name, cache the selected remote image after explicit visual-inspection permission, analyze the cached local file, then dry-run and apply `gallery_apply_recognition_manifest` with the permanent ID and expected content hash.

## Stable numeric-ID scans

Use `gallery_scan_image_ids` to enumerate the full online library for automation. `gallery_list_images` remains useful for interactive search, but its OFFSET pages can shift if images are uploaded or deleted during a long scan.

Start a scan without `snapshot_max_image_id`:

```json
{
  "after_image_id": 0,
  "limit": 50,
  "response_format": "json"
}
```

Gallery captures its current maximum numeric image ID and returns `snapshot_max_image_id`. Continue with the exact returned upper bound and cursor:

```json
{
  "after_image_id": 103,
  "snapshot_max_image_id": 2034,
  "limit": 50,
  "response_format": "json"
}
```

The server queries `id > after_image_id AND id <= snapshot_max_image_id ORDER BY id ASC`. Deleted ID gaps are skipped automatically. New uploads receive higher AUTOINCREMENT IDs and remain outside the snapshot, so they are handled in the next run. Each result contains only `image_id`, `public_id`, and `content_sha256`; it never downloads image content. Continue until `has_more` is false. Do not recalculate or change `snapshot_max_image_id` midway through a scan.

## Remote image cache and analysis deduplication

The remote cache uses two independent identities:

- `public_id` identifies the online Gallery record and remains stable after a rename.
- Full SHA-256 identifies the exact encoded image bytes. Multiple records with identical bytes share one cached object and one analysis state per `analysis_version`.

The cache layout separates content, record mappings, duplicate references, and analysis state:

```text
remote-images/
  objects/ab/<sha256>.png
  images/<public_id>.json
  contents/<sha256>/<public_id>.json
  analysis/<sha256>/<analysis-version-hash>.json
```

Caching and analysis completion are deliberately separate. `gallery_cache_remote_image` and `gallery_cache_remote_images` require `user_confirmed_visual_analysis: true`; an Agent must set it only after the user explicitly authorizes inspection of the private images. A cache result may return `should_analyze: true`, but downloading bytes never marks them inspected. Only call `gallery_mark_remote_image_analyzed` with the same explicit authorization after the Agent has opened the returned `local_path` with its own vision capability and saved the recognition proposal.

Recommended online recognition workflow:

1. Call `gallery_scan_image_ids` and preserve its `snapshot_max_image_id` until the scan finishes.
2. Pass each numeric-ID batch to the cache-status batch tool with a stable `analysis_version`; this reads no image body.
3. If `should_analyze` is false, reuse the referenced result and do not inspect the image again.
4. Ask the user for explicit permission to visually inspect every remaining private image. Stop if permission is not granted.
5. Call the single or batch cache tool with `user_confirmed_visual_analysis: true`.
6. Inspect the returned full-resolution `local_path` values with the Agent's own vision capability.
7. Save the recognition proposals outside the cache.
8. Call `gallery_mark_remote_image_analyzed` with the exact returned `content_sha256`, authorization confirmation, and optional proposal reference.
9. Apply online tags or names only in a later, separately approved mutation phase.

Batch cache operations accept at most 50 images, batch status accepts at most 100, and both use `GALLERY_REMOTE_CACHE_CONCURRENCY`. Their default `result_detail: "actionable"` returns only failures, stale/missing records, and content that still needs analysis; use `summary` for counts or `all` for every item.

Changing `analysis_version` intentionally invalidates only the analyzed-state lookup; cached bytes remain reusable. Every Gallery record must provide a valid full SHA-256 before it can be cached, checked, or marked analyzed. If a cached object is missing or damaged, the cache tool downloads and verifies it again. If downloaded bytes disagree with Gallery's stored hash, the tool refuses to process them and asks for a content-hash audit. Remote downloads must use the same origin as `GALLERY_BASE_URL`; cross-origin URLs and redirects are rejected before their response body is cached.

`result_reference` is editable without changing the original `analyzed_at` timestamp. Omit it to preserve the current reference, provide a new string to correct it, or pass `null` to clear it.

## Apply recognition results to existing images

`gallery_apply_recognition_manifest` is the mutation stage for cached online images. It does not inspect or upload image bytes. Each item identifies the record by permanent `public_id` and binds the proposal to `expected_content_sha256`, so a proposal cannot be applied after the online content changes.

Each item provides a complete desired filename, directory, and grouped tag set:

```json
{
  "items": [
    {
      "client_item_id": "image-001",
      "public_id": "11111111-1111-4111-8111-111111111111",
      "expected_content_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "file_name": "east-asian-red-dress-bedroom-0001.png",
      "directory_id": 2,
      "tag_selections": [
        { "group_id": 1, "tag_ids": [5, 6] },
        { "group_id": 3, "tag_ids": [13] }
      ]
    }
  ],
  "dry_run": true,
  "result_detail": "all"
}
```

The tool defaults to `dry_run: true`. A real update requires both `dry_run: false` and `confirm_apply: "APPLY_RECOGNITION_MANIFEST"`. Preflight validates all permanent IDs, content hashes, unchanged file extensions, unique target names, directories, and grouped tags before mutation. It skips unchanged fields and reads every successful record back for exact verification.

With `continue_on_error: true`, filename changes use bounded concurrency, directory changes are grouped by destination, and all eligible tag changes use the Gallery's atomic heterogeneous batch endpoint. With `continue_on_error: false`, every item must pass preflight and mutations run sequentially, stopping after the first failure. A rename or directory move also changes the underlying R2 key, so the three metadata fields cannot share one database transaction; a failure reports `partial_update` and `applied_fields`, and safely rerunning the same manifest converges the remaining fields.

This workflow preserves the image's numeric ID, permanent ID, content hash, image bytes, album membership, and featured membership. The requested filename must keep the current file extension because this workflow does not transcode content.

## Local-only image tags

Local and remote operations are intentionally impossible to confuse by parameter shape:

- Local tools require `local_path` and never accept `image_id` or `directory_id`.
- Single-image remote tools require exactly one `public_id` or legacy `image_id` and never accept `local_path`.
- Upload tools require both a local path and an online `directory_id`; their descriptions explicitly state that they create online records.

`gallery_set_local_image_tags` preserves the original image bytes. It atomically writes a deterministic sidecar named `<image-file>.gallery-tags.json` next to the image. The sidecar records `scope: "local-only"`, dimensions, grouped tag IDs and names, and an update timestamp. Repeating the same selection is idempotent and does not rewrite the sidecar.

Single local image:

```json
{
  "local_path": "D:/GoodTry/images/example.png",
  "tag_selections": [
    { "group_id": 1, "tag_ids": [20] },
    { "group_id": 6, "tag_ids": [61] }
  ],
  "response_format": "json"
}
```

Read local tags:

```json
{
  "local_path": "D:/GoodTry/images/example.png",
  "response_format": "json"
}
```

Batch local images:

```json
{
  "assignments": [
    {
      "local_path": "D:/GoodTry/images/001.png",
      "tag_selections": [{ "group_id": 1, "tag_ids": [20] }]
    },
    {
      "local_path": "D:/GoodTry/images/002.png",
      "tag_selections": [{ "group_id": 1, "tag_ids": [20] }]
    }
  ],
  "continue_on_error": true,
  "response_format": "json"
}
```

Local tools still read the current online taxonomy to validate parent-child relationships, but they have no Gallery write client and cannot create, upload, or change an online image record.

## Directory and tag model

The Gallery has two independent structures:

- `directories` are upload destinations backed by the Gallery category/R2 directory model. Each image has one `directory_id`.
- `tag_groups` are parent classifications such as Clothing or Scene.
- The nested `tags` are selectable child labels. An image may select multiple child tags from multiple parent groups.

Mutation tools deliberately do not accept a flat top-level `tag_ids` array. They require the parent-child relationship to be explicit:

```json
{
  "directory_id": 2,
  "tag_selections": [
    { "group_id": 1, "tag_ids": [5, 6] },
    { "group_id": 3, "tag_ids": [13] }
  ]
}
```

The MCP server rejects unknown groups, unknown tags, duplicate groups, duplicate tags, and tags declared under the wrong parent. Only after validation does it flatten the child tag IDs for the existing Gallery REST API.

## Recommended local-only workflow

1. Call `gallery_get_taxonomy`.
2. Analyze the local image using the Agent's own vision capability.
3. Call `gallery_set_local_image_tags` or its batch variant.
4. Call `gallery_get_local_image_tags` when verification is needed.
5. Do not call any `gallery_upload_*` tool unless the user explicitly requests an online upload.

## Recommended online upload workflow

1. Call `gallery_get_taxonomy`.
2. Analyze the local image using the Agent's own vision capability.
3. Call `gallery_ensure_tag_group` when the required parent group is missing.
4. Call `gallery_ensure_tag` for every missing child tag.
5. Refresh taxonomy IDs when any label was created.
6. Call `gallery_upload_image` with the local path, one directory ID, and grouped tag selections.
7. Preserve the returned `publicId`; use it with `gallery_get_image` to verify metadata when necessary.

Do not ask the model to reproduce R2 upload URLs or manually call the two Gallery upload endpoints. The high-level upload tool owns that sequence.

When an upload returns `UPLOAD_COMPLETION_REQUIRED`, pass its `resume_parameters`, including `upload_id`, unchanged to `gallery_resume_upload`. Do not upload the same file again. `DUPLICATE_IMAGE_CONTENT` is different: it is non-retryable, includes the matching existing image or pending upload when available, and must never be sent to the resume tool.

For heterogeneous batches, call `gallery_upload_manifest`. Each item carries a stable `client_item_id`, its own local path, directory, and grouped tags:

```json
{
  "items": [
    {
      "client_item_id": "image-001",
      "local_path": "D:/GoodTry/images/001.png",
      "directory_id": 2,
      "tag_selections": [
        { "group_id": 1, "tag_ids": [5, 6] },
        { "group_id": 3, "tag_ids": [13] }
      ]
    }
  ],
  "continue_on_error": true,
  "dry_run": true,
  "result_detail": "all"
}
```

Use `dry_run: true` first. The server validates the full manifest without uploading and does not retain all image bytes in memory. A normal run initializes one chunk at a time, uploads to R2 with bounded concurrency, and atomically completes each successful chunk in D1. If one item is byte-identical to an existing image, an in-progress upload, or an earlier item in the same manifest chunk, only that item is safely skipped and the rest of the chunk continues. Duplicate skips do not abort a run even when `continue_on_error` is false. By default `result_detail` is `failures`, so successful image records do not inflate MCP structured output; it also returns concise duplicate details so the Agent can reuse the existing image. Use `summary` for counts only or `all` when per-item success details are explicitly required. By default one failure does not block unrelated items.

## Tool surface and compatibility

The local tag tools and remote tag tools are intentionally separate: local tools can only write adjacent sidecars, while remote tools can only mutate existing Gallery records. Single-item and batch cache/status tools are also retained because they serve interactive and scheduled workflows without forcing large responses.

The upload area has intentional compatibility overlap. `gallery_upload_image` remains the direct one-file path, and `gallery_upload_manifest` is the preferred Agent path for all heterogeneous or multi-file uploads. `gallery_upload_images` is retained for older callers that send several files with one shared directory and tag set; new Agent prompts should not select it. `gallery_resume_upload` is not redundant because it completes an existing upload session without sending bytes to R2 again.

## Verification

```powershell
npm test
npm run inspect
```

`npm test` compiles the package, tests API retries and credential isolation, validates local path containment with generated test images, verifies idempotent taxonomy behavior, checks the upload sequence, and performs a real MCP stdio handshake.

The Inspector command starts the official MCP Inspector. Set the required environment variables before invoking tools that contact the live Gallery API.
