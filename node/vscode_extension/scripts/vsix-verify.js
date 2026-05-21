const { execFileSync } = require("child_process");
const fs = require("fs");
const { tmpdir } = require("os");
const path = require("path");

const TARGETS = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-x64", "win32-arm64"];
const REQUIRED_DIST_FILES = ["extension/dist/extension.js", "extension/dist/webview.js"];

function getVsixFile(target) {
  return `kimi-code-${target}.vsix`;
}

function getArchivePath(target) {
  return target.startsWith("win32-") ? "extension/bin/kimi/archive.zip" : "extension/bin/kimi/archive.tar.gz";
}

function readZipEntry(filePath, entry) {
  try {
    return execFileSync("unzip", ["-p", filePath, entry], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new Error(`Missing or unreadable ${entry}`);
  }
}

function assertZipEntry(filePath, entry) {
  try {
    execFileSync("unzip", ["-l", filePath, entry], {
      stdio: ["ignore", "ignore", "pipe"],
    });
  } catch {
    throw new Error(`Missing ${entry}`);
  }
}

function findFile(rootDir, fileName) {
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(entryPath, fileName);
      if (found) return found;
    } else if (entry.isFile() && entry.name === fileName) {
      return entryPath;
    }
  }
  return null;
}

function verifyCliArchive(filePath, target, archive) {
  const tempDir = fs.mkdtempSync(path.join(tmpdir(), "kimi-vsix-verify-"));
  try {
    const vsixDir = path.join(tempDir, "vsix");
    const cliDir = path.join(tempDir, "cli");
    fs.mkdirSync(vsixDir, { recursive: true });
    fs.mkdirSync(cliDir, { recursive: true });

    try {
      execFileSync("unzip", ["-q", filePath, archive, "-d", vsixDir], {
        stdio: ["ignore", "ignore", "pipe"],
      });
    } catch {
      throw new Error(`Unable to extract ${archive} from VSIX`);
    }

    const archivePath = path.join(vsixDir, archive);
    try {
      if (target.startsWith("win32-")) {
        execFileSync("unzip", ["-q", archivePath, "-d", cliDir], {
          stdio: ["ignore", "ignore", "pipe"],
        });
      } else {
        execFileSync("tar", ["-xzf", archivePath, "-C", cliDir], {
          stdio: ["ignore", "ignore", "pipe"],
        });
      }
    } catch {
      throw new Error(`Unable to extract bundled CLI archive ${archive}`);
    }

    const executableName = target.startsWith("win32-") ? "kimi.exe" : "kimi";
    const executablePath = findFile(cliDir, executableName);
    if (!executablePath) {
      throw new Error(`Bundled CLI archive is missing ${executableName}`);
    }
    if (!target.startsWith("win32-") && (fs.statSync(executablePath).mode & 0o111) === 0) {
      throw new Error(`Bundled CLI executable is not executable: ${executableName}`);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function readJsonEntry(filePath, entry) {
  const content = readZipEntry(filePath, entry);
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`${entry} is not valid JSON: ${error.message}`);
  }
}

function verifyVsixFiles(rootDir, targets = TARGETS) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
  const expectedExtensionVersion = packageJson.version;
  const failures = [];
  const lines = [];
  let expectedCliVersion = "";

  for (const target of targets) {
    const file = getVsixFile(target);
    const filePath = path.join(rootDir, file);
    const archive = getArchivePath(target);

    try {
      if (!fs.existsSync(filePath)) {
        throw new Error("file does not exist");
      }

      const bundledPackage = readJsonEntry(filePath, "extension/package.json");
      if (bundledPackage.version !== expectedExtensionVersion) {
        throw new Error(`extension version is ${bundledPackage.version}, expected ${expectedExtensionVersion}`);
      }

      const manifest = readJsonEntry(filePath, "extension/bin/kimi/manifest.json");
      const cliVersion = manifest.version;
      const tag = String(manifest.tag || "");
      const bundledPlatform = manifest.bundledPlatform;
      const asset = manifest.platforms && manifest.platforms[target];

      if (!cliVersion) {
        throw new Error("CLI manifest version is missing");
      }
      if (tag.replace(/^v/, "") !== cliVersion) {
        throw new Error(`CLI tag is ${tag}, expected ${cliVersion} or v${cliVersion}`);
      }
      if (bundledPlatform !== target) {
        throw new Error(`bundledPlatform is ${bundledPlatform}, expected ${target}`);
      }
      if (!asset) {
        throw new Error(`platforms.${target} is missing`);
      }
      if (target.startsWith("win32-") && !String(asset.filename || "").endsWith(".zip")) {
        throw new Error(`Windows asset should be .zip, got ${asset.filename}`);
      }
      if (!target.startsWith("win32-") && !String(asset.filename || "").endsWith(".tar.gz")) {
        throw new Error(`Non-Windows asset should be .tar.gz, got ${asset.filename}`);
      }

      assertZipEntry(filePath, archive);
      for (const entry of REQUIRED_DIST_FILES) {
        assertZipEntry(filePath, entry);
      }
      verifyCliArchive(filePath, target, archive);

      if (!expectedCliVersion) {
        expectedCliVersion = cliVersion;
      } else if (cliVersion !== expectedCliVersion) {
        throw new Error(`CLI version is ${cliVersion}, expected ${expectedCliVersion}`);
      }

      lines.push(`${file}: extension ${bundledPackage.version}, CLI ${cliVersion}, ${target}, extension.js/webview.js OK, archive extracts OK`);
    } catch (error) {
      failures.push(`${file}: ${error.message}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`VSIX verification failed:\n${failures.map((failure) => `  - ${failure}`).join("\n")}`);
  }

  console.log("\nVerified VSIX packages:");
  lines.forEach((line) => console.log(`  - ${line}`));

  return { extensionVersion: expectedExtensionVersion, cliVersion: expectedCliVersion };
}

module.exports = {
  TARGETS,
  getVsixFile,
  verifyVsixFiles,
};

if (require.main === module) {
  const rootDir = path.join(__dirname, "..");
  const args = process.argv.slice(2);
  const targets = args.length === 0 || args.includes("all") ? TARGETS : args;

  for (const target of targets) {
    if (!TARGETS.includes(target)) {
      console.error(`Unknown target: ${target}`);
      console.error(`Expected one of: ${TARGETS.join(", ")}`);
      process.exit(1);
    }
  }

  try {
    const { extensionVersion, cliVersion } = verifyVsixFiles(rootDir, targets);

    if (process.env.GITHUB_OUTPUT) {
      const artifactName = `kimi-code-vsix-${extensionVersion}-cli-${cliVersion}`;
      fs.appendFileSync(
        process.env.GITHUB_OUTPUT,
        `expected_cli_version=${cliVersion}\nartifact_name=${artifactName}\n`,
      );
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
