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

  // 监听配置变化，executablePath 改变时重新初始化
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

        // 3. Load configuration in parallel
        const configPromise = bridge.getExtensionConfig().then((config) => {
          if (!cancelled) {
            setExtensionConfig(config);
          }
        });

        const mcpPromise = bridge.getMCPServers().then((servers) => {
          if (!cancelled) {
            setMCPServers(servers);
          }
        });

        // 4. Check CLI (this might be a slow operation)
        let cliResult = await bridge.checkCLI();
        if (cancelled) {
          return;
        }
        console.log("[Kimi Code] App init: CLI check result:", cliResult);

        // 5. If CLI check failed, try to install
        if (!cliResult.ok) {
          console.log("[Kimi Code] App init: Attempting to install Kimi CLI...");
          await bridge.installCLI();
          if (cancelled) {
            return;
          }

          console.log("[Kimi Code] App init: Checking Kimi CLI after installation...");
          cliResult = await bridge.checkCLI();
        }

        if (!cliResult.ok) {
          setState(errorState("cli-error", "Kimi CLI is not installed or outdated."));
          return;
        }

        // 6. Load models
        const kimiConfig = await bridge.getModels();
        if (cancelled) {
          return;
        }

        if (!kimiConfig.models || kimiConfig.models.length === 0) {
          setState(errorState("no-models", "No models configured. Please run 'kimi setup' first."));
          return;
        }

        initModels(kimiConfig.models, kimiConfig.defaultModel, kimiConfig.defaultThinking);

        await Promise.all([configPromise, mcpPromise]);
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
