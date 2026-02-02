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
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    return execSync("gh auth token", { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

async function request(url) {
  const headers = { "User-Agent": "kimi-vscode" };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res;
}

async function buildManifest(release, bundledPlatform) {
  const version = release.tag_name.replace(/^v/, "");
  const platforms = {};

  for (const [key, info] of Object.entries(PLATFORMS)) {
    const filename = `kimi-${version}-${info.target}.${info.ext}`;
    const asset = release.assets.find((a) => a.name === filename);
    const sha256Asset = release.assets.find((a) => a.name === `${filename}.sha256`);

    if (asset && sha256Asset) {
      const sha256Res = await request(sha256Asset.browser_download_url);
      const sha256Text = await sha256Res.text();
      platforms[key] = {
        filename,
        url: asset.browser_download_url,
        sha256: sha256Text.trim().split(/\s+/)[0],
      };
    }
  }

  return { version, tag: release.tag_name, bundledPlatform, platforms };
}

async function main() {
  const platform = process.argv[2];
  const info = PLATFORMS[platform];
  if (!info) {
    throw new Error(`Usage: node download-cli.js <${Object.keys(PLATFORMS).join("|")}>`);
  }

  const binDir = path.join(__dirname, "..", "bin", "kimi");
  fs.mkdirSync(binDir, { recursive: true });

  console.log("Fetching release info...");
  const release = await (await request(`https://api.github.com/repos/${REPO}/releases/latest`)).json();
  const manifest = await buildManifest(release, platform);
  const asset = manifest.platforms[platform];

  if (asset) {
    console.log(`Downloading ${asset.filename}...`);
    const data = Buffer.from(await (await request(asset.url)).arrayBuffer());

    const actualHash = crypto.createHash("sha256").update(data).digest("hex");
    if (actualHash !== asset.sha256) {
      throw new Error(`Checksum mismatch!\nExpected: ${asset.sha256}\nActual:   ${actualHash}`);
    }
    console.log("Checksum verified ✓");

    fs.writeFileSync(path.join(binDir, `archive.${info.ext}`), data);
  } else {
    console.log(`No native CLI for ${platform}, will use UV fallback at runtime`);
  }

  fs.writeFileSync(path.join(binDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`Version: ${manifest.version} | Platform: ${platform}${asset ? "" : " (UV fallback)"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
