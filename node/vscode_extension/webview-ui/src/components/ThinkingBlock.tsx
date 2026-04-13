import { IconLoader3, IconBulb } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

interface ThinkingBlockProps {
  content: string;
  finished?: boolean;
  compact?: boolean;
}

export function ThinkingBlock({ finished, compact }: ThinkingBlockProps) {
  const isStreaming = !finished;

  return (
    <div className="rounded-lg border border-zinc-200/50 bg-zinc-50/30 dark:border-zinc-800/50 dark:bg-zinc-900/10 overflow-hidden">
      <div
        className={cn("w-full flex items-center gap-2", compact ? "px-2 py-1.5" : "px-3 py-2")}
      >
        <div className="inline-flex items-center gap-2">
          <IconBulb className={cn("text-zinc-500", compact ? "size-3" : "size-3.5")} />
          <span className={cn("font-medium text-zinc-700 dark:text-zinc-300", compact ? "text-[0.75rem]" : "text-xs")}>Thinking</span>
          {isStreaming && <IconLoader3 className={cn("text-zinc-400 ml-auto animate-spin", compact ? "size-3" : "size-3.5")} />}
        </div>
      </div>
    </div>
  );
}
