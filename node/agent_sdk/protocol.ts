import { spawn, type ChildProcess } from "node:child_process";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import {
  parseEventPayload,
  parseRequestPayload,
  InitializeResultSchema,
  type StreamEvent,
  type RunResult,
  type ContentPart,
  type ApprovalResponse,
  type ParseError,
  type InitializeResult,
  type ExternalTool,
  type ToolCallRequest,
  type ToolReturnValue,
} from "./schema";
import { TransportError, CliError } from "./errors";
import { log } from "./logger";

const PROTOCOL_VERSION = "1.1";
const CLIENT_NAME = "kimi-agent-sdk";
const CLIENT_VERSION = "0.0.2";

// Client Options
export interface ClientOptions {
  sessionId: string;
  workDir: string;
  model?: string;
  thinking?: boolean;
  yoloMode?: boolean;
  executablePath?: string;
  environmentVariables?: Record<string, string>;
  externalTools?: ExternalTool[];
}

// Prompt Stream
export interface PromptStream {
  events: AsyncIterable<StreamEvent>;
  result: Promise<RunResult>;
}

// Event Channel Helper
export function createEventChannel<T>(): {
  iterable: AsyncIterable<T>;
  push: (value: T) => void;
  finish: () => void;
} {
  const queue: T[] = [];
  const resolvers: Array<(result: IteratorResult<T>) => void> = [];
  let finished = false;

  return {
    iterable: {
      [Symbol.asyncIterator]: () => ({
        next: () => {
          const queued = queue.shift();
          if (queued !== undefined) {
            return Promise.resolve({ done: false as const, value: queued });
          }
          if (finished) {
            return Promise.resolve({ done: true as const, value: undefined });
          }
          return new Promise((resolve) => resolvers.push(resolve));
        },
      }),
    },
    push: (value: T) => {
      if (finished) {
        return;
      }
      const resolver = resolvers.shift();
      if (resolver) {
        resolver({ done: false, value });
      } else {
        queue.push(value);
      }
    },
    finish: () => {
      if (finished) {
        return;
      }
      finished = true;
      for (const resolver of resolvers) {
        resolver({ done: true, value: undefined });
      }
      resolvers.length = 0;
    },
  };
}

export class ProtocolClient {
  private process: ChildProcess | null = null;
  private readline: ReadlineInterface | null = null;
  private requestId = 0;
  private pendingRequests = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  private pushEvent: ((event: StreamEvent) => void) | null = null;
  private finishEvents: (() => void) | null = null;
  private externalToolHandlers = new Map<string, ExternalTool["handler"]>();

  get isRunning(): boolean {
    return this.process !== null && this.process.exitCode === null;
  }

  async start(options: ClientOptions): Promise<InitializeResult> {
    if (this.process) {
      throw new TransportError("ALREADY_STARTED", "Client already started");
    }

    const args = this.buildArgs(options);
    const executable = options.executablePath ?? "kimi";

    log.protocol("Spawning CLI: %s %o", executable, args);

    try {
      this.process = spawn(executable, args, {
        cwd: options.workDir,
        env: { ...process.env, ...options.environmentVariables },
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      throw new TransportError("SPAWN_FAILED", `Failed to spawn CLI: ${err}`, err);
    }

    if (!this.process.stdout || !this.process.stdin) {
      this.process.kill();
      this.process = null;
      throw new TransportError("SPAWN_FAILED", "Process missing stdio");
    }

    this.readline = createInterface({ input: this.process.stdout });
    this.readline.on("line", (line) => this.handleLine(line));

    this.process.stderr?.on("data", (data) => log.protocol("stderr: %s", data.toString().trim()));
    this.process.on("error", (err) => this.handleProcessError(err));
    this.process.on("exit", (code) => this.handleProcessExit(code));

    // Register external tool handlers
    if (options.externalTools) {
      for (const tool of options.externalTools) {
        this.externalToolHandlers.set(tool.name, tool.handler);
      }
    }

    // Send initialize request
    const initResult = await this.sendInitialize(options.externalTools);
    return initResult;
  }

  async stop(): Promise<void> {
    if (!this.process) {
      return;
    }

    if (this.process.exitCode !== null || this.process.killed) {
      this.cleanup();
      return;
    }

    log.protocol("Stopping process...");
    this.process.kill("SIGTERM");

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        this.process?.kill("SIGKILL");
        resolve();
      }, 3000);

      this.process!.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    this.cleanup();
  }

  sendPrompt(content: string | ContentPart[]): PromptStream {
    const { iterable, push, finish } = createEventChannel<StreamEvent>();

    this.pushEvent = push;
    this.finishEvents = () => {
      finish();
      this.pushEvent = null;
      this.finishEvents = null;
    };

    const result = this.sendRequest("prompt", { user_input: content })
      .then((res) => {
        this.finishEvents?.();
        const r = res as { status: string; steps?: number };
        return { status: r.status as RunResult["status"], steps: r.steps };
      })
      .catch((err) => {
        this.finishEvents?.();
        throw err;
      });

    return { events: iterable, result };
  }

  sendCancel(): Promise<void> {
    return this.sendRequest("cancel").then(() => {});
  }

  sendApproval(requestId: string, response: ApprovalResponse): Promise<void> {
    this.writeLine({
      jsonrpc: "2.0",
      id: requestId,
      result: { request_id: requestId, response },
    });
    return Promise.resolve();
  }

  private async sendInitialize(externalTools?: ExternalTool[]): Promise<InitializeResult> {
    const params: Record<string, unknown> = {
      protocol_version: PROTOCOL_VERSION,
      client: {
        name: CLIENT_NAME,
        version: CLIENT_VERSION,
      },
    };

    if (externalTools && externalTools.length > 0) {
      params.external_tools = externalTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      }));
    }

    log.protocol("Sending initialize request: %O", params);
    const result = await this.sendRequest("initialize", params);
    const parsed = InitializeResultSchema.safeParse(result);

    log.protocol("Received initialize response: %O", result);
    if (!parsed.success) {
      throw new TransportError("SPAWN_FAILED", `Invalid initialize response: ${parsed.error.message}`);
    }

    log.protocol("Initialized: protocol=%s, server=%s/%s", parsed.data.protocol_version, parsed.data.server.name, parsed.data.server.version);

    return parsed.data;
  }

  // Private: Args Building
  private buildArgs(options: ClientOptions): string[] {
    const args = ["--session", options.sessionId, "--work-dir", options.workDir, "--wire"];

    if (options.model) {
      args.push("--model", options.model);
    }
    if (options.thinking) {
      args.push("--thinking");
    } else {
      args.push("--no-thinking");
    }
    if (options.yoloMode) {
      args.push("--yolo");
    }
    return args;
  }

  // Private: RPC Communication
  private sendRequest(method: string, params?: any): Promise<unknown> {
    const id = `${++this.requestId}_${Date.now()}`;

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      try {
        this.writeLine({ jsonrpc: "2.0", id, method, ...(params && { params }) });
      } catch (err) {
        this.pendingRequests.delete(id);
        reject(err);
      }
    });
  }

  private writeLine(data: unknown): void {
    log.protocol(">>> %O", data);

    if (!this.process?.stdin?.writable) {
      throw new TransportError("STDIN_NOT_WRITABLE", "Cannot write to CLI stdin");
    }
    this.process.stdin.write(JSON.stringify(data) + "\n");
  }

  // Private: Line Handling
  private handleLine(line: string): void {
    log.protocol("<<< %s", line.length > 500 ? line.slice(0, 500) + "..." : line);

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      this.emitParseError("INVALID_JSON", "Failed to parse JSON", line);
      return;
    }

    const msg = parsed as {
      id?: string;
      method?: string;
      params?: unknown;
      result?: unknown;
      error?: { code: number; message: string };
    };

    // Response to a pending request
    if (msg.id && this.pendingRequests.has(msg.id)) {
      const pending = this.pendingRequests.get(msg.id)!;
      this.pendingRequests.delete(msg.id);

      if (msg.error) {
        pending.reject(CliError.fromRpcError(msg.error.code, msg.error.message));
      } else {
        pending.resolve(msg.result);
      }
      return;
    }

    // Notification (event or request from server)
    if (msg.method) {
      if (msg.method === "request" && msg.id) {
        this.handleServerRequest(msg.id, msg.params);
      } else {
        this.handleNotification(msg.method, msg.params);
      }
    }
  }

  private handleNotification(method: string, params: unknown): void {
    if (method === "event") {
      const p = params as { type?: string; payload?: unknown } | undefined;
      if (!p?.type) {
        this.emitParseError("SCHEMA_MISMATCH", "Event missing type");
        return;
      }
      const result = parseEventPayload(p.type, p.payload);
      if (result.ok) {
        this.pushEvent?.(result.value);
      } else {
        this.emitParseError("UNKNOWN_EVENT_TYPE", result.error);
      }
    }
  }

  private handleServerRequest(requestId: string, params: unknown): void {
    const p = params as { type?: string; payload?: unknown } | undefined;
    if (!p?.type) {
      this.emitParseError("SCHEMA_MISMATCH", "Request missing type");
      return;
    }

    if (p.type === "ToolCallRequest") {
      this.handleToolCallRequest(requestId, p.payload as ToolCallRequest);
      return;
    }

    // For other request types (ApprovalRequest), emit as event
    const result = parseRequestPayload(p.type, p.payload);
    if (result.ok) {
      this.pushEvent?.(result.value);
    } else {
      this.emitParseError("UNKNOWN_REQUEST_TYPE", result.error);
    }
  }

  private async handleToolCallRequest(requestId: string, request: ToolCallRequest): Promise<void> {
    const handler = this.externalToolHandlers.get(request.name);

    let returnValue: ToolReturnValue;

    if (!handler) {
      returnValue = {
        is_error: true,
        output: `Unknown external tool: ${request.name}`,
        message: `Tool "${request.name}" is not registered`,
        display: [],
      };
    } else {
      try {
        const params = request.arguments ? JSON.parse(request.arguments) : {};
        const result = await handler(params);
        returnValue = {
          is_error: false,
          output: result.output,
          message: result.message,
          display: [],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        returnValue = {
          is_error: true,
          output: message,
          message: `Tool execution failed: ${message}`,
          display: [],
        };
      }
    }

    this.writeLine({
      jsonrpc: "2.0",
      id: requestId,
      result: {
        tool_call_id: request.id,
        return_value: returnValue,
      },
    });
  }

  private emitParseError(code: string, message: string, raw?: string): void {
    const error: ParseError = { type: "error", code, message, raw: raw?.slice(0, 500) };
    this.pushEvent?.(error);
  }

  // Private: Process Lifecycle
  private handleProcessError(err: Error): void {
    log.protocol("Process error: %s", err.message);

    const error = new TransportError("PROCESS_CRASHED", `CLI process error: ${err.message}`, err);
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }
    this.finishEvents?.();
    this.cleanup();
  }

  private handleProcessExit(code: number | null): void {
    log.protocol("Process exited with code: %d", code);

    if (code !== 0 && code !== null) {
      const error = new TransportError("PROCESS_CRASHED", `CLI exited with code ${code}`);
      for (const pending of this.pendingRequests.values()) {
        pending.reject(error);
      }
    }
    this.finishEvents?.();
    this.cleanup();
  }

  private cleanup(): void {
    this.readline?.removeAllListeners();
    this.readline?.close();
    this.readline = null;

    this.process?.removeAllListeners();
    this.process?.stdout?.removeAllListeners();
    this.process?.stderr?.removeAllListeners();
    this.process = null;

    this.pushEvent = null;
    this.finishEvents = null;
    this.pendingRequests.clear();
    this.externalToolHandlers.clear();
  }
}
