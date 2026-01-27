import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { execSync, execFile } from "child_process";
import { promisify } from "util";
import { ProtocolClient, type InitializeResult } from "@moonshot-ai/kimi-agent-sdk";
import { getPlatformKey, readManifest, readInstalled, writeInstalled, downloadAndInstall } from "./cli-downloader";
import type { CLICheckResult } from "shared/types";

const execAsync = promisify(execFile);

const MIN_CLI_VERSION = "0.82";
const MIN_WIRE_VERSION = "1.1";

let instance: CLIManager;

export const initCLIManager = (ctx: vscode.ExtensionContext) => (instance = new CLIManager(ctx));
export const getCLIManager = () => {
  if (!instance) {
    throw new Error("CLI not init");
  }
  return instance;
};

export function compareVersion(a: string, b: string): number {
  const v1 = a.split(".").map(Number);
  const v2 = b.split(".").map(Number);
  for (let i = 0; i < Math.max(v1.length, v2.length); i++) {
    const diff = (v1[i] || 0) - (v2[i] || 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

export class CLIManager {
  private globalStorageBinPath: string;
  private extensionBinPath: string;

  constructor(private ctx: vscode.ExtensionContext) {
    this.globalStorageBinPath = path.join(ctx.globalStorageUri.fsPath, "bin", "kimi");
    this.extensionBinPath = path.join(ctx.extensionUri.fsPath, "bin", "kimi");
  }

  getExecutablePath(): string {
    const customPath = vscode.workspace.getConfiguration("kimi").get<string>("executablePath");
    if (customPath) {
      return customPath;
    }
    return path.join(this.globalStorageBinPath, process.platform === "win32" ? "kimi.exe" : "kimi");
  }

  async checkInstalled(workDir: string): Promise<CLICheckResult> {
    const resolved = { isCustomPath: this.isCustomPath(), path: this.getExecutablePath() };

    if (!await this.ensureCLI()) {
      return { ok: false, resolved, error: { type: "extract_failed", message: "Failed to install CLI" } };
    }

    return this.verify(workDir, resolved);
  }

  private isCustomPath(): boolean {
    return !!vscode.workspace.getConfiguration("kimi").get<string>("executablePath");
  }

  private async ensureCLI(): Promise<boolean> {
    if (this.isCustomPath()) return true;

    const manifest = readManifest(this.extensionBinPath);
    if (!manifest) return false;

    const platform = getPlatformKey();
    const installed = readInstalled(this.globalStorageBinPath);

    // 已安装且匹配 → 跳过
    if (installed?.version === manifest.version && installed?.platform === platform) {
      return true;
    }

    // 需要安装：解压或下载
    const useBundle = manifest.bundledPlatform === platform;
    if (useBundle) {
      console.log(`Using bundled CLI for platform: ${platform}, extracting...`);
      this.extractBundled();
    } else {
      vscode.window.showInformationMessage(`System Architecture (${platform}) not supported by bundled CLI. Downloading compatible version...`);

      const asset = manifest.platforms[platform];
      if (!asset) return false;
      await downloadAndInstall(asset, this.globalStorageBinPath);
    }

    writeInstalled(this.globalStorageBinPath, { version: manifest.version, platform });
    return true;
  }

  private async verify(workDir: string, resolved: { isCustomPath: boolean; path: string }): Promise<CLICheckResult> {
    const execPath = this.getExecutablePath();

    let cliVersion: string;
    let wireVersion: string;
    try {
      const info = await this.getInfo(execPath);
      cliVersion = info.kimi_cli_version;
      wireVersion = info.wire_protocol_version;
    } catch (err) {
      return { ok: false, resolved, error: { type: "not_found", message: String(err) } };
    }

    if (compareVersion(cliVersion, MIN_CLI_VERSION) < 0) {
      return { ok: false, resolved, error: { type: "version_low", message: `CLI ${cliVersion} < ${MIN_CLI_VERSION}` } };
    }
    if (compareVersion(wireVersion, MIN_WIRE_VERSION) < 0) {
      return { ok: false, resolved, error: { type: "version_low", message: `Wire ${wireVersion} < ${MIN_WIRE_VERSION}` } };
    }

    try {
      const initResult = await this.verifyWire(execPath, workDir);
      return { ok: true, resolved, slashCommands: initResult.slash_commands };
    } catch (err) {
      return { ok: false, resolved, error: { type: "protocol_error", message: String(err) } };
    }
  }

  private extractBundled(): void {
    const isZip = process.platform === "win32";
    const archivePath = path.join(this.extensionBinPath, isZip ? "archive.zip" : "archive.tar.gz");

    if (!fs.existsSync(archivePath)) {
      throw new Error(`Bundled archive not found: ${archivePath}`);
    }

    if (fs.existsSync(this.globalStorageBinPath)) {
      fs.rmSync(this.globalStorageBinPath, { recursive: true, force: true });
    }
    fs.mkdirSync(this.globalStorageBinPath, { recursive: true });

    const hasTar = (() => {
      try {
        execSync("tar --version", { stdio: "ignore" });
        return true;
      } catch {
        return false;
      }
    })();

    if (isZip && !hasTar) {
      execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${this.globalStorageBinPath}' -Force"`, { stdio: "ignore" });
      const entries = fs.readdirSync(this.globalStorageBinPath);
      if (entries.length === 1) {
        const nested = path.join(this.globalStorageBinPath, entries[0]);
        if (fs.statSync(nested).isDirectory()) {
          for (const f of fs.readdirSync(nested)) {
            fs.renameSync(path.join(nested, f), path.join(this.globalStorageBinPath, f));
          }
          fs.rmdirSync(nested);
        }
      }
    } else {
      execSync(`tar -xf "${archivePath}" -C "${this.globalStorageBinPath}" --strip-components=1`, { stdio: "ignore" });
    }

    if (process.platform !== "win32") {
      fs.chmodSync(path.join(this.globalStorageBinPath, "kimi"), 0o755);
    }
  }

  private async getInfo(execPath: string): Promise<{ kimi_cli_version: string; wire_protocol_version: string }> {
    const { stdout } = await execAsync(execPath, ["info", "--json"]);
    return JSON.parse(stdout);
  }

  private async verifyWire(execPath: string, workDir: string): Promise<InitializeResult> {
    const client = new ProtocolClient();
    try {
      return await client.start({ sessionId: undefined, workDir, executablePath: execPath });
    } finally {
      await client.stop();
    }
  }
}
