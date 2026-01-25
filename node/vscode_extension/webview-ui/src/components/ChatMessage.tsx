import { useState } from "react";
import { IconLoader3 } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Content } from "@/lib/content";
import { Markdown } from "./Markdown";
import { ToolCallCard } from "./ToolRenderers";
import { CopyButton } from "./CopyButton";
import { ThinkingBlock } from "./ThinkingBlock";
import { CompactionCard } from "./CompactionCard";
import { MediaThumbnail } from "./MediaThumbnail";
import { MediaPreviewModal } from "./MediaPreviewModal";
import { InlineError } from "./InlineError";
import { useChatStore } from "@/stores";
import type { ChatMessage as ChatMessageType, UIStep, UIStepItem } from "@/stores/chat.store";

interface ChatMessageProps {
  message: ChatMessageType;
  isStreaming?: boolean;
}

function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-2 mt-1 text-blue-500/80 py-1">
      <IconLoader3 className="size-3.5 animate-spin" />
      <span className="text-[11px] font-medium tracking-wide">Processing...</span>
    </div>
  );
}

function StepItemRenderer({ item }: { item: UIStepItem }) {
  switch (item.type) {
    case "thinking":
      return <ThinkingBlock content={item.content} finished={item.finished} />;
    case "text":
      return <Markdown content={item.content} className="text-xs leading-relaxed" enableEnrichment={item.finished === true} />;
    case "tool_use":
      return <ToolCallCard call={item.call} result={item.result} subagentSteps={item.subagent_steps} />;
    case "compaction":
      return <CompactionCard />;
    default:
      return null;
  }
}

function StepContent({ step, showConnector }: { step: UIStep; showConnector?: boolean }) {
  const hasItems = step.items.length > 0;
  const hasToolOrThinking = step.items.some((item) => item.type === "tool_use" || item.type === "thinking" || item.type === "compaction");
  const showIndicator = hasToolOrThinking;
  const hasActiveItem = step.items.some((item) => (item.type === "text" || item.type === "thinking") && !item.finished);

  if (!hasItems) {
    return null;
  }

  return (
    <div className="flex gap-2">
      {showIndicator ? (
        <div className="hidden @[420px]:flex shrink-0 w-5 flex-col items-center relative">
          <div
            className={cn("size-1.5 rounded-full mt-2 shrink-0 relative z-10", hasActiveItem ? "bg-blue-400 shadow-[0_0_8px_rgba(59,130,246,0.6)] animate-pulse" : "bg-blue-400")}
          />
          {showConnector && (
            <div
              className={cn(
                "absolute left-1/2 w-px",
                hasActiveItem ? "bg-gradient-to-b from-zinc-300 to-transparent dark:from-zinc-600 dark:to-transparent" : "bg-zinc-300 dark:bg-zinc-600",
              )}
              style={{ top: "calc(0.5rem + 0.1875rem)", bottom: "calc(-0.75rem - 0.5rem - 0.1875rem)", transform: "translateX(-50%)" }}
            />
          )}
        </div>
      ) : (
        <div className="hidden @[420px]:block shrink-0 w-5" />
      )}
      <div className="flex-1 min-w-0 space-y-2">
        {step.items.map((item, idx) => (
          <StepItemRenderer key={`${step.n}-${idx}`} item={item} />
        ))}
      </div>
    </div>
  );
}

function MessageMedia({ images, videos, onPreview }: { images: string[]; videos: string[]; onPreview: (src: string) => void }) {
  if (images.length === 0 && videos.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap gap-2 my-2">
      {images.map((src, idx) => (
        <MediaThumbnail key={`img-${idx}`} src={src} size="md" onClick={() => onPreview(src)} />
      ))}
      {videos.map((src, idx) => (
        <MediaThumbnail key={`vid-${idx}`} src={src} size="md" onClick={() => onPreview(src)} />
      ))}
    </div>
  );
}

function UserMessage({ message }: { message: ChatMessageType }) {
  const [previewMedia, setPreviewMedia] = useState<string | null>(null);
  const displayContent = Content.getText(message.content);
  const images = Content.getImages(message.content);
  const videos = Content.getVideos(message.content);

  return (
    <div className="px-3 pt-3 pb-1 flex justify-end">
      <div className={cn("max-w-[85%] px-3.5 py-1.5 rounded-2xl rounded-br-md", "bg-zinc-100 dark:bg-zinc-800", "text-foreground")}>
        {displayContent && (
          <div className="text-xs leading-relaxed whitespace-pre-wrap wrap-break-word">
            <Markdown content={displayContent} enableEnrichment enableLocalImageRender={false} />
          </div>
        )}
        <MessageMedia images={images} videos={videos} onPreview={setPreviewMedia} />
      </div>
      <MediaPreviewModal src={previewMedia} onClose={() => setPreviewMedia(null)} />
    </div>
  );
}

function AssistantMessage({ message, isStreaming }: { message: ChatMessageType; isStreaming?: boolean }) {
  const [previewMedia, setPreviewMedia] = useState<string | null>(null);
  const { isCompacting } = useChatStore();

  const steps = message.steps || [];
  const hasSteps = steps.length > 0;
  const images = Content.getImages(message.content);
  const videos = Content.getVideos(message.content);

  const stepHasIndicator = steps.map((step) => step.items.some((item) => item.type === "tool_use" || item.type === "thinking" || item.type === "compaction"));

  const contentToCopy = (() => {
    if (!hasSteps) {
      return typeof message.content === "string" ? message.content : "";
    }
    const lastStep = steps[steps.length - 1];
    const textItems = lastStep.items.filter((item) => item.type === "text");
    if (textItems.length > 0) {
      return textItems.map((item) => (item as { type: "text"; content: string }).content).join("\n");
    }
    return typeof message.content === "string" ? message.content : "";
  })();

  if (!isStreaming && !hasMessageContent(message) && !message.inlineError) {
    return null;
  }

  const displayContent = typeof message.content === "string" ? message.content : "";
  const isShowingInlineError = message.inlineError && !isStreaming;

  return (
    <div className="@container px-3 py-3 group/message">
      <div className="flex gap-3 flex-col">
        <div className="flex flex-row items-center justify-start gap-2">
          <div className="shrink-0 size-5 rounded flex items-center justify-center text-[10px] font-medium bg-blue-500 text-white">K</div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Kimi</div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex flex-col">
            <div className="[&>*:not(:last-child)]:mb-3">
              {hasSteps &&
                steps.map((step, idx) => {
                  const hasNextIndicator = stepHasIndicator.slice(idx + 1).some(Boolean);
                  const showConnector = stepHasIndicator[idx] && hasNextIndicator;
                  return <StepContent key={step.n} step={step} showConnector={showConnector} />;
                })}
              {!hasSteps && displayContent && <Markdown content={displayContent} className="text-xs leading-relaxed @[420px]:pl-5" enableEnrichment={!isStreaming} />}
              {(images.length > 0 || videos.length > 0) && (
                <div className="@[420px]:pl-5">
                  <MessageMedia images={images} videos={videos} onPreview={setPreviewMedia} />
                </div>
              )}
            </div>

            {/* 内嵌错误显示 */}
            {isShowingInlineError && message.inlineError && (
              <div className="@[420px]:pl-5">
                <InlineError error={message.inlineError} />
              </div>
            )}
            <div className="flex flex-row items-center space-between">
              <div className="inline-flex flex-1">{isStreaming && !isShowingInlineError && !isCompacting && <ThinkingIndicator />}</div>
              <div className="inline-flex flex-1" />
              {!isStreaming && contentToCopy.trim().length > 0 && (
                <div className="flex justify-start pt-1 opacity-0 group-hover/message:opacity-100 transition-opacity duration-100">
                  <CopyButton content={contentToCopy} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <MediaPreviewModal src={previewMedia} onClose={() => setPreviewMedia(null)} />
    </div>
  );
}

function hasMessageContent(message: ChatMessageType): boolean {
  if (!Content.isEmpty(message.content)) {
    return true;
  }
  return message.steps?.some((s) => s.items.length > 0) ?? false;
}

export function ChatMessage({ message, isStreaming }: ChatMessageProps) {
  if (message.role === "user") {
    return <UserMessage message={message} />;
  }
  return <AssistantMessage message={message} isStreaming={isStreaming} />;
}
