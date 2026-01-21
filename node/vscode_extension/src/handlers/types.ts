import type { FileManager } from "../managers/file.manager";
import type { Session, Turn } from "@moonshot-ai/kimi-agent-sdk";

export type BroadcastFn = (event: string, data: unknown, webviewId?: string) => void;

export interface HandlerContext {
  webviewId: string;
  workDir: string | null;
  requireWorkDir: () => string;
  broadcast: BroadcastFn;
  fileManager: FileManager;

  getSession: () => Session | undefined;
  getSessionId: () => string | null;
  getTurn: () => Turn | undefined;
  setTurn: (turn: Turn | null) => void;
  getOrCreateSession: (model: string, thinking: boolean, sessionId?: string) => Session;
  closeSession: () => Promise<void>;
  saveAllDirty: () => Promise<void>;
}

export type Handler<TParams = void, TResult = unknown> = (params: TParams, ctx: HandlerContext) => Promise<TResult>;
