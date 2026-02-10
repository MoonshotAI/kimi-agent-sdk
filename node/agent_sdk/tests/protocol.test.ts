import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { createEventChannel } from "../protocol";
import { TransportError } from "../errors";

// ============================================================================
// createEventChannel Tests
// ============================================================================
describe("createEventChannel", () => {
  it("pushes and consumes values in order", async () => {
    const { iterable, push, finish } = createEventChannel<number>();

    push(1);
    push(2);
    push(3);
    finish();

    const results: number[] = [];
    for await (const value of iterable) {
      results.push(value);
    }

    expect(results).toEqual([1, 2, 3]);
  });

  it("handles async consumption with delayed push", async () => {
    const { iterable, push, finish } = createEventChannel<string>();

    const consumer = (async () => {
      const results: string[] = [];
      for await (const value of iterable) {
        results.push(value);
      }
      return results;
    })();

    await new Promise((r) => setTimeout(r, 10));
    push("a");
    push("b");
    finish();

    const results = await consumer;
    expect(results).toEqual(["a", "b"]);
  });

  it("ignores pushes after finish", async () => {
    const { iterable, push, finish } = createEventChannel<number>();

    push(1);
    finish();
    push(2);
    push(3);

    const results: number[] = [];
    for await (const value of iterable) {
      results.push(value);
    }

    expect(results).toEqual([1]);
  });

  it("handles empty channel", async () => {
    const { iterable, finish } = createEventChannel<number>();
    finish();

    const results: number[] = [];
    for await (const value of iterable) {
      results.push(value);
    }

    expect(results).toEqual([]);
  });

  it("multiple finish calls are safe", async () => {
    const { iterable, push, finish } = createEventChannel<number>();

    push(1);
    finish();
    finish();
    finish();

    const results: number[] = [];
    for await (const value of iterable) {
      results.push(value);
    }

    expect(results).toEqual([1]);
  });

  it("resolves waiting consumers on finish", async () => {
    const { iterable, finish } = createEventChannel<number>();

    const consumer = (async () => {
      const results: number[] = [];
      for await (const value of iterable) {
        results.push(value);
      }
      return results;
    })();

    await new Promise((r) => setTimeout(r, 10));
    finish();

    const results = await consumer;
    expect(results).toEqual([]);
  });
});

// ============================================================================
// ProtocolClient Tests
// ============================================================================
const mockSpawn = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

let ProtocolClient: (typeof import("../protocol"))["ProtocolClient"];

beforeAll(async () => {
  const module = await import("../protocol.js");
  ProtocolClient = module.ProtocolClient;
});

describe("ProtocolClient", () => {
  beforeEach(() => {
    mockSpawn.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Create a mock process with proper Readable streams
  function createMockProcess() {
    const stdin = {
      writable: true,
      write: vi.fn(),
    };

    // Use real Readable streams that support readline
    const stdout = new Readable({ read() {} });
    const stderr = new Readable({ read() {} });

    const proc = new EventEmitter() as EventEmitter & {
      stdin: typeof stdin;
      stdout: Readable;
      stderr: Readable;
      exitCode: number | null;
      killed: boolean;
      kill: ReturnType<typeof vi.fn>;
    };
    proc.stdin = stdin;
    proc.stdout = stdout;
    proc.stderr = stderr;
    proc.exitCode = null;
    proc.killed = false;
    proc.kill = vi.fn();
    return proc;
  }

  // Helper to push a line to stdout
  function pushLine(proc: ReturnType<typeof createMockProcess>, line: string) {
    proc.stdout.push(line + "\n");
  }

  // Helper to send initialize response (needed because start() waits for it)
  function sendInitializeResponse(proc: ReturnType<typeof createMockProcess>, reqId: number) {
    pushLine(
      proc,
      JSON.stringify({
        jsonrpc: "2.0",
        id: reqId,
        result: {
          protocol_version: "1.1",
          server: { name: "kimi-code", version: "1.0.0" },
          slash_commands: [],
        },
      }),
    );
  }

  // Helper to start client with initialize response
  async function startClientWithInit(client: InstanceType<typeof ProtocolClient>, proc: ReturnType<typeof createMockProcess>, options: Parameters<InstanceType<typeof ProtocolClient>["start"]>[0]) {
    // Start client (this triggers initialize request)
    const startPromise = client.start(options);
    
    // Wait a tick for the initialize request to be written
    await new Promise((r) => setImmediate(r));
    
    // Get the initialize request ID and respond
    const initReqId = JSON.parse(proc.stdin.write.mock.calls[0][0]).id;
    sendInitializeResponse(proc, initReqId);
    
    // Wait for start to complete
    return startPromise;
  }

  describe("isRunning", () => {
    it("returns false when not started", () => {
      const client = new ProtocolClient();
      expect(client.isRunning).toBe(false);
    });
  });

  describe("start", () => {
    it("throws ALREADY_STARTED when called twice", async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const client = new ProtocolClient();
      // First start (don't await - just trigger it)
      client.start({ sessionId: "test", workDir: "/tmp" });

      // Second start should throw immediately
      await expect(client.start({ sessionId: "test", workDir: "/tmp" })).rejects.toThrow(TransportError);
    });

    it("builds correct args with all options", () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const client = new ProtocolClient();
      client.start({
        sessionId: "sess-123",
        workDir: "/project",
        model: "kimi-k2",
        thinking: true,
        yoloMode: true,
        executablePath: "/usr/local/bin/kimi",
        environmentVariables: { MY_VAR: "value" },
      });

      expect(mockSpawn).toHaveBeenCalledWith(
        "/usr/local/bin/kimi",
        expect.arrayContaining(["--session", "sess-123", "--work-dir", "/project", "--wire", "--model", "kimi-k2", "--thinking", "--yolo"]),
        expect.objectContaining({
          cwd: "/project",
          env: expect.objectContaining({ MY_VAR: "value" }),
        }),
      );
    });

    it("builds args with --no-thinking when thinking is false", () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const client = new ProtocolClient();
      client.start({
        sessionId: "test",
        workDir: "/tmp",
        thinking: false,
      });

      expect(mockSpawn).toHaveBeenCalledWith("kimi", expect.arrayContaining(["--no-thinking"]), expect.anything());
    });

    it("builds args with --skills-dir when skillsDir is provided", () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const client = new ProtocolClient();
      client.start({
        sessionId: "test",
        workDir: "/tmp",
        skillsDir: "/path/to/my-skills",
      });

      expect(mockSpawn).toHaveBeenCalledWith("kimi", expect.arrayContaining(["--skills-dir", "/path/to/my-skills"]), expect.anything());
    });

    it("does not include --skills-dir when skillsDir is not provided", () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const client = new ProtocolClient();
      client.start({
        sessionId: "test",
        workDir: "/tmp",
      });

      const callArgs = mockSpawn.mock.calls[0][1] as string[];
      expect(callArgs).not.toContain("--skills-dir");
    });

    it("throws SPAWN_FAILED when spawn fails", async () => {
      mockSpawn.mockImplementation(() => {
        throw new Error("spawn ENOENT");
      });

      const client = new ProtocolClient();
      await expect(client.start({ sessionId: "test", workDir: "/tmp" })).rejects.toThrow(TransportError);
    });

    it("throws SPAWN_FAILED when stdio missing", async () => {
      const proc = createMockProcess();
      proc.stdout = null as unknown as Readable;
      mockSpawn.mockReturnValue(proc);

      const client = new ProtocolClient();
      await expect(client.start({ sessionId: "test", workDir: "/tmp" })).rejects.toThrow(TransportError);
    });
  });

  describe("stop", () => {
    it("does nothing when not started", async () => {
      const client = new ProtocolClient();
      await client.stop();
    });

    it("kills process on stop", async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const client = new ProtocolClient();
      client.start({ sessionId: "test", workDir: "/tmp" });

      const stopPromise = client.stop();

      proc.exitCode = 0;
      proc.emit("exit", 0);

      await stopPromise;
      expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
    });
  });

  describe("sendPrompt", () => {
    it("writes prompt request to stdin", () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const client = new ProtocolClient();
      client.start({ sessionId: "test", workDir: "/tmp" });

      client.sendPrompt("Hello");

      expect(proc.stdin.write).toHaveBeenCalledWith(expect.stringContaining('"method":"prompt"'));
      expect(proc.stdin.write).toHaveBeenCalledWith(expect.stringContaining('"user_input":"Hello"'));
    });

    it("handles ContentPart array input", () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const client = new ProtocolClient();
      client.start({ sessionId: "test", workDir: "/tmp" });

      client.sendPrompt([{ type: "text", text: "Hello" }]);

      expect(proc.stdin.write).toHaveBeenCalledWith(expect.stringContaining('"type":"text"'));
    });
  });

  describe("sendCancel", () => {
    it("writes cancel request to stdin", () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const client = new ProtocolClient();
      client.start({ sessionId: "test", workDir: "/tmp" });

      client.sendCancel();

      expect(proc.stdin.write).toHaveBeenCalledWith(expect.stringContaining('"method":"cancel"'));
    });
  });

  describe("sendApproval", () => {
    it("writes approval response to stdin", () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const client = new ProtocolClient();
      client.start({ sessionId: "test", workDir: "/tmp" });

      client.sendApproval("req-123", "approve");

      expect(proc.stdin.write).toHaveBeenCalledWith(expect.stringContaining('"id":"req-123"'));
      expect(proc.stdin.write).toHaveBeenCalledWith(expect.stringContaining('"response":"approve"'));
    });
  });

  describe("message handling", () => {
    it("emits events from event notifications", async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const client = new ProtocolClient();
      await startClientWithInit(client, proc, { sessionId: "test", workDir: "/tmp" });

      const stream = client.sendPrompt("Hello");

      // Push event
      pushLine(
        proc,
        JSON.stringify({
          jsonrpc: "2.0",
          method: "event",
          params: { type: "ContentPart", payload: { type: "text", text: "Hi" } },
        }),
      );

      // Push response to finish (call[1] is the prompt request, call[0] was initialize)
      const reqId = JSON.parse(proc.stdin.write.mock.calls[1][0]).id;
      pushLine(
        proc,
        JSON.stringify({
          jsonrpc: "2.0",
          id: reqId,
          result: { status: "finished" },
        }),
      );

      // Signal end of stream
      proc.stdout.push(null);

      const events = [];
      for await (const event of stream.events) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "ContentPart",
        payload: { type: "text", text: "Hi" },
      });
    });

    it("emits request events from request notifications", async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const client = new ProtocolClient();
      await startClientWithInit(client, proc, { sessionId: "test", workDir: "/tmp" });

      const stream = client.sendPrompt("Hello");

      pushLine(
        proc,
        JSON.stringify({
          jsonrpc: "2.0",
          id: "server-req-1",
          method: "request",
          params: {
            type: "ApprovalRequest",
            payload: {
              id: "req-1",
              tool_call_id: "tc-1",
              sender: "Shell",
              action: "run command",
              description: "Run ls",
            },
          },
        }),
      );

      const reqId = JSON.parse(proc.stdin.write.mock.calls[1][0]).id;
      pushLine(
        proc,
        JSON.stringify({
          jsonrpc: "2.0",
          id: reqId,
          result: { status: "finished" },
        }),
      );

      proc.stdout.push(null);

      const events = [];
      for await (const event of stream.events) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "ApprovalRequest",
        payload: { id: "req-1", sender: "Shell" },
      });
    });

    it("emits parse error for invalid JSON", async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const client = new ProtocolClient();
      await startClientWithInit(client, proc, { sessionId: "test", workDir: "/tmp" });

      const stream = client.sendPrompt("Hello");

      pushLine(proc, "not valid json{{{");

      const reqId = JSON.parse(proc.stdin.write.mock.calls[1][0]).id;
      pushLine(
        proc,
        JSON.stringify({
          jsonrpc: "2.0",
          id: reqId,
          result: { status: "finished" },
        }),
      );

      proc.stdout.push(null);

      const events = [];
      for await (const event of stream.events) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "error",
        code: "INVALID_JSON",
      });
    });

    it("emits parse error for unknown event type", async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const client = new ProtocolClient();
      await startClientWithInit(client, proc, { sessionId: "test", workDir: "/tmp" });

      const stream = client.sendPrompt("Hello");

      pushLine(
        proc,
        JSON.stringify({
          jsonrpc: "2.0",
          method: "event",
          params: { type: "UnknownEventType", payload: {} },
        }),
      );

      const reqId = JSON.parse(proc.stdin.write.mock.calls[1][0]).id;
      pushLine(
        proc,
        JSON.stringify({
          jsonrpc: "2.0",
          id: reqId,
          result: { status: "finished" },
        }),
      );

      proc.stdout.push(null);

      const events = [];
      for await (const event of stream.events) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "error",
        code: "UNKNOWN_EVENT_TYPE",
      });
    });

    it("resolves result promise with run result", async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const client = new ProtocolClient();
      await startClientWithInit(client, proc, { sessionId: "test", workDir: "/tmp" });

      const stream = client.sendPrompt("Hello");

      const reqId = JSON.parse(proc.stdin.write.mock.calls[1][0]).id;
      pushLine(
        proc,
        JSON.stringify({
          jsonrpc: "2.0",
          id: reqId,
          result: { status: "finished" },
        }),
      );

      proc.stdout.push(null);

      for await (const _ of stream.events) {
        // drain
      }

      const result = await stream.result;
      expect(result).toEqual({ status: "finished" });
    });

    it("handles max_steps_reached with steps", async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const client = new ProtocolClient();
      await startClientWithInit(client, proc, { sessionId: "test", workDir: "/tmp" });

      const stream = client.sendPrompt("Hello");

      const reqId = JSON.parse(proc.stdin.write.mock.calls[1][0]).id;
      pushLine(
        proc,
        JSON.stringify({
          jsonrpc: "2.0",
          id: reqId,
          result: { status: "max_steps_reached", steps: 100 },
        }),
      );

      proc.stdout.push(null);

      for await (const _ of stream.events) {
        // drain
      }

      const result = await stream.result;
      expect(result).toEqual({ status: "max_steps_reached", steps: 100 });
    });
  });

  describe("process lifecycle", () => {
    it("handles process error", async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const client = new ProtocolClient();
      await startClientWithInit(client, proc, { sessionId: "test", workDir: "/tmp" });

      const stream = client.sendPrompt("Hello");

      proc.emit("error", new Error("EPIPE"));

      await expect(stream.result).rejects.toThrow(TransportError);
    });

    it("handles process exit with non-zero code", async () => {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const client = new ProtocolClient();
      await startClientWithInit(client, proc, { sessionId: "test", workDir: "/tmp" });

      const stream = client.sendPrompt("Hello");

      proc.exitCode = 1;
      proc.emit("exit", 1);

      await expect(stream.result).rejects.toThrow(TransportError);
    });
  });
});
