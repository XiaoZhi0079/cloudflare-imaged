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
        transition(task, "error", { error: errorText(error) });
      }
    }));

    const ready = batch.filter((task) => task.status !== "error");
    if (!ready.length) return;
    const needsSigning = ready.filter((task) => !task.upload);
    if (needsSigning.length) {
      needsSigning.forEach((task) => transition(task, "signing", { error: null }));
      try {
        const uploads = await requestUploadUrls(
          snapshot().filter((candidate) => needsSigning.some((task) => task.id === candidate.id)),
          { ...metadata, tagIds: [...metadata.tagIds] },
        );
        if (!Array.isArray(uploads) || uploads.length !== needsSigning.length) {
          throw new Error("服务端返回的上传任务数量不正确。");
        }
        const uploadsByTaskId = new Map(uploads
          .filter((upload) => upload?.taskId !== undefined)
          .map((upload) => [String(upload.taskId), upload]));
        needsSigning.forEach((task, index) => {
          task.upload = uploadsByTaskId.get(String(task.id)) ?? uploads[index];
        });
      } catch (error) {
        needsSigning.forEach((task) => transition(task, "error", { error: errorText(error) }));
      }
    }

    const needsObjectUpload = ready.filter((task) => task.status !== "error" && !task.objectUploaded);
    await Promise.all(needsObjectUpload.map(async (task) => {
      transition(task, "uploading");
      try {
        await uploadFile(task.file, task.upload, task);
        task.objectUploaded = true;
      } catch (error) {
        transition(task, "error", { error: errorText(error) });
      }
    }));

    const uploaded = ready.filter((task) => task.status !== "error" && task.objectUploaded);
    if (!uploaded.length) return;
    uploaded.forEach((task) => transition(task, "completing"));
    try {
      const results = await completeUploads(uploaded.map((task) => ({ ...task })), { ...metadata, tagIds: [...metadata.tagIds] });
      const normalizedResults = Array.isArray(results) ? results : [];
      uploaded.forEach((task, index) => transition(task, "success", {
        error: null,
        result: normalizedResults[index] ?? null,
      }));
    } catch (error) {
      uploaded.forEach((task) => transition(task, "error", { error: errorText(error) }));
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
      taskList.filter((task) => task.status === "error").forEach((task) => {
        Object.assign(task, { status: "queued", error: null, result: null });
      });
      notify();
      await runQueued();
    },
    isRunning() {
      return running;
    },
  };
}
