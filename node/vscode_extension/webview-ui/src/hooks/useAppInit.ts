import { useState, useEffect, useCallback } from "react";
import { bridge, Events } from "@/services";
import { useSettingsStore } from "@/stores";
import type { ExtensionConfig, CLICheckResult } from "shared/types";

export type AppStatus = "loading" | "no-workspace" | "cli-error" | "not-logged-in" | "no-models" | "ready";

export interface AppInitState {
  status: AppStatus;
  errorMessage: string | null;
  cliResult: CLICheckResult | null;
  modelsCount: number;
  refresh: () => void;
}

export function useAppInit(): AppInitState {
  const [state, setState] = useState<Omit<AppInitState, "refresh">>({
    status: "loading",
    errorMessage: null,
    cliResult: null,
    modelsCount: 0,
  });
  const [initKey, setInitKey] = useState(0);
  const { initModels, setExtensionConfig, setMCPServers, setWireSlashCommands, setIsLoggedIn } = useSettingsStore();

  const refresh = useCallback(() => {
    setState({ status: "loading", errorMessage: null, cliResult: null, modelsCount: 0 });
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
          setState({ status: "no-workspace", errorMessage: null, cliResult: null, modelsCount: 0 });
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
            status: "cli-error",
            errorMessage: cliResult.error?.message ?? "CLI check failed",
            cliResult,
            modelsCount: 0,
          });
          return;
        }

        const [loginStatus, kimiConfig] = await Promise.all([bridge.checkLoginStatus(), bridge.getModels()]);
        if (cancelled) {
          return;
        }

        console.log("[AppInit] Login status:", loginStatus, "kimiConfig:", kimiConfig);

        setIsLoggedIn(loginStatus.loggedIn);
        initModels(kimiConfig.models, kimiConfig.defaultModel, kimiConfig.defaultThinking);

        const modelsCount = kimiConfig.models?.length ?? 0;

        if (!loginStatus.loggedIn) {
          setState({ status: "not-logged-in", errorMessage: null, cliResult, modelsCount });
          return;
        }

        if (modelsCount === 0) {
          setState({ status: "no-models", errorMessage: null, cliResult, modelsCount: 0 });
          return;
        }

        setState({ status: "ready", errorMessage: null, cliResult, modelsCount });
      } catch (err) {
        if (!cancelled) {
          setState({
            status: "cli-error",
            errorMessage: err instanceof Error ? err.message : "Failed to initialize",
            cliResult: null,
            modelsCount: 0,
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
