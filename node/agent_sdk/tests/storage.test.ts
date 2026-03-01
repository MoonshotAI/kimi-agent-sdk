import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";

describe("forkSession", () => {
  let tempDir: string;
  let workDir: string;
  let sourceSessionId: string;

  function getSessionDir(workDir: string, sessionId: string): string {
    const hash = crypto.createHash("md5").update(workDir, "utf-8").digest("hex");
    return path.join(tempDir, "sessions", hash, sessionId);
  }

  let originalEnv: string | undefined;

  beforeAll(() => {
    originalEnv = process.env.KIMI_SHARE_DIR;
  });

  afterAll(() => {
    if (originalEnv !== undefined) {
      process.env.KIMI_SHARE_DIR = originalEnv;
    } else {
      delete process.env.KIMI_SHARE_DIR;
    }
  });

  beforeEach(async () => {
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "kimi-test-"));
    process.env.KIMI_SHARE_DIR = tempDir;
    vi.resetModules();

    workDir = path.join(tempDir, "project");
    await fsp.mkdir(workDir, { recursive: true });
    sourceSessionId = crypto.randomUUID();

    const sessionDir = getSessionDir(workDir, sourceSessionId);
    await fsp.mkdir(sessionDir, { recursive: true });
  });

  afterEach(async () => {
    if (tempDir) {
      await fsp.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("should fork a complete session with TurnEnd", async () => {
    const { forkSession } = await import("../storage");
    const sessionDir = getSessionDir(workDir, sourceSessionId);

    const wireContent = [
      JSON.stringify({ message: { type: "TurnBegin", payload: { user_input: "Hello" } } }),
      JSON.stringify({ message: { type: "ContentPart", payload: { type: "text", text: "Hi!" } } }),
      JSON.stringify({ message: { type: "TurnEnd", payload: {} } }),
    ].join("\n") + "\n";

    await fsp.writeFile(path.join(sessionDir, "wire.jsonl"), wireContent);

    const result = await forkSession({ workDir, sourceSessionId, turnIndex: 0 });

    const forkedWire = await fsp.readFile(path.join(result.sessionDir, "wire.jsonl"), "utf-8");
    const lines = forkedWire.trim().split("\n");
    expect(lines.length).toBe(3);
  });

  it("should discard incomplete turn (no TurnEnd) and keep previous complete turn", async () => {
    const { forkSession } = await import("../storage");
    const sessionDir = getSessionDir(workDir, sourceSessionId);

    // Turn 0: complete, Turn 1: incomplete (has ToolCall but no TurnEnd)
    const wireContent = [
      // Turn 0 - complete
      JSON.stringify({ message: { type: "TurnBegin", payload: { user_input: "Hello" } } }),
      JSON.stringify({ message: { type: "ContentPart", payload: { type: "text", text: "Hi!" } } }),
      JSON.stringify({ message: { type: "TurnEnd", payload: {} } }),
      // Turn 1 - incomplete
      JSON.stringify({ message: { type: "TurnBegin", payload: { user_input: "List files" } } }),
      JSON.stringify({
        message: {
          type: "ToolCall",
          payload: { type: "function", id: "call_123", function: { name: "Shell", arguments: '{"command":"ls"}' } },
        },
      }),
      // Missing ToolResult and TurnEnd
    ].join("\n") + "\n";

    await fsp.writeFile(path.join(sessionDir, "wire.jsonl"), wireContent);

    // Fork at turn 1 (the incomplete one)
    const result = await forkSession({ workDir, sourceSessionId, turnIndex: 1 });

    const forkedWire = await fsp.readFile(path.join(result.sessionDir, "wire.jsonl"), "utf-8");
    const lines = forkedWire.trim().split("\n");

    // Should only have turn 0 (3 lines), incomplete turn 1 discarded
    expect(lines.length).toBe(3);

    // Verify it ends with TurnEnd
    const lastLine = JSON.parse(lines[lines.length - 1]);
    expect(lastLine.message?.type).toBe("TurnEnd");
  });

  it("should keep complete ToolCall with matching ToolResult and TurnEnd", async () => {
    const { forkSession } = await import("../storage");
    const sessionDir = getSessionDir(workDir, sourceSessionId);

    const wireContent = [
      JSON.stringify({ message: { type: "TurnBegin", payload: { user_input: "List files" } } }),
      JSON.stringify({
        message: {
          type: "ToolCall",
          payload: { type: "function", id: "call_123", function: { name: "Shell", arguments: '{"command":"ls"}' } },
        },
      }),
      JSON.stringify({
        message: {
          type: "ToolResult",
          payload: { tool_call_id: "call_123", return_value: { is_error: false, output: "file1.txt", message: "OK", display: [] } },
        },
      }),
      JSON.stringify({ message: { type: "TurnEnd", payload: {} } }),
    ].join("\n") + "\n";

    await fsp.writeFile(path.join(sessionDir, "wire.jsonl"), wireContent);

    const result = await forkSession({ workDir, sourceSessionId, turnIndex: 0 });

    const forkedWire = await fsp.readFile(path.join(result.sessionDir, "wire.jsonl"), "utf-8");
    const lines = forkedWire.trim().split("\n");
    expect(lines.length).toBe(4);

    // Verify ToolCall and ToolResult are present
    expect(lines.some((l) => JSON.parse(l).message?.type === "ToolCall")).toBe(true);
    expect(lines.some((l) => JSON.parse(l).message?.type === "ToolResult")).toBe(true);
  });

  it("should handle context.jsonl with incomplete tool_calls", async () => {
    const { forkSession } = await import("../storage");
    const sessionDir = getSessionDir(workDir, sourceSessionId);

    // wire.jsonl - complete turn
    const wireContent = [
      JSON.stringify({ message: { type: "TurnBegin", payload: { user_input: "Hello" } } }),
      JSON.stringify({ message: { type: "TurnEnd", payload: {} } }),
    ].join("\n") + "\n";
    await fsp.writeFile(path.join(sessionDir, "wire.jsonl"), wireContent);

    // context.jsonl with incomplete tool_calls
    const contextContent = [
      JSON.stringify({ role: "user", content: "List files" }),
      JSON.stringify({
        role: "assistant",
        content: null,
        tool_calls: [{ id: "call_123", type: "function", function: { name: "Shell", arguments: '{"command":"ls"}' } }],
      }),
      // Missing tool response
    ].join("\n") + "\n";
    await fsp.writeFile(path.join(sessionDir, "context.jsonl"), contextContent);

    const result = await forkSession({ workDir, sourceSessionId, turnIndex: 0 });

    const contextPath = path.join(result.sessionDir, "context.jsonl");
    if (fs.existsSync(contextPath)) {
      const forkedContext = await fsp.readFile(contextPath, "utf-8");
      const lines = forkedContext.trim().split("\n");

      // Assistant with incomplete tool_calls should be removed
      const hasIncompleteAssistant = lines.some((l) => {
        const r = JSON.parse(l);
        return r.role === "assistant" && Array.isArray(r.tool_calls) && r.tool_calls.length > 0;
      });
      expect(hasIncompleteAssistant).toBe(false);
    }
  });

  it("should return empty when forking first turn that is incomplete", async () => {
    const { forkSession } = await import("../storage");
    const sessionDir = getSessionDir(workDir, sourceSessionId);

    // Only incomplete turn 0
    const wireContent = [
      JSON.stringify({ message: { type: "TurnBegin", payload: { user_input: "Hello" } } }),
      JSON.stringify({
        message: {
          type: "ToolCall",
          payload: { type: "function", id: "call_123", function: { name: "Shell", arguments: '{"command":"ls"}' } },
        },
      }),
      // No TurnEnd
    ].join("\n") + "\n";

    await fsp.writeFile(path.join(sessionDir, "wire.jsonl"), wireContent);

    // Should throw or return empty since no complete turn exists
    await expect(forkSession({ workDir, sourceSessionId, turnIndex: 0 })).rejects.toThrow();
  });
});
