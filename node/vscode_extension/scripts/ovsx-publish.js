#!/usr/bin/env node
const { spawnSync } = require("child_process");
const path = require("path");

const { TARGETS, getVsixFile, verifyVsixFiles } = require("./vsix-verify");

const rootDir = path.join(__dirname, "..");
const VSIX_FILES = TARGETS.map(getVsixFile);

if (!process.env.OVSX_PAT) {
  console.error("Error: OVSX_PAT environment variable not set");
  console.error("Get your token from: https://open-vsx.org/user-settings/tokens");
  process.exit(1);
}

try {
  verifyVsixFiles(rootDir, TARGETS);
} catch (error) {
  console.error(error.message);
  console.error("Run `rm -f *.vsix && pnpm run package:platform` first.");
  process.exit(1);
}

console.log(`Found ${VSIX_FILES.length} vsix file(s) to publish to OpenVSX:\n`);
VSIX_FILES.forEach((f) => console.log(`  - ${f}`));
console.log();

let failed = false;

for (const file of VSIX_FILES) {
  const filePath = path.join(rootDir, file);
  console.log(`\n========== Publishing ${file} to OpenVSX ==========\n`);

  const result = spawnSync("npx", ["-y", "ovsx", "publish", filePath], {
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
