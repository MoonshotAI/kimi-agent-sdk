import { useState, useRef, useLayoutEffect } from "react";
import { IconChevronDown, IconChevronUp } from "@tabler/icons-react";
import { useApprovalStore } from "@/stores";
import { DisplayBlocks } from "./DisplayBlocks";
import { cn } from "@/lib/utils";
import type { ApprovalResponse } from "@moonshot-ai/kimi-agent-sdk/schema";

export function ApprovalDialog() {
  const { pending, respondToRequest } = useApprovalStore();
  const [selectedIndex, setSelectedIndex] = useState(1);
  const [expanded, setExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [collapsedRect, setCollapsedRect] = useState<{
    height: number;
    bottom: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (!expanded && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setCollapsedRect({
        height: rect.height,
        bottom: window.innerHeight - rect.bottom,
      });
    }
  }, [expanded, pending]);

  if (pending.length === 0) return null;

  const req = pending[0];
  const hasDisplay = req.display && req.display.length > 0;

  const handleResponse = async (response: ApprovalResponse) => {
    await respondToRequest(req.id, response);
    setSelectedIndex(1);
    setExpanded(false);
  };

  const options = [
    { key: "approve", label: "Yes", index: 1 },
    { key: "approve_for_session", label: "Yes, for this session", index: 2 },
    { key: "reject", label: "No", index: 3 },
  ] as const;

  const content = (
    <div className="p-2 space-y-2 flex-1 min-h-0 overflow-hidden flex flex-col">
      <div className="flex items-center justify-between shrink-0">
        <div className="text-xs font-semibold text-foreground">Allow this {req.action.toLowerCase()}?</div>
        {hasDisplay && (
          <button onClick={() => setExpanded(!expanded)} className="p-1 hover:bg-muted rounded transition-colors">
            {expanded ? <IconChevronDown className="size-4 text-muted-foreground" /> : <IconChevronUp className="size-4 text-muted-foreground" />}
          </button>
        )}
      </div>

      <div className="text-xs text-foreground/90 break-all leading-relaxed bg-muted/30 py-2 px-2 rounded shrink-0 max-h-32 overflow-y-auto">{req.description}</div>

      {hasDisplay && (
        <div className={cn("overflow-y-auto", expanded ? "flex-1 min-h-0" : "max-h-32")}>
          <DisplayBlocks blocks={req.display} maxHeight={expanded ? "max-h-none" : "max-h-24"} />
        </div>
      )}

      <div className="text-xs text-muted-foreground shrink-0">{req.sender}</div>

      <div className="space-y-2 pt-1 shrink-0">
        {options.map((opt) => (
          <button
            key={opt.key}
            onClick={() => handleResponse(opt.key)}
            onMouseEnter={() => setSelectedIndex(opt.index)}
            className={cn(
              "w-full text-left px-2 py-1 rounded-md text-xs transition-colors",
              "border border-border cursor-pointer",
              selectedIndex === opt.index ? "bg-blue-500 text-white border-blue-500" : "bg-background hover:bg-muted/50",
            )}
          >
            <span className={cn("mr-2", selectedIndex === opt.index ? "text-blue-200" : "text-muted-foreground")}>{opt.index}</span>
            <span className="font-medium">{opt.label}</span>
          </button>
        ))}
      </div>
    </div>
  );

  if (expanded && collapsedRect) {
    return (
      <>
        <div style={{ height: collapsedRect.height }} className="mx-2 mb-1 shrink-0" />
        <div
          style={{ bottom: collapsedRect.bottom }}
          className="fixed left-2 right-2 border border-blue-200 dark:border-blue-800 rounded-lg overflow-hidden bg-background flex flex-col z-50 max-h-[70vh]"
        >
          {content}
        </div>
      </>
    );
  }

  return (
    <div ref={containerRef} className="mx-2 mb-0.5 border border-blue-200 dark:border-blue-800 rounded-lg overflow-hidden bg-background flex flex-col shrink-0 max-h-80">
      {content}
    </div>
  );
}
