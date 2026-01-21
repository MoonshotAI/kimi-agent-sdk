import { CLICheckResult } from "shared/types";
import { Methods } from "../../shared/bridge";
import { getCLIManager } from "../managers";
import type { Handler } from "./types";

export const cliHandlers: Record<string, Handler<unknown, unknown>> = {
  [Methods.CheckCLI]: async (_, ctx): Promise<CLICheckResult> => {
    if (!ctx.workDir) {
      return { ok: false };
    }
    return getCLIManager().checkInstalled(ctx.workDir);
  },
};
