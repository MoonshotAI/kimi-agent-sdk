import { useChatStore } from "@/stores";
import { cn } from "@/lib/utils";
import { IconCpu, IconArrowUp, IconArrowDown } from "@tabler/icons-react";

export function ChatStatus() {
  const { lastStatus, tokenUsage, activeTokenUsage } = useChatStore();

  if (!lastStatus) {
    return null;
  }

  const { context_usage } = lastStatus;

  const inputTotal =
    tokenUsage.input_other +
    tokenUsage.input_cache_read +
    tokenUsage.input_cache_creation +
    activeTokenUsage.input_other +
    activeTokenUsage.input_cache_read +
    activeTokenUsage.input_cache_creation;

  const outputTotal = tokenUsage.output + activeTokenUsage.output;

  const contextPercent = context_usage ? Math.round(context_usage * 1000) / 10 : 0;

  return (
    <div className="flex items-center gap-3 text-[10px] text-muted-foreground border border-border/40 rounded-full px-2 py-0.5 select-none h-6 box-border mr-2 @max-[240px]:hidden">
      <div className="flex items-center gap-1.5" title="Context Window Usage">
        <IconCpu className="size-3 opacity-70" />
        <span className={cn(contextPercent > 80 && "text-amber-500", contextPercent > 95 && "text-destructive")}>{contextPercent}%</span>
      </div>
      <div className="w-px h-3 bg-border/50 @max-[440px]:hidden" />
      <div className="flex items-center gap-1.5 @max-[440px]:hidden" title="Total Input Tokens">
        <IconArrowUp className="size-3 opacity-70" />
        <span>{inputTotal.toLocaleString()}</span>
      </div>
      <div className="w-px h-3 bg-border/50 @max-[400px]:hidden" />
      <div className="flex items-center gap-1.5 @max-[440px]:hidden" title="Output Tokens">
        <IconArrowDown className="size-3 opacity-70" />
        <span>{outputTotal.toLocaleString()}</span>
      </div>
    </div>
  );
}
