import * as fs from "fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { KimiPaths, authMCP, resetAuthMCP, testMCP, type MCPTestResult, type MCPServerConfig } from "@moonshot-ai/kimi-agent-sdk";
import { getCLIManager } from "./cli.manager";
import { VSCodeSettings } from "../config/vscode-settings";

interface MCPConfigFile {
  mcpServers?: Record<string, MCPServerEntry>;
}

interface MCPServerEntry {
  transport?: "http" | "stdio";
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
  auth?: "oauth";
}

function readConfigFile(): MCPConfigFile {
  const configPath = KimiPaths.mcpConfig;
  if (!fs.existsSync(configPath)) {
    return { mcpServers: {} };
  }
  try {
    const content = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(content) as MCPConfigFile;
  } catch {
    return { mcpServers: {} };
  }
}

function writeConfigFile(config: MCPConfigFile): void {
  const configPath = KimiPaths.mcpConfig;
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}

function entryToConfig(name: string, entry: MCPServerEntry): MCPServerConfig {
  const isHttp = entry.transport === "http" || !!entry.url;
  return {
    name,
    transport: isHttp ? "http" : "stdio",
    url: entry.url,
    command: entry.command,
    args: entry.args,
    env: entry.env,
    headers: entry.headers,
    auth: entry.auth,
  };
}

function configToEntry(config: MCPServerConfig): MCPServerEntry {
  const entry: MCPServerEntry = {};

  if (config.transport === "http") {
    entry.transport = "http";
    if (config.url) {
      entry.url = config.url;
    }
    if (config.auth) {
      entry.auth = config.auth;
    }
    if (config.headers && Object.keys(config.headers).length > 0) {
      entry.headers = config.headers;
    }
  } else {
    if (config.command) {
      entry.command = config.command;
    }
    if (config.args && config.args.length > 0) {
      entry.args = config.args;
    }
  }

  if (config.env && Object.keys(config.env).length > 0) {
    entry.env = config.env;
  }

  return entry;
}

function getCliOptions() {
  return {
    executable: getCLIManager().getExecutablePath(),
    env: VSCodeSettings.environmentVariables,
  };
}

export const MCPManager = {
  getServers(): MCPServerConfig[] {
    const config = readConfigFile();
    const servers = config.mcpServers || {};
    return Object.entries(servers).map(([name, entry]) => entryToConfig(name, entry));
  },

  addServer(serverConfig: MCPServerConfig): MCPServerConfig[] {
    const config = readConfigFile();
    if (!config.mcpServers) {
      config.mcpServers = {};
    }
    if (config.mcpServers[serverConfig.name]) {
      throw new Error(`MCP server "${serverConfig.name}" already exists`);
    }
    config.mcpServers[serverConfig.name] = configToEntry(serverConfig);
    writeConfigFile(config);
    return this.getServers();
  },

  updateServer(serverConfig: MCPServerConfig): MCPServerConfig[] {
    const config = readConfigFile();
    if (!config.mcpServers || !config.mcpServers[serverConfig.name]) {
      throw new Error(`MCP server "${serverConfig.name}" not found`);
    }
    config.mcpServers[serverConfig.name] = configToEntry(serverConfig);
    writeConfigFile(config);
    return this.getServers();
  },

  removeServer(name: string): MCPServerConfig[] {
    const config = readConfigFile();
    if (config.mcpServers) {
      delete config.mcpServers[name];
      writeConfigFile(config);
    }
    return this.getServers();
  },

  async auth(name: string): Promise<void> {
    const options = getCliOptions();
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Kimi: Authenticating "${name}"...`,
        cancellable: false,
      },
      async () => {
        try {
          await authMCP(name, options);
          vscode.window.showInformationMessage(`Kimi: OAuth completed for "${name}"`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Kimi: OAuth failed for "${name}": ${msg}`);
          throw err;
        }
      },
    );
  },

  async resetAuth(name: string): Promise<void> {
    const options = getCliOptions();
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Kimi: Resetting auth for "${name}"...`,
        cancellable: false,
      },
      async () => {
        try {
          await resetAuthMCP(name, options);
          vscode.window.showInformationMessage(`Kimi: Auth reset for "${name}"`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Kimi: Reset auth failed for "${name}": ${msg}`);
          throw err;
        }
      },
    );
  },

  async test(name: string): Promise<MCPTestResult> {
    vscode.window.showInformationMessage(`Kimi: Testing MCP server "${name}"...`);
    return await testMCP(name, getCliOptions());
  },
};
