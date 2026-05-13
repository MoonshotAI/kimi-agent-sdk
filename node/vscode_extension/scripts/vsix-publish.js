#!/usr/bin/env node
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..");
const VSIX_FILES = [
  "kimi-code-darwin-arm64.vsix",
  "kimi-code-darwin-x64.vsix",
  "kimi-code-linux-arm64.vsix",
  "kimi-code-linux-x64.vsix",
  "kimi-code-win32-arm64.vsix",
  "kimi-code-win32-x64.vsix",
];

if (!process.env.VSCE_PAT) {
  console.error("Error: VSCE_PAT environment variable not set");
  console.error("Get your token from: https://dev.azure.com");
  process.exit(1);
}

const missing = VSIX_FILES.filter((f) => !fs.existsSync(path.join(rootDir, f)));
if (missing.length > 0) {
  console.error("Missing expected .vsix file(s):");
  missing.forEach((f) => console.error(`  - ${f}`));
  console.error("Run `pnpm run package:platform` first.");
  process.exit(1);
}

console.log(`Found ${VSIX_FILES.length} vsix file(s) to publish:\n`);
VSIX_FILES.forEach((f) => console.log(`  - ${f}`));
console.log();

let failed = false;

for (const file of VSIX_FILES) {
  const filePath = path.join(rootDir, file);
  console.log(`\n========== Publishing ${file} ==========\n`);

  const result = spawnSync("npx", ["-y", "@vscode/vsce", "publish", "--packagePath", filePath], {
    cwd: rootDir,
    encoding: "utf8",
    env: process.env,
  });

  const output = `${result.stdout || ""}${result.stderr || ""}`;
  if (output) {
    process.stdout.write(output);
  }

  if (result.status !== 0) {
    if (/already exists/i.test(output)) {
      console.log(`Already published: ${file}`);
      continue;
    }

    console.error(`✗ Failed to publish: ${file}`);
    failed = true;
    continue;
  }

  console.log(`✓ Published: ${file}\n`);
}

if (failed) {
  process.exit(1);
}

console.log("\nAll done!");
