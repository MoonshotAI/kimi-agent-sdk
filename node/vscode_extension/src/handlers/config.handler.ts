import * as vscode from "vscode";
import { Methods } from "../../shared/bridge";
import { VSCodeSettings } from "../config/vscode-settings";
import { parseConfig, saveDefaultModel } from "@moonshot-ai/kimi-agent-sdk";
import type { SessionConfig, ExtensionConfig } from "../../shared/types";
import type { KimiConfig } from "@moonshot-ai/kimi-agent-sdk";
import type { Handler } from "./types";

const saveConfig: Handler<SessionConfig, { ok: boolean }> = async (params) => {
  saveDefaultModel(params.model, params.thinking);
  return { ok: true };
};

const getExtensionConfig: Handler<void, ExtensionConfig> = async () => {
  return VSCodeSettings.getExtensionConfig();
};

const openSettings: Handler<void, { ok: boolean }> = async () => {
  await vscode.commands.executeCommand("workbench.action.openSettings", "kimi");
  return { ok: true };
};

const getModels: Handler<void, KimiConfig> = async () => {
  return parseConfig();
};

const showLogs: Handler<void, { ok: boolean }> = async (_, ctx) => {
  ctx.showLogs();
  return { ok: true };
};

const reloadWebview: Handler<void, { ok: boolean }> = async (_, ctx) => {
  await ctx.closeSession();
  ctx.fileManager.clearTracked(ctx.webviewId);
  ctx.reloadWebview();
  return { ok: true };
};

export const configHandlers = {
  [Methods.SaveConfig]: saveConfig,
  [Methods.GetExtensionConfig]: getExtensionConfig,
  [Methods.OpenSettings]: openSettings,
  [Methods.GetModels]: getModels,
  [Methods.ShowLogs]: showLogs,
  [Methods.ReloadWebview]: reloadWebview,
} as Record<string, Handler<any, any>>;
