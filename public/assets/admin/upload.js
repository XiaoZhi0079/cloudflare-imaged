const ACTIVE_STATES = new Set(["preparing", "signing", "uploading", "completing"]);

function responseMessage(body, contentType, statusText) {
  const title = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    ?.replace(/\s+/g, " ")
    .trim();
  if (title) return title;

  const xmlCode = body.match(/<Code>([\s\S]*?)<\/Code>/i)?.[1]?.trim();
  const xmlMessage = body.match(/<Message>([\s\S]*?)<\/Message>/i)?.[1]?.trim();
  if (xmlCode || xmlMessage) return [xmlCode, xmlMessage].filter(Boolean).join(": ");

  if (!contentType.includes("html") && !body.trimStart().startsWith("<")) {
    return body.replace(/\s+/g, " ").trim().slice(0, 240);
  }
  return statusText || "Cloudflare 返回了无法解析的错误页面";
}

export async function describeUploadFailure(response, fileName) {
  const body = await response.text();
  const message = responseMessage(
    body,
    response.headers.get("content-type")?.toLowerCase() ?? "",
    response.statusText,
  );
  const details = [`HTTP ${response.status}`];
  if (message) details.push(message);
  const rayId = response.headers.get("cf-ray");
  if (rayId) details.push(`Ray ID ${rayId}`);
  return `图片直传失败：${fileName}（${details.join("，")}）`;
}

export async function measureImageFile(file, {
  createBitmap = globalThis.createImageBitmap,
  ImageCtor = globalThis.Image,
  URLImpl = globalThis.URL,
} = {}) {
  if (typeof createBitmap === "function") {
    try {
      const bitmap = await createBitmap(file);
      const dimensions = { width: bitmap.width, height: bitmap.height };
      bitmap.close?.();
      return dimensions;
    } catch {
      // Fall through to the image element decoder.
    }
  }

  if (typeof ImageCtor !== "function" || typeof URLImpl?.createObjectURL !== "function") {
    return { width: null, height: null };
  }

  return await new Promise((resolve) => {
    let url;
    try {
      url = URLImpl.createObjectURL(file);
    } catch {
      resolve({ width: null, height: null });
      return;
    }
    const image = new ImageCtor();
    const finish = (dimensions) => {
      URLImpl.revokeObjectURL?.(url);
      resolve(dimensions);
    };
    image.onload = () => finish({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => finish({ width: null, height: null });
    image.src = url;
  });
}

export async function calculateFileSha256(file, cryptoImpl = globalThis.crypto) {
  if (typeof file?.arrayBuffer !== "function" || typeof cryptoImpl?.subtle?.digest !== "function") {
    throw new Error("当前浏览器无法计算图片内容哈希。");
  }
  const digest = await cryptoImpl.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function inspectImageFile(file, dependencies = {}) {
  const [dimensions, contentSha256] = await Promise.all([
    measureImageFile(file, dependencies),
    calculateFileSha256(file, dependencies.cryptoImpl ?? globalThis.crypto),
  ]);
  return { ...dimensions, contentSha256 };
}

function errorText(error) {
  return error?.message || String(error || "上传失败");
}

function duplicateDetails(error) {
  return error?.payload?.code === "DUPLICATE_IMAGE_CONTENT" && Array.isArray(error.payload.duplicates)
    ? error.payload.duplicates
    : [];
}

function duplicateErrorText(detail) {
  if (detail?.reason === "same_batch") {
    return "与本次选择中的另一张图片内容完全相同，已跳过。";
  }
  if (detail?.reason === "upload_in_progress") {
    return "相同图片正在上传中，本次重复任务已跳过。";
  }
  const existing = detail?.existingImage;
  if (existing) {
    const identity = existing.id ? `（图片 #${existing.id}）` : "";
    return `图库中已存在相同图片“${existing.fileName || "未命名图片"}”${identity}，本次已跳过。`;
  }
  return "图库中已存在内容完全相同的图片，本次已跳过。";
}

function duplicateDetailForTask(task, details) {
  return details.find((detail) => (
    (detail?.uploadId && detail.uploadId === task.uploadId)
    || (detail?.clientItemId && detail.clientItemId === task.id)
    || (detail?.contentSha256 && detail.contentSha256 === task.draft.contentSha256)
  ));
}

export function createUploadRunner({
  batchSize = 12,
  prepareFile,
  requestUploadUrls,
  uploadFile,
  completeUploads,
  onChange = () => {},
}) {
  if (![requestUploadUrls, uploadFile, completeUploads].every((value) => typeof value === "function")) {
    throw new TypeError("Upload runner dependencies are required");
  }

  let taskList = [];
  let metadata = { categoryId: null, tagIds: [] };
  let running = false;
  let nextId = 1;
  const hasPreparer = typeof prepareFile === "function";

  function snapshot() {
    return taskList.map((task) => ({ ...task }));
  }

  function notify() {
    onChange(snapshot());
  }

  function transition(task, status, changes = {}) {
    Object.assign(task, changes, { status });
    notify();
  }

  async function processBatch(batch) {
    await Promise.all(batch.map(async (task) => {
      if (task.prepared || !hasPreparer) return;
      transition(task, "preparing", { error: null, upload: null });
      try {
        const dimensions = await prepareFile(task.file, { ...task });
        const width = Number(dimensions?.width);
        const height = Number(dimensions?.height);
        Object.assign(task.draft, {
          width: Number.isSafeInteger(width) && width > 0 ? width : null,
          height: Number.isSafeInteger(height) && height > 0 ? height : null,
          ...(dimensions?.contentSha256 ? { contentSha256: dimensions.contentSha256 } : {}),
        });
        task.prepared = true;
      } catch (error) {
        transition(task, "error", {
          error: errorText(error),
          errorCode: null,
          retryable: true,
        });
      }
    }));

    const ready = batch.filter((task) => task.status !== "error");
    if (!ready.length) return;
    const needsSigning = ready.filter((task) => !task.upload);
    if (needsSigning.length) {
      let pendingSigning = [...needsSigning];
      while (pendingSigning.length) {
        pendingSigning.forEach((task) => transition(task, "signing", { error: null }));
        try {
          const uploads = await requestUploadUrls(
            snapshot().filter((candidate) => pendingSigning.some((task) => task.id === candidate.id)),
            { ...metadata, tagIds: [...metadata.tagIds] },
          );
          if (!Array.isArray(uploads) || uploads.length !== pendingSigning.length) {
            throw new Error("服务端返回的上传任务数量不正确。");
          }
          const uploadsByTaskId = new Map(uploads
            .filter((upload) => upload?.taskId !== undefined)
            .map((upload) => [String(upload.taskId), upload]));
          pendingSigning.forEach((task, index) => {
            task.upload = uploadsByTaskId.get(String(task.id)) ?? uploads[index];
          });
          pendingSigning = [];
        } catch (error) {
          const details = duplicateDetails(error);
          const duplicated = pendingSigning
            .map((task) => ({ task, detail: duplicateDetailForTask(task, details) }))
            .filter(({ detail }) => detail);
          if (!duplicated.length) {
            pendingSigning.forEach((task) => transition(task, "error", {
              error: errorText(error),
              errorCode: null,
              retryable: true,
            }));
            pendingSigning = [];
            continue;
          }
          const duplicatedIds = new Set(duplicated.map(({ task }) => task.id));
          duplicated.forEach(({ task, detail }) => transition(task, "error", {
            error: duplicateErrorText(detail),
            errorCode: "DUPLICATE_IMAGE_CONTENT",
            retryable: false,
          }));
          pendingSigning = pendingSigning.filter((task) => !duplicatedIds.has(task.id));
        }
      }
    }

    const needsObjectUpload = ready.filter((task) => task.status !== "error" && !task.objectUploaded);
    await Promise.all(needsObjectUpload.map(async (task) => {
      transition(task, "uploading");
      try {
        await uploadFile(task.file, task.upload, task);
        task.objectUploaded = true;
      } catch (error) {
        transition(task, "error", {
          error: errorText(error),
          errorCode: null,
          retryable: true,
        });
      }
    }));

    const uploaded = ready.filter((task) => task.status !== "error" && task.objectUploaded);
    if (!uploaded.length) return;
    let pendingCompletion = [...uploaded];
    while (pendingCompletion.length) {
      pendingCompletion.forEach((task) => transition(task, "completing"));
      try {
        const results = await completeUploads(
          pendingCompletion.map((task) => ({ ...task })),
          { ...metadata, tagIds: [...metadata.tagIds] },
        );
        const normalizedResults = Array.isArray(results) ? results : [];
        pendingCompletion.forEach((task, index) => transition(task, "success", {
          error: null,
          errorCode: null,
          retryable: true,
          result: normalizedResults[index] ?? null,
        }));
        pendingCompletion = [];
      } catch (error) {
        const details = duplicateDetails(error);
        const duplicated = pendingCompletion
          .map((task) => ({ task, detail: duplicateDetailForTask(task, details) }))
          .filter(({ detail }) => detail);
        if (!duplicated.length) {
          pendingCompletion.forEach((task) => transition(task, "error", {
            error: errorText(error),
            errorCode: null,
            retryable: true,
          }));
          pendingCompletion = [];
          continue;
        }
        const duplicatedIds = new Set(duplicated.map(({ task }) => task.id));
        duplicated.forEach(({ task, detail }) => transition(task, "error", {
          error: duplicateErrorText(detail),
          errorCode: "DUPLICATE_IMAGE_CONTENT",
          retryable: false,
        }));
        pendingCompletion = pendingCompletion.filter((task) => !duplicatedIds.has(task.id));
      }
    }
  }

  async function runQueued() {
    if (running) return;
    running = true;
    try {
      const queued = taskList.filter((task) => task.status === "queued");
      for (let index = 0; index < queued.length; index += batchSize) {
        await processBatch(queued.slice(index, index + batchSize));
      }
    } finally {
      running = false;
      notify();
    }
  }

  return {
    setMetadata(next = {}) {
      metadata = {
        categoryId: next.categoryId === null || next.categoryId === "" ? null : Number(next.categoryId),
        tagIds: [...new Set((next.tagIds ?? []).map(Number).filter((id) => Number.isInteger(id) && id > 0))],
      };
      notify();
    },
    metadata() {
      return { ...metadata, tagIds: [...metadata.tagIds] };
    },
    setFiles(files, dimensions = []) {
      taskList = [...files].map((file, index) => {
        const size = dimensions[index] ?? {};
        const width = Number(size.width);
        const height = Number(size.height);
        const hasDimensions = Number.isSafeInteger(width) && width > 0
          && Number.isSafeInteger(height) && height > 0;
        return {
          id: `upload-${nextId++}`,
          uploadId: globalThis.crypto.randomUUID(),
          file,
          draft: {
            name: file.name,
            type: file.type,
            size: file.size,
            width: hasDimensions ? width : null,
            height: hasDimensions ? height : null,
          },
          prepared: !hasPreparer || hasDimensions,
          status: "queued",
          error: null,
          errorCode: null,
          retryable: true,
          upload: null,
          objectUploaded: false,
          result: null,
        };
      });
      notify();
    },
    tasks: snapshot,
    counts() {
      return taskList.reduce((counts, task) => {
        if (task.status === "queued") counts.queued += 1;
        if (ACTIVE_STATES.has(task.status)) counts.active += 1;
        if (task.status === "success") counts.success += 1;
        if (task.status === "error") counts.error += 1;
        return counts;
      }, { total: taskList.length, queued: 0, active: 0, success: 0, error: 0 });
    },
    run: runQueued,
    async retryFailed() {
      taskList.filter((task) => task.status === "error" && task.retryable !== false).forEach((task) => {
        Object.assign(task, {
          status: "queued",
          error: null,
          errorCode: null,
          result: null,
        });
      });
      notify();
      await runQueued();
    },
    isRunning() {
      return running;
    },
  };
}
