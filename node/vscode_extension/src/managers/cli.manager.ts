import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { ProtocolClient, type InitializeResult } from "@moonshot-ai/kimi-agent-sdk";
import {
  getPlatformKey,
  getPlatformInfo,
  readManifest,
  readInstalled,
  writeInstalled,
  extractBundledCLI,
  downloadAndInstallCLI,
  downloadAndInstallUV,
  copyUVWrapper,
} from "./cli-downloader";
import type { CLICheckResult } from "shared/types";

const execAsync = promisify(execFile);

const MIN_CLI_VERSION = "0.82";
const MIN_WIRE_VERSION = "1.1";

let instance: CLIManager;

export const initCLIManager = (ctx: vscode.ExtensionContext) => (instance = new CLIManager(ctx));
export const getCLIManager = () => {
  if (!instance) throw new Error("CLI not init");
  return instance;
};

export function compareVersion(a: string, b: string): number {
  const v1 = a.split(".").map(Number);
  const v2 = b.split(".").map(Number);
  for (let i = 0; i < Math.max(v1.length, v2.length); i++) {
    const diff = (v1[i] || 0) - (v2[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export class CLIManager {
  private extensionBinPath: string;
  private kimiPath: string;
  private uvPath: string;

  constructor(private ctx: vscode.ExtensionContext) {
    const globalBin = path.join(ctx.globalStorageUri.fsPath, "bin");
    this.extensionBinPath = path.join(ctx.extensionUri.fsPath, "bin", "kimi");
    this.kimiPath = path.join(globalBin, "kimi");
    this.uvPath = path.join(globalBin, "uv");
  }

  getExecutablePath(): string {
    const custom = vscode.workspace.getConfiguration("kimi").get<string>("executablePath");
    if (custom) return custom;

    const installed = readInstalled(this.kimiPath);
    const info = getPlatformInfo();
    const filename = installed?.type === "uv" ? info.wrapper : info.exe;
    return path.join(this.kimiPath, filename);
  }

  async checkInstalled(workDir: string): Promise<CLICheckResult> {
    const resolved = { isCustomPath: this.isCustomPath(), path: this.getExecutablePath() };

    if (!(await this.ensureCLI())) {
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
    const installed = readInstalled(this.kimiPath);

    if (installed?.version === manifest.version && installed?.platform === platform) {
      return true;
    }

    const asset = manifest.platforms[platform];
    console.log(`[Kimi Code] Installing CLI for platform: ${platform}, asset:`, asset, `installed info:`, installed, "manifest:", manifest);

    if (asset) {
      if (manifest.bundledPlatform === platform) {
        console.log(`[Kimi Code] Extracting bundled CLI for ${platform}...`);
        const archiveExt = asset.filename.endsWith(".zip") ? "zip" : "tar.gz";
        extractBundledCLI(path.join(this.extensionBinPath, `archive.${archiveExt}`), this.kimiPath);
      } else {
        console.log(`[Kimi Code] Platform ${platform} not matched bundled, downloading CLI...`);
        vscode.window.showInformationMessage(`Downloading Kimi CLI for ${platform}...`);
        await downloadAndInstallCLI(asset, this.kimiPath);
      }
      writeInstalled(this.kimiPath, { version: manifest.version, platform, type: "native" });
    } else {
      console.log(`[Kimi Code] Platform ${platform} not supported natively, installing via uv...`);
      vscode.window.showInformationMessage(
        `Native CLI not available for ${platform}. Installing via uv (first run may take a moment)...`
      );
      await downloadAndInstallUV(this.uvPath);
      copyUVWrapper(this.ctx.extensionUri.fsPath, this.kimiPath);
      writeInstalled(this.kimiPath, { version: manifest.version, platform, type: "uv" });
    }

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
