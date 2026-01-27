import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { execSync } from "child_process";

export interface PlatformAsset {
  filename: string;
  url: string;
  sha256: string;
}

export interface Manifest {
  version: string;
  tag: string;
  bundledPlatform: string;
  platforms: Record<string, PlatformAsset>;
}

export interface InstalledInfo {
  version: string;
  platform: string;
}

export function getPlatformKey(): string {
  const { platform, arch } = process;
  if (platform === "darwin") {
    return arch === "arm64" ? "darwin-arm64" : "darwin-x64";
  }
  if (platform === "linux") {
    return arch === "arm64" ? "linux-arm64" : "linux-x64";
  }
  if (platform === "win32") {
    return "win32-x64";
  }
  throw new Error(`Unsupported platform: ${platform}-${arch}`);
}

export function readManifest(binDir: string): Manifest | null {
  const manifestPath = path.join(binDir, "manifest.json");
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  } catch {
    return null;
  }
}

export function readInstalled(installDir: string): InstalledInfo | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(installDir, "installed.json"), "utf-8"));
  } catch {
    return null;
  }
}

export function writeInstalled(installDir: string, info: InstalledInfo): void {
  fs.mkdirSync(installDir, { recursive: true });
  fs.writeFileSync(path.join(installDir, "installed.json"), JSON.stringify(info, null, 2));
}

export async function downloadAndInstall(asset: PlatformAsset, installDir: string): Promise<void> {
  const platform = getPlatformKey();
  console.log(`[Kimi Code] Downloading CLI for ${platform}...`);

  const res = await fetch(asset.url, { headers: { "User-Agent": "kimi-vscode" } });
  if (!res.ok) {
    throw new Error(`Download failed: HTTP ${res.status}`);
  }
  const data = Buffer.from(await res.arrayBuffer());

  const actualHash = crypto.createHash("sha256").update(data).digest("hex");
  if (actualHash !== asset.sha256) {
    throw new Error(`Checksum mismatch: expected ${asset.sha256}, got ${actualHash}`);
  }
  console.log("[Kimi Code] Checksum verified ✓");

  if (fs.existsSync(installDir)) {
    fs.rmSync(installDir, { recursive: true, force: true });
  }
  fs.mkdirSync(installDir, { recursive: true });

  const isZip = asset.filename.endsWith(".zip");
  const archivePath = path.join(installDir, isZip ? "archive.zip" : "archive.tar.gz");
  fs.writeFileSync(archivePath, data);

  extract(archivePath, installDir);
  fs.unlinkSync(archivePath);

  console.log("[Kimi Code] CLI installed successfully");
}

function extract(archivePath: string, destDir: string): void {
  const isZip = archivePath.endsWith(".zip");
  const hasTar = (() => {
    try {
      execSync("tar --version", { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();

  if (isZip && !hasTar) {
    execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${destDir}' -Force"`, { stdio: "ignore" });
    flattenSingleDir(destDir);
  } else {
    execSync(`tar -xf "${archivePath}" -C "${destDir}" --strip-components=1`, { stdio: "ignore" });
  }

  if (process.platform !== "win32") {
    const binPath = path.join(destDir, "kimi");
    if (fs.existsSync(binPath)) {
      fs.chmodSync(binPath, 0o755);
    }
  }
}

function flattenSingleDir(dir: string): void {
  const entries = fs.readdirSync(dir);
  if (entries.length === 1) {
    const nested = path.join(dir, entries[0]);
    if (fs.statSync(nested).isDirectory()) {
      for (const f of fs.readdirSync(nested)) {
        fs.renameSync(path.join(nested, f), path.join(dir, f));
      }
      fs.rmdirSync(nested);
    }
  }
}
