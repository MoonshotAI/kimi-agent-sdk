import { spawn } from "node:child_process";
import { TransportError, CliError } from "../errors";
import { log } from "../logger";

export interface MCPTestResult {
  success: boolean;
  output: string;
}

export async function authMCP(serverName: string, executable = "kimi"): Promise<void> {
  log.cli("Running MCP auth for: %s", serverName);
  await runCliCommand(executable, ["mcp", "auth", serverName]);
}

export async function resetAuthMCP(serverName: string, executable = "kimi"): Promise<void> {
  log.cli("Running MCP reset-auth for: %s", serverName);
  await runCliCommand(executable, ["mcp", "reset-auth", serverName]);
}

export async function testMCP(serverName: string, executable = "kimi"): Promise<MCPTestResult> {
  log.cli("Running MCP test for: %s", serverName);
  try {
    const output = await runCliCommand(executable, ["mcp", "test", serverName]);
    return { success: true, output };
  } catch (err) {
    return { success: false, output: err instanceof Error ? err.message : String(err) };
  }
}

function runCliCommand(executable: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    log.cli("Executing: %s %o", executable, args);

    const proc = spawn(executable, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data) => (stdout += data.toString()));
    proc.stderr?.on("data", (data) => (stderr += data.toString()));

    proc.on("error", (err) => {
      log.cli("Command error: %O", err);
      reject(new TransportError("CLI_NOT_FOUND", `Failed to run CLI: ${err.message}`, err));
    });

    proc.on("close", (code) => {
      log.cli("Command exited with code: %d", code);
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new CliError("UNKNOWN", stderr.trim() || `CLI exited with code ${code}`, code ?? undefined));
      }
    });
  });
}
