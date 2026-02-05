import { useState, useEffect, useRef, useLayoutEffect } from "react";
import { IconChevronUp, IconStack2, IconFileCode } from "@tabler/icons-react";
import { useChatStore } from "@/stores";
import { bridge, Events } from "@/services";
import { cn } from "@/lib/utils";
import { FileChangesPanel } from "./FileChangesPanel";
import { QueuedMessagesPanel } from "./QueuedMessagesPanel";
import type { FileChange } from "shared/types";

type TabId = "queue" | "changes" | null;

export function BottomToolbar() {
  const { queue } = useChatStore();
  const [activeTab, setActiveTab] = useState<TabId>(null);
  const [fileChanges, setFileChanges] = useState<FileChange[]>([]);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [toolbarRect, setToolbarRect] = useState<{ bottom: number } | null>(null);

  useEffect(() => {
    return bridge.on<FileChange[]>(Events.FileChangesUpdated, setFileChanges);
  }, []);

  // Track toolbar position for popup placement
  useLayoutEffect(() => {
    if (activeTab && toolbarRef.current) {
      const rect = toolbarRef.current.getBoundingClientRect();
      setToolbarRect({ bottom: window.innerHeight - rect.top });
    }
  }, [activeTab]);

  const hasQueue = queue.length > 0;
  const hasChanges = fileChanges.length > 0;

  if (!hasQueue && !hasChanges) return null;

  const toggleTab = (tab: TabId) => {
    setActiveTab((prev) => (prev === tab ? null : tab));
  };

  // Compute file stats for display
  const fileStats = fileChanges.reduce(
    (a, c) => ({ additions: a.additions + c.additions, deletions: a.deletions + c.deletions }),
    { additions: 0, deletions: 0 }
  );

  return (
    <>
      {/* Floating panel - appears above the toolbar */}
      {activeTab && toolbarRect && (
        <div
          style={{ bottom: toolbarRect.bottom }}
          className="fixed left-2 right-2 z-40 border border-border/60 rounded-md bg-card max-h-[50vh] overflow-hidden flex flex-col"
        >
          <div className="overflow-y-auto flex-1">
            {activeTab === "queue" && <QueuedMessagesPanel />}
            {activeTab === "changes" && <FileChangesPanel changes={fileChanges} />}
          </div>
        </div>
      )}

      {/* Tab bar - always at bottom */}
      <div ref={toolbarRef} className="mb-0.5 border border-border/60 rounded-md overflow-hidden bg-card">
        <div className="flex items-center gap-1 px-2 py-1 min-h-7">
          {hasQueue && (
            <button
              onClick={() => toggleTab("queue")}
              className={cn(
                "flex items-center gap-1.5 px-2 py-0.5 rounded text-xs transition-colors",
                activeTab === "queue" ? "bg-accent text-accent-foreground" : "hover:bg-muted/50 text-muted-foreground"
              )}
            >
              <IconStack2 className="size-3.5" />
              <span>{queue.length} Queued</span>
              <IconChevronUp className={cn("size-3 transition-transform", activeTab === "queue" && "rotate-180")} />
            </button>
          )}

          {hasChanges && (
            <button
              onClick={() => toggleTab("changes")}
              className={cn(
                "flex items-center gap-1.5 px-2 py-0.5 rounded text-xs transition-colors",
                activeTab === "changes" ? "bg-accent text-accent-foreground" : "hover:bg-muted/50 text-muted-foreground"
              )}
            >
              <IconFileCode className="size-3.5" />
              <span>{fileChanges.length} Changed</span>
              <span className="text-[10px] tabular-nums">
                <span className="text-green-600 dark:text-green-400">+{fileStats.additions}</span>
                {" "}
                <span className="text-red-600 dark:text-red-400">-{fileStats.deletions}</span>
              </span>
              <IconChevronUp className={cn("size-3 transition-transform", activeTab === "changes" && "rotate-180")} />
            </button>
          )}
        </div>
      </div>
    </>
  );
}
