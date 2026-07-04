# Gallery MVP

Independent public gallery frontend and lightweight admin surface for images stored in `CloudFlare-ImgBed`.

## Runtime

- Cloudflare Pages
- Pages Functions
- Cloudflare D1
- ImgBed as file backend

## Current Flow

- Upload images from Gallery admin
- Bind one or more Gallery tags during upload
- Gallery forwards files to ImgBed with the configured upload folder, currently `gallery` by default
- ImgBed stores files in Telegram or Cloudflare R2
- Gallery stores image records and image-tag mappings in D1
- Optional fallback: import existing ImgBed files into Gallery

## Local Development

Environment variables expected by the API layer:

- `IMGBED_BASE_URL`
- `IMGBED_API_TOKEN`
- `GALLERY_ADMIN_KEY`
- `GALLERY_UPLOAD_CHANNEL` defaults to `telegram` in code; local preview sets `cfr2`.
- `GALLERY_UPLOAD_NAME_TYPE` defaults to `origin`.
- `GALLERY_UPLOAD_FOLDER` defaults to `gallery` and is sent to ImgBed as the storage prefix/folder.

`IMGBED_API_TOKEN` must be allowed to call ImgBed upload and manage-list endpoints.

The repository now auto-creates its D1 tables on first access. If you want to prepare the local database explicitly, you can still run:

```bash
npx wrangler d1 execute GALLERY_DB --local --file schema.sql --persist-to ./.wrangler/state
```

Start local preview:

```bash
npx wrangler pages dev ./public --d1 GALLERY_DB --compatibility-date 2026-03-02 --ip 0.0.0.0 --port 8788 --persist-to ./.wrangler/state
```

Local URLs:

- Public gallery: `http://127.0.0.1:8788/`
- Admin page: `http://127.0.0.1:8788/admin/`

The admin page expects the same `GALLERY_ADMIN_KEY` value that the Functions runtime receives.
