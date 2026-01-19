import * as vscode from "vscode";
import { Methods, Events } from "../../shared/bridge";
import { VSCodeSettings } from "../config/vscode-settings";
import { BaselineManager } from "../managers";
import { getErrorCode } from "../../../agent_sdk";
import type { ContentPart, ApprovalResponse, RunResult } from "../../../agent_sdk";
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

  // 初始化 session 的 baseline 目录
  BaselineManager.initSession(ctx.workDir, session.sessionId);

  ctx.broadcast(Events.StreamEvent, { type: "session_start", sessionId: session.sessionId, model: session.model }, ctx.webviewId);

  try {
    const turn = session.prompt(params.content);
    ctx.setTurn(turn);

    let result: RunResult = { status: "finished" };

    for await (const event of turn) {
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
