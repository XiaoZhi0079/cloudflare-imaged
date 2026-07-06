# Next Steps

## Current State

- `gallery` is now the only active project.
- Cloudflare direct Git deployment is the intended production path.
- GitHub Actions in this repository are limited to CI checks.
- `CloudFlare-ImgBed` is retained only as a local legacy backup.

## Immediate Next Actions

1. Push `gallery` to the GitHub repository.
2. Connect the GitHub repository to the Cloudflare Pages project.
3. Confirm production variables and secrets in Cloudflare Pages.
4. Confirm D1 and R2 bindings match `wrangler.toml`.
5. Verify R2 CORS against both the Pages domain and the custom domain.
6. Run one production smoke test:
   - open gallery home
   - open admin
   - create a tag
   - upload one image
   - verify `/file/...` access

## What Can Be Done Locally

- configure Git remote
- commit repository changes
- push to GitHub if credentials are available
- keep deployment docs and CI in sync

## What Must Be Done In Cloudflare

- attach or reconnect the Pages project to this repository
- set `GALLERY_ADMIN_KEY`
- set `GALLERY_PUBLIC_BASE_URL`
- set `GALLERY_UPLOAD_NAME_TYPE` if needed
- set `GALLERY_UPLOAD_FOLDER` if needed
- set `R2_ACCOUNT_ID`
- set `R2_BUCKET_NAME`
- set `R2_ACCESS_KEY_ID`
- set `R2_SECRET_ACCESS_KEY`
- bind `GALLERY_DB`
- bind `GALLERY_BUCKET`
- confirm bucket CORS
