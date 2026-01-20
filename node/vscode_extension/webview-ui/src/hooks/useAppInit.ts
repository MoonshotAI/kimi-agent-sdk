import { useState, useEffect } from "react";
import { bridge, Events } from "@/services";
import { useSettingsStore } from "@/stores";
import type { ExtensionConfig } from "shared/types";

export type InitStatus = "loading" | "ready" | "error";
export type ErrorType = "cli-error" | "no-models" | "no-workspace" | null;

export interface AppInitState {
  status: InitStatus;
  errorType: ErrorType;
  errorMessage: string | null;
}

function errorState(type: ErrorType, message: string): AppInitState {
  return { status: "error", errorType: type, errorMessage: message };
}

export function useAppInit(): AppInitState {
  const [state, setState] = useState<AppInitState>({ status: "ready", errorType: null, errorMessage: null });
  const [initKey, setInitKey] = useState(0);
  const { initModels, setExtensionConfig, setMCPServers } = useSettingsStore();

  // Watch for config changes, reinit when executablePath changes
  useEffect(() => {
    return bridge.on<{ config: ExtensionConfig; changedKeys: string[] }>(Events.ExtensionConfigChanged, ({ config, changedKeys }) => {
      setExtensionConfig(config);
      if (changedKeys.includes("executablePath")) {
        setState({ status: "loading", errorType: null, errorMessage: null });
        setInitKey((k) => k + 1);
      }
    });
  }, [setExtensionConfig]);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        // 1. Check workspace
        const workspace = await bridge.checkWorkspace();
        if (!workspace.hasWorkspace) {
          setState(errorState("no-workspace", "Please open a folder to start."));
          return;
        }

        // 2. Check if CLI been warmed up
        const { warmed } = await bridge.isCliWarmed();
        if (cancelled) {
          return;
        }
        if (!warmed) {
          setState({ status: "loading", errorType: null, errorMessage: null });
        }

        // 3. Load config, MCP servers and check CLI in parallel
        const [extensionConfig, mcpServers, cliResult] = await Promise.all([
          bridge.getExtensionConfig(),
          bridge.getMCPServers(),
          bridge.checkCLI(),
        ]);

        if (cancelled) {
          return;
        }

        setExtensionConfig(extensionConfig);
        setMCPServers(mcpServers);

        // 3. Check CLI result
        if (!cliResult.ok) {
          setState(errorState("cli-error", "Kimi CLI is not available or outdated."));
          return;
        }

        // 4. Load models
        const kimiConfig = await bridge.getModels();
        if (cancelled) {
          return;
        }

        if (!kimiConfig.models || kimiConfig.models.length === 0) {
          setState(errorState("no-models", "No models configured. Please run 'kimi setup' first."));
          return;
        }

        initModels(kimiConfig.models, kimiConfig.defaultModel, kimiConfig.defaultThinking);

        if (!cancelled) {
          setState({ status: "ready", errorType: null, errorMessage: null });
        }
      } catch (err) {
        if (!cancelled) {
          setState(errorState("cli-error", err instanceof Error ? err.message : "Failed to initialize"));
        }
      }
    }

    init();

    return () => {
      cancelled = true;
    };
  }, [initKey, initModels, setExtensionConfig, setMCPServers]);

  return state;
}
