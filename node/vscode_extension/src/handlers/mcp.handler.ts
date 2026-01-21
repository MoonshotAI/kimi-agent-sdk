import { Methods, Events } from "../../shared/bridge";
import { MCPManager } from "../managers";
import type { MCPServerConfig, MCPTestResult } from "@moonshot-ai/kimi-agent-sdk";
import type { Handler } from "./types";

interface RemoveServerParams {
  name: string;
}

interface AuthParams {
  name: string;
}

export const mcpHandlers: Record<string, Handler<any, any>> = {
  [Methods.GetMCPServers]: async () => {
    return MCPManager.getServers();
  },

  [Methods.AddMCPServer]: async (params: MCPServerConfig, ctx) => {
    const servers = MCPManager.addServer(params);
    ctx.broadcast(Events.MCPServersChanged, servers);
    return servers;
  },

  [Methods.UpdateMCPServer]: async (params: MCPServerConfig, ctx) => {
    const servers = MCPManager.updateServer(params);
    ctx.broadcast(Events.MCPServersChanged, servers);
    return servers;
  },

  [Methods.RemoveMCPServer]: async (params: RemoveServerParams, ctx) => {
    const servers = MCPManager.removeServer(params.name);
    ctx.broadcast(Events.MCPServersChanged, servers);
    return servers;
  },

  [Methods.AuthMCP]: async (params: AuthParams) => {
    await MCPManager.auth(params.name);
    return { ok: true };
  },

  [Methods.ResetAuthMCP]: async (params: AuthParams) => {
    await MCPManager.resetAuth(params.name);
    return { ok: true };
  },

  [Methods.TestMCP]: async (params: AuthParams): Promise<MCPTestResult> => {
    return MCPManager.test(params.name);
  },
};
