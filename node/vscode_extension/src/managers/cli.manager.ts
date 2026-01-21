import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import { execFile, execSync } from "child_process";
import { promisify } from "util";
import { ProtocolClient, type InitializeResult } from "@moonshot-ai/kimi-agent-sdk";
import { CLICheckResult } from "shared/types";

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

const checkVersion = (current: string, min: string) => {
  const v1 = current.split(".").map(Number),
    v2 = min.split(".").map(Number);
  for (let i = 0; i < Math.max(v1.length, v2.length); i++) {
    if ((v1[i] || 0) !== (v2[i] || 0)) {
      return (v1[i] || 0) - (v2[i] || 0);
    }
  }
  return 0;
};

export class CLIManager {
  private globalBin: string;
  private bundledExec: string;
  private extBin: string;

  constructor(ctx: vscode.ExtensionContext) {
    const binName = process.platform === "win32" ? "kimi.exe" : "kimi";
    this.globalBin = path.join(ctx.globalStorageUri.fsPath, "bin", "kimi");
    this.bundledExec = path.join(this.globalBin, binName);
    this.extBin = path.join(ctx.extensionUri.fsPath, "bin", "kimi");
  }

  getExecutablePath() {
    return vscode.workspace.getConfiguration("kimi").get<string>("executablePath") || this.bundledExec;
  }

  async checkInstalled(workDir: string): Promise<CLICheckResult> {
    const execPath = this.getExecutablePath();
    console.log(`[Kimi Code] Checking CLI: ${execPath}`);

    try {
      // 1. Existence check & extraction
      if (execPath === this.bundledExec && !fs.existsSync(execPath)) {
        this.extractArchive();
      }

      // 2. Version check
      const { kimi_cli_version: cli_version, wire_protocol_version: wire_version } = await this.getInfo(execPath);
      if (checkVersion(cli_version, MIN_CLI_VERSION) < 0 || checkVersion(wire_version, MIN_WIRE_VERSION) < 0) {
        throw new Error(`CLI version too low: ${cli_version} (req ${MIN_CLI_VERSION})`);
      }

      // 3. Wire protocol check
      const { slash_commands } = await this.verifyWire(execPath, workDir);
      return { ok: true, slashCommands: slash_commands };
    } catch (err) {
      console.error(`[Kimi Code] Setup failed:`, err);
      return { ok: false };
    }
  }

  private extractArchive() {
    const archive = path.join(this.extBin, process.platform === "win32" ? "archive.zip" : "archive.tar.gz");
    if (!fs.existsSync(archive)) {
      throw new Error(`Archive missing: ${archive}`);
    }

    fs.mkdirSync(this.globalBin, { recursive: true });
    console.log(`[Kimi Code] Extracting to ${this.globalBin}...`);

    if (process.platform === "win32") {
      execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${archive}' -DestinationPath '${this.globalBin}' -Force"`, { stdio: "ignore" });
    } else {
      execSync(`tar -xzf "${archive}" -C "${this.globalBin}" --strip-components=1`, { stdio: "ignore" });
      fs.chmodSync(path.join(this.globalBin, "kimi"), 0o755);
    }
  }

  private async getInfo(path: string) {
    const { stdout } = await execAsync(path, ["info", "--json"]);
    return JSON.parse(stdout);
  }

  private async verifyWire(executablePath: string, workDir: string): Promise<InitializeResult> {
    const client = new ProtocolClient();
    try {
      return await client.start({ sessionId: crypto.randomUUID(), workDir, executablePath });
    } finally {
      await client.stop();
    }
  }
}
