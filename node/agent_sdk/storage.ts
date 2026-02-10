import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as readline from "node:readline";
import { KimiPaths } from "./paths";
import { log } from "./logger";
import type { SessionInfo, ContentPart } from "./schema";

// Constants
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Fork Session Types
export interface ForkSessionOptions {
  workDir: string;
  sourceSessionId: string;
  /** 0-indexed turn number to fork after (0 = after first turn) */
  turnIndex: number;
}

export interface ForkSessionResult {
  sessionId: string;
  sessionDir: string;
}

// List Sessions (Async)
export async function listSessions(workDir: string): Promise<SessionInfo[]> {
  const sessionsDir = KimiPaths.sessionsDir(workDir);

  try {
    await fsp.access(sessionsDir);
  } catch {
    return [];
  }

  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(sessionsDir, { withFileTypes: true });
  } catch (err) {
    console.warn("[storage] Failed to read sessions:", err);
    return [];
  }

  const sessions: SessionInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !UUID_REGEX.test(entry.name)) {
      continue;
    }

    const sessionId = entry.name;
    const sessionDir = path.join(sessionsDir, sessionId);
    const wireFile = path.join(sessionDir, "wire.jsonl");

    if (!fs.existsSync(wireFile)) {
      continue;
    }

    try {
      const stat = await fsp.stat(wireFile);
      if (stat.size === 0) {
        continue;
      }

      const brief = await getFirstUserMessage(wireFile);
      if (!brief) {
        continue;
      }

      sessions.push({
        id: sessionId,
        workDir,
        contextFile: wireFile,
        updatedAt: stat.mtimeMs,
        brief,
      });
    } catch (err) {
      log.storage("Failed to stat session %s: %O", sessionId, err);
    }
  }

  return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
}

// Delete Session
export async function deleteSession(workDir: string, sessionId: string): Promise<boolean> {
  const sessionDir = path.join(KimiPaths.sessionsDir(workDir), sessionId);

  try {
    await fsp.access(sessionDir);
  } catch {
    return false;
  }

  try {
    await fsp.rm(sessionDir, { recursive: true, force: true });
    log.storage("Deleted session %s", sessionId);
    return true;
  } catch (err) {
    log.storage("Failed to delete session %s: %O", sessionId, err);
    return false;
  }
}

// Get First User Message (Stream-based, early exit)
async function getFirstUserMessage(wireFile: string): Promise<string> {
  try {
    const stream = fs.createReadStream(wireFile, { encoding: "utf-8" });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of rl) {
      if (!line.trim()) {
        continue;
      }

      try {
        const record = JSON.parse(line);
        if (record.message?.type !== "TurnBegin") {
          continue;
        }

        const userInput = record.message.payload?.user_input;
        const text = extractUserText(userInput);
        if (text) {
          rl.close();
          stream.destroy();
          return text;
        }
      } catch {
        continue;
      }
    }
  } catch (err) {
    log.storage("Failed to read wire file: %O", err);
  }

  return "";
}

// Text Extraction Helpers
function extractUserText(userInput: unknown): string {
  if (typeof userInput === "string") {
    return stripFileTags(userInput);
  }

  if (Array.isArray(userInput)) {
    const textParts = (userInput as ContentPart[]).filter((p): p is ContentPart & { type: "text" } => p.type === "text").map((p) => p.text);
    return stripFileTags(textParts.join("\n"));
  }

  return "";
}

function stripFileTags(text: string): string {
  return text
    .replace(/<uploaded_files>[\s\S]*?<\/uploaded_files>\s*/g, "")
    .replace(/<document[^>]*>[\s\S]*?<\/document>\s*/g, "")
    .replace(/<image[^>]*>[\s\S]*?<\/image>\s*/g, "")
    .trim();
}

// Fork Session
export async function forkSession(options: ForkSessionOptions): Promise<ForkSessionResult> {
  const { workDir, sourceSessionId, turnIndex } = options;

  if (!UUID_REGEX.test(sourceSessionId)) {
    throw new Error(`Invalid session ID: ${sourceSessionId}`);
  }

  if (turnIndex < 0) {
    throw new Error(`Invalid turn index: ${turnIndex}`);
  }

  const sourceDir = KimiPaths.sessionDir(workDir, sourceSessionId);
  const sourceWireFile = path.join(sourceDir, "wire.jsonl");
  const sourceContextFile = path.join(sourceDir, "context.jsonl");

  // Verify source session exists
  try {
    await fsp.access(sourceWireFile);
  } catch {
    throw new Error(`Source session not found: ${sourceSessionId}`);
  }

  // Create new session
  const newSessionId = crypto.randomUUID();
  const newSessionDir = KimiPaths.sessionDir(workDir, newSessionId);

  await fsp.mkdir(newSessionDir, { recursive: true });

  // Truncate wire.jsonl at the specified turn
  const wireLines = await truncateWireAtTurn(sourceWireFile, turnIndex);
  if (wireLines.length === 0) {
    await fsp.rm(newSessionDir, { recursive: true, force: true });
    throw new Error(`Turn ${turnIndex} not found in session`);
  }

  await fsp.writeFile(path.join(newSessionDir, "wire.jsonl"), wireLines.join("\n") + "\n");

  // Truncate context.jsonl if it exists
  try {
    await fsp.access(sourceContextFile);
    const contextLines = await truncateContextAtTurn(sourceContextFile, turnIndex);
    if (contextLines.length > 0) {
      await fsp.writeFile(path.join(newSessionDir, "context.jsonl"), contextLines.join("\n") + "\n");
    }
  } catch {
    // context.jsonl doesn't exist or is empty, that's fine
  }

  log.storage("Forked session %s -> %s at turn %d", sourceSessionId, newSessionId, turnIndex);

  return {
    sessionId: newSessionId,
    sessionDir: newSessionDir,
  };
}

/**
 * Truncate wire.jsonl to include only events up to and including the specified turn.
 */
async function truncateWireAtTurn(wireFile: string, turnIndex: number): Promise<string[]> {
  const lines: string[] = [];
  let turnCount = 0;
  let inTargetTurn = false;

  const stream = fs.createReadStream(wireFile, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }

    try {
      const record = JSON.parse(line);
      const messageType = record.message?.type;

      if (messageType === "TurnBegin") {
        if (turnCount === turnIndex) {
          inTargetTurn = true;
        } else if (turnCount > turnIndex) {
          break;
        }
        turnCount++;
      }

      lines.push(line);

      if (messageType === "TurnEnd" && inTargetTurn) {
        break;
      }
    } catch {
      if (turnCount > 0 && turnCount <= turnIndex + 1) {
        lines.push(line);
      }
    }
  }

  rl.close();
  stream.destroy();

  return lines;
}

/**
 * Truncate context.jsonl to include only messages up to and including the specified turn.
 */
async function truncateContextAtTurn(contextFile: string, turnIndex: number): Promise<string[]> {
  const lines: string[] = [];
  let userMessageCount = 0;
  let lastAssistantLineIndex = -1;

  const stream = fs.createReadStream(contextFile, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }

    try {
      const record = JSON.parse(line);
      const role = record.role;

      if (role === "_checkpoint" || role === "_usage") {
        lines.push(line);
        continue;
      }

      if (role === "user") {
        if (userMessageCount > turnIndex) {
          break;
        }
        userMessageCount++;
        lines.push(line);
      } else if (role === "assistant") {
        if (userMessageCount > turnIndex + 1) {
          break;
        }
        lines.push(line);
        lastAssistantLineIndex = lines.length - 1;
      } else {
        lines.push(line);
      }
    } catch {
      lines.push(line);
    }
  }

  rl.close();
  stream.destroy();

  if (lastAssistantLineIndex >= 0 && lastAssistantLineIndex < lines.length - 1) {
    const trailingLines = lines.slice(lastAssistantLineIndex + 1);
    const hasNonMarkerTrailing = trailingLines.some((l) => {
      try {
        const r = JSON.parse(l);
        return r.role !== "_checkpoint" && r.role !== "_usage";
      } catch {
        return true;
      }
    });

    if (hasNonMarkerTrailing) {
      return lines.slice(0, lastAssistantLineIndex + 1).concat(
        trailingLines.filter((l) => {
          try {
            const r = JSON.parse(l);
            return r.role === "_checkpoint" || r.role === "_usage";
          } catch {
            return false;
          }
        }),
      );
    }
  }

  return lines;
}
