import { useState, useEffect, useCallback } from "react";
import { bridge, Events } from "@/services";
import { useSettingsStore } from "@/stores";
import type { ExtensionConfig, CLICheckResult } from "shared/types";

export type InitStatus = "loading" | "ready" | "error";
export type ErrorType = "cli-error" | "no-models" | "no-workspace" | "not-logged-in" | null;

export interface AppInitState {
  status: InitStatus;
  errorType: ErrorType;
  errorMessage: string | null;
  cliResult: CLICheckResult | null;
  refresh: () => void;
}

export function useAppInit(): AppInitState {
  const [state, setState] = useState<Omit<AppInitState, "refresh">>({
    status: "loading",
    errorType: null,
    errorMessage: null,
    cliResult: null,
  });
  const [initKey, setInitKey] = useState(0);
  const { initModels, setExtensionConfig, setMCPServers, setWireSlashCommands, setIsLoggedIn } = useSettingsStore();

  const refresh = useCallback(() => {
    setState((prev) => ({ ...prev, status: "loading", errorType: null, errorMessage: null }));
    setInitKey((k) => k + 1);
  }, []);

  useEffect(() => {
    return bridge.on<{ config: ExtensionConfig; changedKeys: string[] }>(Events.ExtensionConfigChanged, ({ config, changedKeys }) => {
      setExtensionConfig(config);
      if (changedKeys.includes("executablePath")) {
        refresh();
      }
    });
  }, [setExtensionConfig, refresh]);

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

        const [loginStatus, kimiConfig] = await Promise.all([bridge.checkLoginStatus(), bridge.getModels()]);
        if (cancelled) {
          return;
        }
        console.log(`Login status: ${loginStatus.loggedIn}, Kimi Config:`, kimiConfig);

        setIsLoggedIn(loginStatus.loggedIn);

        if (!kimiConfig.models || kimiConfig.models.length === 0) {
          setState({
            status: "error",
            errorType: "no-models",
            errorMessage: "No models configured. Please run setup.",
            cliResult,
          });
          return;
        }

        initModels(kimiConfig.models, kimiConfig.defaultModel, kimiConfig.defaultThinking);

        const needsLoginPrompt = !kimiConfig.defaultModel && !loginStatus.loggedIn;
        setState({
          status: "ready",
          errorType: needsLoginPrompt ? "not-logged-in" : null,
          errorMessage: null,
          cliResult,
        });
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
  }, [initKey, initModels, setExtensionConfig, setMCPServers, setWireSlashCommands, setIsLoggedIn]);

  return { ...state, refresh };
}
