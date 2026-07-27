import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("stdio MCP handshake exposes grouped-tag and manifest tools", async () => {
  const packageRoot = process.env.GALLERY_MCP_PACKAGE_ROOT
    ? path.resolve(process.env.GALLERY_MCP_PACKAGE_ROOT)
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(packageRoot, "dist", "index.js")],
    cwd: packageRoot,
    stderr: "pipe",
    env: {
      ...Object.fromEntries(Object.entries(process.env).filter((entry) => typeof entry[1] === "string")),
      GALLERY_ADMIN_KEY: "protocol-test-key",
      GALLERY_BASE_URL: "http://127.0.0.1:8788",
    },
  });
  const client = new Client({ name: "gallery-mcp-test-client", version: "1.0.0" }, { capabilities: {} });
  try {
    await client.connect(transport);
    const response = await client.listTools();
    assert.deepEqual(
      response.tools.map((tool) => tool.name).sort(),
      [
        "gallery_apply_recognition_manifest",
        "gallery_cache_remote_image",
        "gallery_cache_remote_images",
        "gallery_ensure_tag",
        "gallery_ensure_tag_group",
        "gallery_get_image",
        "gallery_get_local_image_tags",
        "gallery_get_remote_image_cache_status",
        "gallery_get_remote_image_cache_status_batch",
        "gallery_get_taxonomy",
        "gallery_health_check",
        "gallery_list_images",
        "gallery_mark_remote_image_analyzed",
        "gallery_resume_upload",
        "gallery_scan_image_ids",
        "gallery_search_images_by_name",
        "gallery_set_local_image_tags",
        "gallery_set_local_image_tags_batch",
        "gallery_set_remote_image_tags",
        "gallery_set_remote_image_tags_batch",
        "gallery_upload_image",
        "gallery_upload_images",
        "gallery_upload_manifest",
      ],
    );
    assert.ok(response.tools.every((tool) => tool.inputSchema?.type === "object"));

    for (const name of ["gallery_upload_image", "gallery_upload_images", "gallery_resume_upload"]) {
      const schema = response.tools.find((tool) => tool.name === name)?.inputSchema;
      assert.ok(schema?.properties?.directory_id, `${name} should expose directory_id`);
      assert.ok(schema?.properties?.tag_selections, `${name} should expose tag_selections`);
      assert.equal(schema?.properties?.category_id, undefined);
      assert.equal(schema?.properties?.tag_ids, undefined);
    }

    const resumeSchema = response.tools.find((tool) => tool.name === "gallery_resume_upload")?.inputSchema;
    assert.ok(resumeSchema?.properties?.upload_id);
    assert.ok(resumeSchema?.required?.includes("upload_id"));

    const localTagsSchema = response.tools.find((tool) => tool.name === "gallery_set_local_image_tags")?.inputSchema;
    assert.ok(localTagsSchema?.properties?.local_path);
    assert.ok(localTagsSchema?.properties?.tag_selections);
    assert.equal(localTagsSchema?.properties?.image_id, undefined);
    assert.equal(localTagsSchema?.properties?.directory_id, undefined);

    const remoteTagsSchema = response.tools.find((tool) => tool.name === "gallery_set_remote_image_tags")?.inputSchema;
    assert.ok(remoteTagsSchema?.properties?.image_id);
    assert.ok(remoteTagsSchema?.properties?.tag_selections);
    assert.equal(remoteTagsSchema?.properties?.local_path, undefined);
    assert.equal(remoteTagsSchema?.properties?.tag_ids, undefined);

    assert.equal(response.tools.some((tool) => tool.name === "gallery_set_image_tags"), false);
    assert.equal(response.tools.some((tool) => tool.name === "gallery_set_image_tags_batch"), false);

    const manifestSchema = response.tools.find((tool) => tool.name === "gallery_upload_manifest")?.inputSchema;
    assert.ok(manifestSchema?.properties?.result_detail);

    const recognitionSchema = response.tools.find((tool) => tool.name === "gallery_apply_recognition_manifest")?.inputSchema;
    assert.equal(recognitionSchema?.properties?.items?.maxItems, 50);
    assert.equal(recognitionSchema?.properties?.dry_run?.default, true);
    assert.ok(recognitionSchema?.properties?.confirm_apply);
    assert.ok(recognitionSchema?.properties?.result_detail);

    const scanSchema = response.tools.find((tool) => tool.name === "gallery_scan_image_ids")?.inputSchema;
    assert.equal(scanSchema?.properties?.after_image_id?.default, 0);
    assert.equal(scanSchema?.properties?.limit?.default, 50);
    assert.equal(scanSchema?.properties?.limit?.maximum, 100);
    assert.ok(scanSchema?.properties?.snapshot_max_image_id);
    assert.equal(scanSchema?.properties?.offset, undefined);

    const nameSearchSchema = response.tools.find((tool) => tool.name === "gallery_search_images_by_name")?.inputSchema;
    assert.ok(nameSearchSchema?.properties?.name_query);
    assert.equal(nameSearchSchema?.properties?.limit?.default, 20);
    assert.equal(nameSearchSchema?.properties?.limit?.maximum, 100);
    assert.equal(nameSearchSchema?.properties?.offset?.default, 0);
    assert.ok(nameSearchSchema?.required?.includes("name_query"));

    const cacheSchema = response.tools.find((tool) => tool.name === "gallery_cache_remote_image")?.inputSchema;
    assert.ok(cacheSchema?.properties?.public_id);
    assert.ok(cacheSchema?.properties?.image_id);
    assert.ok(cacheSchema?.properties?.analysis_version);
    assert.ok(cacheSchema?.properties?.force_refresh);
    assert.ok(cacheSchema?.properties?.user_confirmed_visual_analysis);
    assert.ok(cacheSchema?.required?.includes("user_confirmed_visual_analysis"));

    const cacheBatchSchema = response.tools.find((tool) => tool.name === "gallery_cache_remote_images")?.inputSchema;
    assert.equal(cacheBatchSchema?.properties?.images?.maxItems, 50);
    assert.ok(cacheBatchSchema?.properties?.result_detail);
    assert.ok(cacheBatchSchema?.required?.includes("user_confirmed_visual_analysis"));

    const statusBatchSchema = response.tools.find((tool) => tool.name === "gallery_get_remote_image_cache_status_batch")?.inputSchema;
    assert.equal(statusBatchSchema?.properties?.images?.maxItems, 100);
    assert.ok(statusBatchSchema?.properties?.result_detail);
    assert.equal(statusBatchSchema?.properties?.user_confirmed_visual_analysis, undefined);

    const markSchema = response.tools.find((tool) => tool.name === "gallery_mark_remote_image_analyzed")?.inputSchema;
    assert.ok(markSchema?.properties?.content_sha256);
    assert.ok(markSchema?.properties?.result_reference);
    assert.ok(markSchema?.required?.includes("user_confirmed_visual_analysis"));
    assert.equal(markSchema?.properties?.local_path, undefined);
  } finally {
    await client.close();
  }
});
