# Gallery MVP

Independent public gallery frontend and lightweight admin surface managed entirely by this project.

## Runtime

- Cloudflare Pages
- Pages Functions
- Cloudflare D1
- Cloudflare R2

## Current Flow

- Gallery admin requests presigned upload URLs from `/api/admin/images/upload/init`
- Browser uploads image files directly to R2 with those signed `PUT` URLs
- Gallery admin calls `/api/admin/images/upload/complete` to write image records and tag bindings into D1
- Public image URLs are served by this project under `/file/...`

## Required Bindings and Variables

Wrangler bindings:

- `GALLERY_DB` as a D1 database
- `GALLERY_BUCKET` as an R2 bucket

Environment variables:

- `GALLERY_ADMIN_KEY`
- `GALLERY_PUBLIC_BASE_URL`
- `GALLERY_UPLOAD_NAME_TYPE` defaults to `origin`
- `GALLERY_UPLOAD_FOLDER` defaults to `gallery`
- `R2_ACCOUNT_ID`
- `R2_BUCKET_NAME`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`

`GALLERY_PUBLIC_BASE_URL` should normally point to the same project, for example:

- local: `http://127.0.0.1:8788/file`
- production: `https://your-domain.example/file`

`R2_BUCKET_NAME` should match the real bucket that receives direct browser uploads.

## Cloudflare R2 CORS

Because the browser uploads directly to R2, your R2 bucket must allow CORS from the gallery site origin.

Example rule:

```json
[
  {
    "AllowedOrigins": [
      "https://your-pages-domain.pages.dev",
      "https://your-custom-domain.example"
    ],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

## Local Development

If you want to prepare the local database explicitly, you can run:

```bash
npx wrangler d1 execute GALLERY_DB --local --file schema.sql --persist-to ./.wrangler/state
```

For local direct uploads, provide real R2 signing credentials in the shell before starting preview.

Start local preview:

```bash
npx wrangler pages dev ./public --d1 GALLERY_DB --r2 GALLERY_BUCKET --compatibility-date 2026-03-02 --ip 0.0.0.0 --port 8788 --persist-to ./.wrangler/state
```

Local URLs:

- Public gallery: `http://127.0.0.1:8788/`
- Admin page: `http://127.0.0.1:8788/admin/`
- Image route: `http://127.0.0.1:8788/file/...`

The admin page expects the same `GALLERY_ADMIN_KEY` value that the Functions runtime receives.
