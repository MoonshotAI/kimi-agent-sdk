import type { RunResult, StreamEvent, ContentPart, SlashCommandInfo } from "@moonshot-ai/kimi-agent-sdk";

export interface SessionConfig {
  model: string;
  thinking?: boolean;
}

export interface ProjectFile {
  path: string;
  name: string;
  isDirectory: boolean;
}

export interface EditorContext {
  content: string;
  language: string;
  fileName: string;
  selection?: {
    text: string;
    startLine: number;
    endLine: number;
  };
}

export interface FileChange {
  path: string;
  status: "Modified" | "Added" | "Deleted";
  additions: number;
  deletions: number;
}

export interface DiffInfo {
  path: string;
  oldText: string;
}

export interface ExtensionConfig {
  executablePath: string;
  yoloMode: boolean;
  autosave: boolean;
  useCtrlEnterToSend: boolean;
  enableNewConversationShortcut: boolean;
  environmentVariables: Record<string, string>;
}

export interface WorkspaceStatus {
  hasWorkspace: boolean;
  path?: string;
}

export type ErrorPhase = "preflight" | "runtime";

export interface StreamError {
  type: "error";
  code: string;
  message: string;
  phase: ErrorPhase;
}

export type UIStreamEvent = { type: "session_start"; sessionId: string; model?: string } | { type: "stream_complete"; result: RunResult } | StreamError | StreamEvent;

export type CLIErrorType = "not_found" | "version_low" | "extract_failed" | "protocol_error";

export interface CLICheckResult {
  ok: boolean;
  slashCommands?: SlashCommandInfo[];
  error?: {
    type: CLIErrorType;
    message: string;
  };
  resolved: {
    isCustomPath: boolean;
    path: string;
  };
}
