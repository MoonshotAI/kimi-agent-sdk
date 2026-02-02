import { create } from "zustand";
import { produce } from "immer";
import { bridge } from "@/services";
import { Content } from "@/lib/content";
import { useApprovalStore } from "./approval.store";
import { useSettingsStore } from "./settings.store";
import { processEvent } from "./event-handlers";
import type { StatusUpdate, ContentPart } from "@moonshot-ai/kimi-agent-sdk/schema";
import type { UIStreamEvent } from "shared/types";

const HANDSHAKE_TIMEOUT_MS = 30_000;

export interface UIToolCall {
  id: string;
  name: string;
  arguments: string | null;
}

export interface UIStep {
  n: number;
  items: UIStepItem[];
}

export interface InlineError {
  code: string;
  message: string;
  detail?: string; // 服务器原始错误信息
}

export type UIStepItem =
  | { type: "thinking"; content: string; finished?: boolean }
  | { type: "text"; content: string; finished?: boolean }
  | { type: "compaction" }
  | {
      type: "tool_use";
      id: string;
      call: UIToolCall;
      result?: import("@moonshot-ai/kimi-agent-sdk/schema").ToolResult["return_value"];
      subagent_steps?: UIStep[];
    };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string | ContentPart[];
  timestamp: number;
  steps?: UIStep[];
  status?: StatusUpdate;
  inlineError?: InlineError;
}

export interface TokenUsage {
  input_other: number;
  output: number;
  input_cache_read: number;
  input_cache_creation: number;
}

function createEmptyTokenUsage(): TokenUsage {
  return { input_other: 0, output: 0, input_cache_read: 0, input_cache_creation: 0 };
}

export interface MediaInConversation {
  hasImage: boolean;
  hasVideo: boolean;
}

export interface DraftMediaItem {
  id: string;
  dataUri?: string;
}

export interface PendingInput {
  content: string | ContentPart[];
  model: string;
}

export interface ChatState {
  sessionId: string | null;
  messages: ChatMessage[];
  isStreaming: boolean;
  isCompacting: boolean;
  handshakeReceived: boolean;
  draftMedia: DraftMediaItem[];
  lastStatus: StatusUpdate | null;
  tokenUsage: TokenUsage;
  activeTokenUsage: TokenUsage;
  pendingInput: PendingInput | null;

  sendMessage: (text: string) => void;
  retryLastMessage: () => void;
  processEvent: (event: UIStreamEvent) => void;
  loadSession: (sessionId: string, events: UIStreamEvent[]) => void;
  startNewConversation: () => Promise<void>;
  abort: () => void;
  addDraftMedia: (id: string, dataUri?: string) => void;
  updateDraftMedia: (id: string, dataUri: string) => void;
  removeDraftMedia: (id: string) => void;
  clearDraftMedia: () => void;
  getMediaInConversation: () => MediaInConversation;
  hasProcessingMedia: () => boolean;
  rollbackInput: (content: string | ContentPart[]) => void;
}

let handshakeTimer: ReturnType<typeof setTimeout> | null = null;

function clearHandshakeTimer() {
  if (handshakeTimer) {
    clearTimeout(handshakeTimer);
    handshakeTimer = null;
  }
}

function clearAllInlineErrors(draft: ChatState): void {
  for (const msg of draft.messages) {
    if (msg.inlineError) {
      msg.inlineError = undefined;
    }
  }
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessionId: null,
  messages: [],
  isStreaming: false,
  isCompacting: false,
  handshakeReceived: false,
  draftMedia: [],
  lastStatus: null,
  tokenUsage: createEmptyTokenUsage(),
  activeTokenUsage: createEmptyTokenUsage(),
  pendingInput: null,

  sendMessage: (text) => {
    const { draftMedia, sessionId, isStreaming } = get();
    const { currentModel, thinkingEnabled } = useSettingsStore.getState();

    if (isStreaming) {
      return;
    }

    const readyMedia = draftMedia.filter((m) => m.dataUri).map((m) => m.dataUri!);
    const content = readyMedia.length > 0 ? Content.build(text, readyMedia) : text;

    if (Content.isEmpty(content)) {
      return;
    }

    // Clear draft and set streaming state
    set(
      produce((draft: ChatState) => {
        clearAllInlineErrors(draft);
        draft.draftMedia = [];
        draft.isStreaming = true;
        draft.handshakeReceived = false;
        draft.pendingInput = { content, model: currentModel };
      }),
    );

    useApprovalStore.getState().clearRequests();

    // Set handshake timeout
    clearHandshakeTimer();
    handshakeTimer = setTimeout(() => {
      const state = get();
      if (state.isStreaming && !state.handshakeReceived) {
        bridge.abortChat();
        get().processEvent({
          type: "error",
          code: "HANDSHAKE_TIMEOUT",
          message: "Connection timed out.",
          phase: "runtime",
        });
      }
    }, HANDSHAKE_TIMEOUT_MS);

    bridge.streamChat(content, currentModel, thinkingEnabled, sessionId ?? undefined);
  },

  retryLastMessage: () => {
    const { pendingInput, isStreaming, sessionId } = get();
    const { thinkingEnabled } = useSettingsStore.getState();

    if (isStreaming || !pendingInput) {
      return;
    }

    set({ isStreaming: true, handshakeReceived: false });
    useApprovalStore.getState().clearRequests();

    // Remove failed assistant message and user message
    set(
      produce((draft: ChatState) => {
        clearAllInlineErrors(draft);
        const lastAssistant = draft.messages.at(-1);
        if (lastAssistant?.role === "assistant" && lastAssistant.inlineError) {
          draft.messages.pop();
          if (draft.messages.at(-1)?.role === "user") {
            draft.messages.pop();
          }
        }
      }),
    );

    // Set handshake timeout
    clearHandshakeTimer();
    handshakeTimer = setTimeout(() => {
      const state = get();
      if (state.isStreaming && !state.handshakeReceived) {
        bridge.abortChat();
        get().processEvent({
          type: "error",
          code: "HANDSHAKE_TIMEOUT",
          message: "Connection timed out.",
          phase: "runtime",
        });
      }
    }, HANDSHAKE_TIMEOUT_MS);

    bridge.streamChat(pendingInput.content, pendingInput.model, thinkingEnabled, sessionId ?? undefined);
  },

  processEvent: (event) => {
    // Clear handshake timeout on receiving valid response
    if (event.type === "TurnBegin" || event.type === "StepBegin" || event.type === "ContentPart") {
      clearHandshakeTimer();
      set({ handshakeReceived: true });
    }

    set(
      produce((draft: ChatState) => {
        processEvent(draft, event);
      }),
    );
  },

  loadSession: (sessionId, events) => {
    clearHandshakeTimer();
    set({
      sessionId,
      messages: [],
      isStreaming: false,
      isCompacting: false,
      handshakeReceived: false,
      draftMedia: [],
      lastStatus: null,
      tokenUsage: createEmptyTokenUsage(),
      activeTokenUsage: createEmptyTokenUsage(),
      pendingInput: null,
    });
    useApprovalStore.getState().clearRequests();
    bridge.clearTrackedFiles();

    for (const event of events) {
      get().processEvent(event);
    }

    // All steps are finished when loading from history
    set(
      produce((draft: ChatState) => {
        for (const msg of draft.messages) {
          if (msg.steps) {
            for (const step of msg.steps) {
              for (const item of step.items) {
                if (item.type === "text" || item.type === "thinking") {
                  item.finished = true;
                }
              }
            }
          }
        }
        draft.isStreaming = false;
        draft.isCompacting = false;
      }),
    );
    useApprovalStore.getState().clearRequests();
  },

  startNewConversation: async () => {
    clearHandshakeTimer();
    await bridge.resetSession();
    await bridge.clearTrackedFiles();
    set({
      sessionId: null,
      messages: [],
      isStreaming: false,
      isCompacting: false,
      handshakeReceived: false,
      draftMedia: [],
      lastStatus: null,
      tokenUsage: createEmptyTokenUsage(),
      activeTokenUsage: createEmptyTokenUsage(),
      pendingInput: null,
    });
    useApprovalStore.getState().clearRequests();
  },

  abort: () => {
    clearHandshakeTimer();
    bridge.abortChat();
    useApprovalStore.getState().clearRequests();
  },

  addDraftMedia: (id, dataUri) => {
    set((s) => ({ draftMedia: [...s.draftMedia, { id, dataUri }] }));
  },

  updateDraftMedia: (id, dataUri) => {
    set((s) => ({
      draftMedia: s.draftMedia.map((m) => (m.id === id ? { ...m, dataUri } : m)),
    }));
  },

  removeDraftMedia: (id) => {
    set((s) => ({ draftMedia: s.draftMedia.filter((m) => m.id !== id) }));
  },

  clearDraftMedia: () => {
    set({ draftMedia: [] });
  },

  getMediaInConversation: () => {
    const { messages, draftMedia } = get();

    let hasImage = false;
    let hasVideo = false;

    for (const item of draftMedia) {
      if (!item.dataUri) {
        continue;
      }
      if (item.dataUri.startsWith("data:image/")) {
        hasImage = true;
      } else if (item.dataUri.startsWith("data:video/")) {
        hasVideo = true;
      }
    }

    for (const msg of messages) {
      if (Content.hasImages(msg.content)) {
        hasImage = true;
      }
      if (Content.hasVideos(msg.content)) {
        hasVideo = true;
      }
      if (hasImage && hasVideo) {
        break;
      }
    }

    return { hasImage, hasVideo };
  },

  hasProcessingMedia: () => {
    return get().draftMedia.some((m) => !m.dataUri);
  },

  rollbackInput: (content) => {
    const { currentModel } = useSettingsStore.getState();
    set({ pendingInput: { content, model: currentModel } });
  },
}));
