#!/usr/bin/env node

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..");

// vsce generates: {name}-{target}-{version}.vsix
// e.g., kimi-code-darwin-arm64-0.0.8.vsix
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
    execSync(`vsce publish --packagePath "${filePath}"`, {
      cwd: rootDir,
      stdio: "inherit",
    });
    console.log(`✓ Published: ${file}\n`);
  } catch (err) {
    console.error(`✗ Failed to publish: ${file}`);
    process.exit(1);
  }
}

console.log("\nAll done!");
