import test from "node:test";
import assert from "node:assert/strict";

import { createImgBedClient } from "../src/server/imgbed-client.js";

test("listImagesFromManageApi sends bearer token and normalizes image records", async () => {
  const calls = [];
  const client = createImgBedClient({
    baseUrl: "https://imgbed.example.com",
    apiToken: "secret-token",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });

      return new Response(
        JSON.stringify({
          files: [
            {
              name: "girls/japan-01.webp",
              metadata: {
                FileType: "image/webp",
                Width: 720,
                Height: 1280,
              },
            },
            {
              name: "misc/clip.mp4",
              metadata: {
                FileType: "video/mp4",
              },
            },
          ],
        }),
        {
          headers: {
            "content-type": "application/json",
          },
        },
      );
    },
  });

  const records = await client.listImagesFromManageApi({ recursive: true });

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/api\/manage\/list\?/);
  assert.equal(calls[0].init.headers.Authorization, "Bearer secret-token");
  assert.deepEqual(records, [
    {
      imgbedFileId: "girls/japan-01.webp",
      fileName: "japan-01.webp",
      fileUrl: "https://imgbed.example.com/file/girls/japan-01.webp",
      width: 720,
      height: 1280,
      syncStatus: "ok",
    },
  ]);
});

test("listImagesFromManageApi rejects failed imgbed responses", async () => {
  const client = createImgBedClient({
    baseUrl: "https://imgbed.example.com",
    apiToken: "secret-token",
    fetchImpl: async () =>
      new Response(JSON.stringify({ error: "bad request" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
  });

  await assert.rejects(
    client.listImagesFromManageApi(),
    /ImgBed list request failed/,
  );
});

test("uploadImage sends bearer token, forwards the file, and normalizes the ImgBed upload response", async () => {
  const calls = [];
  const client = createImgBedClient({
    baseUrl: "https://imgbed.example.com",
    apiToken: "secret-token",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });

      return new Response(
        JSON.stringify([
          {
            src: "/file/gallery/campus-01.webp",
            publicUrl: "https://cdn.example.com/gallery/campus-01.webp",
          },
        ]),
        {
          headers: {
            "content-type": "application/json",
          },
        },
      );
    },
  });

  const file = new File(["image-bytes"], "campus-01.webp", { type: "image/webp" });
  const record = await client.uploadImage({
    file,
    uploadChannel: "telegram",
    uploadFolder: "gallery",
    uploadNameType: "origin",
    imageMeta: { width: 900, height: 1350 },
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/upload\?/);
  assert.match(calls[0].url, /uploadChannel=telegram/);
  assert.match(calls[0].url, /uploadFolder=gallery/);
  assert.match(calls[0].url, /uploadNameType=origin/);
  assert.match(calls[0].url, /returnFormat=full/);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, "Bearer secret-token");
  assert.equal(calls[0].init.body.get("file").name, "campus-01.webp");
  assert.deepEqual(record, {
    imgbedFileId: "gallery/campus-01.webp",
    fileName: "campus-01.webp",
    fileUrl: "https://cdn.example.com/gallery/campus-01.webp",
    width: 900,
    height: 1350,
    syncStatus: "ok",
  });
});

test("uploadImage rejects failed imgbed upload responses", async () => {
  const client = createImgBedClient({
    baseUrl: "https://imgbed.example.com",
    apiToken: "secret-token",
    fetchImpl: async () =>
      new Response("upload failed", {
        status: 500,
        headers: { "content-type": "text/plain; charset=utf-8" },
      }),
  });

  const file = new File(["image-bytes"], "campus-01.webp", { type: "image/webp" });

  await assert.rejects(
    client.uploadImage({ file }),
    /ImgBed upload request failed/,
  );
});


test("deleteImage sends bearer token and calls the manage delete endpoint", async () => {
  const calls = [];
  const client = createImgBedClient({
    baseUrl: "https://imgbed.example.com",
    apiToken: "secret-token",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });

      return new Response(JSON.stringify({ success: true, fileId: "gallery/campus-01.webp" }), {
        headers: { "content-type": "application/json" },
      });
    },
  });

  const result = await client.deleteImage("gallery/campus-01.webp");

  assert.equal(result, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/api\/manage\/delete\/gallery%2Fcampus-01\.webp$/);
  assert.equal(calls[0].init.method, "DELETE");
  assert.equal(calls[0].init.headers.Authorization, "Bearer secret-token");
});

test("deleteImage rejects failed imgbed delete responses", async () => {
  const client = createImgBedClient({
    baseUrl: "https://imgbed.example.com",
    apiToken: "secret-token",
    fetchImpl: async () =>
      new Response(JSON.stringify({ success: false, error: "cannot delete" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
  });

  await assert.rejects(
    client.deleteImage("gallery/campus-01.webp"),
    /ImgBed delete request failed/,
  );
});


test("renameImage sends bearer token and calls the manage rename endpoint", async () => {
  const calls = [];
  const client = createImgBedClient({
    baseUrl: "https://imgbed.example.com",
    apiToken: "secret-token",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });

      return new Response(JSON.stringify({ success: true, newFileId: "gallery/campus-02.webp" }), {
        headers: { "content-type": "application/json" },
      });
    },
  });

  const record = await client.renameImage("gallery/campus-01.webp", "gallery/campus-02.webp");

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/api\/manage\/rename\/gallery%2Fcampus-01\.webp$/);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, "Bearer secret-token");
  assert.deepEqual(JSON.parse(calls[0].init.body), { newFileId: "gallery/campus-02.webp" });
  assert.deepEqual(record, {
    imgbedFileId: "gallery/campus-02.webp",
    fileName: "campus-02.webp",
    fileUrl: "https://imgbed.example.com/file/gallery/campus-02.webp",
    syncStatus: "ok",
  });
});

test("renameImage rejects failed imgbed rename responses", async () => {
  const client = createImgBedClient({
    baseUrl: "https://imgbed.example.com",
    apiToken: "secret-token",
    fetchImpl: async () =>
      new Response(JSON.stringify({ success: false, message: "cannot rename" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
  });

  await assert.rejects(
    client.renameImage("gallery/campus-01.webp", "gallery/campus-02.webp"),
    /ImgBed rename request failed/,
  );
});


test("moveImage sends bearer token and calls the manage move endpoint", async () => {
  const calls = [];
  const client = createImgBedClient({
    baseUrl: "https://imgbed.example.com",
    apiToken: "secret-token",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });

      return new Response(JSON.stringify({ success: true, newFileId: "archive/campus-01.webp" }), {
        headers: { "content-type": "application/json" },
      });
    },
  });

  const record = await client.moveImage("gallery/campus-01.webp", "archive");

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/api\/manage\/move\/gallery%2Fcampus-01\.webp\?dist=archive$/);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, "Bearer secret-token");
  assert.deepEqual(record, {
    imgbedFileId: "archive/campus-01.webp",
    fileName: "campus-01.webp",
    fileUrl: "https://imgbed.example.com/file/archive/campus-01.webp",
    syncStatus: "ok",
  });
});

test("moveImage rejects failed imgbed move responses", async () => {
  const client = createImgBedClient({
    baseUrl: "https://imgbed.example.com",
    apiToken: "secret-token",
    fetchImpl: async () =>
      new Response(JSON.stringify({ success: false, error: "cannot move" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
  });

  await assert.rejects(
    client.moveImage("gallery/campus-01.webp", "archive"),
    /ImgBed move request failed/,
  );
});
