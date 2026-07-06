# Gallery Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `gallery` the sole maintained app, add lightweight CI, and document Cloudflare direct deployment while keeping the old project only as a backup.

**Architecture:** Cloudflare Pages remains the deployment engine and reads `wrangler.toml` plus project-level bindings and variables. GitHub Actions only runs repository validation and never publishes to Cloudflare.

**Tech Stack:** GitHub Actions, Node.js test runner, Cloudflare Pages, Pages Functions, D1, R2

---

### Task 1: Add repository CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Add a push and pull_request workflow**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
```

- [ ] **Step 2: Run the repository test suite with Node 22**

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: '22'
      - run: node --test tests/*.test.js
```

### Task 2: Document the active deployment path

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Explain that Cloudflare Pages direct Git integration is the production deployment path**

```md
## Production Deployment

1. Push `gallery` to GitHub.
2. Connect the repository to Cloudflare Pages.
3. Let Cloudflare deploy on each push to `main`.
```

- [ ] **Step 2: Document build, bindings, variables, and R2 CORS**

```md
- Build command: none
- Output directory: `public`
- Bind `GALLERY_DB` and `GALLERY_BUCKET`
- Set required environment variables in the Pages project
```

### Task 3: Mark the old project as legacy

**Files:**
- Create: `../CloudFlare-ImgBed/LEGACY.md`

- [ ] **Step 1: Add a short warning that the directory is backup-only**

```md
This project is retained only as a legacy backup and workflow reference.
Do not use it as the active deployment source for the gallery.
```

### Task 4: Verify

**Files:**
- Test: `tests/*.test.js`

- [ ] **Step 1: Run the full test suite**

Run: `node --test tests/*.test.js`
Expected: all tests pass

- [ ] **Step 2: Inspect the workflow and docs changes**

Run: `git diff -- .github/workflows/ci.yml README.md docs/superpowers/specs/2026-07-05-gallery-deployment-design.md docs/superpowers/plans/2026-07-05-gallery-deployment.md ../CloudFlare-ImgBed/LEGACY.md`
Expected: diff only contains the intended CI, docs, and legacy marker changes
