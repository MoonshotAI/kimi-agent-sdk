import { Methods, Events } from "shared/bridge";
import type { ApprovalResponse, ContentPart, MCPServerConfig, SessionInfo, KimiConfig, MCPTestResult, LoginResult } from "@moonshot-ai/kimi-agent-sdk";
import type { FileChange, SessionConfig, ExtensionConfig, WorkspaceStatus, CLICheckResult, LoginStatus } from "shared/types";
import type { UIStreamEvent } from "shared/types";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface VSCodeAPI {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VSCodeAPI;

class Bridge {
  private vscode: VSCodeAPI;
  private pending = new Map<string, PendingRequest>();
  private eventHandlers = new Map<string, Set<(data: unknown) => void>>();
  private requestId = 0;
  private webviewId: string;

  constructor() {
    this.webviewId = document.body.getAttribute("data-webviewid") || `unknown_${Date.now()}`;

    if (typeof acquireVsCodeApi === "function") {
      this.vscode = acquireVsCodeApi();
    } else {
      console.warn("[Kimi Bridge] Running outside VS Code, using mock");
      this.vscode = {
        postMessage: (msg) => console.log("[Kimi Mock]", msg),
        getState: () => undefined,
        setState: () => {},
      };
    }

    window.addEventListener("message", this.handleMessage);
  }

  private handleMessage = (event: MessageEvent) => {
    const msg = event.data;

    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject, timeout } = this.pending.get(msg.id)!;
      clearTimeout(timeout);
      this.pending.delete(msg.id);

      if (msg.error) {
        reject(new Error(msg.error));
      } else {
        resolve(msg.result);
      }
      return;
    }

    if (msg.event) {
      const handlers = this.eventHandlers.get(msg.event);
      handlers?.forEach((h) => h(msg.data));
    }
  };

  private call<T>(method: string, params?: unknown): Promise<T> {
    const id = `${++this.requestId}_${Date.now()}`;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Bridge ${method} timed out`));
      }, 600000);

      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timeout });
      this.vscode.postMessage({ id, method, params, webviewId: this.webviewId });
    });
  }

  on<T>(event: string, handler: (data: T) => void): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler as (data: unknown) => void);

    return () => {
      this.eventHandlers.get(event)?.delete(handler as (data: unknown) => void);
    };
  }

  checkWorkspace() {
    return this.call<WorkspaceStatus>(Methods.CheckWorkspace);
  }

  getInputHistory() {
    return this.call<string[]>(Methods.GetInputHistory);
  }

  addInputHistory(text: string) {
    return this.call<{ ok: boolean }>(Methods.AddInputHistory, { text });
  }

  checkCLI() {
    return this.call<CLICheckResult>(Methods.CheckCLI);
  }

  checkLoginStatus() {
    return this.call<LoginStatus>(Methods.CheckLoginStatus);
  }

  login() {
    return this.call<LoginResult>(Methods.Login);
  }

  logout() {
    return this.call<LoginResult>(Methods.Logout);
  }

  saveConfig(sessionConfig: SessionConfig) {
    return this.call<{ ok: boolean }>(Methods.SaveConfig, sessionConfig);
  }

  getExtensionConfig() {
    return this.call<ExtensionConfig>(Methods.GetExtensionConfig);
  }

  openSettings() {
    return this.call<{ ok: boolean }>(Methods.OpenSettings);
  }

  openFolder() {
    return this.call<{ ok: boolean }>(Methods.OpenFolder);
  }

  runCLI(args?: string[]) {
    return this.call<{ ok: boolean }>(Methods.RunCLI, { args });
  }

  getModels() {
    return this.call<KimiConfig>(Methods.GetModels);
  }

  getMCPServers() {
    return this.call<MCPServerConfig[]>(Methods.GetMCPServers);
  }

  addMCPServer(serverConfig: MCPServerConfig) {
    return this.call<MCPServerConfig[]>(Methods.AddMCPServer, serverConfig);
  }

  updateMCPServer(serverConfig: MCPServerConfig) {
    return this.call<MCPServerConfig[]>(Methods.UpdateMCPServer, serverConfig);
  }

  removeMCPServer(name: string) {
    return this.call<MCPServerConfig[]>(Methods.RemoveMCPServer, { name });
  }

  authMCP(name: string) {
    return this.call<{ ok: boolean }>(Methods.AuthMCP, { name });
  }

  resetAuthMCP(name: string) {
    return this.call<{ ok: boolean }>(Methods.ResetAuthMCP, { name });
  }

  testMCP(name: string) {
    return this.call<MCPTestResult>(Methods.TestMCP, { name });
  }

  streamChat(content: string | ContentPart[], model: string, thinking: boolean, sessionId?: string) {
    return this.call<{ done: boolean }>(Methods.StreamChat, { content, model, thinking, sessionId });
  }

  abortChat() {
    return this.call<{ aborted: boolean }>(Methods.AbortChat);
  }

  resetSession() {
    return this.call<{ ok: boolean }>(Methods.ResetSession);
  }

  getProjectFiles(params?: { query?: string; directory?: string }) {
    return this.call<import("shared/types").ProjectFile[]>(Methods.GetProjectFiles, params);
  }

  getEditorContext() {
    return this.call<import("shared/types").EditorContext | null>(Methods.GetEditorContext);
  }

  insertText(text: string) {
    return this.call<void>(Methods.InsertText, { text });
  }

  respondApproval(requestId: string, response: ApprovalResponse) {
    return this.call<{ ok: boolean }>(Methods.RespondApproval, { requestId, response });
  }

  getKimiSessions() {
    return this.call<SessionInfo[]>(Methods.GetKimiSessions);
  }

  loadSessionHistory(sessionId: string) {
    return this.call<UIStreamEvent[]>(Methods.LoadKimiSessionHistory, { kimiSessionId: sessionId });
  }

  deleteSession(sessionId: string) {
    return this.call<{ ok: boolean }>(Methods.DeleteKimiSession, { sessionId });
  }

  pickMedia(maxCount: number, includeVideo = true) {
    return this.call<string[]>(Methods.PickMedia, { maxCount, includeVideo });
  }

  checkFileExists(filePath: string) {
    return this.call<boolean>(Methods.CheckFileExists, { filePath });
  }

  checkFilesExist(paths: string[]) {
    return this.call<Record<string, boolean>>(Methods.CheckFilesExist, { paths });
  }

  openFile(filePath: string) {
    return this.call<{ ok: boolean }>(Methods.OpenFile, { filePath });
  }

  openFileDiff(filePath: string) {
    return this.call<{ ok: boolean }>(Methods.OpenFileDiff, { filePath });
  }

  saveBaselines(paths: string[]) {
    return this.call<{ ok: boolean }>(Methods.SaveBaselines, { paths });
  }

  trackFiles(paths: string[]) {
    return this.call<FileChange[]>(Methods.TrackFiles, { paths });
  }

  clearTrackedFiles() {
    return this.call<{ ok: boolean }>(Methods.ClearTrackedFiles);
  }

  revertFiles(filePath?: string) {
    return this.call<{ ok: boolean }>(Methods.RevertFiles, { filePath });
  }

  keepChanges(filePath?: string) {
    return this.call<{ ok: boolean }>(Methods.KeepChanges, { filePath });
  }

  getImageDataUri(filePath: string) {
    return this.call<string | null>(Methods.GetImageDataUri, { filePath });
  }

  showLogs() {
    return this.call<{ ok: boolean }>(Methods.ShowLogs);
  }

  reloadWebview() {
    return this.call<{ ok: boolean }>(Methods.ReloadWebview);
  }
}

export const bridge = new Bridge();
export { Events };
