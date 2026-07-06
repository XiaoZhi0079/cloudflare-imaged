# Admin Workbench Layout Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the admin workbench onto a single consistent grid/flex layout system so headers, auth controls, toolbar controls, sidebar, and image panel align cleanly.

**Architecture:** Keep the current admin page and visual language, but normalize its structure into four clear sections: head, auth strip, toolbar, and content grid. Add one static regression test for layout hooks, then update HTML and CSS together so the structure and styles stay in sync.

**Tech Stack:** Static HTML, CSS, Node test runner

---

### Task 1: Lock the new layout hooks with a failing test

**Files:**
- Modify: `tests/ui-smoke.test.js`
- Test: `tests/ui-smoke.test.js`

- [ ] Add a test that asserts the admin page contains dedicated layout hooks for head content, auth controls, toolbar actions, and library meta.
- [ ] Run: `node --test tests/ui-smoke.test.js`
- [ ] Verify it fails before implementation.

### Task 2: Reshape the admin page markup

**Files:**
- Modify: `public/admin/index.html`
- Test: `tests/ui-smoke.test.js`

- [ ] Move the head section into explicit content/status blocks.
- [ ] Wrap auth controls into a shared row so title, field, button, and note align on one system.
- [ ] Wrap toolbar search/upload into a unified top row and keep tag filters in a full-width row below.
- [ ] Move the library count into the panel header row.

### Task 3: Replace the ad-hoc workbench layout rules

**Files:**
- Modify: `public/assets/main.css`
- Test: `tests/ui-smoke.test.js`

- [ ] Add shared admin layout variables for control height, gaps, panel padding, and sidebar width.
- [ ] Rebuild head, auth, toolbar, and content grid rules on one consistent baseline.
- [ ] Normalize button/input heights, panel header alignment, count badge placement, and empty-state widths.
- [ ] Preserve responsive behavior by collapsing from two columns to one column below the existing tablet breakpoint.

### Task 4: Verify the refactor end to end

**Files:**
- Test: `tests/ui-smoke.test.js`
- Test: `tests/*.test.js`

- [ ] Run: `node --test tests/ui-smoke.test.js`
- [ ] Run: `node --test tests/*.test.js`
- [ ] Confirm all tests pass.
