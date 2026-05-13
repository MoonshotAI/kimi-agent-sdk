const { spawn } = require("child_process");
const { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("fs");
const { tmpdir } = require("os");
const { basename, join, relative } = require("path");

const { TARGETS, verifyVsixFiles } = require("./vsix-verify");

const rootDir = join(__dirname, "..");
const binDir = join(rootDir, "bin", "kimi");
const vsceBin = join(rootDir, "node_modules", ".bin", process.platform === "win32" ? "vsce.cmd" : "vsce");

const args = process.argv.slice(2);
const targets = args.length === 0 || args.includes("all") ? TARGETS : args;

for (const target of targets) {
  if (!TARGETS.includes(target)) {
    console.error(`Unknown target: ${target}`);
    console.error(`Expected one of: ${TARGETS.join(", ")}`);
    process.exit(1);
  }
}

const rawConcurrency = Number(process.env.KIMI_VSIX_PACKAGE_CONCURRENCY);
const concurrency = Number.isInteger(rawConcurrency) && rawConcurrency > 0 ? Math.min(rawConcurrency, targets.length) : Math.min(3, targets.length);
const tempRoot = mkdtempSync(join(tmpdir(), "kimi-vscode-package-"));

function runCommand(label, command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (output.trim()) {
        console.log(`\n[${label}] ${basename(command)} ${args.join(" ")}`);
        console.log(output.trim());
      }

      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${label} failed with exit code ${code}`));
      }
    });
  });
}

function copyPackageWorkspace(target) {
  const packageDir = join(tempRoot, target);

  cpSync(rootDir, packageDir, {
    recursive: true,
    filter(src) {
      const rel = relative(rootDir, src);
      if (!rel) return true;

      const first = rel.split(/[\\/]/)[0];
      if (first === "node_modules" || first === "bin" || first === ".git") return false;
      if (first.startsWith(".tmp")) return false;
      if (rel.endsWith(".vsix")) return false;

      return true;
    },
  });

  const manifestPath = join(packageDir, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.scripts) {
    delete manifest.scripts["vscode:prepublish"];
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return packageDir;
}

async function packageTarget(target) {
  const packageDir = copyPackageWorkspace(target);
  const outPath = join(rootDir, `kimi-code-${target}.vsix`);

  rmSync(outPath, { force: true });
  console.log(`Packaging [${target}]...`);

  await runCommand(target, "node", ["scripts/download-cli.js", target], packageDir);
  await runCommand(target, vsceBin, ["package", "--no-dependencies", "--target", target, "--out", outPath], packageDir);

  console.log(`Packaged [${target}] -> ${basename(outPath)}`);
}

async function runLimited(items, limit, worker) {
  const failures = [];
  let next = 0;

  async function runWorker() {
    while (next < items.length && failures.length === 0) {
      const item = items[next++];
      try {
        await worker(item);
      } catch (error) {
        failures.push({ item, error });
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, runWorker));

  if (failures.length > 0) {
    const failure = failures[0];
    throw new Error(`Failed to package ${failure.item}: ${failure.error.message}`);
  }
}

async function main() {
  console.log(`Building for: ${targets.join(", ")}`);
  console.log(`Package concurrency: ${concurrency}`);

  if (existsSync(binDir)) {
    rmSync(binDir, { recursive: true, force: true });
  }

  await runCommand("build", "pnpm", ["run", "build"], rootDir);
  await runLimited(targets, concurrency, packageTarget);

  verifyVsixFiles(rootDir, targets);

  console.log("\n✅ All builds completed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });
