import { useMemo } from "react";
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

  // Precompute turn indices in O(n) instead of O(n²) per render.
  // turnIndices[i] is the turn index for messages[i] when it is an assistant
  // message, otherwise undefined.
  const turnIndices = useMemo<(number | undefined)[]>(() => {
    const indices: (number | undefined)[] = [];
    let userCount = 0;
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].role === "assistant") {
        indices.push(userCount - 1);
      } else {
        indices.push(undefined);
      }
      if (messages[i].role === "user") {
        userCount++;
      }
    }
    return indices;
  }, [messages]);

  return (
    <>
      <div className="">
        {messages.map((message, idx) => (
          <ChatMessage
            key={message.id}
            message={message}
            turnIndex={turnIndices[idx]}
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
