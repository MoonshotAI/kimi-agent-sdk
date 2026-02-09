import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "fs";
import { Methods, Events } from "../../shared/bridge";
import { VSCodeSettings } from "../config/vscode-settings";
import { BaselineManager } from "../managers";
import { getErrorCode, CliError } from "@moonshot-ai/kimi-agent-sdk";
import type { ContentPart, ApprovalResponse, RunResult } from "@moonshot-ai/kimi-agent-sdk";
import type { Handler } from "./types";
import type { ErrorPhase } from "../../shared/types";
import { classifyError, getUserMessage } from "shared/errors";

interface StreamChatParams {
  content: string | ContentPart[];
  model: string;
  thinking: boolean;
  sessionId?: string;
}

interface RespondApprovalParams {
  requestId: string;
  response: ApprovalResponse;
}

interface RespondAskUserWithOptionParams {
  requestId: string;
  response: string;
}

interface PendingToolCall {
  id: string;
  name: string;
  arguments: string;
  baselineSaved: boolean;
}

const FILE_TOOLS = new Set(["WriteFile", "CreateFile", "StrReplaceFile", "PatchFile", "DeleteFile", "AppendFile"]);

function buildSystemContext(): string {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return "";
  }

  const doc = editor.document;
  const sel = editor.selection;
  const relativePath = vscode.workspace.asRelativePath(doc.uri);

  const info: string[] = [`file: ${relativePath}`, `language: ${doc.languageId}`, `cursor: line ${sel.active.line + 1}`];

  if (doc.isDirty) {
    info.push("unsaved: true");
  }

  if (!sel.isEmpty) {
    info.push(`selection: lines ${sel.start.line + 1}-${sel.end.line + 1}`);
  }

  return `<system>${info.join(", ")}</system>\n`;
}

function prependSystemContext(content: string | ContentPart[], ctx: string): string | ContentPart[] {
  if (!ctx) {
    return content;
  }

  if (typeof content === "string") {
    return ctx + content;
  }

  const idx = content.findIndex((p) => p.type === "text");
  if (idx >= 0) {
    const copy = [...content];
    const part = copy[idx] as { type: "text"; text: string };
    copy[idx] = { type: "text", text: ctx + part.text };
    return copy;
  }

  return [{ type: "text", text: ctx }, ...content];
}

function saveBaselineForPath(filePath: string, workDir: string, sessionId: string): boolean {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(workDir, filePath);
  const relativePath = path.relative(workDir, absolutePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return false;
  }

  let content = "";
  if (fs.existsSync(absolutePath)) {
    try {
      content = fs.readFileSync(absolutePath, "utf-8");
    } catch {
      // File unreadable, use empty baseline (for new files)
    }
  }

  BaselineManager.saveBaseline(workDir, sessionId, relativePath, content);
  return true;
}

function tryParseAndSaveBaseline(call: PendingToolCall, workDir: string, sessionId: string): boolean {
  if (call.baselineSaved || !FILE_TOOLS.has(call.name) || !call.arguments) {
    return false;
  }

  try {
    const args = JSON.parse(call.arguments);
    if (args.path && saveBaselineForPath(args.path, workDir, sessionId)) {
      call.baselineSaved = true;
      return true;
    }
  } catch {
    // JSON not complete yet or invalid
  }
  return false;
}

const streamChat: Handler<StreamChatParams, { done: boolean }> = async (params, ctx) => {
  if (!ctx.workDir) {
    ctx.broadcast(
      Events.StreamEvent,
      {
        type: "error",
        code: "NO_WORKSPACE",
        message: "Please open a folder to start.",
        phase: "preflight" as ErrorPhase,
      },
      ctx.webviewId,
    );
    vscode.window.showWarningMessage("Kimi: Please open a folder first.", "Open Folder").then((a) => {
      if (a) {
        vscode.commands.executeCommand("vscode.openFolder");
      }
    });
    return { done: false };
  }

  if (VSCodeSettings.autosave) {
    await ctx.saveAllDirty();
  }

  const session = ctx.getOrCreateSession(params.model, params.thinking, params.sessionId);
  const workDir = ctx.workDir;
  const sessionId = session.sessionId;

  // Track pending tool calls for baseline saving
  BaselineManager.initSession(workDir, sessionId);

  ctx.broadcast(Events.StreamEvent, { type: "session_start", sessionId, model: session.model, _sessionId: sessionId }, ctx.webviewId);

  const systemContext = buildSystemContext();
  const contentWithContext = prependSystemContext(params.content, systemContext);

  const pendingToolCalls = new Map<string, PendingToolCall>();
  let lastToolCallId: string | null = null;

  try {
    const turn = session.prompt(contentWithContext);
    ctx.setTurn(turn);

    let result: RunResult = { status: "finished" };

    for await (const event of turn) {
      const eventAny = event as any;
      const eventType = event.type;
      const payload = eventAny.payload;

      // ToolCall: Record and try to save baseline immediately if args are complete
      if (eventType === "ToolCall" && payload?.id) {
        const call: PendingToolCall = {
          id: payload.id,
          name: payload.function?.name || "",
          arguments: payload.function?.arguments || "",
          baselineSaved: false,
        };
        pendingToolCalls.set(payload.id, call);
        lastToolCallId = payload.id;

        // Try to save baseline immediately (for YOLO / approve_for_session where args come complete)
        tryParseAndSaveBaseline(call, workDir, sessionId);
      }

      // ToolCallPart: Accumulate arguments and try to save baseline
      if (eventType === "ToolCallPart" && payload?.arguments_part && lastToolCallId) {
        const call = pendingToolCalls.get(lastToolCallId);
        if (call) {
          call.arguments += payload.arguments_part;
          // Try to save after each part (will succeed when JSON becomes complete)
          tryParseAndSaveBaseline(call, workDir, sessionId);
        }
      }

      // StatusUpdate: Last chance to save baseline before potential file modification
      if (eventType === "StatusUpdate") {
        for (const call of pendingToolCalls.values()) {
          tryParseAndSaveBaseline(call, workDir, sessionId);
        }
      }

      // ToolResult: Clean up
      if (eventType === "ToolResult" && payload?.tool_call_id) {
        pendingToolCalls.delete(payload.tool_call_id);
        if (lastToolCallId === payload.tool_call_id) {
          lastToolCallId = null;
        }
      }

      ctx.broadcast(Events.StreamEvent, { ...event, _sessionId: sessionId }, ctx.webviewId);
    }

    result = await turn.result;

    ctx.broadcast(Events.StreamEvent, { type: "stream_complete", result, _sessionId: sessionId }, ctx.webviewId);
    ctx.setTurn(null);

    return { done: true };
  } catch (err) {
    ctx.setTurn(null);

    const code = getErrorCode(err);
    const phase = classifyError(code);
    // 优先使用完整的原始 JSON 响应
    const detail = err instanceof CliError && err.rawResponse ? err.rawResponse : err instanceof Error ? err.message : String(err);
    const message = getUserMessage(code, err instanceof Error ? err.message : String(err));

    ctx.broadcast(
      Events.StreamEvent,
      {
        type: "error",
        code,
        message,
        detail,
        phase,
        _sessionId: sessionId,
      },
      ctx.webviewId,
    );

    return { done: false };
  }
};

const abortChat: Handler<void, { aborted: boolean }> = async (_, ctx) => {
  const turn = ctx.getTurn();
  if (turn) {
    await turn.interrupt();
    ctx.setTurn(null);
  }
  return { aborted: true };
};

const respondApproval: Handler<RespondApprovalParams, { ok: boolean }> = async (params, ctx) => {
  const turn = ctx.getTurn();
  turn?.approve(params.requestId, params.response);
  return { ok: true };
};

const respondAskUserWithOption: Handler<RespondAskUserWithOptionParams, { ok: boolean }> = async (params, ctx) => {
  ctx.resolveAskUserWithOption(params.requestId, params.response);
  return { ok: true };
};

const resetSession: Handler<void, { ok: boolean }> = async (_, ctx) => {
  await ctx.closeSession();
  ctx.fileManager.clearTracked(ctx.webviewId);
  return { ok: true };
};

export const chatHandlers: Record<string, Handler<any, any>> = {
  [Methods.StreamChat]: streamChat,
  [Methods.AbortChat]: abortChat,
  [Methods.RespondApproval]: respondApproval,
  [Methods.RespondAskUserWithOption]: respondAskUserWithOption,
  [Methods.ResetSession]: resetSession,
};
