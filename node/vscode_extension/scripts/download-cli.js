#!/usr/bin/env node

const https = require("https");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const crypto = require("crypto");

// ============ Configuration ============
const GITHUB_REPO = "MoonshotAI/kimi-cli";
const GITHUB_RELEASE_BASE = `https://github.com/${GITHUB_REPO}/releases/latest/download`;

const PLATFORM_MAP = {
  "darwin-arm64": { target: "aarch64-apple-darwin-onedir", ext: "tar.gz" },
  "darwin-x64": { target: "x86_64-apple-darwin-onedir", ext: "tar.gz" },
  "linux-arm64": { target: "aarch64-unknown-linux-gnu", ext: "tar.gz" },
  "linux-x64": { target: "x86_64-unknown-linux-gnu", ext: "tar.gz" },
  "win32-x64": { target: "x86_64-pc-windows-msvc", ext: "zip" },
};

// ============ Utilities ============

function fetch(url) {
  return new Promise((resolve, reject) => {
    const doRequest = (url) => {
      https
        .get(url, { headers: { "User-Agent": "kimi-vscode" } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            doRequest(res.headers.location);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}: ${url}`));
            return;
          }
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => resolve(Buffer.concat(chunks)));
          res.on("error", reject);
        })
        .on("error", reject);
    };
    doRequest(url);
  });
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function getArchiveName(version, platform) {
  const info = PLATFORM_MAP[platform];
  if (!info) {
    throw new Error(`Unsupported platform: ${platform}`);
  }
  return `kimi-${version}-${info.target}.${info.ext}`;
}

async function getLatestVersion() {
  const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
  const data = await fetch(apiUrl);
  const json = JSON.parse(data.toString());
  return json.tag_name.replace(/^v/, "");
}

// ============ Main ============

async function main() {
  const platform = process.argv[2];

  if (!platform || !PLATFORM_MAP[platform]) {
    console.error("Usage: node download-cli.js <platform>");
    console.error("Platforms:", Object.keys(PLATFORM_MAP).join(", "));
    process.exit(1);
  }

  const info = PLATFORM_MAP[platform];
  const binDir = path.join(__dirname, "..", "bin", "kimi");

  // Clean and create bin directory
  if (fs.existsSync(binDir)) {
    fs.rmSync(binDir, { recursive: true });
  }
  fs.mkdirSync(binDir, { recursive: true });

  console.log(`Fetching latest version...`);
  const version = await getLatestVersion();
  const archiveName = getArchiveName(version, platform);
  const archiveUrl = `${GITHUB_RELEASE_BASE}/${archiveName}`;
  const sha256Url = `${archiveUrl}.sha256`;

  console.log(`Downloading ${archiveName}...`);
  const [archiveData, sha256Data] = await Promise.all([fetch(archiveUrl), fetch(sha256Url)]);

  // Verify checksum
  const expectedHash = sha256Data.toString().trim().split(/\s+/)[0];
  const actualHash = sha256(archiveData);
  if (actualHash !== expectedHash) {
    console.error(`Checksum mismatch!`);
    console.error(`Expected: ${expectedHash}`);
    console.error(`Actual: ${actualHash}`);
    process.exit(1);
  }
  console.log(`Checksum verified.`);

  // Write archive to temp file
  const archivePath = path.join(binDir, archiveName);
  fs.writeFileSync(archivePath, archiveData);

  // Extract
  console.log(`Extracting...`);
  if (info.ext === "zip") {
    execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${binDir}' -Force"`, { stdio: "inherit" });
  } else {
    execSync(`tar -xzf "${archivePath}" -C "${binDir}"`, { stdio: "inherit" });
  }

  // Clean up archive
  fs.unlinkSync(archivePath);

  // Set executable permission on unix
  if (process.platform !== "win32") {
    const executablePath = path.join(binDir, "kimi");
    if (fs.existsSync(executablePath)) {
      fs.chmodSync(executablePath, 0o755);
    }
  }

  console.log(`Done! Binary installed to ${binDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
