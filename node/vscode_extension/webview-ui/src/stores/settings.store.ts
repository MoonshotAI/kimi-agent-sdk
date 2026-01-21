import { create } from "zustand";
import { bridge } from "@/services";
import type { ExtensionConfig } from "shared/types";
import type { MCPServerConfig, ModelConfig, ThinkingMode, SlashCommandInfo } from "@moonshot-ai/kimi-agent-sdk";

export const DEFAULT_EXTENSION_CONFIG: ExtensionConfig = {
  executablePath: "",
  yoloMode: false,
  autosave: true,
  useCtrlEnterToSend: false,
  enableNewConversationShortcut: false,
  environmentVariables: {},
};

export function getModelThinkingMode(model: ModelConfig): ThinkingMode {
  if (model.name.toLowerCase().includes("think")) {
    return "always";
  }
  if (model.capabilities.includes("always_thinking")) {
    return "always";
  }
  if (model.capabilities.includes("thinking")) {
    return "switch";
  }
  return "none";
}

export function isImageModel(model: ModelConfig): boolean {
  return model.capabilities.includes("image_in");
}

export function isVideoModel(model: ModelConfig): boolean {
  return model.capabilities.includes("video_in");
}

export function getModelById(models: ModelConfig[], id: string): ModelConfig | undefined {
  return models.find((m) => m.id === id);
}

export interface MediaRequirements {
  image: boolean;
  video: boolean;
}

export function getModelsForMedia(models: ModelConfig[], mediaReq: MediaRequirements): ModelConfig[] {
  return models.filter((m) => {
    if (mediaReq.image && !isImageModel(m)) {
      return false;
    }
    if (mediaReq.video && !isVideoModel(m)) {
      return false;
    }
    return true;
  });
}

interface SettingsState {
  currentModel: string;
  thinkingEnabled: boolean;
  extensionConfig: ExtensionConfig;
  mcpServers: MCPServerConfig[];
  mcpModalOpen: boolean;
  models: ModelConfig[];
  defaultModel: string | null;
  defaultThinking: boolean;
  modelsLoaded: boolean;
  wireSlashCommands: SlashCommandInfo[];
  slashCommands: SlashCommandInfo[];

  setCurrentModel: (model: string) => void;
  setThinkingEnabled: (enabled: boolean) => void;
  updateModel: (modelId: string) => void;
  toggleThinking: () => void;
  setExtensionConfig: (config: ExtensionConfig) => void;
  setMCPServers: (servers: MCPServerConfig[]) => void;
  setMCPModalOpen: (open: boolean) => void;
  initModels: (models: ModelConfig[], defaultModel: string | null, defaultThinking: boolean) => void;
  setWireSlashCommands: (commands: SlashCommandInfo[]) => void;
  getCurrentThinkingMode: () => ThinkingMode;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  currentModel: "",
  thinkingEnabled: false,
  extensionConfig: DEFAULT_EXTENSION_CONFIG,
  mcpServers: [],
  mcpModalOpen: false,
  models: [],
  defaultModel: null,
  defaultThinking: false,
  modelsLoaded: false,
  wireSlashCommands: [],
  slashCommands: [],

  setCurrentModel: (currentModel) => set({ currentModel }),

  setThinkingEnabled: (thinkingEnabled) => set({ thinkingEnabled }),

  updateModel: (modelId) => {
    const { models, defaultThinking } = get();
    const model = getModelById(models, modelId);
    if (!model) {
      return;
    }

    const thinkingMode = getModelThinkingMode(model);
    let thinkingEnabled: boolean;

    if (thinkingMode === "always") {
      thinkingEnabled = true;
    } else if (thinkingMode === "none") {
      thinkingEnabled = false;
    } else {
      // switch mode - use default preference
      thinkingEnabled = defaultThinking;
    }

    set({ currentModel: modelId, thinkingEnabled });
    bridge.saveConfig({ model: modelId, thinking: thinkingEnabled });
  },

  toggleThinking: () => {
    const { models, currentModel, thinkingEnabled } = get();
    const model = getModelById(models, currentModel);
    if (!model) {
      return;
    }

    const thinkingMode = getModelThinkingMode(model);
    if (thinkingMode !== "switch") {
      return;
    } // Can only toggle in switch mode

    const newThinking = !thinkingEnabled;
    set({ thinkingEnabled: newThinking, defaultThinking: newThinking });
    bridge.saveConfig({ model: currentModel, thinking: newThinking });
  },

  setExtensionConfig: (extensionConfig) => set({ extensionConfig }),

  setMCPServers: (mcpServers) => set({ mcpServers }),

  setMCPModalOpen: (mcpModalOpen) => set({ mcpModalOpen }),

  initModels: (models, defaultModel, defaultThinking) => {
    const initialModel = defaultModel || (models.length > 0 ? models[0].id : "");
    const model = getModelById(models, initialModel);

    let thinkingEnabled = false;
    if (model) {
      const thinkingMode = getModelThinkingMode(model);
      if (thinkingMode === "always") {
        thinkingEnabled = true;
      } else if (thinkingMode === "switch") {
        thinkingEnabled = defaultThinking;
      }
    }

    set({
      models,
      defaultModel,
      defaultThinking,
      modelsLoaded: true,
      currentModel: initialModel,
      thinkingEnabled,
    });
  },

  setWireSlashCommands: (commands) => {
    set({
      wireSlashCommands: commands,
      slashCommands: commands,
    });
  },

  getCurrentThinkingMode: () => {
    const { models, currentModel } = get();
    const model = getModelById(models, currentModel);
    if (!model) {
      return "none";
    }
    return getModelThinkingMode(model);
  },
}));
