import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { spawn } from "child_process";
import { ProtocolClient } from "@moonshot-ai/kimi-agent-sdk";
import type { InitializeResult, SlashCommandInfo } from "@moonshot-ai/kimi-agent-sdk";
import { CLICheckResult } from "shared/types";

const MIN_CLI_VERSION = "0.81";
const MIN_WIRE_PROTOCOL_VERSION = "1.1";

interface CLIInfo {
  kimi_cli_version: string;
  wire_protocol_version: string;
}

let instance: CLIManager | null = null;

export function initCLIManager(context: vscode.ExtensionContext): CLIManager {
  instance = new CLIManager(context);
  return instance;
}

export function getCLIManager(): CLIManager {
  if (!instance) {
    throw new Error("CLIManager not initialized");
  }
  return instance;
}

function exec(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    console.log(`[Kimi Code] Executing command: ${cmd} ${args.join(" ")}`);

    let stdout = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolve(stdout) : reject(new Error(`${cmd} exited with ${code}`))));
  });
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

export class CLIManager {
  private bundledPath: string;
  private warmedPath: string;

  constructor(private context: vscode.ExtensionContext) {
    const binName = process.platform === "win32" ? "kimi.exe" : "kimi";
    this.bundledPath = path.join(context.globalStorageUri.fsPath, "bin", "kimi", binName);
    this.warmedPath = path.join(context.globalStorageUri.fsPath, "bin", ".warmed");
  }

  getExecutablePath(): string {
    const userPath = vscode.workspace.getConfiguration("kimi").get<string>("executablePath", "");
    return userPath || this.bundledPath;
  }

  async isWarmed(): Promise<boolean> {
    return fs.existsSync(this.warmedPath);
  }

  async markWarmed(): Promise<void> {
    const dir = path.dirname(this.warmedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.warmedPath, "");
  }

  async checkInstalled(workDir: string): Promise<CLICheckResult> {
    const execPath = this.getExecutablePath();

    // Step 3: Verify via wire initialize
    try {
      // Check version via info --json
      console.log(`[Kimi Code] ${new Date().toISOString()} Checking CLI at path: ${execPath}`);

      const info = await this.getInfo(execPath);
      if (!info || !this.meetsRequirements(info)) {
        console.error(`[Kimi Code] ${new Date().toISOString()} CLI does not meet minimum version requirements.`);
        return { ok: false };
      }

      console.log(`[Kimi Code] ${new Date().toISOString()} Verifying CLI via wire protocol...`);
      const initResult = await this.verifyWithWire(execPath, workDir);

      console.log(`[Kimi Code] ${new Date().toISOString()} CLI verified successfully via wire protocol.`);
      if (!(await this.isWarmed())) {
        await this.markWarmed();
      }

      return {
        ok: true,
        slashCommands: initResult.slash_commands,
      };
    } catch (err) {
      console.error(`[Kimi Code] ${new Date().toISOString()} CLI verification failed:`, err);
      return { ok: false };
    }
  }

  private async getInfo(execPath: string): Promise<CLIInfo> {
    const output = await exec(execPath, ["info", "--json"]);
    console.log(`[Kimi Code] ${new Date().toISOString()} CLI info output: ${output}`);
    return JSON.parse(output);
  }

  private meetsRequirements(info: CLIInfo): boolean {
    return compareVersions(info.kimi_cli_version, MIN_CLI_VERSION) >= 0 && compareVersions(info.wire_protocol_version, MIN_WIRE_PROTOCOL_VERSION) >= 0;
  }

  private async verifyWithWire(execPath: string, workDir: string): Promise<InitializeResult> {
    const client = new ProtocolClient();
    const sessionId = crypto.randomUUID();

    try {
      const result = await client.start({
        sessionId,
        workDir,
        executablePath: execPath,
      });

      return result;
    } finally {
      await client.stop();
    }
  }
}
