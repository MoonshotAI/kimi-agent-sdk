import * as vscode from "vscode";
import { VSCodeSettings } from "./config/vscode-settings";
import { getCLIManager, FileManager } from "./managers";
import { handlers, type HandlerContext, type BroadcastFn, type ReloadWebviewFn, type ShowLogsFn } from "./handlers";
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
  private sessions = new Map<string, Map<string, Session>>();
  private turns = new Map<string, Map<string, Turn>>();
  private customWorkDirs = new Map<string, string>(); // webviewId -> custom workDir
  private fileManager: FileManager;

  constructor(
    private broadcast: BroadcastFn,
    private workspaceState: vscode.Memento,
    private reloadWebview: ReloadWebviewFn,
    private showLogs: ShowLogsFn,
  ) {
    this.fileManager = new FileManager(() => this.workspaceRoot, broadcast);
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

  private get workspaceRoot(): string | null {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
  }

  private getWorkDir(webviewId: string): string | null {
    return this.customWorkDirs.get(webviewId) ?? this.workspaceRoot;
  }

  setCustomWorkDir(webviewId: string, workDir: string | null): void {
    if (workDir && workDir !== this.workspaceRoot) {
      this.customWorkDirs.set(webviewId, workDir);
    } else {
      this.customWorkDirs.delete(webviewId);
    }
    // Existing sessions keep their own working directory and may continue in the background.
  }

  private requireWorkDir(webviewId: string): string {
    const w = this.getWorkDir(webviewId);
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
      workDir: this.getWorkDir(webviewId),
      workspaceRoot: this.workspaceRoot,
      workspaceState: this.workspaceState,
      requireWorkDir: () => this.requireWorkDir(webviewId),
      broadcast: this.broadcast,
      fileManager: this.fileManager,
      reloadWebview: () => this.reloadWebview(webviewId),
      showLogs: this.showLogs,
      getSession: (sessionId?: string) => this.getSession(webviewId, sessionId),
      getSessionId: () => this.fileManager.getSessionId(webviewId),
      getTurn: (sessionId?: string) => this.getTurn(webviewId, sessionId),
      setTurn: (sessionId: string, turn: Turn | null) => {
        const turns = this.getTurns(webviewId);
        if (turn) {
          turns.set(sessionId, turn);
        } else {
          turns.delete(sessionId);
        }
      },
      getOrCreateSession: (model, thinking, sessionId) => this.getOrCreateSession(webviewId, model, thinking, sessionId),
      closeSession: (sessionId?: string) => this.closeSession(webviewId, sessionId),
      saveAllDirty: () => this.saveAllDirty(),
      setCustomWorkDir: (workDir: string | null) => this.setCustomWorkDir(webviewId, workDir),
    };
  }

  private async saveAllDirty(): Promise<void> {
    const dirty = vscode.workspace.textDocuments.filter((d) => d.isDirty && !d.isUntitled);
    await Promise.all(dirty.map((d) => d.save()));
  }

  private getOrCreateSession(webviewId: string, model: string, thinking: boolean, sessionId?: string): Session {
    const workDir = this.requireWorkDir(webviewId);
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

    const sessions = this.getSessions(webviewId);
    const existing = sessionId ? sessions.get(sessionId) : undefined;

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
        sessions.delete(existing.sessionId);
        this.getTurns(webviewId).delete(existing.sessionId);
      }
    }

    if (existing && sessions.has(existing.sessionId)) {
      return existing;
    }

    const session = createSession({
      workDir,
      model,
      thinking: actualThinking,
      yoloMode,
      sessionId,
      executable,
      env,
      clientInfo: { name: "kimi-code-for-vs-code", version: VSCodeSettings.getExtensionConfig().version },
    });

    sessions.set(session.sessionId, session);
    this.fileManager.setSessionId(webviewId, session.sessionId);
    return session;
  }

  disposeView(webviewId: string): void {
    void this.closeSessions(webviewId);
    this.sessions.delete(webviewId);
    this.turns.delete(webviewId);
    this.fileManager.disposeView(webviewId);
  }

  async dispose(): Promise<void> {
    this.fileManager.dispose();
    for (const sessions of this.sessions.values()) {
      for (const session of sessions.values()) {
        await session.close();
      }
    }
    this.sessions.clear();
    this.turns.clear();
  }

  private getSessions(webviewId: string): Map<string, Session> {
    let sessions = this.sessions.get(webviewId);
    if (!sessions) {
      sessions = new Map();
      this.sessions.set(webviewId, sessions);
    }
    return sessions;
  }

  private getTurns(webviewId: string): Map<string, Turn> {
    let turns = this.turns.get(webviewId);
    if (!turns) {
      turns = new Map();
      this.turns.set(webviewId, turns);
    }
    return turns;
  }

  private getSession(webviewId: string, sessionId?: string): Session | undefined {
    const id = sessionId ?? this.fileManager.getSessionId(webviewId);
    return id ? this.sessions.get(webviewId)?.get(id) : undefined;
  }

  private getTurn(webviewId: string, sessionId?: string): Turn | undefined {
    const id = sessionId ?? this.fileManager.getSessionId(webviewId);
    return id ? this.turns.get(webviewId)?.get(id) : undefined;
  }

  private async closeSession(webviewId: string, sessionId?: string): Promise<void> {
    const id = sessionId ?? this.fileManager.getSessionId(webviewId);
    if (!id) return;
    const sessions = this.sessions.get(webviewId);
    const session = sessions?.get(id);
    if (session) {
      await session.close();
      sessions?.delete(id);
    }
    this.turns.get(webviewId)?.delete(id);
  }

  private async closeSessions(webviewId: string): Promise<void> {
    const sessions = this.sessions.get(webviewId);
    if (!sessions) return;
    await Promise.all([...sessions.values()].map((session) => session.close()));
  }
}
