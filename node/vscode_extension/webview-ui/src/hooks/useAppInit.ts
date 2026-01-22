import { useState, useEffect } from "react";
import { bridge, Events } from "@/services";
import { useSettingsStore } from "@/stores";
import type { ExtensionConfig, CLICheckResult } from "shared/types";

export type InitStatus = "loading" | "ready" | "error";
export type ErrorType = "cli-error" | "no-models" | "no-workspace" | null;

export interface AppInitState {
  status: InitStatus;
  errorType: ErrorType;
  errorMessage: string | null;
  cliResult: CLICheckResult | null;
}

export function useAppInit(): AppInitState {
  const [state, setState] = useState<AppInitState>({
    status: "loading",
    errorType: null,
    errorMessage: null,
    cliResult: null,
  });
  const [initKey, setInitKey] = useState(0);
  const { initModels, setExtensionConfig, setMCPServers, setWireSlashCommands } = useSettingsStore();

  useEffect(() => {
    return bridge.on<{ config: ExtensionConfig; changedKeys: string[] }>(Events.ExtensionConfigChanged, ({ config, changedKeys }) => {
      setExtensionConfig(config);
      if (changedKeys.includes("executablePath")) {
        setState({ status: "loading", errorType: null, errorMessage: null, cliResult: null });
        setInitKey((k) => k + 1);
      }
    });
  }, [setExtensionConfig]);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const workspace = await bridge.checkWorkspace();
        if (cancelled) {
          return;
        }

        if (!workspace.hasWorkspace) {
          setState({
            status: "error",
            errorType: "no-workspace",
            errorMessage: "Please open a folder to start.",
            cliResult: null,
          });
          return;
        }

        const [extensionConfig, mcpServers, cliResult] = await Promise.all([bridge.getExtensionConfig(), bridge.getMCPServers(), bridge.checkCLI()]);
        if (cancelled) {
          return;
        }

        setExtensionConfig(extensionConfig);
        setMCPServers(mcpServers);
        setWireSlashCommands(cliResult.slashCommands ?? []);

        if (!cliResult.ok) {
          setState({
            status: "error",
            errorType: "cli-error",
            errorMessage: cliResult.error?.message ?? "CLI check failed",
            cliResult,
          });
          return;
        }

        const kimiConfig = await bridge.getModels();
        if (cancelled) {
          return;
        }

        if (!kimiConfig.models || kimiConfig.models.length === 0) {
          setState({
            status: "error",
            errorType: "no-models",
            errorMessage: "No models configured. Please run setup first.",
            cliResult,
          });
          return;
        }

        initModels(kimiConfig.models, kimiConfig.defaultModel, kimiConfig.defaultThinking);
        setState({ status: "ready", errorType: null, errorMessage: null, cliResult });
      } catch (err) {
        if (!cancelled) {
          setState({
            status: "error",
            errorType: "cli-error",
            errorMessage: err instanceof Error ? err.message : "Failed to initialize",
            cliResult: null,
          });
        }
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [initKey, initModels, setExtensionConfig, setMCPServers, setWireSlashCommands]);

  return state;
}
