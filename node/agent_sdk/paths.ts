import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";

const KIMI_HOME = path.join(os.homedir(), ".kimi");

function hashPath(workDir: string): string {
  return crypto.createHash("md5").update(workDir, "utf-8").digest("hex");
}

export const KimiPaths = {
  home: KIMI_HOME,
  config: path.join(KIMI_HOME, "config.toml"),
  mcpConfig: path.join(KIMI_HOME, "mcp.json"),

  sessionsDir(workDir: string): string {
    return path.join(KIMI_HOME, "sessions", hashPath(workDir));
  },

  sessionDir(workDir: string, sessionId: string): string {
    return path.join(KIMI_HOME, "sessions", hashPath(workDir), sessionId);
  },

  baselineDir(workDir: string, sessionId: string): string {
    return path.join(KIMI_HOME, "sessions", hashPath(workDir), sessionId, "baseline");
  },
};
