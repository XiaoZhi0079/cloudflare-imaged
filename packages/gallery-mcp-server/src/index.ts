#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadConfig } from "./config.js";
import { GalleryApiClient } from "./services/gallery-client.js";
import { TaxonomyService } from "./services/taxonomy-service.js";
import { registerImageTools } from "./tools/image-tools.js";
import { registerTaxonomyTools } from "./tools/taxonomy-tools.js";

function printHelp(): void {
  console.error(`gallery-mcp-server\n\nEnvironment:\n  GALLERY_BASE_URL        Gallery API base URL (default: https://gallery.140079.xyz)\n  GALLERY_ADMIN_KEY       Gallery admin key (prefer the file option)\n  GALLERY_ADMIN_KEY_FILE  File containing the Gallery admin key\n  GALLERY_UPLOAD_ROOTS    Semicolon-separated local image roots\n  GALLERY_MAX_FILE_BYTES  Maximum upload size (default: 50 MiB)\n`);
}

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp();
    return;
  }

  const config = loadConfig();
  const api = new GalleryApiClient(config);
  const taxonomy = new TaxonomyService(api);
  const server = new McpServer({ name: "gallery-mcp-server", version: "0.2.0" });

  registerTaxonomyTools(server, taxonomy);
  registerImageTools(server, { api, taxonomy, config });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("gallery-mcp-server running via stdio");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unexpected startup error.";
  console.error(`gallery-mcp-server failed to start: ${message}`);
  process.exitCode = 1;
});
