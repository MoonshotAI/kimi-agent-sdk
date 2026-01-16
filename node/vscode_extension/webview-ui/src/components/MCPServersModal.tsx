import { useState, useEffect, useMemo } from "react";
import {
  IconX,
  IconPlus,
  IconTrash,
  IconServer,
  IconKey,
  IconRefresh,
  IconPlugConnected,
  IconLoader2,
  IconWorld,
  IconTerminal2,
  IconBrandGithub,
  IconChevronDown,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useSettingsStore } from "@/stores";
import { bridge } from "@/services";
import { RECOMMENDED_MCP_SERVERS, recommendedToConfig, type RecommendedMCPServer } from "@/services/recommended-mcp";
import { cn } from "@/lib/utils";
import type { MCPServerConfig } from "@moonshot-ai/kimi-agent-sdk/schema";

type TransportType = "stdio" | "http";

interface EnvVar {
  key: string;
  value: string;
}

interface FormData {
  name: string;
  transport: TransportType;
  url: string;
  command: string;
  args: string;
  envVars: EnvVar[];
  requiresAuth: boolean;
}

const EMPTY_FORM: FormData = { name: "", transport: "stdio", url: "", command: "", args: "", envVars: [], requiresAuth: false };

function serverToForm(s?: MCPServerConfig): FormData {
  if (!s) return { ...EMPTY_FORM };
  const isHttp = s.transport === "http";
  return {
    name: s.name,
    transport: isHttp ? "http" : "stdio",
    url: s.url || "",
    command: s.command || "",
    args: (s.args || []).join(" "),
    envVars: s.env ? Object.entries(s.env).map(([key, value]) => ({ key, value })) : [],
    requiresAuth: s.auth === "oauth",
  };
}

function formToConfig(f: FormData): MCPServerConfig {
  const env = f.envVars.reduce((acc, { key, value }) => (key.trim() ? { ...acc, [key.trim()]: value } : acc), {} as Record<string, string>);
  if (f.transport === "http") {
    return { name: f.name.trim(), transport: "http", url: f.url.trim(), ...(f.requiresAuth && { auth: "oauth" }), ...(Object.keys(env).length > 0 && { env }) };
  }
  const args = f.args.trim().split(/\s+/).filter(Boolean);
  return { name: f.name.trim(), transport: "stdio", command: f.command.trim(), ...(args.length > 0 && { args }), ...(Object.keys(env).length > 0 && { env }) };
}

function validateForm(f: FormData): string | null {
  if (!f.name.trim()) return "Name required";
  if (f.transport === "http" && !f.url.trim()) return "URL required";
  if (f.transport === "stdio" && !f.command.trim()) return "Command required";
  return null;
}

function ServerForm({
  data,
  onChange,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  data: FormData;
  onChange: (d: FormData) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitLabel: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof FormData>(k: K, v: FormData[K]) => {
    onChange({ ...data, [k]: v });
    setError(null);
  };
  const handleSubmit = () => {
    const err = validateForm(data);
    if (err) {
      setError(err);
      return;
    }
    onSubmit();
  };

  return (
    <div className="space-y-3 pt-2 border-t border-border/50">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-[10px] text-muted-foreground">Name</Label>
          <Input value={data.name} onChange={(e) => set("name", e.target.value)} className="h-7 text-xs" />
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">Transport</Label>
          <div className="flex gap-1">
            {(["stdio", "http"] as const).map((t) => (
              <button
                key={t}
                onClick={() => set("transport", t)}
                className={cn(
                  "flex-1 h-7 text-xs rounded border flex items-center justify-center gap-1",
                  data.transport === t ? "border-blue-500 bg-blue-500/10 text-blue-500" : "border-border",
                )}
              >
                {t === "stdio" ? <IconTerminal2 className="size-3" /> : <IconWorld className="size-3" />}
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      {data.transport === "http" ? (
        <div>
          <Label className="text-[10px] text-muted-foreground">URL</Label>
          <Input value={data.url} onChange={(e) => set("url", e.target.value)} placeholder="https://..." className="h-7 text-xs font-mono" />
          <label className="flex items-center gap-1.5 mt-1.5 cursor-pointer">
            <input type="checkbox" checked={data.requiresAuth} onChange={(e) => set("requiresAuth", e.target.checked)} className="rounded size-3" />
            <span className="text-xs text-muted-foreground">Requires OAuth</span>
          </label>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          <div>
            <Label className="text-[10px] text-muted-foreground">Command</Label>
            <Input value={data.command} onChange={(e) => set("command", e.target.value)} placeholder="npx" className="h-7 text-xs font-mono" />
          </div>
          <div className="col-span-2">
            <Label className="text-[10px] text-muted-foreground">Arguments</Label>
            <Input value={data.args} onChange={(e) => set("args", e.target.value)} placeholder="-y @pkg/name" className="h-7 text-xs font-mono" />
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between">
          <Label className="text-[10px] text-muted-foreground">Environment Variables</Label>
          <button onClick={() => set("envVars", [...data.envVars, { key: "", value: "" }])} className="text-xs text-muted-foreground hover:text-foreground">
            + Add
          </button>
        </div>
        {data.envVars.map((env, i) => (
          <div key={i} className="flex items-center gap-1 mt-1">
            <Input
              value={env.key}
              onChange={(e) => {
                const n = [...data.envVars];
                n[i].key = e.target.value;
                set("envVars", n);
              }}
              placeholder="KEY"
              className="h-6 text-xs font-mono flex-1"
            />
            <span className="text-muted-foreground text-xs">=</span>
            <Input
              value={env.value}
              onChange={(e) => {
                const n = [...data.envVars];
                n[i].value = e.target.value;
                set("envVars", n);
              }}
              placeholder="value"
              className="h-6 text-xs font-mono flex-1"
            />
            <button
              onClick={() =>
                set(
                  "envVars",
                  data.envVars.filter((_, j) => j !== i),
                )
              }
              className="text-muted-foreground hover:text-destructive p-1"
            >
              <IconX className="size-3" />
            </button>
          </div>
        ))}
      </div>

      {error && <p className="text-[10px] text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" className="h-6 text-xs" onClick={handleSubmit}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

function ServerItem({ server, onDelete }: { server: MCPServerConfig; onDelete: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [form, setForm] = useState(() => serverToForm(server));
  const [testOutput, setTestOutput] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { setMCPServers } = useSettingsStore();

  const isHttp = server.transport === "http";
  const info = isHttp ? server.url : [server.command, ...(server.args || [])].join(" ");

  const handleUpdate = async () => {
    try {
      const servers = await bridge.updateMCPServer(formToConfig(form));
      setMCPServers(servers);
      setExpanded(false);
    } catch {}
  };

  const handleAction = async (action: () => Promise<any>) => {
    setIsLoading(true);
    setTestOutput(null);
    try {
      await action();
    } finally {
      setIsLoading(false);
    }
  };

  const handleTest = () =>
    handleAction(async () => {
      const result = await bridge.testMCP(server.name);
      setTestOutput(result.output);
    });

  const handleAuth = () => handleAction(() => bridge.authMCP(server.name));
  const handleResetAuth = () => handleAction(() => bridge.resetAuthMCP(server.name));

  return (
    <div className="rounded-md border border-border/60 bg-card/30">
      <div className="flex items-center gap-2 px-2.5 py-1.5 cursor-pointer hover:bg-muted/30" onClick={() => setExpanded(!expanded)}>
        <div className={cn("size-6 rounded flex items-center justify-center text-xs", isHttp ? "bg-blue-500/10 text-blue-500" : "bg-emerald-500/10 text-emerald-500")}>
          {isHttp ? <IconWorld className="size-3.5" /> : <IconTerminal2 className="size-3.5" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium">{server.name}</span>
            {server.auth === "oauth" && <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400">OAuth</span>}
          </div>
          <p className="text-[10px] text-muted-foreground truncate font-mono">{info}</p>
        </div>
        <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          {server.auth === "oauth" && (
            <>
              <Button variant="ghost" size="icon" className="size-6" onClick={handleAuth} disabled={isLoading}>
                <IconKey className="size-3" />
              </Button>
              <Button variant="ghost" size="icon" className="size-6" onClick={handleResetAuth} disabled={isLoading}>
                <IconRefresh className="size-3" />
              </Button>
            </>
          )}
          <Button variant="ghost" size="icon" className="size-6" onClick={handleTest} disabled={isLoading}>
            {isLoading ? <IconLoader2 className="size-3 animate-spin" /> : <IconPlugConnected className="size-3" />}
          </Button>
          <Button variant="ghost" size="icon" className="size-6 text-muted-foreground hover:text-destructive" onClick={onDelete} disabled={isLoading}>
            <IconTrash className="size-3" />
          </Button>
        </div>
        <IconChevronDown className={cn("size-3.5 text-muted-foreground transition-transform", expanded && "rotate-180")} />
      </div>

      {expanded && (
        <div className="px-2.5 pb-2.5">
          {testOutput && <pre className="text-[10px] font-mono bg-muted/50 rounded p-2 mb-2 whitespace-pre-wrap max-h-48 overflow-auto">{testOutput}</pre>}
          <ServerForm data={form} onChange={setForm} onSubmit={handleUpdate} onCancel={() => setExpanded(false)} submitLabel="Update" />
        </div>
      )}
    </div>
  );
}

function RecommendedItem({ server, onInstall, isInstalling }: { server: RecommendedMCPServer; onInstall: () => void; isInstalling: boolean }) {
  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-dashed border-border/50">
      <div className="size-6 rounded flex items-center justify-center bg-violet-500/10 text-violet-500">
        <IconTerminal2 className="size-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium">{server.name}</span>
          {server.github && (
            <a href={server.github} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground">
              <IconBrandGithub className="size-3" />
            </a>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground truncate">{server.description}</p>
      </div>
      <Button variant="outline" size="sm" className="h-6 text-xs" onClick={onInstall} disabled={isInstalling}>
        {isInstalling ? (
          <>
            <IconLoader2 className="size-3 mr-1 animate-spin" />
            Adding
          </>
        ) : (
          "Add"
        )}
      </Button>
    </div>
  );
}

export function MCPServersModal() {
  const { mcpServers, mcpModalOpen, setMCPServers, setMCPModalOpen } = useSettingsStore();
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState<FormData>({ ...EMPTY_FORM });
  const [installingRecommended, setInstallingRecommended] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (mcpModalOpen) bridge.getMCPServers().then(setMCPServers);
  }, [mcpModalOpen, setMCPServers]);

  useEffect(() => {
    if (!showAdd) setAddForm({ ...EMPTY_FORM });
  }, [showAdd]);

  const installedNames = useMemo(() => new Set(mcpServers.map((s) => s.name)), [mcpServers]);

  const handleAdd = async () => {
    try {
      const servers = await bridge.addMCPServer(formToConfig(addForm));
      setMCPServers(servers);
      setShowAdd(false);
    } catch {}
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const servers = await bridge.removeMCPServer(deleteTarget);
      setMCPServers(servers);
    } catch {}
    setIsDeleting(false);
    setDeleteTarget(null);
  };

  const handleInstallRecommended = async (server: RecommendedMCPServer) => {
    setInstallingRecommended(server.id);
    try {
      const config = recommendedToConfig(server);
      const servers = await bridge.addMCPServer(config);
      setMCPServers(servers);
    } catch {}
    setInstallingRecommended(null);
  };

  if (!mcpModalOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 flex flex-col bg-background">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <div className="flex items-center gap-2">
            <IconServer className="size-4 text-blue-500" />
            <h2 className="text-xs font-medium">MCP Servers</h2>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-6 text-xs" onClick={() => setShowAdd(true)}>
              <IconPlus className="size-3 mr-1" />
              Add
            </Button>
            <Button variant="ghost" size="icon" className="size-6" onClick={() => setMCPModalOpen(false)}>
              <IconX className="size-3.5" />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-3 py-3 space-y-4">
            {showAdd && (
              <div className="rounded-md border border-blue-500/5 p-2.5">
                <div className="flex items-center gap-2 mb-2">
                  <IconPlus className="size-3.5 text-blue-500" />
                  <span className="text-xs font-medium">Add MCP Server</span>
                </div>
                <ServerForm data={addForm} onChange={setAddForm} onSubmit={handleAdd} onCancel={() => setShowAdd(false)} submitLabel="Add Server" />
              </div>
            )}

            {mcpServers.length > 0 && (
              <div className="space-y-1.5">
                {mcpServers.map((server) => (
                  <ServerItem key={server.name} server={server} onDelete={() => setDeleteTarget(server.name)} />
                ))}
              </div>
            )}

            {mcpServers.length === 0 && !showAdd && (
              <div className="py-6 text-center">
                <IconServer className="size-6 mx-auto text-muted-foreground/30 mb-1" />
                <p className="text-xs text-muted-foreground">No MCP servers configured</p>
              </div>
            )}

            <div className="space-y-1.5">
              <h3 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Recommended</h3>
              {RECOMMENDED_MCP_SERVERS.filter((s) => !installedNames.has(s.id)).map((server) => (
                <RecommendedItem key={server.id} server={server} onInstall={() => handleInstallRecommended(server)} isInstalling={installingRecommended === server.id} />
              ))}
              {RECOMMENDED_MCP_SERVERS.every((s) => installedNames.has(s.id)) && (
                <p className="text-[10px] text-muted-foreground text-center py-2">All recommended servers installed</p>
              )}
            </div>
          </div>
        </div>
      </div>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete MCP Server?</AlertDialogTitle>
            <AlertDialogDescription>This will remove "{deleteTarget}" from your configuration. This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={isDeleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {isDeleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
