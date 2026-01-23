import { Methods, Events } from "../../shared/bridge";
import { isLoggedIn, login, logout } from "@moonshot-ai/kimi-agent-sdk";
import { getCLIManager } from "../managers";
import { updateLoginContext } from "../utils/context";
import type { Handler } from "./types";
import type { LoginStatus } from "../../shared/types";
import type { LoginResult } from "@moonshot-ai/kimi-agent-sdk";

export const authHandlers: Record<string, Handler<any, any>> = {
  [Methods.CheckLoginStatus]: async (): Promise<LoginStatus> => {
    // Sync context on check
    await updateLoginContext();
    return { loggedIn: isLoggedIn() };
  },

  [Methods.Login]: async (_, ctx): Promise<LoginResult> => {
    const executable = getCLIManager().getExecutablePath();
    const result = await login(executable, {
      onUrl: (url) => {
        ctx.broadcast(Events.LoginUrl, { url }, ctx.webviewId);
      },
    });

    await updateLoginContext();
    return result;
  },

  [Methods.Logout]: async (): Promise<LoginResult> => {
    const executable = getCLIManager().getExecutablePath();
    const result = await logout(executable);

    // Update context after logout
    await updateLoginContext();
    return result;
  },
};
