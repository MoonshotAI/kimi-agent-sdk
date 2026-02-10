import ScrollToBottom, { useScrollToBottom, useSticky } from "react-scroll-to-bottom";
import { IconArrowDown } from "@tabler/icons-react";
import { ChatMessage } from "./ChatMessage";
import { WelcomeScreen } from "./WelcomeScreen";
import { useChatStore } from "@/stores";
import { cn } from "@/lib/utils";

function ScrollButton() {
  const scrollToBottom = useScrollToBottom();
  const [sticky] = useSticky();

  if (sticky) return null;

  return (
    <button
      onClick={() => scrollToBottom()}
      className={cn("absolute bottom-4 right-4 p-2 rounded-full z-10", "bg-blue-400 text-white shadow-lg", "hover:bg-blue-600 transition-all")}
    >
      <IconArrowDown className="size-4" />
    </button>
  );
}

function MessageList() {
  const { messages, isStreaming } = useChatStore();

  // Calculate turn index for each assistant message
  // Turn index is 0-indexed, counting user messages
  const getTurnIndex = (idx: number): number | undefined => {
    if (messages[idx]?.role !== "assistant") return undefined;
    let turnCount = 0;
    for (let i = 0; i < idx; i++) {
      if (messages[i].role === "user") turnCount++;
    }
    return turnCount - 1; // 0-indexed (first turn = 0)
  };

  return (
    <>
      <div className="">
        {messages.map((message, idx) => (
          <ChatMessage
            key={message.id}
            message={message}
            turnIndex={getTurnIndex(idx)}
            isStreaming={isStreaming && idx === messages.length - 1 && message.role === "assistant"}
          />
        ))}
      </div>
      <ScrollButton />
    </>
  );
}

export function ChatArea() {
  const { messages } = useChatStore();

  if (messages.length === 0) {
    return (
      <div className="h-full flex items-center justify-center relative">
        <WelcomeScreen />
      </div>
    );
  }

  return (
    <div className="h-full relative">
      <ScrollToBottom className="h-full" scrollViewClassName="h-full overflow-y-auto overflow-x-hidden" followButtonClassName="hidden" initialScrollBehavior="auto">
        <MessageList />
      </ScrollToBottom>
    </div>
  );
}
