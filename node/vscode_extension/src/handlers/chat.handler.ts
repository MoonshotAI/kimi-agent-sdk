import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "fs";
import { Methods, Events } from "../../shared/bridge";
import { VSCodeSettings } from "../config/vscode-settings";
import { BaselineManager } from "../managers";
import { getErrorCode } from "@moonshot-ai/kimi-agent-sdk";
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

interface PendingToolCall {
  id: string;
  name: string;
  arguments: string;
  baselineSaved: boolean;
}

const FILE_TOOLS = new Set(["WriteFile", "CreateFile", "StrReplaceFile", "PatchFile", "DeleteFile", "AppendFile"]);

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

  BaselineManager.initSession(workDir, sessionId);

  ctx.broadcast(Events.StreamEvent, { type: "session_start", sessionId, model: session.model }, ctx.webviewId);

  // Track pending tool calls for baseline saving
  const pendingToolCalls = new Map<string, PendingToolCall>();
  let lastToolCallId: string | null = null;

  try {
    const turn = session.prompt(params.content);
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

      ctx.broadcast(Events.StreamEvent, event, ctx.webviewId);
    }

    result = await turn.result;

    ctx.broadcast(Events.StreamEvent, { type: "stream_complete", result }, ctx.webviewId);
    ctx.setTurn(null);

    return { done: true };
  } catch (err) {
    ctx.setTurn(null);

    const code = getErrorCode(err);
    const phase = classifyError(code);
    const message = getUserMessage(code, err instanceof Error ? err.message : String(err));

    ctx.broadcast(
      Events.StreamEvent,
      {
        type: "error",
        code,
        message,
        phase,
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

const resetSession: Handler<void, { ok: boolean }> = async (_, ctx) => {
  await ctx.closeSession();
  ctx.fileManager.clearTracked(ctx.webviewId);
  return { ok: true };
};

export const chatHandlers: Record<string, Handler<any, any>> = {
  [Methods.StreamChat]: streamChat,
  [Methods.AbortChat]: abortChat,
  [Methods.RespondApproval]: respondApproval,
  [Methods.ResetSession]: resetSession,
};
