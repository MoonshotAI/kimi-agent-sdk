import { Methods } from "../../shared/bridge";
import { getCLIManager } from "../managers";
import type { Handler } from "./types";
import type { CLICheckResult } from "../../shared/types";

export const cliHandlers: Record<string, Handler<unknown, unknown>> = {
  [Methods.CheckCLI]: async (_, ctx): Promise<CLICheckResult> => {
    if (!ctx.workDir) {
      return {
        ok: false,
        resolved: { isCustomPath: false, path: "" },
        error: { type: "not_found", message: "No workspace folder open" },
      };
    }
    return getCLIManager().checkInstalled(ctx.workDir);
  },
};
