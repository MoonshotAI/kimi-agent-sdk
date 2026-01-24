import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { TransportError, CliError } from "../errors";
import { log } from "../logger";

export interface MCPTestResult {
  success: boolean;
  output: string;
}

export interface LoginResult {
  success: boolean;
  error?: string;
}

export interface LoginCallbacks {
  onUrl?: (url: string) => void;
}

interface RunOptions {
  onLine?: (line: string) => void;
}

const handleError = (err: unknown): LoginResult => ({
  success: false,
  error: err instanceof Error ? err.message : String(err),
});

export async function authMCP(serverName: string, executable = "kimi"): Promise<void> {
  log.cli("Running MCP auth for: %s", serverName);
  await runCliCommand(executable, ["mcp", "auth", serverName]);
}

export async function resetAuthMCP(serverName: string, executable = "kimi"): Promise<void> {
  log.cli("Running MCP reset-auth for: %s", serverName);
  await runCliCommand(executable, ["mcp", "reset-auth", serverName]);
}

export function testMCP(serverName: string, executable = "kimi"): Promise<MCPTestResult> {
  log.cli("Running MCP test for: %s", serverName);
  return runCliCommand(executable, ["mcp", "test", serverName])
    .then((output) => ({ success: true, output }))
    .catch((err) => ({
      success: false,
      output: err instanceof Error ? err.message : String(err),
    }));
}

export function login(executable = "kimi", callbacks?: LoginCallbacks): Promise<LoginResult> {
  log.cli("Running login --json");
  return runCliCommand(executable, ["login", "--json"], {
    onLine: (line) => {
      try {
        const msg = JSON.parse(line);
        if (msg.type === "verification_url" && msg.data?.verification_url) {
          callbacks?.onUrl?.(msg.data.verification_url);
        }
      } catch {
        /** Ignore non-JSON lines */
      }
    },
  })
    .then(() => ({ success: true }))
    .catch(handleError);
}

export function logout(executable = "kimi"): Promise<LoginResult> {
  log.cli("Running logout");
  return runCliCommand(executable, ["logout"])
    .then(() => ({ success: true }))
    .catch(handleError);
}

function runCliCommand(executable: string, args: string[], options: RunOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    log.cli("Executing: %s %o", executable, args);
    const proc = spawn(executable, args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NO_COLOR: "1" } });

    let stdout = "";
    let stderr = "";

    const rl = createInterface({ input: proc.stdout!, terminal: false });

    rl.on("line", (line) => {
      stdout += line + "\n";
      if (line.trim() && options.onLine) {
        log.cli("cli stdout: %s", line);
        options.onLine(line);
      }
    });

    proc.stderr?.on("data", (data) => {
      const chunk = data.toString();
      stderr += chunk;
      if (chunk.trim()) {
        log.cli("cli stderr: %s", chunk.trim());
      }
    });

    proc.on("error", (err) => {
      log.cli("Command error: %O", err);
      reject(new TransportError("CLI_NOT_FOUND", `Failed to run CLI: ${err.message}`, err));
    });

    proc.on("close", (code) => {
      log.cli("Command exited with code: %d", code);
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        const errorMessage = stderr.trim() || stdout.trim() || `CLI exited with code ${code}`;
        reject(new CliError("UNKNOWN", errorMessage, code ?? undefined));
      }
    });
  });
}
