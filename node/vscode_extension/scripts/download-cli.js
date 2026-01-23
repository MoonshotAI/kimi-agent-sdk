#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

const REPO = "MoonshotAI/kimi-cli";
const PLATFORMS = {
  "darwin-arm64": { t: "aarch64-apple-darwin-onedir", ext: "tar.gz" },
  "darwin-x64": { t: "x86_64-apple-darwin-onedir", ext: "tar.gz" },
  "linux-arm64": { t: "aarch64-unknown-linux-gnu-onedir", ext: "tar.gz" },
  "linux-x64": { t: "x86_64-unknown-linux-gnu-onedir", ext: "tar.gz" },
  "win32-x64": { t: "x86_64-pc-windows-msvc-onedir", ext: "zip" },
};

const getToken = () =>
  process.env.GITHUB_TOKEN ||
  (() => {
    try {
      return execSync("gh auth token", { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }).trim();
    } catch {}
  })();

const request = async (url) => {
  const headers = { "User-Agent": "kimi-vscode" };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return Buffer.from(await res.arrayBuffer());
};

async function main() {
  const platform = process.argv[2];
  const info = PLATFORMS[platform];
  if (!info) {
    throw new Error(`Usage: node download-cli.js <${Object.keys(PLATFORMS).join("|")}>`);
  }

  const binDir = path.join(__dirname, "..", "bin", "kimi");
  const archiveName = `archive.${info.ext}`;

  console.log("Fetching release info...");
  const release = JSON.parse((await request(`https://api.github.com/repos/${REPO}/releases/latest`)).toString());
  const version = release.tag_name.replace(/^v/, "");
  const filename = `kimi-${version}-${info.t}.${info.ext}`;

  const asset = release.assets.find((a) => a.name === filename);
  const sha256Asset = release.assets.find((a) => a.name === `${filename}.sha256`);
  if (!asset) throw new Error(`Asset not found: ${filename}`);
  if (!sha256Asset) throw new Error(`SHA256 not found: ${filename}.sha256`);

  console.log(`Downloading ${filename}...`);
  const data = await request(asset.browser_download_url);

  console.log("Verifying checksum...");
  const expectedHash = (await request(sha256Asset.browser_download_url)).toString().trim().split(/\s+/)[0];
  const actualHash = crypto.createHash("sha256").update(data).digest("hex");
  if (actualHash !== expectedHash) {
    throw new Error(`Checksum mismatch!\nExpected: ${expectedHash}\nActual:   ${actualHash}`);
  }
  console.log("Checksum verified ✓");

  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, archiveName), data);
  console.log(`Saved to bin/kimi/${archiveName}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
