import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";

function hashPath(workDir: string): string {
  return crypto.createHash("md5").update(workDir, "utf-8").digest("hex");
}

export interface KimiPathsType {
  home: string;
  config: string;
  mcpConfig: string;
  sessionsDir(workDir: string): string;
  sessionDir(workDir: string, sessionId: string): string;
  baselineDir(workDir: string, sessionId: string): string;
}

/** Create a KimiPaths object with custom shareDir */
export function createKimiPaths(shareDir?: string): KimiPathsType {
  const home = shareDir || process.env.KIMI_SHARE_DIR || path.join(os.homedir(), ".kimi");
  return {
    home,
    config: path.join(home, "config.toml"),
    mcpConfig: path.join(home, "mcp.json"),
    sessionsDir(workDir: string): string {
      return path.join(home, "sessions", hashPath(workDir));
    },
    sessionDir(workDir: string, sessionId: string): string {
      return path.join(home, "sessions", hashPath(workDir), sessionId);
    },
    baselineDir(workDir: string, sessionId: string): string {
      return path.join(home, "sessions", hashPath(workDir), sessionId, "baseline");
    },
  };
}

/** Default KimiPaths using KIMI_SHARE_DIR env or ~/.kimi */
export const KimiPaths = createKimiPaths();
