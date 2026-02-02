const { execSync } = require("child_process");
const { rmSync, existsSync } = require("fs");
const { join } = require("path");

const ALL_TARGETS = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-x64"];

// Use provided args or fallback to all targets
const args = process.argv.slice(2);
const targets = args.length > 0 ? args : ALL_TARGETS;

const rootDir = join(__dirname, "..");
const binDir = join(rootDir, "bin", "kimi");

console.log(`Building for: ${targets.join(", ")}`);

for (const target of targets) {
  console.log(`Packaging [${target}]...`);

  try {
    // 1. Clean previous binary to prevent mixing architectures
    if (existsSync(binDir)) {
      rmSync(binDir, { recursive: true, force: true });
    }

    // 2. Download CLI binary for specific target
    execSync(`node scripts/download-cli.js ${target}`, {
      cwd: rootDir,
      stdio: "inherit",
    });

    // 3. Package extension
    execSync(`npx vsce package --target ${target} --out kimi-code-${target}.vsix`, {
      cwd: rootDir,
      stdio: "inherit",
    });
  } catch (e) {
    console.error(`❌ Failed to build for ${target}`);
    process.exit(1);
  }
}

console.log("\n✅ All builds completed.");
