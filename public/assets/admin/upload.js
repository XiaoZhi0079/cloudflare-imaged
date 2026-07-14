const ACTIVE_STATES = new Set(["signing", "uploading", "completing"]);

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

function errorText(error) {
  return error?.message || String(error || "上传失败");
}

export function createUploadRunner({
  batchSize = 12,
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
    batch.forEach((task) => transition(task, "signing", { error: null, upload: null }));
    let uploads;
    try {
      uploads = await requestUploadUrls(snapshot().filter((candidate) => batch.some((task) => task.id === candidate.id)), { ...metadata, tagIds: [...metadata.tagIds] });
      if (!Array.isArray(uploads) || uploads.length !== batch.length) {
        throw new Error("服务端返回的上传任务数量不正确。");
      }
    } catch (error) {
      batch.forEach((task) => transition(task, "error", { error: errorText(error) }));
      return;
    }

    const uploadsByTaskId = new Map(uploads.filter((upload) => upload?.taskId !== undefined).map((upload) => [String(upload.taskId), upload]));
    const uploaded = [];
    await Promise.all(batch.map(async (task, index) => {
      const upload = uploadsByTaskId.get(String(task.id)) ?? uploads[index];
      transition(task, "uploading", { upload });
      try {
        await uploadFile(task.file, upload, task);
        uploaded.push(task);
      } catch (error) {
        transition(task, "error", { error: errorText(error) });
      }
    }));

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
        return {
          id: `upload-${nextId++}`,
          file,
          draft: {
            name: file.name,
            type: file.type,
            size: file.size,
            width: size.width ?? null,
            height: size.height ?? null,
          },
          status: "queued",
          error: null,
          upload: null,
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
        Object.assign(task, { status: "queued", error: null, upload: null, result: null });
      });
      notify();
      await runQueued();
    },
    isRunning() {
      return running;
    },
  };
}
