import { Methods } from "../../shared/bridge";
import { listSessions, parseSessionEvents, deleteSession } from "../../../agent_sdk";
import { BaselineManager } from "../managers";
import type { SessionInfo, StreamEvent } from "../../../agent_sdk";
import type { Handler } from "./types";

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
    if (!ctx.workDir) {
      return [];
    }

    ctx.fileManager.setSessionId(ctx.webviewId, params.kimiSessionId);
    BaselineManager.initSession(ctx.workDir, params.kimiSessionId);

    return parseSessionEvents(ctx.workDir, params.kimiSessionId);
  },

  [Methods.DeleteKimiSession]: async (params: DeleteSessionParams, ctx): Promise<{ ok: boolean }> => {
    if (!ctx.workDir) {
      return { ok: false };
    }
    return { ok: await deleteSession(ctx.workDir, params.sessionId) };
  },
};
