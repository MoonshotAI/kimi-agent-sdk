import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { execSync } from "child_process";

// ===== Types =====

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
  type: "native" | "uv";
}

// ===== Platform Config =====

interface PlatformInfo {
  uv: { target: string; ext: string };
  exe: string;
  wrapper: string;
}

const PLATFORMS: Record<string, PlatformInfo> = {
  "darwin-arm64": { uv: { target: "aarch64-apple-darwin", ext: "tar.gz" }, exe: "kimi", wrapper: "kimi" },
  "darwin-x64": { uv: { target: "x86_64-apple-darwin", ext: "tar.gz" }, exe: "kimi", wrapper: "kimi" },
  "linux-arm64": { uv: { target: "aarch64-unknown-linux-gnu", ext: "tar.gz" }, exe: "kimi", wrapper: "kimi" },
  "linux-x64": { uv: { target: "x86_64-unknown-linux-gnu", ext: "tar.gz" }, exe: "kimi", wrapper: "kimi" },
  "win32-x64": { uv: { target: "x86_64-pc-windows-msvc", ext: "zip" }, exe: "kimi.exe", wrapper: "kimi.bat" },
};

export function getPlatformKey(): string {
  const { platform, arch } = process;
  if (platform === "darwin") return arch === "arm64" ? "darwin-arm64" : "darwin-x64";
  if (platform === "linux") return arch === "arm64" ? "linux-arm64" : "linux-x64";
  if (platform === "win32") return "win32-x64";
  throw new Error(`Unsupported platform: ${platform}-${arch}`);
}

export function getPlatformInfo(): PlatformInfo {
  return PLATFORMS[getPlatformKey()];
}

// ===== Manifest & Installed =====

export function readManifest(binDir: string): Manifest | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(binDir, "manifest.json"), "utf-8"));
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

// ===== Native CLI =====

export function extractBundledCLI(archivePath: string, installDir: string): void {
  prepareDir(installDir);
  extract(archivePath, installDir);
  fs.chmodSync(path.join(installDir, getPlatformInfo().exe), 0o755);
}

export async function downloadAndInstallCLI(asset: PlatformAsset, installDir: string): Promise<void> {
  console.log("[Kimi Code] Downloading CLI...");
  const data = await downloadWithHash(asset.url, asset.sha256);

  prepareDir(installDir);
  const archivePath = path.join(installDir, asset.filename);
  fs.writeFileSync(archivePath, data);
  extract(archivePath, installDir);
  fs.unlinkSync(archivePath);
  fs.chmodSync(path.join(installDir, getPlatformInfo().exe), 0o755);

  console.log("[Kimi Code] CLI installed");
}

// ===== UV Fallback =====

export async function downloadAndInstallUV(uvDir: string): Promise<void> {
  const { uv } = getPlatformInfo();
  console.log(`[Kimi Code] Downloading uv...`);

  const res = await fetch("https://api.github.com/repos/astral-sh/uv/releases/latest", {
    headers: { "User-Agent": "kimi-vscode" },
  });
  if (!res.ok) throw new Error(`Failed to fetch uv release: HTTP ${res.status}`);

  const release = (await res.json()) as { assets: Array<{ name: string; browser_download_url: string }> };
  const filename = `uv-${uv.target}.${uv.ext}`;
  const asset = release.assets.find((a) => a.name === filename);
  if (!asset) throw new Error(`UV asset not found: ${filename}`);

  const data = await downloadWithHash(asset.browser_download_url);

  prepareDir(uvDir);
  const binDir = path.join(uvDir, "bin");
  fs.mkdirSync(binDir, { recursive: true });

  const archivePath = path.join(uvDir, filename);
  fs.writeFileSync(archivePath, data);
  extract(archivePath, binDir);
  fs.unlinkSync(archivePath);

  for (const name of fs.readdirSync(binDir)) {
    fs.chmodSync(path.join(binDir, name), 0o755);
  }

  console.log("[Kimi Code] uv installed");
}

export function copyUVWrapper(extensionPath: string, wrapperDir: string): void {
  const { wrapper } = getPlatformInfo();
  fs.mkdirSync(wrapperDir, { recursive: true });

  const src = path.join(extensionPath, "bin", "uv-wrapper", wrapper);
  const dest = path.join(wrapperDir, wrapper);
  fs.copyFileSync(src, dest);
  fs.chmodSync(dest, 0o755);
}

// ===== Helpers =====

function prepareDir(dir: string): void {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

async function downloadWithHash(url: string, expectedSha256?: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { "User-Agent": "kimi-vscode" } });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);

  const data = Buffer.from(await res.arrayBuffer());

  if (expectedSha256) {
    const actual = crypto.createHash("sha256").update(data).digest("hex");
    if (actual !== expectedSha256) {
      throw new Error(`Checksum mismatch: expected ${expectedSha256}, got ${actual}`);
    }
    console.log("[Kimi Code] Checksum verified ✓");
  }

  return data;
}

function extract(archivePath: string, destDir: string): void {
  if (archivePath.endsWith(".zip") && process.platform === "win32" && !hasTar()) {
    execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${destDir}' -Force"`, { stdio: "ignore" });
    flattenSingleDir(destDir);
  } else {
    execSync(`tar -xf "${archivePath}" -C "${destDir}" --strip-components=1`, { stdio: "ignore" });
  }
}

function hasTar(): boolean {
  try {
    execSync("tar --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
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
