/**
 * Kimi Code Agent SDK - TypeScript SDK for Kimi Code Wire protocol.
 *
 * @example Quick Start
 * ```typescript
 * import { createSession } from "@moonshot-ai/kimi-agent-sdk";
 *
 * const session = createSession({
 *   workDir: process.cwd(),
 *   model: "kimi-k2-0711-preview",
 * });
 *
 * const turn = session.prompt("Hello");
 * for await (const event of turn) {
 *   if (event.type === "text") console.log(event.text);
 *   if (event.type === "approval_request") {
 *     await turn.approve(event.id, "approve");
 *   }
 * }
 *
 * await session.close();
 * ```
 *
 * @module @moonshot-ai/kimi-agent-sdk
 */

// Session
export { createSession, prompt } from "./session";
export type { Session, Turn, SessionState } from "./session";

// Storage
export { listSessions, deleteSession } from "./storage";

// History
export { parseSessionEvents } from "./history/context-extract";

// Config
export { parseConfig, saveDefaultModel, getModelById, isModelThinking, getModelThinkingMode } from "./config";
export type { ThinkingMode } from "./config";

// Paths
export { KimiPaths } from "./paths";

// CLI Commands
export { authMCP, resetAuthMCP, testMCP } from "./cli/commands";
export type { MCPTestResult } from "./cli/commands";

export { createExternalTool } from "./external-tool";

// Errors
export {
  AgentSdkError,
  TransportError,
  ProtocolError,
  SessionError,
  CliError,
  isAgentSdkError,
  getErrorCode,
  getErrorCategory,
  TransportErrorCodes,
  ProtocolErrorCodes,
  SessionErrorCodes,
  CliErrorCodes,
} from "./errors";
export type { ErrorCategory, TransportErrorCodeType, ProtocolErrorCodeType, SessionErrorCodeType, CliErrorCodeType } from "./errors";

// Utils
export { extractBrief, extractTextFromContentParts, formatContentOutput } from "./utils";

// Types
export type {
  ApprovalResponse,
  ContentPart,
  TokenUsage,
  DisplayBlock,
  BriefBlock,
  DiffBlock,
  TodoBlock,
  ShellBlock,
  UnknownBlock,
  ToolCall,
  ToolCallPart,
  ToolResult,
  ToolReturnValue,
  TurnBegin,
  StepBegin,
  StatusUpdate,
  ApprovalRequestPayload,
  SubagentEvent,
  StreamEvent,
  RunResult,
  ModelConfig,
  MCPServerConfig,
  KimiConfig,
  SessionOptions,
  SessionInfo,
  ContextRecord,
  InitializeParams,
  InitializeResult,
  SlashCommandInfo,
  ExternalTool,
  ExternalToolDefinition,
  ExternalToolHandler,
  ToolCallRequest,
  ClientInfo,
  ServerInfo,
} from "./schema";

// Schemas
export {
  ContentPartSchema,
  DisplayBlockSchema,
  ToolCallSchema,
  ToolResultSchema,
  RunResultSchema,
  InitializeResultSchema,
  SlashCommandInfoSchema,
  parseEventPayload,
  parseRequestPayload,
} from "./schema";

// Protocol
export { ProtocolClient } from "./protocol";

// Logging
export { enableLogs, disableLogs, setLogSink } from "./logger";
