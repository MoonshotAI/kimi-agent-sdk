import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "fs";
import { Methods, Events } from "../../shared/bridge";
import { BaselineManager } from "../managers";
import type { ProjectFile, EditorContext, FileChange } from "../../shared/types";
import type { Handler } from "./types";

interface GetProjectFilesParams {
  query?: string;
  directory?: string;
}

interface InsertTextParams {
  text: string;
}

interface PickMediaParams {
  maxCount?: number;
  includeVideo?: boolean;
}

interface FilePathParams {
  filePath: string;
}

interface OptionalFilePathParams {
  filePath?: string;
}

interface PathsParams {
  paths: string[];
}

interface CheckFileExistsParams {
  filePath: string;
}

interface CheckFilesExistParams {
  paths: string[];
}

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp"];
const VIDEO_EXTENSIONS = ["mp4", "webm", "mov"];

const IMAGE_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
};

function toAbsolute(workDir: string, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(workDir, filePath);
}

function isInsideWorkDir(workDir: string, absolutePath: string): boolean {
  const rel = path.relative(workDir, absolutePath);
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function getMimeType(ext: string): string {
  const mimeTypes: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
  };
  return mimeTypes[ext] || "application/octet-stream";
}

const getProjectFiles: Handler<GetProjectFilesParams, ProjectFile[]> = async (params, ctx) => {
  if (!ctx.workDir) {
    return [];
  }
  return params.directory !== undefined
    ? ctx.fileManager.listDirectory(ctx.workDir, params.directory)
    : ctx.fileManager.searchFiles(params.query);
};

const getEditorContext: Handler<void, EditorContext | null> = async () => {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return null;
  }

  const doc = editor.document;
  const sel = editor.selection;

  return {
    content: doc.getText(),
    language: doc.languageId,
    fileName: doc.fileName,
    selection: sel.isEmpty
      ? undefined
      : {
          text: doc.getText(sel),
          startLine: sel.start.line + 1,
          endLine: sel.end.line + 1,
        },
  };
};

const insertText: Handler<InsertTextParams, void> = async (params) => {
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    await editor.edit((b) => b.insert(editor.selection.active, params.text));
  }
};

const pickMedia: Handler<PickMediaParams, string[]> = async (params) => {
  const maxCount = params.maxCount ?? 9;
  const includeVideo = params.includeVideo ?? true;

  const filters: Record<string, string[]> = {
    Images: IMAGE_EXTENSIONS,
  };
  if (includeVideo) {
    filters["Videos"] = VIDEO_EXTENSIONS;
    filters["All Media"] = [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS];
  }

  const uris = await vscode.window.showOpenDialog({
    canSelectMany: true,
    filters,
    title: "Select Media",
  });

  if (!uris) {
    return [];
  }

  const results: string[] = [];
  const maxImageSize = 10 * 1024 * 1024;
  const maxVideoSize = 20 * 1024 * 1024;

  for (const uri of uris.slice(0, maxCount)) {
    try {
      const ext = path.extname(uri.fsPath).toLowerCase().slice(1);
      const isVideo = VIDEO_EXTENSIONS.includes(ext);
      const maxSize = isVideo ? maxVideoSize : maxImageSize;

      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.size > maxSize) {
        continue;
      }

      const data = await vscode.workspace.fs.readFile(uri);
      const mime = getMimeType(ext);
      results.push(`data:${mime};base64,${Buffer.from(data).toString("base64")}`);
    } catch {
      // skip
    }
  }

  return results;
};

const openFile: Handler<FilePathParams, { ok: boolean }> = async (params, ctx) => {
  const workDir = ctx.requireWorkDir();
  const absolutePath = toAbsolute(workDir, params.filePath);
  if (!isInsideWorkDir(workDir, absolutePath)) {
    return { ok: false };
  }

  const uri = vscode.Uri.file(absolutePath);
  await vscode.commands.executeCommand("vscode.open", uri);

  return { ok: true };
};

const openFileDiff: Handler<FilePathParams, { ok: boolean }> = async (params, ctx) => {
  const workDir = ctx.requireWorkDir();
  const sessionId = ctx.getSessionId();
  if (!sessionId) {
    return { ok: false };
  }

  const absolutePath = toAbsolute(workDir, params.filePath);
  if (!isInsideWorkDir(workDir, absolutePath)) {
    return { ok: false };
  }
  const relativePath = path.relative(workDir, absolutePath);
  const currentUri = vscode.Uri.file(absolutePath);
  const baselineUri = vscode.Uri.from({
    scheme: "kimi-baseline",
    path: "/" + relativePath,
    query: new URLSearchParams({ workDir, sessionId }).toString(),
  });
  await vscode.commands.executeCommand("vscode.diff", baselineUri, currentUri, `${path.basename(relativePath)} (changes from Kimi)`);
  return { ok: true };
};

const saveBaselines: Handler<PathsParams, { ok: boolean }> = async (params, ctx) => {
  const workDir = ctx.requireWorkDir();
  const sessionId = ctx.getSessionId();
  if (!sessionId) {
    return { ok: false };
  }

  for (const filePath of params.paths) {
    const absolutePath = toAbsolute(workDir, filePath);
    if (!isInsideWorkDir(workDir, absolutePath)) {
      continue;
    }

    const relativePath = path.relative(workDir, absolutePath);

    // Read current file content from disk (before modification)
    // If file doesn't exist, it's a new file - save empty string as baseline
    let content = "";
    if (fs.existsSync(absolutePath)) {
      try {
        content = fs.readFileSync(absolutePath, "utf-8");
      } catch {
        // If read fails, treat as new file
      }
    }

    BaselineManager.saveBaseline(workDir, sessionId, relativePath, content);
  }

  return { ok: true };
};

const trackFiles: Handler<PathsParams, FileChange[]> = async (params, ctx) => {
  const workDir = ctx.requireWorkDir();
  const sessionId = ctx.getSessionId();
  if (!sessionId) {
    return [];
  }

  // Add files to tracked set
  for (const filePath of params.paths) {
    const absolutePath = toAbsolute(workDir, filePath);
    if (isInsideWorkDir(workDir, absolutePath)) {
      ctx.fileManager.trackFile(ctx.webviewId, absolutePath);
    }
  }

  const trackedFiles = ctx.fileManager.getTracked(ctx.webviewId);
  const changes = await BaselineManager.getChanges(workDir, sessionId, trackedFiles);
  ctx.broadcast(Events.FileChangesUpdated, changes, ctx.webviewId);

  return changes;
};

const clearTrackedFiles: Handler<void, { ok: boolean }> = async (_, ctx) => {
  ctx.fileManager.clearTracked(ctx.webviewId);
  ctx.broadcast(Events.FileChangesUpdated, [], ctx.webviewId);
  return { ok: true };
};

const revertFiles: Handler<OptionalFilePathParams, { ok: boolean }> = async (params, ctx) => {
  const workDir = ctx.requireWorkDir();
  const sessionId = ctx.getSessionId();
  if (!sessionId) {
    return { ok: false };
  }

  const trackedFiles = ctx.fileManager.getTracked(ctx.webviewId);

  if (params.filePath) {
    const absolutePath = toAbsolute(workDir, params.filePath);
    if (!isInsideWorkDir(workDir, absolutePath)) {
      return { ok: false };
    }
    const relativePath = path.relative(workDir, absolutePath);
    BaselineManager.revertFile(workDir, sessionId, relativePath);
  } else {
    BaselineManager.revertAll(workDir, sessionId, trackedFiles);
    ctx.fileManager.clearTracked(ctx.webviewId);
  }

  const newTracked = ctx.fileManager.getTracked(ctx.webviewId);
  const changes = await BaselineManager.getChanges(workDir, sessionId, newTracked);
  ctx.broadcast(Events.FileChangesUpdated, changes, ctx.webviewId);

  return { ok: true };
};

const keepChanges: Handler<OptionalFilePathParams, { ok: boolean }> = async (params, ctx) => {
  const workDir = ctx.requireWorkDir();
  const sessionId = ctx.getSessionId();
  if (!sessionId) {
    return { ok: false };
  }

  const trackedFiles = ctx.fileManager.getTracked(ctx.webviewId);

  if (params.filePath) {
    const absolutePath = toAbsolute(workDir, params.filePath);
    if (!isInsideWorkDir(workDir, absolutePath)) {
      return { ok: false };
    }
    const relativePath = path.relative(workDir, absolutePath);
    BaselineManager.clearBaseline(workDir, sessionId, relativePath);
    trackedFiles.delete(absolutePath);
  } else {
    BaselineManager.clearBaselines(workDir, sessionId, trackedFiles);
    ctx.fileManager.clearTracked(ctx.webviewId);
  }

  const newTracked = ctx.fileManager.getTracked(ctx.webviewId);
  const changes = await BaselineManager.getChanges(workDir, sessionId, newTracked);
  ctx.broadcast(Events.FileChangesUpdated, changes, ctx.webviewId);

  return { ok: true };
};

const checkFileExists: Handler<CheckFileExistsParams, boolean> = async (params, ctx) => {
  if (!ctx.workDir) {
    return false;
  }
  const absolutePath = toAbsolute(ctx.workDir, params.filePath);
  if (!isInsideWorkDir(ctx.workDir, absolutePath)) {
    return false;
  }
  return fs.existsSync(absolutePath);
};

const checkFilesExist: Handler<CheckFilesExistParams, Record<string, boolean>> = async (params, ctx) => {
  if (!ctx.workDir) {
    return {};
  }
  const result: Record<string, boolean> = {};
  for (const filePath of params.paths) {
    const absolutePath = toAbsolute(ctx.workDir, filePath);
    result[filePath] = isInsideWorkDir(ctx.workDir, absolutePath) && fs.existsSync(absolutePath);
  }
  return result;
};

const getImageDataUri: Handler<FilePathParams, string | null> = async (params, ctx) => {
  if (!ctx.workDir) {
    return null;
  }
  const filePath = decodeURIComponent(params.filePath);
  const absolutePath = toAbsolute(ctx.workDir, filePath);
  if (!isInsideWorkDir(ctx.workDir, absolutePath)) {
    return null;
  }
  const ext = path.extname(absolutePath).toLowerCase();
  const mime = IMAGE_MIME_TYPES[ext];
  if (!mime) {
    return null;
  }
  try {
    const data = fs.readFileSync(absolutePath);
    return `data:${mime};base64,${data.toString("base64")}`;
  } catch {
    return null;
  }
};

export const fileHandlers: Record<string, Handler<any, any>> = {
  [Methods.GetProjectFiles]: getProjectFiles,
  [Methods.GetEditorContext]: getEditorContext,
  [Methods.InsertText]: insertText,
  [Methods.PickMedia]: pickMedia,
  [Methods.OpenFile]: openFile,
  [Methods.OpenFileDiff]: openFileDiff,
  [Methods.SaveBaselines]: saveBaselines,
  [Methods.TrackFiles]: trackFiles,
  [Methods.ClearTrackedFiles]: clearTrackedFiles,
  [Methods.RevertFiles]: revertFiles,
  [Methods.KeepChanges]: keepChanges,
  [Methods.CheckFileExists]: checkFileExists,
  [Methods.CheckFilesExist]: checkFilesExist,
  [Methods.GetImageDataUri]: getImageDataUri,
};
