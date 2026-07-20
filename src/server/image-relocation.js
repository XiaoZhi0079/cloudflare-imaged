import { sanitizeFileName } from "./gallery-storage.js";

export class ImageRelocationError extends Error {
  constructor(message, { code = "IMAGE_RELOCATION_FAILED", cause, repairRequired = false } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "ImageRelocationError";
    this.code = code;
    this.repairRequired = repairRequired;
  }
}

export function validateManagedFileName(value) {
  const fileName = String(value ?? "").trim();
  if (
    !fileName
    || fileName === "."
    || fileName === ".."
    || sanitizeFileName(fileName) !== fileName
    || /[\u0000-\u001f\u007f]/.test(fileName)
  ) {
    throw new ImageRelocationError("Invalid managed file name", {
      code: "INVALID_FILE_NAME",
    });
  }
  return fileName;
}

function targetKeyForRename(storageKey, fileName) {
  const parts = String(storageKey).split("/");
  parts[parts.length - 1] = fileName;
  return parts.join("/");
}

function targetKeyForMove(storageKey, directory) {
  const normalizedDirectory = String(directory ?? "").trim().replace(/^\/+|\/+$/g, "");
  if (!normalizedDirectory || /[\u0000-\u001f\u007f\\]/.test(normalizedDirectory)) {
    throw new ImageRelocationError("Invalid managed directory", {
      code: "INVALID_DIRECTORY",
    });
  }
  return `${normalizedDirectory}/${String(storageKey).split("/").pop()}`;
}

function operationCopy(operation) {
  return operation === "move"
    ? {
        pendingStatus: "move_pending",
        failedStatus: "move_failed",
        pendingNote: "底层文件正在移动，完成前请勿重复操作。",
        failedNote: "底层文件移动失败，已保留原始目录。",
      }
    : {
        pendingStatus: "rename_pending",
        failedStatus: "rename_failed",
        pendingNote: "底层文件正在重命名，完成前请勿重复操作。",
        failedNote: "底层文件重命名失败，已保留原始文件名。",
      };
}

async function safeUpdateSyncState(repository, imageId, state, onError) {
  try {
    return await repository.updateImageSyncState(imageId, state);
  } catch (error) {
    onError?.({ event: "image_sync_state_update_failed", imageId, syncStatus: state.syncStatus, error });
    return null;
  }
}

export function createImageRelocationService({ repository, storage, onError } = {}) {
  if (!repository || !storage) {
    throw new TypeError("repository and storage are required");
  }

  async function relocate({ image, targetKey, operation, perform }) {
    const copy = operationCopy(operation);
    if (targetKey === image.storageKey) {
      return await repository.updateImageSyncState(image.id, { syncStatus: "ok", note: null });
    }

    const resumeCompletedCopy = image.syncStatus === copy.pendingStatus
      && String(image.note ?? "").includes(`-> ${targetKey}`);
    try {
      await repository.updateImageSyncState(image.id, {
        syncStatus: copy.pendingStatus,
        note: `${copy.pendingNote} ${image.storageKey} -> ${targetKey}`,
      });
    } catch (error) {
      throw new ImageRelocationError("Unable to record pending image relocation", {
        code: "PENDING_STATE_FAILED",
        cause: error,
      });
    }

    let relocated;
    try {
      relocated = await perform({ allowExistingTarget: resumeCompletedCopy });
    } catch (error) {
      await safeUpdateSyncState(repository, image.id, {
        syncStatus: copy.failedStatus,
        note: copy.failedNote,
      }, onError);
      throw new ImageRelocationError("Image storage relocation failed", {
        code: error?.code ?? "STORAGE_RELOCATION_FAILED",
        cause: error,
      });
    }

    try {
      const updated = await repository.updateImageStorage(image.id, {
        storageKey: relocated.storageKey,
        fileName: relocated.fileName,
        fileUrl: relocated.fileUrl,
        syncStatus: "ok",
        note: null,
      });
      if (!updated) {
        throw new Error("Image metadata record disappeared during relocation");
      }
      return updated;
    } catch (error) {
      let rollbackError = null;
      try {
        await storage.renameImage(relocated.storageKey, image.storageKey);
      } catch (currentRollbackError) {
        rollbackError = currentRollbackError;
      }

      const repairRequired = Boolean(rollbackError);
      await safeUpdateSyncState(repository, image.id, {
        syncStatus: repairRequired ? "repair_required" : copy.failedStatus,
        note: repairRequired
          ? `R2 与 D1 状态不一致，需要修复：${image.storageKey} <-> ${relocated.storageKey}`
          : copy.failedNote,
      }, onError);
      onError?.({
        event: "image_metadata_update_failed",
        imageId: image.id,
        operation,
        targetKey,
        repairRequired,
        error,
        rollbackError,
      });
      throw new ImageRelocationError("Image metadata update failed after storage relocation", {
        code: repairRequired ? "RELOCATION_ROLLBACK_FAILED" : "METADATA_UPDATE_FAILED",
        cause: error,
        repairRequired,
      });
    }
  }

  return {
    async rename(image, fileName) {
      const validatedFileName = validateManagedFileName(fileName);
      const targetKey = targetKeyForRename(image.storageKey, validatedFileName);
      return await relocate({
        image,
        targetKey,
        operation: "rename",
        perform: (options) => storage.renameImage(image.storageKey, targetKey, options),
      });
    },

    async move(image, directory) {
      const targetKey = targetKeyForMove(image.storageKey, directory);
      return await relocate({
        image,
        targetKey,
        operation: "move",
        perform: (options) => storage.moveImage(image.storageKey, directory, options),
      });
    },
  };
}
