import { spawn } from "node:child_process";
import { TransportError, CliError } from "../errors";

export interface MCPTestResult {
  success: boolean;
  output: string;
}

export async function authMCP(serverName: string, executable = "kimi"): Promise<void> {
  await runCliCommand(executable, ["mcp", "auth", serverName]);
}

export async function resetAuthMCP(serverName: string, executable = "kimi"): Promise<void> {
  await runCliCommand(executable, ["mcp", "reset-auth", serverName]);
}

export async function testMCP(serverName: string, executable = "kimi"): Promise<MCPTestResult> {
  try {
    const output = await runCliCommand(executable, ["mcp", "test", serverName]);
    return { success: true, output };
  } catch (err) {
    return { success: false, output: err instanceof Error ? err.message : String(err) };
  }
}

function runCliCommand(executable: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(executable, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data) => (stdout += data.toString()));
    proc.stderr?.on("data", (data) => (stderr += data.toString()));

    proc.on("error", (err) => {
      reject(new TransportError("CLI_NOT_FOUND", `Failed to run CLI: ${err.message}`, err));
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new CliError("UNKNOWN", stderr.trim() || `CLI exited with code ${code}`, code ?? undefined));
      }
    });
  });
}
