#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

const REPO = "MoonshotAI/kimi-cli";
const PLATFORMS = {
  "darwin-arm64": { t: "aarch64-apple-darwin-onedir", ext: "tar.gz" },
  "darwin-x64": { t: "x86_64-apple-darwin-onedir", ext: "tar.gz" },
  "linux-arm64": { t: "aarch64-unknown-linux-gnu", ext: "tar.gz" },
  "linux-x64": { t: "x86_64-unknown-linux-gnu", ext: "tar.gz" },
  "win32-x64": { t: "x86_64-pc-windows-msvc", ext: "zip" },
};

const getToken = () =>
  process.env.GITHUB_TOKEN ||
  (() => {
    try {
      return execSync("gh auth token", { encoding: "utf8", stdio: "ignore" }).trim();
    } catch {}
  })();

const request = async (url) => {
  const headers = { "User-Agent": "kimi-vscode" };
  const token = getToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${url}`);
  }
  return Buffer.from(await res.arrayBuffer());
};

async function main() {
  const platform = process.argv[2];
  const info = PLATFORMS[platform];
  if (!info) {
    throw new Error(`Usage: node download-cli.js <${Object.keys(PLATFORMS).join("|")}>`);
  }

  const binDir = path.join(__dirname, "..", "bin", "kimi");
  fs.rmSync(binDir, { recursive: true, force: true });
  fs.mkdirSync(binDir, { recursive: true });

  console.log("Fetching release info...");
  const release = JSON.parse((await request(`https://api.github.com/repos/${REPO}/releases/latest`)).toString());

  const version = release.tag_name.replace(/^v/, ""); // 文件名通常不带v
  const filename = `kimi-${version}-${info.t}.${info.ext}`;
  const baseUrl = `https://github.com/${REPO}/releases/download/${release.tag_name}`;

  console.log(`Downloading ${filename}...`);
  const [fileBuf, sumBuf] = await Promise.all([request(`${baseUrl}/${filename}`), request(`${baseUrl}/${filename}.sha256`)]);

  const expected = sumBuf.toString().trim().split(/\s+/)[0];
  const actual = crypto.createHash("sha256").update(fileBuf).digest("hex");
  if (actual !== expected) {
    throw new Error(`Checksum mismatch!\nExp: ${expected}\nAct: ${actual}`);
  }

  const dest = path.join(binDir, info.ext === "zip" ? "archive.zip" : "archive.tar.gz");
  fs.writeFileSync(dest, fileBuf);
  console.log(`Verified & Saved to ${dest}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
