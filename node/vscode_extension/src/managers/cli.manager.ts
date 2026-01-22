import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import { execFile, execSync } from "child_process";
import { promisify } from "util";
import { ProtocolClient, type InitializeResult } from "@moonshot-ai/kimi-agent-sdk";
import type { CLICheckResult, CLIErrorType } from "../../shared/types";

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

function compareVersion(current: string, min: string): number {
  const v1 = current.split(".").map(Number);
  const v2 = min.split(".").map(Number);
  for (let i = 0; i < Math.max(v1.length, v2.length); i++) {
    const diff = (v1[i] || 0) - (v2[i] || 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

function classifyError(err: unknown): CLIErrorType {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("ENOENT") || message.includes("not found") || message.includes("spawn")) {
    return "not_found";
  }
  if (message.includes("extract") || message.includes("Archive") || message.includes("tar")) {
    return "extract_failed";
  }
  if (message.includes("protocol") || message.includes("wire") || message.includes("Initialize")) {
    return "protocol_error";
  }
  return "not_found";
}

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

  getExecutablePath(): string {
    return vscode.workspace.getConfiguration("kimi").get<string>("executablePath") || this.bundledExec;
  }

  private isCustomPath(): boolean {
    return !!vscode.workspace.getConfiguration("kimi").get<string>("executablePath");
  }

  async checkInstalled(workDir: string): Promise<CLICheckResult> {
    const execPath = this.getExecutablePath();
    const resolved = { isCustomPath: this.isCustomPath(), path: execPath };

    console.log(`[Kimi Code] Checking CLI: ${execPath} (custom: ${resolved.isCustomPath})`);

    try {
      if (execPath === this.bundledExec && !fs.existsSync(execPath)) {
        this.extractArchive();
      }

      const { kimi_cli_version, wire_protocol_version } = await this.getInfo(execPath);

      if (compareVersion(kimi_cli_version, MIN_CLI_VERSION) < 0) {
        return {
          ok: false,
          resolved,
          error: {
            type: "version_low",
            message: `CLI version ${kimi_cli_version} is below minimum required ${MIN_CLI_VERSION}`,
          },
        };
      }

      if (compareVersion(wire_protocol_version, MIN_WIRE_VERSION) < 0) {
        return {
          ok: false,
          resolved,
          error: {
            type: "version_low",
            message: `Wire protocol ${wire_protocol_version} is below minimum required ${MIN_WIRE_VERSION}`,
          },
        };
      }

      const { slash_commands } = await this.verifyWire(execPath, workDir);

      return { ok: true, slashCommands: slash_commands, resolved };
    } catch (err) {
      console.error(`[Kimi Code] CLI check failed:`, err);
      return {
        ok: false,
        resolved,
        error: {
          type: classifyError(err),
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  private extractArchive(): void {
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

  private async getInfo(execPath: string): Promise<{ kimi_cli_version: string; wire_protocol_version: string }> {
    const { stdout } = await execAsync(execPath, ["info", "--json"]);
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
