import { Methods } from "../../shared/bridge";
import type { Handler } from "./types";

interface RespondAskUserParams {
  requestId: string;
  response: string;
}

export const askUserHandlers: Record<string, Handler<any, any>> = {
  [Methods.RespondAskUser]: async (params: RespondAskUserParams, ctx) => {
    ctx.resolveAskUserWithOption(params.requestId, params.response);
    return { ok: true };
  },
};
