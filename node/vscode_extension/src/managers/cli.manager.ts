import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "node:path";
import * as crypto from "crypto";
import { spawn } from "child_process";

const MIN_CLI_VERSION = "0.72";
const MIN_WIRE_PROTOCOL_VERSION = "1";
const GITHUB_RELEASE_BASE = "https://github.com/MoonshotAI/kimi-cli/releases/latest/download";
const GITHUB_API_LATEST = "https://api.github.com/repos/MoonshotAI/kimi-cli/releases/latest";

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
  private binDir: string;
  private executable: string;

  constructor(private context: vscode.ExtensionContext) {
    this.binDir = path.join(context.globalStorageUri.fsPath, "bin");
    this.executable = path.join(this.binDir, process.platform === "win32" ? "kimi.exe" : "kimi");
  }

  getExecutablePath(): string {
    return vscode.workspace.getConfiguration("kimi").get<string>("executablePath", "") || this.executable;
  }

  async checkInstalled(): Promise<boolean> {
    const userPath = vscode.workspace.getConfiguration("kimi").get<string>("executablePath", "");

    if (userPath) {
      const info = await this.getInfo(userPath).catch(() => null);
      return info !== null && this.meetsRequirements(info);
    }

    const info = await this.getInfo(this.executable).catch(() => null);
    return info !== null && this.meetsRequirements(info);
  }

  async installCLI(): Promise<void> {
    const info = await this.getInfo(this.executable).catch(() => null);
    if (info && this.meetsRequirements(info)) {
      return;
    }

    await this.install();
  }

  private async getInfo(execPath: string): Promise<CLIInfo> {
    const env = vscode.env.remoteName ? ` (remote: ${vscode.env.remoteName})` : "";
    console.log(`[Kimi CLI] Getting info from ${execPath}${env}`);
    const output = await exec(execPath, ["info", "--json"]);
    return JSON.parse(output);
  }

  private meetsRequirements(info: CLIInfo): boolean {
    return compareVersions(info.kimi_cli_version, MIN_CLI_VERSION) >= 0 && compareVersions(info.wire_protocol_version, MIN_WIRE_PROTOCOL_VERSION) >= 0;
  }

  private async install(): Promise<void> {
    const platform = this.getPlatform();
    if (!platform) {
      throw new Error(`Unsupported: ${process.platform} ${process.arch}. Manual install: uv tool install --python 3.14 kimi-cli`);
    }

    const remoteInfo = vscode.env.remoteName ? ` on ${vscode.env.remoteName}` : "";

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Kimi: Installing CLI ${remoteInfo}`,
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: "Fetching version..." });

        const res = await fetch(GITHUB_API_LATEST, {
          headers: { "User-Agent": "kimi-vscode" },
        });
        const version = ((await res.json()) as { tag_name: string }).tag_name.replace(/^v/, "");

        const archiveName = this.getArchiveName(version, platform);
        const archivePath = path.join(this.binDir, archiveName);
        await fs.promises.mkdir(this.binDir, { recursive: true });

        progress.report({ message: "Downloading checksum..." });
        const sha256Res = await fetch(`${GITHUB_RELEASE_BASE}/${archiveName}.sha256`);
        const expectedHash = (await sha256Res.text()).trim().split(/\s+/)[0];

        progress.report({ message: "Downloading CLI..." });
        const archiveRes = await fetch(`${GITHUB_RELEASE_BASE}/${archiveName}`);
        const total = +archiveRes.headers.get("content-length")!;
        const reader = archiveRes.body!.getReader();
        const chunks: Uint8Array[] = [];

        for (let loaded = 0; ; ) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          chunks.push(value);
          loaded += value.length;
          progress.report({
            message: `Downloading CLI... ${((loaded / total) * 100) | 0}%`,
          });
        }

        const buffer = Buffer.concat(chunks);

        progress.report({ message: "Verifying..." });
        const actualHash = crypto.createHash("sha256").update(buffer).digest("hex");
        if (actualHash !== expectedHash) {
          await fs.promises.unlink(archivePath).catch(() => {});
          throw new Error(`Checksum mismatch`);
        }

        await fs.promises.writeFile(archivePath, buffer);

        progress.report({ message: "Extracting..." });
        if (platform.os === "windows") {
          await exec("powershell", ["-NoProfile", "-Command", `Expand-Archive -Path "${archivePath}" -DestinationPath "${this.binDir}" -Force`]);
        } else {
          await exec("tar", ["-xzf", archivePath, "-C", this.binDir]);
        }

        await fs.promises.unlink(archivePath).catch(() => {});
        if (process.platform !== "win32") {
          await fs.promises.chmod(this.executable, 0o755);
        }
      },
    );
  }

  private getPlatform(): { os: "darwin" | "linux" | "windows"; arch: "aarch64" | "x86_64" } | null {
    const map: Record<string, { os: "darwin" | "linux" | "windows"; arch: "aarch64" | "x86_64" }> = {
      "darwin-arm64": { os: "darwin", arch: "aarch64" },
      "darwin-x64": { os: "darwin", arch: "x86_64" },
      "linux-arm64": { os: "linux", arch: "aarch64" },
      "linux-x64": { os: "linux", arch: "x86_64" },
      "win32-x64": { os: "windows", arch: "x86_64" },
    };
    return map[`${process.platform}-${process.arch}`] || null;
  }

  private getArchiveName(version: string, platform: { os: string; arch: string }): string {
    const targets: Record<string, string> = {
      "darwin-aarch64": "aarch64-apple-darwin",
      "darwin-x86_64": "x86_64-apple-darwin",
      "linux-aarch64": "aarch64-unknown-linux-gnu",
      "linux-x86_64": "x86_64-unknown-linux-gnu",
      "windows-x86_64": "x86_64-pc-windows-msvc",
    };
    const ext = platform.os === "windows" ? "zip" : "tar.gz";
    return `kimi-${version}-${targets[`${platform.os}-${platform.arch}`]}.${ext}`;
  }
}
