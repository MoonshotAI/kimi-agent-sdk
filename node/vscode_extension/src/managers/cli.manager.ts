import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";

const MIN_CLI_VERSION = "0.79";
const MIN_WIRE_PROTOCOL_VERSION = "1";

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
    this.bundledPath = path.join(context.extensionUri.fsPath, "bin", "kimi", binName);
    this.warmedPath = path.join(context.globalStorageUri.fsPath, ".warmed");
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

  async checkInstalled(): Promise<boolean> {
    const execPath = this.getExecutablePath();
    if (!fs.existsSync(execPath)) {
      return false;
    }
    const info = await this.getInfo(execPath).catch(() => null);
    const ok = info !== null && this.meetsRequirements(info);
    if (ok && !(await this.isWarmed())) {
      await this.markWarmed();
    }
    return ok;
  }

  private async getInfo(execPath: string): Promise<CLIInfo> {
    const output = await exec(execPath, ["info", "--json"]);
    return JSON.parse(output);
  }

  private meetsRequirements(info: CLIInfo): boolean {
    return (
      compareVersions(info.kimi_cli_version, MIN_CLI_VERSION) >= 0 &&
      compareVersions(info.wire_protocol_version, MIN_WIRE_PROTOCOL_VERSION) >= 0
    );
  }
}
