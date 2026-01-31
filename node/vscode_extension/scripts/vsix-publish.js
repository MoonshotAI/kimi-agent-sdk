#!/usr/bin/env node
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..");

if (!process.env.VSCE_PAT) {
  console.error("Error: VSCE_PAT environment variable not set");
  console.error("Get your token from: https://dev.azure.com");
  process.exit(1);
}

const vsixFiles = fs
  .readdirSync(rootDir)
  .filter((f) => f.endsWith(".vsix"))
  .sort();

if (vsixFiles.length === 0) {
  console.error("No .vsix files found in", rootDir);
  console.error("Run `pnpm run package:platform all` first.");
  process.exit(1);
}

console.log(`Found ${vsixFiles.length} vsix file(s) to publish:\n`);
vsixFiles.forEach((f) => console.log(`  - ${f}`));
console.log();

for (const file of vsixFiles) {
  const filePath = path.join(rootDir, file);
  console.log(`\n========== Publishing ${file} ==========\n`);
  try {
    execFileSync("npx", ["-y", "vsce", "publish", "--packagePath", filePath, "-p", process.env.VSCE_PAT], {
      cwd: rootDir,
      stdio: "inherit",
    });
    console.log(`✓ Published: ${file}\n`);
  } catch (err) {
    console.error(`✗ Failed to publish: ${file}, error:`, err);
  }
}

console.log("\nAll done!");
