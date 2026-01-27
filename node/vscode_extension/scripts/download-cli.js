#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

const REPO = "MoonshotAI/kimi-cli";

const PLATFORMS = {
  "darwin-arm64": { target: "aarch64-apple-darwin-onedir", ext: "tar.gz" },
  "darwin-x64": { target: "x86_64-apple-darwin-onedir", ext: "tar.gz" },
  "linux-arm64": { target: "aarch64-unknown-linux-gnu-onedir", ext: "tar.gz" },
  "linux-x64": { target: "x86_64-unknown-linux-gnu-onedir", ext: "tar.gz" },
  "win32-x64": { target: "x86_64-pc-windows-msvc-onedir", ext: "zip" },
};

function getToken() {
  if (process.env.GITHUB_TOKEN) {
    return process.env.GITHUB_TOKEN;
  }
  try {
    return execSync("gh auth token", { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

async function request(url) {
  const headers = { "User-Agent": "kimi-vscode" };
  const token = getToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${url}`);
  }
  return res;
}

async function fetchRelease() {
  const res = await request(`https://api.github.com/repos/${REPO}/releases/latest`);
  return res.json();
}

async function buildManifest(release, bundledPlatform) {
  const version = release.tag_name.replace(/^v/, "");
  const tag = release.tag_name;

  const platforms = {};
  for (const [platformKey, info] of Object.entries(PLATFORMS)) {
    const filename = `kimi-${version}-${info.target}.${info.ext}`;
    const asset = release.assets.find((a) => a.name === filename);
    const sha256Asset = release.assets.find((a) => a.name === `${filename}.sha256`);

    if (asset && sha256Asset) {
      const sha256Res = await request(sha256Asset.browser_download_url);
      const sha256Text = await sha256Res.text();

      platforms[platformKey] = {
        filename,
        url: asset.browser_download_url,
        sha256: sha256Text.trim().split(/\s+/)[0],
      };
    }
  }

  return { version, tag, bundledPlatform, platforms };
}

async function main() {
  const platform = process.argv[2];
  const info = PLATFORMS[platform];
  if (!info) {
    throw new Error(`Usage: node download-cli.js <${Object.keys(PLATFORMS).join("|")}>`);
  }

  const binDir = path.join(__dirname, "..", "bin", "kimi");
  const archiveName = `archive.${info.ext}`;

  console.log("Fetching release info...");
  const release = await fetchRelease();
  const manifest = await buildManifest(release, platform);

  const { version, tag } = manifest;
  const asset = manifest.platforms[platform];
  if (!asset) {
    throw new Error(`Asset not found for platform: ${platform}`);
  }

  console.log(`Downloading ${asset.filename}...`);
  const dataRes = await request(asset.url);
  const data = Buffer.from(await dataRes.arrayBuffer());

  console.log("Verifying checksum...");
  const actualHash = crypto.createHash("sha256").update(data).digest("hex");
  if (actualHash !== asset.sha256) {
    throw new Error(`Checksum mismatch!\nExpected: ${asset.sha256}\nActual:   ${actualHash}`);
  }
  console.log("Checksum verified ✓");

  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, archiveName), data);
  fs.writeFileSync(path.join(binDir, "version.json"), JSON.stringify({ version, tag }, null, 2));
  fs.writeFileSync(path.join(binDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  console.log(`Saved to bin/kimi/${archiveName}`);
  console.log(`Saved to bin/kimi/manifest.json`);
  console.log(`Version: ${version} (${tag})`);
  console.log(`Bundled platform: ${platform}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
