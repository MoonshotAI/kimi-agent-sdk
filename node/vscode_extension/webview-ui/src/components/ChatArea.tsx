import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { IconArrowDown } from "@tabler/icons-react";
import { ChatMessage } from "./ChatMessage";
import { WelcomeScreen } from "./WelcomeScreen";
import { useChatStore, type ChatMessage as ChatMessageType } from "@/stores";
import { cn } from "@/lib/utils";

const ESTIMATED_MESSAGE_HEIGHT = 240;
const OVERSCAN_PX = 800;
const BOTTOM_THRESHOLD_PX = 32;

interface VirtualMessageProps {
  index: number;
  message: ChatMessageType;
  turnIndex?: number;
  isStreaming: boolean;
  onHeight: (id: string, height: number) => void;
}

function VirtualMessage({ index, message, turnIndex, isStreaming, onHeight }: VirtualMessageProps) {
  const elementRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const observer = new ResizeObserver(([entry]) => onHeight(message.id, entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height));
    observer.observe(element);
    return () => observer.disconnect();
  }, [message.id, onHeight]);

  return (
    <div ref={elementRef} data-message-index={index}>
      <ChatMessage message={message} turnIndex={turnIndex} isStreaming={isStreaming} />
    </div>
  );
}

function findFirstVisible(offsets: number[], target: number): number {
  let low = 0;
  let high = offsets.length - 2;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (offsets[middle + 1] <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function MessageList() {
  const { messages, isStreaming } = useChatStore();
  const viewportRef = useRef<HTMLDivElement>(null);
  const heightsRef = useRef(new Map<string, number>());
  const [measurementVersion, setMeasurementVersion] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const { offsets, turnIndexes, totalHeight } = useMemo(() => {
    const nextOffsets = [0];
    const nextTurnIndexes: Array<number | undefined> = [];
    let turnCount = 0;

    for (const message of messages) {
      if (message.role === "user") turnCount++;
      nextTurnIndexes.push(message.role === "assistant" ? turnCount - 1 : undefined);
      nextOffsets.push(nextOffsets.at(-1)! + (heightsRef.current.get(message.id) ?? ESTIMATED_MESSAGE_HEIGHT));
    }

    return { offsets: nextOffsets, turnIndexes: nextTurnIndexes, totalHeight: nextOffsets.at(-1) ?? 0 };
  }, [messages, measurementVersion]);

  const visibleRange = useMemo(() => {
    if (messages.length === 0) return { start: 0, end: 0 };
    const start = findFirstVisible(offsets, Math.max(0, scrollTop - OVERSCAN_PX));
    const end = Math.min(messages.length, findFirstVisible(offsets, scrollTop + viewportHeight + OVERSCAN_PX) + 1);
    return { start, end };
  }, [messages.length, offsets, scrollTop, viewportHeight]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    viewportRef.current?.scrollTo({ top: viewportRef.current.scrollHeight, behavior });
  }, []);

  const handleHeight = useCallback((id: string, height: number) => {
    const roundedHeight = Math.ceil(height);
    if (heightsRef.current.get(id) === roundedHeight) return;
    heightsRef.current.set(id, roundedHeight);
    setMeasurementVersion((version) => version + 1);
  }, []);

  const handleScroll = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    setScrollTop(viewport.scrollTop);
    setIsAtBottom(viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= BOTTOM_THRESHOLD_PX);
  }, []);

  useLayoutEffect(() => {
    if (isAtBottom) scrollToBottom("auto");
  }, [isAtBottom, isStreaming, messages, measurementVersion, scrollToBottom]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(([entry]) => setViewportHeight(entry.contentRect.height));
    observer.observe(viewport);
    setViewportHeight(viewport.clientHeight);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div ref={viewportRef} className="h-full overflow-y-auto overflow-x-hidden" onScroll={handleScroll}>
        <div style={{ height: totalHeight, position: "relative" }}>
          <div style={{ position: "absolute", top: offsets[visibleRange.start], left: 0, right: 0 }}>
            {messages.slice(visibleRange.start, visibleRange.end).map((message, relativeIndex) => {
              const index = visibleRange.start + relativeIndex;
              return (
                <VirtualMessage
                  key={message.id}
                  index={index}
                  message={message}
                  turnIndex={turnIndexes[index]}
                  isStreaming={isStreaming && index === messages.length - 1 && message.role === "assistant"}
                  onHeight={handleHeight}
                />
              );
            })}
          </div>
        </div>
      </div>
      {!isAtBottom && (
        <button
          onClick={() => scrollToBottom()}
          className={cn("absolute bottom-4 right-4 p-2 rounded-full z-10", "bg-blue-400 text-white shadow-lg", "hover:bg-blue-600 transition-all")}
        >
          <IconArrowDown className="size-4" />
        </button>
      )}
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
      <MessageList />
    </div>
  );
}
