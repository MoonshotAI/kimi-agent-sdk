import * as vscode from "vscode";
import { VSCodeSettings } from "./config/vscode-settings";
import { getCLIManager, FileManager } from "./managers";
import { handlers, type HandlerContext, type BroadcastFn, type ReloadWebviewFn, type ShowLogsFn } from "./handlers";
import { createSession, createExternalTool, parseConfig, getModelThinkingMode, getModelById, type Session, type Turn, type ExternalTool } from "@moonshot-ai/kimi-agent-sdk";
import { z } from "zod";
import { Events } from "../shared/bridge";

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
  private pendingAskUserWithOption = new Map<string, { resolve: (response: string) => void }>();

  constructor(
    private broadcast: BroadcastFn,
    private workspaceState: vscode.Memento,
    private reloadWebview: ReloadWebviewFn,
    private showLogs: ShowLogsFn,
  ) {
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

  private createAskUserTool(webviewId: string): ExternalTool {
    return createExternalTool({
      name: "AskUserWithOption",
      description: "Ask the user a question with predefined options. Use when you need user input to proceed. You can provide 1-3 options for the user to choose from.",
      parameters: z.object({
        question: z.string().describe("The question to ask the user"),
        options: z.array(z.string()).describe("1-3 options for the user to choose from"),
      }),
      handler: async (params) => {
        if (VSCodeSettings.yoloMode) {
          return { output: "YOLO mode enabled, cannot ask user", message: "User interaction disabled" };
        }
        const requestId = `askuser_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        return new Promise((resolve) => {
          this.pendingAskUserWithOption.set(requestId, {
            resolve: (response: string) => resolve({ output: response, message: "User responded" }),
          });
          this.broadcast(Events.AskUserWithOptionRequest, { id: requestId, question: params.question, options: params.options }, webviewId);
        });
      },
    });
  }

  private resolveAskUserWithOption(requestId: string, response: string): void {
    const pending = this.pendingAskUserWithOption.get(requestId);
    if (pending) {
      pending.resolve(response);
      this.pendingAskUserWithOption.delete(requestId);
    }
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
      workspaceState: this.workspaceState,
      requireWorkDir: () => this.requireWorkDir(),
      broadcast: this.broadcast,
      fileManager: this.fileManager,
      reloadWebview: () => this.reloadWebview(webviewId),
      showLogs: this.showLogs,
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
      resolveAskUserWithOption: (requestId: string, response: string) => this.resolveAskUserWithOption(requestId, response),
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
      externalTools: [this.createAskUserTool(webviewId)],
      clientInfo: { name: "kimi-code-for-vs-code", version: VSCodeSettings.getExtensionConfig().version },
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
