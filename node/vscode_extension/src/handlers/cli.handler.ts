import { Methods } from "../../shared/bridge";
import { getCLIManager } from "../managers";
import type { Handler } from "./types";

export const cliHandlers: Record<string, Handler<any, any>> = {
  [Methods.IsCliWarmed]: async () => {
    return { warmed: getCLIManager().isWarmed() };
  },

  [Methods.CheckCLI]: async () => {
    const cli = getCLIManager();
    const ok = await cli.checkInstalled();
    if (ok) {
      cli.markWarmed();
    }
    return { ok };
  },

  [Methods.InstallCLI]: async () => {
    await getCLIManager().installCLI();
    return { ok: true };
  },
};
