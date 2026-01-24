import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as readline from "node:readline";
import { KimiPaths } from "../paths";
import { log } from "../logger";
import { parseEventPayload, type StreamEvent } from "../schema";

export async function parseSessionEvents(workDir: string, sessionId: string): Promise<StreamEvent[]> {
  const sessionDir = KimiPaths.sessionDir(workDir, sessionId);
  const wireFile = path.join(sessionDir, "wire.jsonl");

  if (!fs.existsSync(wireFile)) {
    log.history("Wire file not found for session: %s", sessionId);
    return [];
  }

  const stat = await fsp.stat(wireFile);
  if (stat.size === 0) {
    log.history("Wire file is empty for session: %s", sessionId);
    return [];
  }

  log.history("Parsing wire file: %s (%d bytes)", wireFile, stat.size);
  return parseWireFile(wireFile);
}

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
