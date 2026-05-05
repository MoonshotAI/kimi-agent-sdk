import * as vscode from "vscode";
import * as fs from "fs";
import { BridgeHandler } from "./bridge-handler";
import { VSCodeSettings } from "./config/vscode-settings";

interface RpcMessage {
  id: string;
  method: string;
  params?: unknown;
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}

/**
 * Manages webview instances (sidebar and panels).
 * Each webview gets a unique viewId for session isolation.
 */
export class KimiWebviewProvider implements vscode.WebviewViewProvider {
  private webviews = new Map<string, vscode.Webview>();
  private bridgeHandler: BridgeHandler;

  constructor(
    private readonly extensionUri: vscode.Uri,
    workspaceState: vscode.Memento,
    showLogs: () => void,
  ) {
    this.bridgeHandler = new BridgeHandler(this.broadcastInternal.bind(this), workspaceState, this.reloadWebview.bind(this), showLogs);
  }

  dispose(): void {
    this.bridgeHandler.dispose();
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    const webviewId = `sidebar_${crypto.randomUUID()}`;
    this.setupWebview(webviewId, webviewView.webview);

    webviewView.onDidDispose(() => {
      this.bridgeHandler.disposeView(webviewId);
      this.webviews.delete(webviewId);
    });
  }

  createPanel(): vscode.WebviewPanel {
    const webviewId = `panel_${crypto.randomUUID()}`;

    const panel = vscode.window.createWebviewPanel("kimiPanel", "Kimi Code", vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [this.extensionUri],
    });

    this.setupWebview(webviewId, panel.webview);

    panel.onDidDispose(() => {
      this.bridgeHandler.disposeView(webviewId);
      this.webviews.delete(webviewId);
    });

    return panel;
  }

  broadcast(event: string, data: unknown): void {
    this.broadcastInternal(event, data);
  }

  private setupWebview(webviewId: string, webview: vscode.Webview): void {
    webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webview.html = this.getHtml(webviewId, webview);
    this.webviews.set(webviewId, webview);

    webview.onDidReceiveMessage(async (msg: RpcMessage & { webviewId?: string }) => {
      const result = await this.bridgeHandler.handle(msg, webviewId);
      webview.postMessage(result);
    });
  }

  private broadcastInternal(event: string, data: unknown, targetWebviewId?: string): void {
    const msg = { event, data };

    if (targetWebviewId) {
      this.webviews.get(targetWebviewId)?.postMessage(msg);
    } else {
      this.webviews.forEach((w) => w.postMessage(msg));
    }
  }

  private reloadWebview(webviewId: string): void {
    const webview = this.webviews.get(webviewId);
    if (webview) {
      webview.html = this.getHtml(webviewId, webview);
    }
  }

  reloadAllWebviews(): void {
    this.webviews.forEach((webview, webviewId) => {
      webview.html = this.getHtml(webviewId, webview);
    });
  }

  private getHtml(webviewId: string, webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview.js"));
    const baseUri = webview.asWebviewUri(this.extensionUri).toString();
    const nonce = getNonce();

    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `img-src ${webview.cspSource} data: blob:`,
      `font-src ${webview.cspSource}`,
      `media-src ${webview.cspSource} data: blob:`,
      `connect-src ${webview.cspSource}`,
      `worker-src ${webview.cspSource} blob:`,
      `script-src 'nonce-${nonce}' ${webview.cspSource}`,
    ].join("; ");

    const themeMode = VSCodeSettings.themeMode;

    const vscodeThemeStyles = themeMode === "vscode"
      ? `<style>
  .vscode-theme [data-slot="button"] {
    border: none !important;
    box-shadow: none !important;
    outline: none !important;
    background-clip: border-box !important;
  }
  .vscode-theme [data-variant="ghost"]:hover,
  .vscode-theme [data-variant="outline"]:hover {
    background-color: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground, color-mix(in oklch, var(--foreground) 20%, var(--background)))) !important;
  }
  .vscode-theme [data-plan-mode="inactive"]:hover {
    background-color: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground, color-mix(in oklch, var(--foreground) 20%, var(--background)))) !important;
  }
  .vscode-theme [data-slot="dropdown-menu-item"]:hover,
  .vscode-theme [data-slot="command-item"]:hover,
  .vscode-theme [data-slot="context-menu-item"]:hover,
  .vscode-theme [data-session-item]:hover {
    background-color: var(--vscode-list-hoverBackground, color-mix(in oklch, var(--foreground) 20%, var(--background))) !important;
  }
  .vscode-theme [data-block-header]:hover {
    background-color: var(--vscode-toolbar-hoverBackground, color-mix(in oklch, var(--foreground) 20%, var(--background))) !important;
  }
  .vscode-theme .border-border {
    border-color: transparent !important;
  }
</style>`
      : "";

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>Kimi Code</title>
  ${vscodeThemeStyles}
</head>
<body data-baseuri="${baseUri}" data-webviewid="${webviewId}" data-thememode="${themeMode}">
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
