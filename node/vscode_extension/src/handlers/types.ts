import type * as vscode from "vscode";
import type { FileManager } from "../managers/file.manager";
import type { Session, Turn } from "@moonshot-ai/kimi-agent-sdk";

export type BroadcastFn = (event: string, data: unknown, webviewId?: string) => void;

export type ReloadWebviewFn = (webviewId: string) => void;

export type ShowLogsFn = () => void;

export interface HandlerContext {
  webviewId: string;
  workDir: string | null;
  workspaceRoot: string | null;
  workspaceState: vscode.Memento;
  requireWorkDir: () => string;
  broadcast: BroadcastFn;
  fileManager: FileManager;
  reloadWebview: () => void;
  showLogs: () => void;

  getSession: (sessionId?: string) => Session | undefined;
  getSessionId: () => string | null;
  getTurn: (sessionId?: string) => Turn | undefined;
  setTurn: (sessionId: string, turn: Turn | null) => void;
  getOrCreateSession: (model: string, thinking: boolean, sessionId?: string) => Session;
  closeSession: (sessionId?: string) => Promise<void>;
  saveAllDirty: () => Promise<void>;
  setCustomWorkDir: (workDir: string | null) => void;
}

export type Handler<TParams = void, TResult = unknown> = (params: TParams, ctx: HandlerContext) => Promise<TResult>;
