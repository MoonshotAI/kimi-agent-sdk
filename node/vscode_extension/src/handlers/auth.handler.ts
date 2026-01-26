import { Methods, Events } from "../../shared/bridge";
import { isLoggedIn, login, logout } from "@moonshot-ai/kimi-agent-sdk";
import { getCLIManager } from "../managers";
import { VSCodeSettings } from "../config/vscode-settings";
import { updateLoginContext } from "../utils/context";
import type { Handler } from "./types";
import type { LoginStatus } from "../../shared/types";
import type { LoginResult } from "@moonshot-ai/kimi-agent-sdk";

function getCliOptions() {
  return {
    executable: getCLIManager().getExecutablePath(),
    env: VSCodeSettings.environmentVariables,
  };
}

export const authHandlers: Record<string, Handler<any, any>> = {
  [Methods.CheckLoginStatus]: async (): Promise<LoginStatus> => {
    // Sync context on check
    await updateLoginContext();
    return { loggedIn: isLoggedIn() };
  },

  [Methods.Login]: async (_, ctx): Promise<LoginResult> => {
    const result = await login({
      ...getCliOptions(),
      onUrl: (url) => {
        ctx.broadcast(Events.LoginUrl, { url }, ctx.webviewId);
      },
    });

    await updateLoginContext();
    return result;
  },

  [Methods.Logout]: async (): Promise<LoginResult> => {
    const result = await logout(getCliOptions());
    await updateLoginContext();
    return result;
  },
};
