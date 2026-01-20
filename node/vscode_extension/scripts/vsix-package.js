#!/usr/bin/env node

const { execSync } = require("child_process");
const path = require("path");

const PLATFORMS = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-x64"];

const platform = process.argv[2];

if (!platform) {
  console.log("Usage: node vsix-package.js <platform|all>");
  console.log("Platforms:", PLATFORMS.join(", "), "all");
  process.exit(1);
}

const targets = platform === "all" ? PLATFORMS : [platform];

for (const target of targets) {
  if (!PLATFORMS.includes(target)) {
    console.error(`Unknown platform: ${target}`);
    process.exit(1);
  }
}

const rootDir = path.join(__dirname, "..");

function run(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { cwd: rootDir, stdio: "inherit" });
}

for (const target of targets) {
  console.log(`\n========== Packaging for ${target} ==========\n`);

  run(`node scripts/download-cli.js ${target}`);
  run("pnpm run build");
  run(`vsce package --no-dependencies --target ${target}`);

  console.log(`Done: ${target}\n`);
}

console.log("All done!");
