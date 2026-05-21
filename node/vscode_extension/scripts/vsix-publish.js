#!/usr/bin/env node
const { spawnSync } = require("child_process");
const path = require("path");

const { TARGETS, getVsixFile, verifyVsixFiles } = require("./vsix-verify");

const rootDir = path.join(__dirname, "..");
const VSIX_FILES = TARGETS.map(getVsixFile);

if (!process.env.VSCE_PAT) {
  console.error("Error: VSCE_PAT environment variable not set");
  console.error("Get your token from: https://dev.azure.com");
  process.exit(1);
}

try {
  verifyVsixFiles(rootDir, TARGETS);
} catch (error) {
  console.error(error.message);
  console.error("Run `rm -f *.vsix && pnpm run package:platform` first.");
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
