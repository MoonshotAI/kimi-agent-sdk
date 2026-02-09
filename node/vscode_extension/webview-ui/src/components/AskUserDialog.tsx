import { useState, useEffect } from "react";
import { useAskUserStore } from "@/stores";
import { cn } from "@/lib/utils";

export function AskUserDialog() {
  const { pending, respondToRequest } = useAskUserStore();
  const [customInput, setCustomInput] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(1);

  const req = pending[0];

  useEffect(() => {
    if (req) {
      setShowCustom(false);
      setCustomInput("");
      setSelectedIndex(1);
    }
  }, [req?.id]);

  if (!req) return null;

  const handleSelect = async (option: string) => {
    await respondToRequest(req.id, option);
  };

  const handleCustomSubmit = async () => {
    if (!customInput.trim()) return;
    await respondToRequest(req.id, customInput.trim());
  };

  const customIndex = req.options.length + 1;

  return (
    <div className={cn("mb-0.5 border border-blue-200 dark:border-blue-800 rounded-lg overflow-hidden bg-background flex flex-col shrink")}>
      <div className="p-2 space-y-2">
        <div className="text-xs font-semibold text-foreground">{req.question}</div>
        <div className="space-y-1.5">
          {req.options.map((option, idx) => (
            <button
              key={idx}
              onClick={() => handleSelect(option)}
              onMouseEnter={() => setSelectedIndex(idx + 1)}
              className={cn(
                "w-full text-left px-2 py-1 rounded-md text-xs transition-colors",
                "border border-border cursor-pointer",
                selectedIndex === idx + 1 ? "bg-blue-500 text-white border-blue-500" : "bg-background hover:bg-muted/50",
              )}
            >
              <span className={cn("mr-2", selectedIndex === idx + 1 ? "text-blue-200" : "text-muted-foreground")}>{idx + 1}</span>
              <span className="font-medium">{option}</span>
            </button>
          ))}
          {showCustom ? (
            <div className="flex gap-1.5">
              <input
                autoFocus
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCustomSubmit();
                  if (e.key === "Escape") setShowCustom(false);
                }}
                placeholder="Enter your response..."
                className="flex-1 px-2 py-1 rounded-md text-xs border border-border bg-background outline-none focus:border-blue-500"
              />
              <button onClick={handleCustomSubmit} disabled={!customInput.trim()} className="px-2 py-1 rounded-md text-xs bg-blue-500 text-white disabled:opacity-50 cursor-pointer">
                Send
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowCustom(true)}
              onMouseEnter={() => setSelectedIndex(customIndex)}
              className={cn(
                "w-full text-left px-2 py-1 rounded-md text-xs transition-colors",
                "border border-border cursor-pointer",
                selectedIndex === customIndex ? "bg-blue-500 text-white border-blue-500" : "bg-background hover:bg-muted/50",
              )}
            >
              <span className={cn("mr-2", selectedIndex === customIndex ? "text-blue-200" : "text-muted-foreground")}>{customIndex}</span>
              <span className="font-medium">Custom response...</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
