import { z } from "zod";

// ============================================================================
// Primitives
// ============================================================================

// Approval response type
export const ApprovalResponseSchema = z.enum(["approve", "approve_for_session", "reject"]);
/**
 * Approval response
 * - `approve`: Approve this operation
 * - `approve_for_session`: Approve similar operations in this session
 * - `reject`: Reject the operation
 */
export type ApprovalResponse = z.infer<typeof ApprovalResponseSchema>;

// Message content part
export const ContentPartSchema = z.discriminatedUnion("type", [
  z.object({
    // Text type
    type: z.literal("text"),
    // Text content
    text: z.string(),
  }),
  z.object({
    // Think type, appears only in thinking mode
    type: z.literal("think"),
    // Think content
    think: z.string(),
    // Encrypted think content or signature
    encrypted: z.string().nullable().optional(),
  }),
  z.object({
    // Image type
    type: z.literal("image_url"),
    image_url: z.object({
      // Image URL, usually a data URI (e.g., data:image/png;base64,...)
      url: z.string(),
      // Image ID, used to distinguish different images
      id: z.string().nullable().optional(),
    }),
  }),
  z.object({
    // Audio type
    type: z.literal("audio_url"),
    audio_url: z.object({
      // Audio URL, usually a data URI (e.g., data:audio/aac;base64,...)
      url: z.string(),
      // Audio ID, used to distinguish different audio
      id: z.string().nullable().optional(),
    }),
  }),
  z.object({
    // Video type
    type: z.literal("video_url"),
    video_url: z.object({
      // Video URL, usually a data URI (e.g., data:video/mp4;base64,...)
      url: z.string(),
      // Video ID, used to distinguish different videos
      id: z.string().nullable().optional(),
    }),
  }),
]);
/**
 * Message content part
 * - `text`: Text content
 * - `think`: Think content (thinking mode)
 * - `image_url`: Image
 * - `audio_url`: Audio
 * - `video_url`: Video
 */
export type ContentPart = z.infer<typeof ContentPartSchema>;

// Token usage statistics
export const TokenUsageSchema = z.object({
  // Number of input tokens (excluding cache)
  input_other: z.number(),
  // Number of output tokens
  output: z.number(),
  // Number of input tokens read from cache
  input_cache_read: z.number(),
  // Number of input tokens written to cache
  input_cache_creation: z.number(),
});
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

// ============================================================================
// DisplayBlock
// ============================================================================

// Brief text display block
export const BriefBlockSchema = z.object({
  type: z.literal("brief"),
  // Brief text content
  text: z.string(),
});
export type BriefBlock = z.infer<typeof BriefBlockSchema>;

// File diff display block
export const DiffBlockSchema = z.object({
  type: z.literal("diff"),
  // File path
  path: z.string(),
  // Original content
  old_text: z.string(),
  // New content
  new_text: z.string(),
});
export type DiffBlock = z.infer<typeof DiffBlockSchema>;

// Todo list display block
export const TodoBlockSchema = z.object({
  type: z.literal("todo"),
  // Todo list
  items: z.array(
    z.object({
      // Todo item title
      title: z.string(),
      // Status: pending | in_progress | done
      status: z.enum(["pending", "in_progress", "done"]),
    }),
  ),
});
export type TodoBlock = z.infer<typeof TodoBlockSchema>;

export const ShellBlockSchema = z.object({
  type: z.literal("shell"),
  language: z.string(),
  command: z.string(),
});
export type ShellBlock = z.infer<typeof ShellBlockSchema>;

// Unknown display block (fallback)
export interface UnknownBlock {
  type: string;
  data: Record<string, unknown>;
}

export type DisplayBlock = BriefBlock | DiffBlock | TodoBlock | ShellBlock | UnknownBlock;

// Raw DisplayBlock parsing schema
const RawDisplayBlockSchema = z
  .object({
    type: z.string(),
    text: z.string().optional(),
    path: z.string().optional(),
    old_text: z.string().optional(),
    new_text: z.string().optional(),
    items: z.array(z.object({ title: z.string(), status: z.enum(["pending", "in_progress", "done"]) })).optional(),
    language: z.string().optional(),
    command: z.string().optional(),
  })
  .passthrough();

// DisplayBlock schema with automatic strong typing
export const DisplayBlockSchema = RawDisplayBlockSchema.transform((raw): DisplayBlock => {
  switch (raw.type) {
    case "brief":
      if (typeof raw.text === "string") {
        return { type: "brief", text: raw.text };
      }
      break;
    case "diff":
      if (typeof raw.path === "string" && typeof raw.old_text === "string" && typeof raw.new_text === "string") {
        return { type: "diff", path: raw.path, old_text: raw.old_text, new_text: raw.new_text };
      }
      break;
    case "todo":
      if (Array.isArray(raw.items)) {
        return { type: "todo", items: raw.items };
      }
      break;
    case "shell":
      if (typeof raw.language === "string" && typeof raw.command === "string") {
        return { type: "shell", language: raw.language, command: raw.command };
      }
      break;
  }
  const { type, ...rest } = raw;
  return { type, data: rest };
});

// ============================================================================
// Tool Types
// ============================================================================

// Tool call
export const ToolCallSchema = z.object({
  // Always "function"
  type: z.literal("function"),
  // Tool call ID, used to match with ToolResult
  id: z.string(),
  function: z.object({
    // Tool name, e.g. "Shell", "ReadFile", "WriteFile"
    name: z.string(),
    // JSON-encoded arguments string, may be incomplete during streaming
    arguments: z.string().nullable().optional(),
  }),
  // Extra metadata
  extras: z.record(z.unknown()).nullable().optional(),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

// Tool call argument chunk (streaming)
export const ToolCallPartSchema = z.object({
  // Argument chunk, appended to the last ToolCall's arguments
  arguments_part: z.string().nullable().optional(),
});
export type ToolCallPart = z.infer<typeof ToolCallPartSchema>;

// Tool execution result
export const ToolReturnValueSchema = z.object({
  is_error: z.boolean(),
  output: z.union([z.string(), z.array(ContentPartSchema)]),
  message: z.string(),
  display: z.array(DisplayBlockSchema),
  extras: z.record(z.unknown()).nullable().optional(),
});
export type ToolReturnValue = z.infer<typeof ToolReturnValueSchema>;

export const ToolResultSchema = z.object({
  // Corresponding tool call ID
  tool_call_id: z.string(),
  return_value: ToolReturnValueSchema,
});
export type ToolResult = z.infer<typeof ToolResultSchema>;

// ============================================================================
// Event Payloads
// ============================================================================

export const ClientInfoSchema = z.object({
  name: z.string(),
  version: z.string().optional(),
});
export type ClientInfo = z.infer<typeof ClientInfoSchema>;

export const ServerInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
});
export type ServerInfo = z.infer<typeof ServerInfoSchema>;

export const SlashCommandInfoSchema = z.object({
  name: z.string(),
  description: z.string(),
  aliases: z.array(z.string()),
});
export type SlashCommandInfo = z.infer<typeof SlashCommandInfoSchema>;

export const ExternalToolDefinitionSchema = z.object({
  name: z.string(),
  description: z.string(),
  parameters: z.record(z.unknown()),
});
export type ExternalToolDefinition = z.infer<typeof ExternalToolDefinitionSchema>;

export const ExternalToolsResultSchema = z.object({
  accepted: z.array(z.string()),
  rejected: z.array(z.object({ name: z.string(), reason: z.string() })),
});
export type ExternalToolsResult = z.infer<typeof ExternalToolsResultSchema>;

export const InitializeParamsSchema = z.object({
  protocol_version: z.string(),
  client: ClientInfoSchema.optional(),
  external_tools: z.array(ExternalToolDefinitionSchema).optional(),
});
export type InitializeParams = z.infer<typeof InitializeParamsSchema>;

export const InitializeResultSchema = z.object({
  protocol_version: z.string(),
  server: ServerInfoSchema,
  slash_commands: z.array(SlashCommandInfoSchema),
  external_tools: ExternalToolsResultSchema.optional(),
});
export type InitializeResult = z.infer<typeof InitializeResultSchema>;

// ============================================================================
// Tool Call Request (Wire 1.1)
// ============================================================================

export const ToolCallRequestSchema = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.string().nullable().optional(),
});
export type ToolCallRequest = z.infer<typeof ToolCallRequestSchema>;

// ============================================================================
// Wire Events
// ============================================================================

export const TurnBeginSchema = z.object({
  // User input, can be plain text or array of content parts
  user_input: z.union([z.string(), z.array(ContentPartSchema)]),
});
export type TurnBegin = z.infer<typeof TurnBeginSchema>;

// Step begin event
export const StepBeginSchema = z.object({
  // Step number, starting from 1
  n: z.number(),
});
export type StepBegin = z.infer<typeof StepBeginSchema>;

// Empty payload (for StepInterrupted, CompactionBegin, CompactionEnd)
export const EmptyPayloadSchema = z.object({});
// Step interrupted, no additional fields
export type StepInterrupted = z.infer<typeof EmptyPayloadSchema>;
// Context compaction started, no additional fields
export type CompactionBegin = z.infer<typeof EmptyPayloadSchema>;
// Context compaction ended, no additional fields
export type CompactionEnd = z.infer<typeof EmptyPayloadSchema>;

// Status update event
export const StatusUpdateSchema = z.object({
  // Context usage ratio, float between 0 and 1
  context_usage: z.number().nullable().optional(),
  // Token usage stats for the current step
  token_usage: TokenUsageSchema.nullable().optional(),
  // Message ID for the current step
  message_id: z.string().nullable().optional(),
});
export type StatusUpdate = z.infer<typeof StatusUpdateSchema>;

// Approval request payload
export const ApprovalRequestPayloadSchema = z.object({
  // Request ID, referenced when responding
  id: z.string(),
  // Associated tool call ID
  tool_call_id: z.string(),
  // Sender (tool name), e.g. "Shell", "WriteFile"
  sender: z.string(),
  // Action description, e.g. "run shell command"
  action: z.string(),
  // Detailed description, e.g. "Run command `rm -rf /`"
  description: z.string(),
  // Display blocks shown to the user
  display: z.array(DisplayBlockSchema).optional(),
});
export type ApprovalRequestPayload = z.infer<typeof ApprovalRequestPayloadSchema>;

// Approval request resolved event
export const ApprovalResponseEventSchema = z.object({
  // Resolved approval request ID
  request_id: z.string(),
  // Approval result
  response: ApprovalResponseSchema,
});
export type ApprovalResponseEvent = z.infer<typeof ApprovalResponseEventSchema>;

// Parse error payload
export interface ParseErrorPayload {
  code: string;
  message: string;
  rawType?: string;
}

// Sub-agent event
export interface SubagentEvent {
  task_tool_call_id: string;
  event: WireEvent;
}

// ============================================================================
// Wire Events & Requests
// ============================================================================

/**
 * Wire event union type
 * Sent from Agent to Client via `event` method, no response required
 */
export type WireEvent =
  | { type: "TurnBegin"; payload: TurnBegin }
  | { type: "StepBegin"; payload: StepBegin }
  | { type: "StepInterrupted"; payload: StepInterrupted }
  | { type: "CompactionBegin"; payload: CompactionBegin }
  | { type: "CompactionEnd"; payload: CompactionEnd }
  | { type: "StatusUpdate"; payload: StatusUpdate }
  | { type: "ContentPart"; payload: ContentPart }
  | { type: "ToolCall"; payload: ToolCall }
  | { type: "ToolCallPart"; payload: ToolCallPart }
  | { type: "ToolResult"; payload: ToolResult }
  | { type: "SubagentEvent"; payload: SubagentEvent }
  | { type: "ApprovalResponse"; payload: ApprovalResponseEvent }
  | { type: "ParseError"; payload: ParseErrorPayload };

export type WireRequest = { type: "ApprovalRequest"; payload: ApprovalRequestPayload } | { type: "ToolCallRequest"; payload: ToolCallRequest };

// Event type -> schema mapping
export const EventSchemas: Record<string, z.ZodSchema> = {
  TurnBegin: TurnBeginSchema,
  StepBegin: StepBeginSchema,
  StepInterrupted: EmptyPayloadSchema,
  CompactionBegin: EmptyPayloadSchema,
  CompactionEnd: EmptyPayloadSchema,
  StatusUpdate: StatusUpdateSchema,
  ContentPart: ContentPartSchema,
  ToolCall: ToolCallSchema,
  ToolCallPart: ToolCallPartSchema,
  ToolResult: ToolResultSchema,
  ApprovalResponse: ApprovalResponseEventSchema,
  // Legacy name support
  ApprovalRequestResolved: ApprovalResponseEventSchema,
};

// Request type -> schema mapping
export const RequestSchemas: Record<string, z.ZodSchema> = {
  ApprovalRequest: ApprovalRequestPayloadSchema,
  ToolCallRequest: ToolCallRequestSchema,
};

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

// Parse wire event (internal use)
export function parseEventPayload(type: string, payload: unknown): Result<WireEvent> {
  // Handle legacy event name
  const normalizedType = type === "ApprovalRequestResolved" ? "ApprovalResponse" : type;
  const schema = EventSchemas[type];
  if (!schema) {
    return { ok: false, error: `Unknown event type: ${type}` };
  }
  const result = schema.safeParse(payload);
  if (!result.success) {
    return { ok: false, error: `Invalid payload for ${type}: ${result.error.message}` };
  }
  return { ok: true, value: { type: normalizedType, payload: result.data } as WireEvent };
}

function parseWireEvent(raw: { type: string; payload?: unknown }): WireEvent {
  const result = parseEventPayload(raw.type, raw.payload);
  if (result.ok) {
    return result.value;
  }
  return {
    type: "ParseError",
    payload: {
      code: "SUBAGENT_PARSE_FAILED",
      message: result.error,
      rawType: raw.type,
    },
  };
}

export const SubagentEventSchema = z.lazy(() =>
  z.object({
    task_tool_call_id: z.string(),
    event: z.object({ type: z.string(), payload: z.unknown() }).transform(parseWireEvent),
  }),
) as z.ZodType<SubagentEvent, z.ZodTypeDef, unknown>;

EventSchemas.SubagentEvent = SubagentEventSchema;

// ============================================================================
// Stream Event
// ============================================================================

// Protocol parse error
export interface ParseError {
  type: "error";
  // Error code
  code: string;
  // Error message
  message: string;
  // Raw data (truncated to 500 chars)
  raw?: string;
}

/**
 * Stream event union type
 * Event type returned by the Turn iterator, includes WireEvent, WireRequest, and ParseError
 */
export type StreamEvent = WireEvent | WireRequest | ParseError;

// ============================================================================
// Run Result
// ============================================================================

// Turn run result
export const RunResultSchema = z.object({
  /**
   * Completion status
   * - `finished`: Turn completed normally
   * - `cancelled`: Turn was cancelled via cancel()
   * - `max_steps_reached`: Reached maximum step limit
   */
  status: z.enum(["finished", "cancelled", "max_steps_reached"]),
  // When status is max_steps_reached, returns the number of steps executed
  steps: z.number().optional(),
});
export type RunResult = z.infer<typeof RunResultSchema>;

// ============================================================================
// RPC Messages
// ============================================================================

// RPC error
export const RpcErrorSchema = z.object({
  // Error code
  code: z.number(),
  // Error message
  message: z.string(),
  // Extra data
  data: z.unknown().optional(),
});
export type RpcError = z.infer<typeof RpcErrorSchema>;

// RPC message (request, notification, or response)
export const RpcMessageSchema = z.object({
  jsonrpc: z.string().optional(),
  id: z.string().optional(),
  method: z.string().optional(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
  error: RpcErrorSchema.optional(),
});
export type RpcMessage = z.infer<typeof RpcMessageSchema>;

export function parseRequestPayload(type: string, payload: unknown): Result<WireRequest> {
  const schema = RequestSchemas[type];
  if (!schema) {
    return { ok: false, error: `Unknown request type: ${type}` };
  }
  const result = schema.safeParse(payload);
  if (!result.success) {
    return { ok: false, error: `Invalid payload for ${type}: ${result.error.message}` };
  }
  return { ok: true, value: { type, payload: result.data } as WireRequest };
}

// ============================================================================
// Config Types
// ============================================================================

// Model configuration
export interface ModelConfig {
  // Model ID for API calls
  id: string;
  // Model display name
  name: string;
  // Model capabilities, e.g. ["thinking", "image_in", "video_in"]
  capabilities: string[];
}

// Kimi configuration
export interface KimiConfig {
  // Default model ID
  defaultModel: string | null;
  // Default thinking mode
  defaultThinking: boolean;
  // Available models list
  models: ModelConfig[];
}

// MCP server configuration
export interface MCPServerConfig {
  // Server name for identification
  name: string;
  // Transport type
  transport: "http" | "stdio";
  // Server URL for HTTP transport
  url?: string;
  // Command to launch for stdio transport
  command?: string;
  // Command arguments for stdio transport
  args?: string[];
  // Environment variables
  env?: Record<string, string>;
  // HTTP headers
  headers?: Record<string, string>;
  // Authentication method, currently only "oauth" is supported
  auth?: "oauth";
}

// ============================================================================
// Session Types
// ============================================================================

// Session options
export interface SessionOptions {
  // Working directory path, required
  workDir: string;
  // Session ID, auto-generated UUID if not provided
  sessionId?: string;
  // Model ID
  model?: string;
  // Enable thinking mode, defaults to false
  thinking?: boolean;
  // Auto-approve all operations, defaults to false
  yoloMode?: boolean;
  // CLI executable path, defaults to "kimi"
  executable?: string;
  // Environment variables passed to CLI
  env?: Record<string, string>;
  externalTools?: ExternalTool[];
}

// Session info
export interface SessionInfo {
  // Session ID
  id: string;
  // Working directory
  workDir: string;
  // Context file path
  contextFile: string;
  // Last updated timestamp (milliseconds)
  updatedAt: number;
  // Summary of the first user message
  brief: string;
}

// ============================================================================
// Context Record (for history parsing)
// ============================================================================

// Context record (for parsing history)
export const ContextRecordSchema = z.object({
  role: z.string().optional(),
  content: z.unknown().optional(),
  tool_calls: z
    .array(
      z.object({
        id: z.string().optional(),
        function: z
          .object({
            name: z.string().optional(),
            arguments: z.union([z.string(), z.record(z.unknown())]).optional(),
          })
          .optional(),
      }),
    )
    .optional(),
  tool_call_id: z.string().optional(),
});
export type ContextRecord = z.infer<typeof ContextRecordSchema>;

// Parse request payload
export interface ExternalToolHandler {
  (params: Record<string, unknown>): Promise<{ output: string; message: string }>;
}

export interface ExternalTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: ExternalToolHandler;
}
