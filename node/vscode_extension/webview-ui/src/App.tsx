import { useEffect } from "react";
import { Header } from "./components/Header";
import { ChatArea } from "./components/ChatArea";
import { InputArea } from "./components/inputarea/InputArea";
import { ApprovalDialog } from "./components/ApprovalDialog";
import { MCPServersModal } from "./components/MCPServersModal";
import { ConfigErrorScreen } from "./components/ConfigErrorScreen";
import { Toaster, toast } from "./components/ui/sonner";
import { useChatStore, useSettingsStore } from "./stores";
import { bridge, Events } from "./services";
import { useAppInit } from "./hooks/useAppInit";
import { isPreflightError, getUserMessage } from "shared/errors";
import type { UIStreamEvent, StreamError, ExtensionConfig } from "shared/types";
import "./styles/index.css";

function MainContent() {
  const { processEvent, startNewConversation } = useChatStore();
  const { setMCPServers, setExtensionConfig, extensionConfig } = useSettingsStore();

  useEffect(() => {
    return bridge.on(Events.StreamEvent, (event: UIStreamEvent) => {
      processEvent(event);
      if (event.type === "error") {
        const streamError = event as StreamError;
        const code = streamError.code || "UNKNOWN";
        if (isPreflightError(code)) {
          const message = getUserMessage(code, streamError.message);
          toast.error(message);
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
    if (!extensionConfig.enableNewConversationShortcut) {
      return;
    }
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
      <InputArea />
      <MCPServersModal />
    </>
  );
}

export default function App() {
  const { status, errorType, errorMessage, cliResult } = useAppInit();

  if (status !== "ready") {
    return (
      <div className="flex flex-col h-screen text-foreground overflow-hidden">
        <Header />
        <ConfigErrorScreen type={errorType ?? "loading"} cliResult={cliResult} errorMessage={errorMessage} />
        <Toaster position="top-center" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen text-foreground overflow-hidden">
      <Header />
      <MainContent />
      <Toaster position="top-center" />
    </div>
  );
}
