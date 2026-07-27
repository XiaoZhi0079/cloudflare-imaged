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
        "gallery_ensure_tag",
        "gallery_ensure_tag_group",
        "gallery_get_image",
        "gallery_get_local_image_tags",
        "gallery_get_taxonomy",
        "gallery_health_check",
        "gallery_list_images",
        "gallery_resume_upload",
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
  } finally {
    await client.close();
  }
});
