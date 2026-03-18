import type { ReactNode } from "react";
import { IconClipboardList } from "@tabler/icons-react";

interface PlanCardProps {
  children: ReactNode;
}

export function PlanCard({ children }: PlanCardProps) {
  return (
    <div className="my-2 rounded-lg border border-amber-300/50 dark:border-amber-700/50 bg-amber-50/30 dark:bg-amber-950/20 overflow-hidden">
      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-100/50 dark:bg-amber-900/30 border-b border-amber-300/50 dark:border-amber-700/50">
        <IconClipboardList className="size-3.5 text-amber-600 dark:text-amber-400" />
        <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">Plan Mode</span>
      </div>
      <div className="px-1 py-1">
        {children}
      </div>
    </div>
  );
}
