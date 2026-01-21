import * as vscode from "vscode";
import { VSCodeSettings } from "./config/vscode-settings";
import { getCLIManager, FileManager } from "./managers";
import { handlers, type HandlerContext, type BroadcastFn } from "./handlers";
import { createSession, parseConfig, getModelThinkingMode, getModelById, type Session, type Turn } from "@moonshot-ai/kimi-agent-sdk";

interface RpcMessage {
  id: string;
  method: string;
  params?: unknown;
}

interface RpcResult {
  id: string;
  result?: unknown;
  error?: string;
}

export class BridgeHandler {
  private sessions = new Map<string, Session>();
  private turns = new Map<string, Turn>();
  private fileManager: FileManager;

  constructor(private broadcast: BroadcastFn) {
    this.fileManager = new FileManager(() => this.workDir, broadcast);
  }

  async handle(msg: RpcMessage, webviewId: string): Promise<RpcResult> {
    try {
      return {
        id: msg.id,
        result: await this.dispatch(msg.method, msg.params, webviewId),
      };
    } catch (err) {
      return {
        id: msg.id,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private get workDir(): string | null {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
  }

  private requireWorkDir(): string {
    const w = this.workDir;
    if (!w) {
      throw new Error("No workspace folder open");
    }
    return w;
  }

  private async dispatch(method: string, params: unknown, webviewId: string): Promise<unknown> {
    const handler = handlers[method];
    if (!handler) {
      throw new Error(`Unknown method: ${method}`);
    }
    return handler(params, this.createContext(webviewId));
  }

  private createContext(webviewId: string): HandlerContext {
    return {
      webviewId,
      workDir: this.workDir,
      requireWorkDir: () => this.requireWorkDir(),
      broadcast: this.broadcast,
      fileManager: this.fileManager,
      getSession: () => this.sessions.get(webviewId),
      getSessionId: () => this.fileManager.getSessionId(webviewId),
      getTurn: () => this.turns.get(webviewId),
      setTurn: (turn: Turn | null) => {
        if (turn) {
          this.turns.set(webviewId, turn);
        } else {
          this.turns.delete(webviewId);
        }
      },
      getOrCreateSession: (model, thinking, sessionId) => this.getOrCreateSession(webviewId, model, thinking, sessionId),
      closeSession: async () => {
        const session = this.sessions.get(webviewId);
        if (session) {
          await session.close();
          this.sessions.delete(webviewId);
        }
        this.turns.delete(webviewId);
      },
      saveAllDirty: () => this.saveAllDirty(),
    };
  }

  private async saveAllDirty(): Promise<void> {
    const dirty = vscode.workspace.textDocuments.filter((d) => d.isDirty && !d.isUntitled);
    await Promise.all(dirty.map((d) => d.save()));
  }

  private getOrCreateSession(webviewId: string, model: string, thinking: boolean, sessionId?: string): Session {
    const workDir = this.requireWorkDir();
    const cli = getCLIManager();
    const config = parseConfig();

    // Determine actual thinking state based on model capability
    const modelConfig = getModelById(config.models, model);
    const thinkingMode = modelConfig ? getModelThinkingMode(modelConfig) : "none";

    let actualThinking: boolean;
    if (thinkingMode === "always") {
      actualThinking = true;
    } else if (thinkingMode === "none") {
      actualThinking = false;
    } else {
      actualThinking = thinking;
    }

    const executable = cli.getExecutablePath();
    const env = VSCodeSettings.environmentVariables;
    const yoloMode = VSCodeSettings.yoloMode;

    const existing = this.sessions.get(webviewId);

    // Check if we need to restart the session
    if (existing) {
      const needsRestart =
        (sessionId && sessionId !== existing.sessionId) ||
        model !== existing.model ||
        actualThinking !== existing.thinking ||
        yoloMode !== existing.yoloMode ||
        executable !== existing.executable ||
        JSON.stringify(env) !== JSON.stringify(existing.env);

      if (needsRestart) {
        existing.close();
        this.sessions.delete(webviewId);
        this.turns.delete(webviewId);
      }
    }

    const current = this.sessions.get(webviewId);
    if (current) {
      return current;
    }

    const session = createSession({
      workDir,
      model,
      thinking: actualThinking,
      yoloMode,
      sessionId,
      executable,
      env,
    });

    this.sessions.set(webviewId, session);
    this.fileManager.setSessionId(webviewId, session.sessionId);
    return session;
  }

  disposeView(webviewId: string): void {
    this.sessions.get(webviewId)?.close();
    this.sessions.delete(webviewId);
    this.turns.delete(webviewId);
    this.fileManager.disposeView(webviewId);
  }

  async dispose(): Promise<void> {
    this.fileManager.dispose();
    for (const s of this.sessions.values()) {
      await s.close();
    }
    this.sessions.clear();
    this.turns.clear();
  }
}
