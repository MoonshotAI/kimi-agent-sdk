import { IconAlertTriangle, IconTerminal2, IconLoader2, IconFolderOpen, IconSettings } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { KimiMascot } from "./KimiMascot";
import { bridge } from "@/services";
import type { CLICheckResult, CLIErrorType } from "shared/types";

interface Props {
  type: "loading" | "cli-error" | "no-models" | "no-workspace";
  cliResult?: CLICheckResult | null;
  errorMessage?: string | null;
}

const CLI_ERROR_TITLES: Record<CLIErrorType, string> = {
  not_found: "CLI Not Found",
  version_low: "CLI Outdated",
  extract_failed: "Installation Failed",
  protocol_error: "Connection Error",
};

function CLIErrorContent({ cliResult, errorMessage }: { cliResult?: CLICheckResult | null; errorMessage?: string | null }) {
  const isCustomPath = cliResult?.resolved?.isCustomPath ?? false;
  const errorType = cliResult?.error?.type ?? "not_found";
  const title = CLI_ERROR_TITLES[errorType];
  const path = cliResult?.resolved?.path;

  if (isCustomPath) {
    return (
      <>
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 text-amber-500">
            <IconAlertTriangle className="size-5" />
            <span className="text-sm font-medium">{title}</span>
          </div>
          <p className="text-xs text-muted-foreground">The configured CLI path is invalid or the CLI version is incompatible.</p>
          {path && <p className="text-xs text-muted-foreground/70 font-mono break-all">{path}</p>}
        </div>

        <div className="flex flex-col gap-2">
          <Button onClick={() => bridge.openSettings()} className="gap-2">
            <IconSettings className="size-4" />
            Open Settings
          </Button>
          <p className="text-xs text-muted-foreground/70 text-center">
            Update <code className="bg-muted px-1 rounded">kimi.executablePath</code> or clear it to use bundled CLI
          </p>
        </div>

        <div className="bg-muted/50 rounded-lg p-4 text-left space-y-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <IconTerminal2 className="size-4" />
            <span>Or install CLI manually:</span>
          </div>
          <code className="block text-xs bg-background rounded px-3 py-2 font-mono select-all">curl -LsSf https://cdn.kimi.com/binaries/kimi-cli/install.sh | bash</code>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="space-y-2">
        <div className="inline-flex items-center gap-2 text-amber-500">
          <IconAlertTriangle className="size-5" />
          <span className="text-sm font-medium">{title}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {errorType === "extract_failed" ? "Failed to extract the bundled CLI. Please install manually." : "The bundled CLI is unavailable. Please install manually."}
        </p>
      </div>

      <div className="bg-muted/50 rounded-lg p-4 text-left space-y-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <IconTerminal2 className="size-4" />
          <span>Install CLI:</span>
        </div>
        <code className="block text-xs bg-background rounded px-3 py-2 font-mono select-all">curl -LsSf https://cdn.kimi.com/binaries/kimi-cli/install.sh | bash</code>
      </div>

      <p className="text-xs text-muted-foreground/70">
        After installation, you may need to configure the path in{" "}
        <button onClick={() => bridge.openSettings()} className="underline hover:text-foreground">
          settings
        </button>
      </p>
    </>
  );
}

export function ConfigErrorScreen({ type, cliResult, errorMessage }: Props) {
  if (type === "loading") {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <div className="text-center space-y-4">
          <KimiMascot className="h-10 mx-auto opacity-50" />
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 text-muted-foreground">
              <IconLoader2 className="size-4 animate-spin" />
              <span className="text-sm">Loading...</span>
            </div>
            <p className="text-xs text-muted-foreground/70">Kimi Code is initializing. May take up to 15 seconds. Please wait.</p>
          </div>
        </div>
      </div>
    );
  }

  if (type === "no-workspace") {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <div className="max-w-sm text-center space-y-6">
          <KimiMascot className="h-10 mx-auto opacity-50" />
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 text-amber-500">
              <IconFolderOpen className="size-5" />
              <span className="text-sm font-medium">No Workspace Open</span>
            </div>
            <p className="text-xs text-muted-foreground/70">Please open a folder to start using Kimi Code.</p>
          </div>
          <Button onClick={() => bridge.openFolder()} className="gap-2">
            <IconFolderOpen className="size-4" />
            Open Folder
          </Button>
        </div>
      </div>
    );
  }

  if (type === "cli-error") {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <div className="max-w-sm text-center space-y-6">
          <KimiMascot className="h-10 mx-auto opacity-50" />
          <CLIErrorContent cliResult={cliResult} errorMessage={errorMessage} />
        </div>
      </div>
    );
  }

  // no-models
  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="max-w-sm text-center space-y-6">
        <KimiMascot className="h-10 mx-auto opacity-50" />
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 text-amber-500">
            <IconAlertTriangle className="size-5" />
            <span className="text-sm font-medium">Configuration Required</span>
          </div>
          <p className="text-xs text-muted-foreground">Kimi Code is not configured. Please run setup first.</p>
        </div>
        <div className="bg-muted/50 rounded-lg p-4 text-left space-y-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <IconTerminal2 className="size-4" />
            <span>Run in terminal:</span>
          </div>
          <code className="block text-xs bg-background rounded px-3 py-2 font-mono select-all">kimi /setup</code>
        </div>
      </div>
    </div>
  );
}
