import { Methods } from "../../shared/bridge";
import { getCLIManager } from "../managers";
import type { Handler } from "./types";

export const cliHandlers: Record<string, Handler<unknown, unknown>> = {
  [Methods.CheckCLI]: async () => {
    const ok = await getCLIManager().checkInstalled();
    return { ok };
  },
  [Methods.IsCliWarmed]: async () => {
    const warmed = await getCLIManager().isWarmed();
    return { warmed };
  },
};
