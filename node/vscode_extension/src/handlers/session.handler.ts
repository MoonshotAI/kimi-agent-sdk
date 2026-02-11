import * as vscode from "vscode";
import * as path from "node:path";
import { Methods } from "../../shared/bridge";
import { listSessions, listSessionsForWorkspace, getRegisteredWorkDirs, parseSessionEvents, deleteSession, forkSession } from "@moonshot-ai/kimi-agent-sdk";
import { BaselineManager } from "../managers";
import type { SessionInfo, StreamEvent, ForkSessionResult } from "@moonshot-ai/kimi-agent-sdk";
import type { Handler } from "./types";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface LoadHistoryParams {
  kimiSessionId: string;
}

interface DeleteSessionParams {
  sessionId: string;
}

interface ForkSessionParams {
  sessionId: string;
  turnIndex: number;
}

export const sessionHandlers: Record<string, Handler<any, any>> = {
  [Methods.GetKimiSessions]: async (_, ctx) => {
    return ctx.workDir ? listSessions(ctx.workDir) : [];
  },

  [Methods.GetAllKimiSessions]: async (_, ctx) => {
    return ctx.workspaceRoot ? listSessionsForWorkspace(ctx.workspaceRoot) : [];
  },

  [Methods.GetRegisteredWorkDirs]: async (_, ctx) => {
    return ctx.workspaceRoot ? getRegisteredWorkDirs(ctx.workspaceRoot) : [];
  },

  [Methods.SetWorkDir]: async (params: { workDir: string | null }, ctx) => {
    if (!ctx.workspaceRoot) {
      return { ok: false };
    }
    // Validate: must be workspace root or a subdirectory
    const target = params.workDir;
    if (target && target !== ctx.workspaceRoot && !target.startsWith(ctx.workspaceRoot + path.sep)) {
      return { ok: false };
    }
    ctx.setCustomWorkDir(target);
    return { ok: true, workDir: target || ctx.workspaceRoot };
  },

  [Methods.BrowseWorkDir]: async (_, ctx) => {
    if (!ctx.workspaceRoot) {
      return { ok: false, workDir: null };
    }
    // Get all subdirectories of workspace root (1 level deep for quick pick)
    const workspaceUri = vscode.Uri.file(ctx.workspaceRoot);
    let subdirs: string[] = [];
    try {
      const entries = await vscode.workspace.fs.readDirectory(workspaceUri);
      subdirs = entries
        .filter(([, type]) => type === vscode.FileType.Directory)
        .map(([name]) => name)
        .filter((name) => !name.startsWith(".")) // Hide hidden directories
        .sort();
    } catch {
      // Ignore errors
    }

    // Show quick pick with subdirectories
    const items: vscode.QuickPickItem[] = [
      { label: "$(folder) Browse...", description: "Open folder picker", alwaysShow: true },
      { label: "", kind: vscode.QuickPickItemKind.Separator },
      ...subdirs.map((name) => ({
        label: `$(folder) ${name}`,
        description: path.join(ctx.workspaceRoot!, name),
      })),
    ];

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: "Select a subdirectory or browse...",
      title: "Working Directory",
    });

    if (!picked) {
      return { ok: false, workDir: null };
    }

    let selected: string;

    if (picked.label === "$(folder) Browse...") {
      // Open native folder picker, starting from workspace root
      const result = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        defaultUri: workspaceUri,
        openLabel: "Select Working Directory",
      });
      if (!result || result.length === 0) {
        return { ok: false, workDir: null };
      }
      selected = result[0].fsPath;
    } else {
      selected = picked.description!;
    }

    // Validate: must be workspace root or a subdirectory
    if (selected !== ctx.workspaceRoot && !selected.startsWith(ctx.workspaceRoot + path.sep)) {
      vscode.window.showWarningMessage("Selected directory must be within the workspace.");
      return { ok: false, workDir: null };
    }

    ctx.setCustomWorkDir(selected === ctx.workspaceRoot ? null : selected);
    return { ok: true, workDir: selected };
  },

  [Methods.LoadKimiSessionHistory]: async (params: LoadHistoryParams, ctx): Promise<StreamEvent[]> => {
    if (!ctx.workDir || !UUID_REGEX.test(params.kimiSessionId)) {
      return [];
    }

    ctx.fileManager.setSessionId(ctx.webviewId, params.kimiSessionId);
    BaselineManager.initSession(ctx.workDir, params.kimiSessionId);

    return parseSessionEvents(ctx.workDir, params.kimiSessionId);
  },

  [Methods.DeleteKimiSession]: async (params: DeleteSessionParams, ctx): Promise<{ ok: boolean }> => {
    if (!ctx.workDir || !UUID_REGEX.test(params.sessionId)) {
      return { ok: false };
    }
    return { ok: await deleteSession(ctx.workDir, params.sessionId) };
  },

  [Methods.ForkKimiSession]: async (params: ForkSessionParams, ctx): Promise<ForkSessionResult | null> => {
    if (!ctx.workDir || !UUID_REGEX.test(params.sessionId) || params.turnIndex < 0) {
      return null;
    }
    try {
      return await forkSession({
        workDir: ctx.workDir,
        sourceSessionId: params.sessionId,
        turnIndex: params.turnIndex,
      });
    } catch (err) {
      console.error("[session.handler] Fork session failed:", err);
      return null;
    }
  },
};
