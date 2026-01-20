import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as readline from "node:readline";
import { KimiPaths } from "../paths";
import { log } from "../logger";
import { parseEventPayload, type StreamEvent, type WireEvent } from "../schema";

// Constants
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

// Parse Session Events
export async function parseSessionEvents(workDir: string, sessionId: string): Promise<StreamEvent[]> {
  const sessionDir = KimiPaths.sessionDir(workDir, sessionId);
  const wireFile = path.join(sessionDir, "wire.jsonl");
  const contextFile = path.join(sessionDir, "context.jsonl");

  // Prefer wire.jsonl if it exists and is not too large
  if (fs.existsSync(wireFile)) {
    const stat = await fsp.stat(wireFile);
    if (stat.size <= MAX_FILE_SIZE) {
      log.history("Parsing wire file: %s (%d bytes)", wireFile, stat.size);
      return parseWireFile(wireFile);
    }
    log.history("Wire file too large (%d bytes), falling back to context", stat.size);
  }

  // Fallback to context.jsonl (compacted)
  if (fs.existsSync(contextFile)) {
    log.history("Parsing context file: %s", contextFile);
    return parseContextFile(contextFile);
  }

  log.history("No history files found for session: %s", sessionId);
  return [];
}

// Wire File Parser
async function parseWireFile(filePath: string): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];

  const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }

    try {
      const record = JSON.parse(line);
      const event = parseWireRecord(record);
      if (event) {
        events.push(event);
      }
    } catch {
      // Skip invalid lines
    }
  }

  log.history("Parsed %d events from wire file", events.length);
  return events;
}

function parseWireRecord(record: unknown): StreamEvent | null {
  if (!record || typeof record !== "object") {
    return null;
  }

  const rec = record as Record<string, unknown>;
  const message = rec.message as { type?: string; payload?: unknown } | undefined;

  if (!message?.type) {
    return null;
  }

  const result = parseEventPayload(message.type, message.payload);
  return result.ok ? result.value : null;
}

// Context File Parser
async function parseContextFile(filePath: string): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];

  const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }

    try {
      const record = JSON.parse(line);
      const converted = convertContextRecord(record);
      events.push(...converted);
    } catch {
      // Skip invalid lines
    }
  }

  log.history("Parsed %d events from context file", events.length);
  return events;
}

function convertContextRecord(record: unknown): WireEvent[] {
  if (!record || typeof record !== "object") {
    return [];
  }

  const rec = record as Record<string, unknown>;
  const events: WireEvent[] = [];

  // Convert role-based context records to events
  if (rec.role === "user" && rec.content) {
    events.push({
      type: "TurnBegin",
      payload: { user_input: rec.content as string },
    });
  }

  if (rec.role === "assistant" && rec.content) {
    const content = rec.content;
    if (typeof content === "string") {
      events.push({
        type: "ContentPart",
        payload: { type: "text", text: content },
      });
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (part && typeof part === "object" && "type" in part) {
          const result = parseEventPayload("ContentPart", part);
          if (result.ok) {
            events.push(result.value);
          }
        }
      }
    }
  }

  // Handle tool calls
  if (rec.tool_calls && Array.isArray(rec.tool_calls)) {
    for (const call of rec.tool_calls) {
      if (call && typeof call === "object") {
        const tc = call as Record<string, unknown>;
        const fn = tc.function as Record<string, unknown> | undefined;
        if (tc.id && fn?.name) {
          events.push({
            type: "ToolCall",
            payload: {
              type: "function",
              id: tc.id as string,
              function: {
                name: fn.name as string,
                arguments: fn.arguments as string | undefined,
              },
            },
          });
        }
      }
    }
  }

  return events;
}
