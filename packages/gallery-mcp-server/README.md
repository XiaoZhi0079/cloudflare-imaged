# Gallery MCP Server

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
```

Set exactly one of `GALLERY_ADMIN_KEY_FILE` or `GALLERY_ADMIN_KEY`. The file option is recommended because it keeps the secret out of MCP client configuration. `GALLERY_UPLOAD_ROOTS` is required for local sidecar tools and upload tools. Every local path is resolved through the filesystem and must remain inside one of these roots, including through symlinks.

Optional limits:

| Variable | Default |
|---|---:|
| `GALLERY_REQUEST_TIMEOUT_MS` | `30000` |
| `GALLERY_UPLOAD_TIMEOUT_MS` | `120000` |
| `GALLERY_MAX_FILE_BYTES` | `52428800` |
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
| `gallery_list_images` | Lists filtered, paginated image metadata. |
| `gallery_get_image` | Gets one image by permanent `public_id` or legacy numeric `image_id` without downloading content. |
| `gallery_get_local_image_tags` | Reads a local image's adjacent `.gallery-tags.json` sidecar; no online mutation. |
| `gallery_set_local_image_tags` | Writes local-only tags to an adjacent sidecar; never uploads. |
| `gallery_set_local_image_tags_batch` | Writes local-only sidecars for up to 100 images; never uploads. |
| `gallery_set_remote_image_tags` | Replaces tags on one online image by permanent `public_id` or legacy numeric `image_id`. |
| `gallery_set_remote_image_tags_batch` | Atomically replaces tags on up to 100 existing online images. |
| `gallery_upload_image` | Runs upload init, direct R2 PUT, and D1 completion for one file. |
| `gallery_upload_images` | Uploads up to 12 files sequentially and isolates item failures. |
| `gallery_upload_manifest` | Preflights up to 50 images, then uploads in bounded concurrent chunks with per-image directories and tags. |
| `gallery_resume_upload` | Completes D1 after an R2 upload succeeded but completion failed. |

The server intentionally excludes deletion, file movement, tag deletion, and tag merging in this first version.

Upload tools calculate SHA-256 from the exact local file bytes before requesting an R2 URL. Gallery reserves a permanent `public_id`, the content hash, and a stable upload session before R2 receives bytes. Repeating completion with the same upload ID is idempotent, while a different upload targeting an occupied object key is rejected. Remote tag tools remain destructive because they replace complete online tag sets.

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

When an upload returns `UPLOAD_COMPLETION_REQUIRED`, pass its `resume_parameters`, including `upload_id`, unchanged to `gallery_resume_upload`. Do not upload the same file again.

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

Use `dry_run: true` first. The server validates the full manifest without uploading and does not retain all image bytes in memory. A normal run initializes one chunk at a time, uploads to R2 with bounded concurrency, and atomically completes each successful chunk in D1. By default `result_detail` is `failures`, so successful image records do not inflate MCP structured output. Use `summary` for counts only or `all` when per-item success details are explicitly required. By default one failure does not block unrelated items.

## Verification

```powershell
npm test
npm run inspect
```

`npm test` compiles the package, tests API retries and credential isolation, validates local path containment with generated test images, verifies idempotent taxonomy behavior, checks the upload sequence, and performs a real MCP stdio handshake.

The Inspector command starts the official MCP Inspector. Set the required environment variables before invoking tools that contact the live Gallery API.
