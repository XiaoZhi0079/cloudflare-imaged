# Gallery MVP

Independent public gallery frontend and lightweight admin surface managed entirely by this project.

## Runtime

- Cloudflare Pages
- Pages Functions
- Cloudflare D1
- Cloudflare R2

## Production Deployment

This project is meant to be deployed by Cloudflare Pages through direct GitHub integration.

The current Cloudflare Pages project is `cloudflare-imaged`; its custom production domain is `gallery.140079.xyz`.

Recommended setup:

1. Push the `gallery` repository to GitHub.
2. In Cloudflare Dashboard, create a Pages project or reconnect the existing Pages project to this repository.
3. Let Cloudflare read `wrangler.toml` from the repository root.
4. Use `main` as the production branch.
5. Keep GitHub Actions for CI only. Do not add a second deployment pipeline unless you intentionally want a fallback path.

Cloudflare build settings for this repository:

- Framework preset: `None`
- Build command: leave empty
- Build output directory: `public`

If Cloudflare shows Wrangler config detection, that is expected. This repository already declares:

- `pages_build_output_dir = "./public"`
- D1 binding `GALLERY_DB`
- R2 binding `GALLERY_BUCKET`

If you move this project to a different Cloudflare account, update `wrangler.toml` to use the target D1 database ID and bucket names for that account.

## D1 Migrations

The repository does not create or repair D1 tables inside request handlers. Apply the versioned migrations before starting a new environment or deploying code that depends on them.

Local database:

```bash
npm run db:migrate:local
```

Production database, after a read-only schema check:

```bash
npx wrangler d1 migrations list GALLERY_DB --remote
npx wrangler d1 migrations apply GALLERY_DB --remote
npx wrangler d1 migrations list GALLERY_DB --remote
```

`migrations/0001_baseline.sql` is additive and idempotent: it creates missing current objects and inserts only missing defaults. It does not drop, delete, or overwrite gallery business data. Production migrations are an explicit release step; they are not part of the Pages build command or GitHub CI.

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

For Cloudflare Pages production, set those values in:

- `Workers & Pages` -> your Pages project -> `Settings` -> `Variables and Secrets`

Recommended production values:

- `GALLERY_PUBLIC_BASE_URL=https://your-domain.example/file`
- `GALLERY_UPLOAD_NAME_TYPE=origin`
- `GALLERY_UPLOAD_FOLDER=gallery`

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

If uploads fail in the browser while the admin API still works, the first thing to check is R2 CORS.

## Deployment Checklist

Before the first production deploy, confirm all of the following:

- D1 database exists and is bound as `GALLERY_DB`
- All remote D1 migrations have been applied
- R2 bucket exists and is bound as `GALLERY_BUCKET`
- Pages project secrets include the gallery admin key and R2 signing credentials
- `GALLERY_PUBLIC_BASE_URL` points to your real deployed `/file` route
- R2 bucket CORS allows your Pages domain and custom domain
- Your custom domain is attached to the Pages project, not to the legacy app

## Legacy Project Note

The older `CloudFlare-ImgBed` directory in the workspace is retained only as a local backup and workflow reference. It is not the active deployment source for this gallery.

## Local Development

Prepare the local database with the same migrations used by Cloudflare:

```bash
npm run db:migrate:local
```

For local direct uploads, copy .dev.vars.example to .dev.vars and fill in your real R2 signing credentials before starting preview.

Start local preview:

```bash
npm run dev
```

`npm run dev`, `start-local.cmd`, and `start-local.sh` all apply pending local migrations before Pages starts. A migration failure stops startup.

Local URLs:

- Public gallery: `http://127.0.0.1:8788/`
- Admin page: `http://127.0.0.1:8788/admin/`
- Image route: `http://127.0.0.1:8788/file/...`

The admin page expects the same `GALLERY_ADMIN_KEY` value that the Functions runtime receives.
