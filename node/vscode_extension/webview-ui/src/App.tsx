import { useEffect, useState, useCallback } from "react";
import { Header } from "./components/Header";
import { ChatArea } from "./components/ChatArea";
import { InputArea } from "./components/inputarea/InputArea";
import { ApprovalDialog } from "./components/ApprovalDialog";
import { MCPServersModal } from "./components/MCPServersModal";
import { ConfigErrorScreen } from "./components/ConfigErrorScreen";
import { LoginScreen } from "./components/LoginScreen";
import { Toaster, toast } from "./components/ui/sonner";
import { useChatStore, useSettingsStore } from "./stores";
import { bridge, Events } from "./services";
import { useAppInit } from "./hooks/useAppInit";
import { isPreflightError } from "shared/errors";
import type { UIStreamEvent, StreamError, ExtensionConfig } from "shared/types";
import "./styles/index.css";

function MainContent({ onAuthAction }: { onAuthAction: () => void }) {
  const { processEvent, startNewConversation } = useChatStore();
  const { setMCPServers, setExtensionConfig, extensionConfig } = useSettingsStore();

  useEffect(() => {
    return bridge.on(Events.StreamEvent, (event: UIStreamEvent) => {
      processEvent(event);
      if (event.type === "error") {
        const streamError = event as StreamError;
        if (isPreflightError(streamError.code || "UNKNOWN")) {
          toast.error(streamError.message);
        }
      }
    });
  }, [processEvent]);

  useEffect(() => {
    const unsubs = [
      bridge.on(Events.MCPServersChanged, setMCPServers),
      bridge.on(Events.ExtensionConfigChanged, ({ config }: { config: ExtensionConfig }) => setExtensionConfig(config)),
      bridge.on(Events.FocusInput, () => document.querySelector<HTMLTextAreaElement>("textarea")?.focus()),
      bridge.on(Events.NewConversation, () => startNewConversation()),
    ];
    return () => unsubs.forEach((u) => u());
  }, [setMCPServers, setExtensionConfig, startNewConversation]);

  useEffect(() => {
    if (!extensionConfig.enableNewConversationShortcut) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        startNewConversation();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [extensionConfig.enableNewConversationShortcut, startNewConversation]);

  return (
    <>
      <div className="flex-1 min-h-0 relative group/chat">
        <ChatArea />
      </div>
      <ApprovalDialog />
      <InputArea onAuthAction={onAuthAction} />
      <MCPServersModal />
    </>
  );
}

export default function App() {
  const { status, errorMessage, cliResult, modelsCount, refresh } = useAppInit();
  const [skippedLogin, setSkippedLogin] = useState(false);

  const handleLoginSuccess = useCallback(() => {
    refresh();
  }, [refresh]);

  const handleSkip = useCallback(() => {
    setSkippedLogin(true);
  }, []);

  const handleAuthAction = useCallback(() => {
    setSkippedLogin(false);
    refresh();
  }, [refresh]);

  // 未登录且未 skip → 显示登录页
  if (status === "not-logged-in" && !skippedLogin) {
    return (
      <div className="flex flex-col h-screen text-foreground overflow-hidden">
        <Header />
        <LoginScreen onLoginSuccess={handleLoginSuccess} onSkip={handleSkip} />
        <Toaster position="top-center" />
      </div>
    );
  }

  // skip 登录但没有 models → 显示 no-models
  if (skippedLogin && modelsCount === 0) {
    return (
      <div className="flex flex-col h-screen text-foreground overflow-hidden">
        <Header />
        <ConfigErrorScreen type="no-models" cliResult={cliResult} errorMessage={errorMessage} onRefresh={refresh} onBackToLogin={() => setSkippedLogin(false)} />
        <Toaster position="top-center" />
      </div>
    );
  }

  // 其他错误状态
  if (status !== "ready" && status !== "not-logged-in") {
    return (
      <div className="flex flex-col h-screen text-foreground overflow-hidden">
        <Header />
        <ConfigErrorScreen type={status} cliResult={cliResult} errorMessage={errorMessage} />
        <Toaster position="top-center" />
      </div>
    );
  }

  // ready 或 skip 登录但有 models
  return (
    <div className="flex flex-col h-screen text-foreground overflow-hidden">
      <Header />
      <MainContent onAuthAction={handleAuthAction} />
      <Toaster position="top-center" />
    </div>
  );
}
