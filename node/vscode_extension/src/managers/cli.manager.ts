import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import { execFile, execSync } from "child_process";
import { promisify } from "util";
import { ProtocolClient, type InitializeResult } from "@moonshot-ai/kimi-agent-sdk";
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

  private createCheckResult(ok: boolean, extra: Partial<CLICheckResult> = {}): CLICheckResult {
    return {
      ok,
      resolved: { isCustomPath: this.isCustomPath(), path: this.getExecutablePath() },
      ...extra,
    };
  }

  async checkInstalled(workDir: string): Promise<CLICheckResult> {
    const execPath = this.getExecutablePath();
    console.log(`[Kimi Code] Checking CLI: ${execPath} (custom: ${this.isCustomPath()})`);

    // Step 1: Extract bundled CLI if needed
    if (execPath === this.bundledExec && !fs.existsSync(execPath)) {
      try {
        this.extractArchive();
      } catch (err) {
        console.error(`[Kimi Code] Extract failed:`, err);
        return this.createCheckResult(false, {
          error: { type: "extract_failed", message: err instanceof Error ? err.message : String(err) },
        });
      }
    }

    // Step 2: Get CLI info
    let cliVersion: string;
    let wireVersion: string;
    try {
      const info = await this.getInfo(execPath);
      cliVersion = info.kimi_cli_version;
      wireVersion = info.wire_protocol_version;
    } catch (err) {
      console.error(`[Kimi Code] CLI not found or failed to execute:`, err);
      return this.createCheckResult(false, {
        error: { type: "not_found", message: err instanceof Error ? err.message : String(err) },
      });
    }

    // Step 3: Check version
    if (compareVersion(cliVersion, MIN_CLI_VERSION) < 0) {
      return this.createCheckResult(false, {
        error: { type: "version_low", message: `CLI version ${cliVersion} is below minimum required ${MIN_CLI_VERSION}` },
      });
    }
    if (compareVersion(wireVersion, MIN_WIRE_VERSION) < 0) {
      return this.createCheckResult(false, {
        error: { type: "version_low", message: `Wire protocol ${wireVersion} is below minimum required ${MIN_WIRE_VERSION}` },
      });
    }

    // Step 4: Verify wire protocol
    let initResult: InitializeResult;
    try {
      initResult = await this.verifyWire(execPath, workDir);
    } catch (err) {
      console.error(`[Kimi Code] Wire protocol verification failed:`, err);
      return this.createCheckResult(false, {
        error: { type: "protocol_error", message: err instanceof Error ? err.message : String(err) },
      });
    }

    return this.createCheckResult(true, { slashCommands: initResult.slash_commands });
  }

  private extractArchive(): void {
    const archive = path.join(this.extBin, process.platform === "win32" ? "archive.zip" : "archive.tar.gz");
    if (!fs.existsSync(archive)) {
      throw new Error(`Archive missing: ${archive}`);
    }
    fs.mkdirSync(this.globalBin, { recursive: true });

    let hasTar = true;
    try {
      execSync("tar --version", { stdio: "ignore" });
    } catch {
      hasTar = false;
    }

    console.log(`[Kimi Code] Extracting to ${this.globalBin}..., using ${hasTar ? "tar" : "powershell"}`);

    if (hasTar) {
      execSync(`tar -xf "${archive}" -C "${this.globalBin}" --strip-components=1`, { stdio: "ignore" });
    } else {
      execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${archive}' -DestinationPath '${this.globalBin}' -Force"`, { stdio: "ignore" });

      // Move files out of nested folder
      const entries = fs.readdirSync(this.globalBin);
      if (entries.length === 1) {
        const nested = path.join(this.globalBin, entries[0]);
        if (fs.statSync(nested).isDirectory()) {
          for (const f of fs.readdirSync(nested)) {
            fs.renameSync(path.join(nested, f), path.join(this.globalBin, f));
          }
          fs.rmdirSync(nested);
        }
      }
    }

    if (process.platform !== "win32") {
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
