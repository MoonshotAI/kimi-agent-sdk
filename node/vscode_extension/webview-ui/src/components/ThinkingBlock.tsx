import { useState } from "react";
import { IconChevronDown, IconLoader3, IconBulb } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Markdown } from "./Markdown";
import { useSettingsStore } from "@/stores";

interface ThinkingBlockProps {
  content: string;
  finished?: boolean;
  compact?: boolean;
}

export function ThinkingBlock({ content, finished, compact }: ThinkingBlockProps) {
  const { extensionConfig } = useSettingsStore();
  const showThinkingContent = extensionConfig.showThinkingContent;

  const [expanded, setExpanded] = useState(extensionConfig.showThinkingExpanded);
  const isStreaming = !finished;

  if (!showThinkingContent) {
    // Hidden mode: static label, no interaction
    return (
      <div className="rounded-lg bg-input overflow-hidden">
        <div
          className={cn("w-full flex items-center gap-2", compact ? "px-2 py-1.5" : "px-3 py-2")}
        >
          <div className="inline-flex items-center gap-2">
            <IconBulb className={cn("text-muted-foreground", compact ? "size-3" : "size-3.5")} />
            <span className={cn("font-medium text-foreground", compact ? "text-[0.75rem]" : "text-xs")}>Thinking</span>
            {isStreaming && <IconLoader3 className={cn("text-muted-foreground ml-auto animate-spin", compact ? "size-3" : "size-3.5")} />}
          </div>
        </div>
      </div>
    );
  }

  // Show mode: clickable, expandable/collapsible
  if (!content && !isStreaming) {
    return null;
  }

  return (
    <div className="rounded-lg bg-input overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        data-block-header="thinking"
        className={cn("w-full flex items-center gap-2 hover:bg-muted/50 transition-colors", compact ? "px-2 py-1.5" : "px-3 py-2")}
      >
        <div className="inline-flex items-center gap-2">
          <IconBulb className={cn("text-muted-foreground", compact ? "size-3" : "size-3.5")} />
          <span className={cn("font-medium text-foreground", compact ? "text-[0.75rem]" : "text-xs")}>Thinking</span>
          {isStreaming && <IconLoader3 className={cn("text-muted-foreground ml-auto animate-spin", compact ? "size-3" : "size-3.5")} />}
        </div>
        <IconChevronDown className={cn("text-muted-foreground ml-auto transition-transform", compact ? "size-3" : "size-3.5", expanded && "rotate-180")} />
      </button>

      {expanded && content && (
        <Markdown
          content={content}
          className={cn("border-t border-[var(--border)]", compact ? "py-2 px-2 text-[0.75rem]" : "py-3 px-2 pl-3.5 text-xs")}
          enableEnrichment={finished}
        />
      )}
    </div>
  );
}
