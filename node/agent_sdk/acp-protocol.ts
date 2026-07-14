import { spawn, type ChildProcess } from "node:child_process";

import type { ApprovalResponse, ContentPart, InitializeResult, RunResult, SlashCommandInfo, StreamEvent } from "./schema";
import { SlashCommandInfoSchema } from "./schema";
import { ProtocolError, TransportError } from "./errors";
import { createEventChannel, type ClientOptions, type PromptStream } from "./protocol";

const ACP_PROTOCOL_VERSION = 1;

function parseSlashCommands(raw: unknown): SlashCommandInfo[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const commands: SlashCommandInfo[] = [];
  for (const item of raw) {
    const parsed = SlashCommandInfoSchema.safeParse(item);
    if (parsed.success) {
      commands.push(parsed.data);
    }
  }
  return commands;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface PendingApproval {
  rpcId: string | number;
  options: Array<{ optionId: string }>;
}

interface AcpToolCall {
  toolCallId: string;
  title?: string;
  kind?: string;
  rawInput?: unknown;
  status?: string;
  content?: unknown;
  argumentText?: string;
}

export interface AcpSessionConfig {
  sessionId: string;
  configOptions: Array<{
    id?: string;
    currentValue?: string;
    options?: Array<{ value: string; name: string }>;
  }>;
}

interface AcpPromptResponse {
  stopReason?: string;
}

type AcpSessionResult = Omit<AcpSessionConfig, "sessionId"> & { sessionId?: string };

function toAcpSessionId(sessionId: string): string {
  return sessionId.startsWith("session_") ? sessionId : `session_${sessionId}`;
}

function toStorageSessionId(sessionId: string): string {
  return sessionId.startsWith("session_") ? sessionId.slice("session_".length) : sessionId;
}

export class AcpProtocolClient {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private sessionId: string | null = null;
  private pendingRequests = new Map<string | number, PendingRequest>();
  private pendingApprovals = new Map<string, PendingApproval>();
  private toolCalls = new Map<string, AcpToolCall>();
  private eventChannel: ReturnType<typeof createEventChannel<StreamEvent>> | null = null;
  private config: AcpSessionConfig | null = null;

  get sessionConfig(): AcpSessionConfig | null {
    return this.config;
  }

  get isRunning(): boolean {
    return this.process !== null && this.process.exitCode === null;
  }

  async start(options: ClientOptions): Promise<InitializeResult> {
    const executable = options.executablePath ?? "kimi";
    this.process = spawn(executable, ["acp"], {
      cwd: options.workDir,
      env: { ...process.env, ...options.environmentVariables },
      stdio: ["pipe", "pipe", "pipe"],
    });

    if (!this.process.stdin || !this.process.stdout) {
      throw new TransportError("SPAWN_FAILED", "ACP process missing stdio");
    }

    let buffer = "";
    this.process.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) this.handleLine(line);
    });
    this.process.on("exit", () => this.finishEvents());
    this.process.on("error", (error) => this.finishEvents(error));

    const initialized = (await this.request("initialize", {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientCapabilities: {},
    })) as {
      agentInfo?: { name?: string; version?: string };
      slashCommands?: unknown[];
      slash_commands?: unknown[];
    };
    const session = (await this.request(
      options.resumeSession && options.sessionId ? "session/load" : "session/new",
      options.resumeSession && options.sessionId
        ? { sessionId: toAcpSessionId(options.sessionId), cwd: options.workDir, mcpServers: [] }
        : { cwd: options.workDir, mcpServers: [] },
    )) as AcpSessionResult;
    const acpSessionId = options.resumeSession && options.sessionId ? toAcpSessionId(options.sessionId) : session.sessionId;
    if (!acpSessionId) {
      throw new ProtocolError("SCHEMA_MISMATCH", "ACP did not return a session ID");
    }
    this.sessionId = acpSessionId;
    this.config = { sessionId: toStorageSessionId(acpSessionId), configOptions: session.configOptions ?? [] };
    await this.applySessionOptions(options);

    return {
      protocol_version: `acp/${ACP_PROTOCOL_VERSION}`,
      server: { name: initialized.agentInfo?.name ?? "Kimi Code CLI", version: initialized.agentInfo?.version ?? "unknown" },
      slash_commands: parseSlashCommands(initialized.slashCommands ?? initialized.slash_commands),
    };
  }

  sendPrompt(content: string | ContentPart[]): PromptStream {
    const channel = createEventChannel<StreamEvent>();
    this.eventChannel = channel;
    channel.push({ type: "TurnBegin", payload: { user_input: content } });
    // The webview's Wire-compatible renderer requires a step before it can append
    // text, thoughts, or tool calls from ACP session updates.
    channel.push({ type: "StepBegin", payload: { n: 1 } });
    const prompt = typeof content === "string" ? [{ type: "text", text: content }] : content.filter((part) => part.type === "text").map((part) => ({ type: "text", text: part.text }));
    const result = this.request("session/prompt", { sessionId: this.sessionId, prompt })
      .then((response): RunResult => this.toRunResult(response as AcpPromptResponse | undefined))
      .finally(() => {
        channel.push({ type: "TurnEnd", payload: {} });
        this.finishEvents();
      });
    return { events: channel.iterable, result };
  }

  sendCancel(): Promise<void> {
    return this.request("session/cancel", { sessionId: this.sessionId }).then(() => {});
  }

  sendApproval(requestId: string, response: ApprovalResponse): Promise<void> {
    const pending = this.pendingApprovals.get(requestId);
    if (!pending) return Promise.resolve();
    this.pendingApprovals.delete(requestId);
    const optionId = response === "approve" ? "approve_once" : response === "approve_for_session" ? "approve_always" : "reject";
    const selected = pending.options.find((option) => option.optionId === optionId) ?? pending.options.at(-1);
    this.write({
      jsonrpc: "2.0",
      id: pending.rpcId,
      result: { outcome: selected ? { outcome: "selected", optionId: selected.optionId } : { outcome: "cancelled" } },
    });
    return Promise.resolve();
  }

  async stop(): Promise<void> {
    if (!this.process) return;
    this.process.kill("SIGTERM");
    this.process = null;
    this.finishEvents();
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = ++this.requestId;
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      try {
        this.write({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        this.pendingRequests.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private write(message: unknown): void {
    if (!this.process?.stdin?.writable) throw new TransportError("STDIN_NOT_WRITABLE", "Cannot write to ACP CLI stdin");
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;
    let message: any;
    try { message = JSON.parse(line); } catch { return; }
    // ACP is bidirectional JSON-RPC: an agent-side request may reuse the
    // numeric ID of one of our outstanding requests. Dispatch methods before
    // looking at the ID so a reverse permission request never masquerades as
    // an empty response to session/prompt.
    if (message.method === "session/update") {
      this.handleUpdate(message.params);
      return;
    }
    if (message.method === "session/request_permission") {
      this.handleApproval(message);
      return;
    }
    if (message.id !== undefined && this.pendingRequests.has(message.id)) {
      const pending = this.pendingRequests.get(message.id)!;
      this.pendingRequests.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result);
    }
  }

  private handleUpdate(params: any): void {
    const update = params?.update;
    if (!update || !this.eventChannel) return;
    for (const event of mapAcpUpdate(update, this.toolCalls)) this.eventChannel.push(event);
  }

  private handleApproval(message: any): void {
    const params = message.params;
    const requestId = String(message.id);
    this.pendingApprovals.set(requestId, { rpcId: message.id, options: params?.options ?? [] });
    this.eventChannel?.push({ type: "ApprovalRequest", payload: { id: requestId, tool_call_id: params?.toolCall?.toolCallId ?? "acp", sender: params?.toolCall?.title ?? "Tool", action: "execute tool", description: params?.toolCall?.title ?? "Approval required" } });
  }

  private toRunResult(response: AcpPromptResponse | undefined): RunResult {
    // Older Kimi Code ACP builds may acknowledge session/prompt with an
    // omitted result. Treat that as an unknown terminal reason instead of
    // dereferencing it and masking the actual unfinished-turn diagnostic.
    const stopReason = response?.stopReason;
    const pendingToolCallIds = [...this.toolCalls.values()]
      .filter((tool) => tool.status !== "completed" && tool.status !== "failed")
      .map((tool) => tool.toolCallId);

    console.warn("[kimi-code] ACP prompt completed", {
      sessionId: this.sessionId,
      stopReason,
      pendingToolCallIds,
    });

    if (stopReason === "cancelled") {
      return { status: "cancelled" };
    }

    if (stopReason === "max_steps") {
      return { status: "max_steps_reached" };
    }

    if (pendingToolCallIds.length > 0) {
      throw new ProtocolError(
        "INCOMPLETE_TURN",
        `Kimi Code ended the ACP turn before completing tool calls: ${pendingToolCallIds.join(", ")}`,
        { sessionId: this.sessionId ?? undefined, stopReason, pendingToolCallIds },
      );
    }

    return { status: "finished" };
  }

  private finishEvents(error?: Error): void {
    if (error) for (const pending of this.pendingRequests.values()) pending.reject(error);
    this.pendingRequests.clear();
    this.pendingApprovals.clear();
    this.toolCalls.clear();
    this.eventChannel?.finish();
    this.eventChannel = null;
  }

  private async applySessionOptions(options: ClientOptions): Promise<void> {
    const configOptions = this.config?.configOptions ?? [];
    const apply = async (configId: string, value: string | undefined): Promise<void> => {
      if (!value) return;
      const option = configOptions.find((item) => item.id === configId);
      if (!option || option.currentValue === value || !option.options?.some((item) => item.value === value)) return;
      await this.request("session/set_config_option", { sessionId: this.sessionId, configId, value });
      option.currentValue = value;
    };

    await apply("model", options.model);
    await apply("thinking", options.thinking ? "on" : "off");
    await apply("mode", options.yoloMode ? "yolo" : "default");
  }
}

/** Convert ACP session updates to the SDK's existing Wire-compatible event contract. */
export function mapAcpUpdate(update: any, toolCalls = new Map<string, AcpToolCall>()): StreamEvent[] {
  if (update.sessionUpdate === "agent_message_chunk" && typeof update.content?.text === "string") {
    return [{ type: "ContentPart", payload: { type: "text", text: update.content.text } }];
  }
  if (update.sessionUpdate === "agent_thought_chunk" && typeof update.content?.text === "string") {
    return [{ type: "ContentPart", payload: { type: "think", think: update.content.text } }];
  }

  if (update.sessionUpdate === "tool_call") {
    const tool = update as AcpToolCall;
    if (!tool.toolCallId) return [];
    const argumentText = stringifyToolInput(tool.rawInput) ?? acpContentText(tool.content);
    toolCalls.set(tool.toolCallId, { ...tool, argumentText });
    return [{
      type: "ToolCall",
      payload: {
        type: "function",
        id: tool.toolCallId,
        function: { name: tool.title ?? tool.kind ?? "Tool", arguments: argumentText },
        extras: { title: tool.title, kind: tool.kind, status: tool.status },
      },
    }];
  }

  if (update.sessionUpdate === "tool_call_update") {
    const tool = update as AcpToolCall;
    const previous = toolCalls.get(tool.toolCallId) ?? { toolCallId: tool.toolCallId };
    const argumentText = tool.rawInput !== undefined
      ? stringifyToolInput(tool.rawInput)
      : acpContentText(tool.content) ?? previous.argumentText;
    const current = { ...previous, ...tool, argumentText };
    toolCalls.set(tool.toolCallId, current);
    if (!tool.toolCallId) return [];
    if (tool.status === "completed" || tool.status === "failed") {
      return [{
        type: "ToolResult",
        payload: {
          tool_call_id: tool.toolCallId,
          return_value: {
            is_error: tool.status === "failed",
            output: stringifyToolOutput(current.content),
            message: tool.status === "failed" ? "Tool call failed" : "Tool call completed",
            display: [],
          },
        },
      }];
    }
    const events: StreamEvent[] = [];
    if (argumentText !== undefined && argumentText !== previous.argumentText) {
      events.push({
        type: "ToolCallPart",
        payload: { tool_call_id: tool.toolCallId, arguments_part: argumentText, replace_arguments: true },
      });
    }
    events.push({ type: "StatusUpdate", payload: {} });
    return events;
  }

  if (update.sessionUpdate === "plan") {
    return [{ type: "StatusUpdate", payload: { plan_mode: true } }];
  }
  return [];
}

function stringifyToolInput(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === "string" ? value : JSON.stringify(value);
}

function stringifyToolOutput(value: unknown): string {
  const contentText = acpContentText(value);
  if (contentText !== undefined) return contentText;
  if (value === undefined || value === null) return "";
  return JSON.stringify(value);
}

function acpContentText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return undefined;

  const text = value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const content = (item as { content?: unknown }).content;
    if (typeof content === "string") return [content];
    if (content && typeof content === "object" && typeof (content as { text?: unknown }).text === "string") {
      return [(content as { text: string }).text];
    }
    if (typeof (item as { text?: unknown }).text === "string") return [(item as { text: string }).text];
    return [];
  });
  return text.length > 0 ? text.join("\n") : undefined;
}
