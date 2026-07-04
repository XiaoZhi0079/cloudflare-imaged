function buildFileUrl(baseUrl, fileId) {
  const origin = baseUrl.replace(/\/+$/, "");
  const safePath = fileId
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");

  return `${origin}/file/${safePath}`;
}

function isImageRecord(file) {
  return String(file?.metadata?.FileType ?? "").startsWith("image/");
}

function normalizeUploadRecord(baseUrl, entry, imageMeta = {}) {
  const src = String(entry?.src ?? "").trim();
  if (!src) {
    throw new Error("ImgBed upload response missing src");
  }

  const srcUrl = new URL(src, baseUrl);
  const filePathMatch = srcUrl.pathname.match(/^\/file\/(.+)$/);
  if (!filePathMatch) {
    throw new Error("ImgBed upload response missing file path");
  }

  const imgbedFileId = decodeURIComponent(filePathMatch[1]);
  const fileUrl = String(entry?.publicUrl ?? "").trim() || srcUrl.toString();

  return {
    imgbedFileId,
    fileName: imgbedFileId.split("/").pop(),
    fileUrl,
    width: imageMeta.width ?? null,
    height: imageMeta.height ?? null,
    syncStatus: "ok",
  };
}

export function createImgBedClient({ baseUrl, apiToken, fetchImpl = fetch }) {
  return {
    async listImagesFromManageApi({ recursive = true, dir = "" } = {}) {
      const url = new URL("/api/manage/list", baseUrl);
      url.searchParams.set("count", "-1");
      url.searchParams.set("recursive", recursive ? "true" : "false");

      if (dir) {
        url.searchParams.set("dir", dir);
      }

      const response = await fetchImpl(url.toString(), {
        headers: {
          Authorization: `Bearer ${apiToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(`ImgBed list request failed with status ${response.status}`);
      }

      const payload = await response.json();
      const files = Array.isArray(payload.files) ? payload.files : [];

      return files
        .filter(isImageRecord)
        .map((file) => ({
          imgbedFileId: file.name,
          fileName: file.name.split("/").pop(),
          fileUrl: buildFileUrl(baseUrl, file.name),
          width: file.metadata?.Width ?? null,
          height: file.metadata?.Height ?? null,
          syncStatus: "ok",
        }));
    },

    async uploadImage({
      file,
      uploadChannel = "telegram",
      uploadFolder = "",
      uploadNameType = "origin",
      imageMeta = {},
    }) {
      const url = new URL("/upload", baseUrl);
      url.searchParams.set("uploadChannel", uploadChannel);
      url.searchParams.set("uploadNameType", uploadNameType);
      url.searchParams.set("returnFormat", "full");

      if (uploadFolder) {
        url.searchParams.set("uploadFolder", uploadFolder);
      }

      const formData = new FormData();
      formData.append("file", file);

      const response = await fetchImpl(url.toString(), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
        },
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`ImgBed upload request failed with status ${response.status}`);
      }

      const payload = await response.json();
      const entry = Array.isArray(payload) ? payload[0] : payload;

      return normalizeUploadRecord(baseUrl, entry, imageMeta);
    },


    async renameImage(fileId, newFileId) {
      const url = new URL(`/api/manage/rename/${encodeURIComponent(fileId)}`, baseUrl);
      const response = await fetchImpl(url.toString(), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ newFileId }),
      });

      if (!response.ok) {
        throw new Error(`ImgBed rename request failed with status ${response.status}`);
      }

      const payload = await response.json();
      if (payload?.success === false) {
        throw new Error(payload.message ?? "ImgBed rename request failed");
      }

      return {
        imgbedFileId: newFileId,
        fileName: newFileId.split("/").pop(),
        fileUrl: buildFileUrl(baseUrl, newFileId),
        syncStatus: "ok",
      };
    },

    async moveImage(fileId, directory) {
      const url = new URL(`/api/manage/move/${encodeURIComponent(fileId)}`, baseUrl);
      url.searchParams.set("dist", directory);
      const response = await fetchImpl(url.toString(), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(`ImgBed move request failed with status ${response.status}`);
      }

      const payload = await response.json();
      const nextFileId = payload?.newFileId ?? `${directory}/${fileId.split("/").pop()}`;
      if (payload?.success === false) {
        throw new Error(payload.error ?? "ImgBed move request failed");
      }

      return {
        imgbedFileId: nextFileId,
        fileName: nextFileId.split("/").pop(),
        fileUrl: buildFileUrl(baseUrl, nextFileId),
        syncStatus: "ok",
      };
    },
    async deleteImage(fileId) {
      const url = new URL(`/api/manage/delete/${encodeURIComponent(fileId)}`, baseUrl);
      const response = await fetchImpl(url.toString(), {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${apiToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(`ImgBed delete request failed with status ${response.status}`);
      }

      const payload = await response.json();
      if (payload?.success === false) {
        throw new Error(payload.error ?? "ImgBed delete request failed");
      }

      return true;
    },
  };
}
