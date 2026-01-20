import { CliErrorCodes, SessionErrorCodes, TransportErrorCodes, ProtocolErrorCodes } from "@moonshot-ai/kimi-agent-sdk/errors";
import type { ErrorPhase } from "./types";

// Pre-flight: task didn't start at all or was blocked by "gatekeeper"
export const PREFLIGHT_CODES = new Set<string>([
  TransportErrorCodes.CLI_NOT_FOUND,
  TransportErrorCodes.SPAWN_FAILED,
  TransportErrorCodes.ALREADY_STARTED,
  TransportErrorCodes.STDIN_NOT_WRITABLE,
  TransportErrorCodes.PROCESS_CRASHED,
  CliErrorCodes.LLM_NOT_SET,
  CliErrorCodes.LLM_NOT_SUPPORTED,
  CliErrorCodes.INVALID_STATE,
  SessionErrorCodes.SESSION_BUSY,
]);

// User-friendly error messages
export const ERROR_MESSAGES: Record<string, string> = {
  // Pre-flight
  [TransportErrorCodes.CLI_NOT_FOUND]: "Kimi Code not found.",
  [TransportErrorCodes.SPAWN_FAILED]: "Failed to start Kimi Code.",
  [TransportErrorCodes.ALREADY_STARTED]: "A session is already running.",
  [TransportErrorCodes.STDIN_NOT_WRITABLE]: "Failed to communicate with Kimi Code.",
  [TransportErrorCodes.HANDSHAKE_TIMEOUT]: "Connection timed out.",
  [TransportErrorCodes.PROCESS_CRASHED]: "Process connection lost.",

  // CLI errors
  [CliErrorCodes.LLM_NOT_SET]: "Authentication failed. Please sign in.",
  [CliErrorCodes.LLM_NOT_SUPPORTED]: "This model is not supported.",
  [CliErrorCodes.INVALID_STATE]: "Please wait for the current operation.",
  [CliErrorCodes.CHAT_PROVIDER_ERROR]: "Service temporarily unavailable.",

  // Session errors
  [SessionErrorCodes.SESSION_BUSY]: "A message is being sent. Please wait.",
  [SessionErrorCodes.SESSION_CLOSED]: "Session was closed.",
  [SessionErrorCodes.TURN_INTERRUPTED]: "Stopped by user.",

  // Protocol errors
  [ProtocolErrorCodes.INVALID_JSON]: "Communication format error.",
  [ProtocolErrorCodes.INVALID_REQUEST]: "Invalid request.",
  [ProtocolErrorCodes.INVALID_PARAMS]: "Invalid parameters.",
  [ProtocolErrorCodes.INTERNAL_ERROR]: "Internal error occurred.",
};

export function classifyError(code: string): ErrorPhase {
  return PREFLIGHT_CODES.has(code) ? "preflight" : "runtime";
}

export function getUserMessage(code: string, fallback?: string): string {
  return ERROR_MESSAGES[code] || fallback || "An unknown error occurred.";
}

export function isPreflightError(code: string): boolean {
  return PREFLIGHT_CODES.has(code);
}

export function isUserInterrupt(code: string): boolean {
  return code === SessionErrorCodes.TURN_INTERRUPTED;
}
