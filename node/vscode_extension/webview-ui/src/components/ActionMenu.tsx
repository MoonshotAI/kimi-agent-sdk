import { useState } from "react";
import { IconSettings, IconServer, IconLogout, IconLogin, IconLoader2 } from "@tabler/icons-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useSettingsStore } from "@/stores";
import { bridge } from "@/services";
import { cn } from "@/lib/utils";

interface ActionMenuProps {
  className?: string;
  onAuthAction?: () => void;
}

export function ActionMenu({ className, onAuthAction }: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const { setMCPModalOpen, isLoggedIn, setIsLoggedIn } = useSettingsStore();

  const handleOpenSettings = () => {
    bridge.openSettings();
    setOpen(false);
  };

  const handleOpenMCPServers = () => {
    setMCPModalOpen(true);
    setOpen(false);
  };

  const handleAuthAction = async () => {
    if (isLoggedIn) {
      setLoading(true);
      try {
        await bridge.logout();
        setIsLoggedIn(false);
      } finally {
        setLoading(false);
      }
    }
    setOpen(false);
    onAuthAction?.();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-xs" className={cn("text-muted-foreground", className)}>
          <IconSettings className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-1.5 gap-0!" align="end" side="top">
        <button
          onClick={handleOpenMCPServers}
          className="w-full flex items-center gap-2 px-1.5 py-1.5 rounded-md text-xs hover:bg-accent transition-colors text-left cursor-pointer"
        >
          <IconServer className="size-3.5 text-muted-foreground" />
          <span className="flex-1">MCP Servers</span>
        </button>
        <button onClick={handleOpenSettings} className="w-full flex items-center gap-2 px-1.5 py-1.5 rounded-md text-xs hover:bg-accent transition-colors text-left cursor-pointer">
          <IconSettings className="size-3.5 text-muted-foreground" />
          <span className="flex-1">Settings</span>
          <span className="text-[10px] text-muted-foreground">↗</span>
        </button>
        <Separator className="my-1" />
        <button
          onClick={handleAuthAction}
          disabled={loading}
          className={cn(
            "w-full flex items-center gap-2 px-1.5 py-1.5 rounded-md text-xs hover:bg-accent transition-colors text-left cursor-pointer",
            isLoggedIn && "text-red-500 hover:text-red-600",
          )}
        >
          {loading ? <IconLoader2 className="size-3.5 animate-spin" /> : isLoggedIn ? <IconLogout className="size-3.5" /> : <IconLogin className="size-3.5" />}
          <span className="flex-1">{loading ? "Processing..." : isLoggedIn ? "Sign out" : "Sign in"}</span>
        </button>
      </PopoverContent>
    </Popover>
  );
}
