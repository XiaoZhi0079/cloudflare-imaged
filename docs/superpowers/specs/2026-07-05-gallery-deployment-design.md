# Gallery Deployment Design

## Goal

Make `gallery` the only actively maintained project, use Cloudflare Pages direct Git integration for production deployment, keep GitHub Actions limited to CI checks, and retain `CloudFlare-ImgBed` only as a local legacy backup.

## Decisions

### Source of truth

`gallery/` is the only source of truth for ongoing development and deployment. The workspace root is just a container directory, and `CloudFlare-ImgBed/` is no longer part of the active delivery path.

### Deployment model

Production deployment is handled by Cloudflare Pages directly connected to the GitHub repository for `gallery`. We do not add a second GitHub-based deployment path for the same app, because that would duplicate configuration and make release state harder to reason about.

### CI scope

GitHub Actions in `gallery` should run lightweight validation only:

- repository checkout
- Node setup
- `node --test tests/*.test.js`

This keeps the repository protected by an automated check without turning GitHub Actions into the deployment system.

### Legacy project handling

`CloudFlare-ImgBed/` remains on disk temporarily as a backup and reference for older workflow history, but it must be clearly marked as legacy so it is not confused with the active app.

## Required documentation

The `gallery` README must document:

- Cloudflare Pages direct Git deployment steps
- build configuration expectations
- required environment variables
- required D1 and R2 bindings
- required R2 CORS rules
- the fact that old project workflows are not used for the active app

## Verification

The completion bar for this change is:

- `gallery` contains a CI workflow
- `gallery` README explains the current deploy path end to end
- legacy backup status is explicitly documented
- local tests still pass
