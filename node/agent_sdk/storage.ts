import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as readline from "node:readline";
import { KimiPaths } from "./paths";
import { log } from "./logger";
import type { SessionInfo, ContentPart } from "./schema";

// ============================================================================
// kimi.json & metadata.json helpers
// ============================================================================

function readKimiJson(): { work_dirs?: Array<{ path: string }> } | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(KimiPaths.home, "kimi.json"), "utf-8"));
  } catch {
    return null;
  }
}

function readSessionMetadata(sessionDir: string): { title?: string } | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(sessionDir, "metadata.json"), "utf-8"));
  } catch {
    return null;
  }
}

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

/** Get all workDirs registered under a workspace (from kimi.json) */
export function getRegisteredWorkDirs(workspaceRoot: string): string[] {
  const config = readKimiJson();
  if (!config?.work_dirs) {
    return [workspaceRoot];
  }

  const sep = path.sep;
  const dirs = config.work_dirs
    .map((e) => e.path)
    .filter((p) => p === workspaceRoot || p.startsWith(workspaceRoot + sep));

  return dirs.length > 0 ? dirs : [workspaceRoot];
}

/** List sessions from all registered workDirs under a workspace */
export async function listSessionsForWorkspace(workspaceRoot: string): Promise<SessionInfo[]> {
  const workDirs = getRegisteredWorkDirs(workspaceRoot);
  const allSessions: SessionInfo[] = [];

  for (const workDir of workDirs) {
    const sessions = await listSessions(workDir);
    allSessions.push(...sessions);
  }

  return allSessions.sort((a, b) => b.updatedAt - a.updatedAt);
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

      // Priority: metadata.json > wire.jsonl
      const metadata = readSessionMetadata(sessionDir);
      const brief = metadata?.title || (await getFirstUserMessage(wireFile));
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
 * Truncate wire.jsonl to include only complete turns up to the specified turn index.
 * If the target turn is incomplete (no TurnEnd), it will be discarded to prevent
 * API errors from incomplete tool calls.
 */
async function truncateWireAtTurn(wireFile: string, turnIndex: number): Promise<string[]> {
  const lines: string[] = [];
  let turnCount = 0;
  let lastTurnEndIndex = -1;

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
        if (turnCount > turnIndex) {
          break;
        }
        turnCount++;
      }

      lines.push(line);

      // Track the last TurnEnd position
      if (messageType === "TurnEnd" && turnCount === turnIndex + 1) {
        lastTurnEndIndex = lines.length;
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

  // If target turn completed normally, return all lines
  if (lastTurnEndIndex > 0) {
    return lines.slice(0, lastTurnEndIndex);
  }

  // Target turn is incomplete - find the last complete turn
  // Scan backwards for the last TurnEnd
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const record = JSON.parse(lines[i]);
      if (record.message?.type === "TurnEnd") {
        log.storage("Target turn incomplete, truncating to last complete turn");
        return lines.slice(0, i + 1);
      }
    } catch {
      continue;
    }
  }

  // No complete turn found - return empty or just the first TurnBegin
  // to allow user to continue from scratch
  log.storage("No complete turn found in session");
  return [];
}

/**
 * Truncate context.jsonl to include only messages up to and including the specified turn.
 * If the last assistant message has incomplete tool_calls, it will be removed.
 */
async function truncateContextAtTurn(contextFile: string, turnIndex: number): Promise<string[]> {
  const lines: string[] = [];
  let userMessageCount = 0;

  const stream = fs.createReadStream(contextFile, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }

    try {
      const record = JSON.parse(line);
      const role = record.role;

      // Always include markers
      if (role === "_checkpoint" || role === "_usage") {
        lines.push(line);
        continue;
      }

      if (role === "user") {
        if (userMessageCount > turnIndex) {
          break;
        }
        userMessageCount++;
      } else if (role === "assistant" && userMessageCount > turnIndex + 1) {
        break;
      }

      lines.push(line);
    } catch {
      lines.push(line);
    }
  }

  rl.close();
  stream.destroy();

  // Check if last assistant has incomplete tool_calls
  return removeIncompleteToolCalls(lines);
}

/**
 * Remove assistant messages with incomplete tool_calls (missing tool responses).
 */
function removeIncompleteToolCalls(lines: string[]): string[] {
  // Collect tool_call IDs from assistant messages and tool responses
  const expectedIds = new Set<string>();
  const receivedIds = new Set<string>();
  const assistantIndicesWithToolCalls: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    try {
      const record = JSON.parse(lines[i]);
      if (record.role === "assistant" && Array.isArray(record.tool_calls)) {
        for (const tc of record.tool_calls) {
          if (tc.id) expectedIds.add(tc.id);
        }
        if (record.tool_calls.length > 0) {
          assistantIndicesWithToolCalls.push(i);
        }
      } else if (record.role === "tool" && record.tool_call_id) {
        receivedIds.add(record.tool_call_id);
      }
    } catch {
      continue;
    }
  }

  // Check if all tool_calls have responses
  const hasIncomplete = [...expectedIds].some((id) => !receivedIds.has(id));
  if (!hasIncomplete) {
    return lines;
  }

  // Find the last assistant with incomplete tool_calls and truncate before it
  for (let i = assistantIndicesWithToolCalls.length - 1; i >= 0; i--) {
    const idx = assistantIndicesWithToolCalls[i];
    try {
      const record = JSON.parse(lines[idx]);
      const ids = (record.tool_calls || []).map((tc: { id?: string }) => tc.id).filter(Boolean);
      const incomplete = ids.some((id: string) => !receivedIds.has(id));
      if (incomplete) {
        log.storage("Removing incomplete assistant message at index %d", idx);
        // Keep lines before this assistant, plus any markers after
        const before = lines.slice(0, idx);
        const after = lines.slice(idx + 1).filter((l) => {
          try {
            const r = JSON.parse(l);
            return r.role === "_checkpoint" || r.role === "_usage";
          } catch {
            return false;
          }
        });
        return [...before, ...after];
      }
    } catch {
      continue;
    }
  }

  return lines;
}
