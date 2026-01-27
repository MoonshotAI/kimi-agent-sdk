import { Methods } from "../../shared/bridge";
import { listSessions, parseSessionEvents, deleteSession } from "@moonshot-ai/kimi-agent-sdk";
import { BaselineManager } from "../managers";
import type { SessionInfo, StreamEvent } from "@moonshot-ai/kimi-agent-sdk";
import type { Handler } from "./types";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface LoadHistoryParams {
  kimiSessionId: string;
}

interface DeleteSessionParams {
  sessionId: string;
}

export const sessionHandlers: Record<string, Handler<any, any>> = {
  [Methods.GetKimiSessions]: async (_, ctx) => {
    return ctx.workDir ? listSessions(ctx.workDir) : [];
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
};
