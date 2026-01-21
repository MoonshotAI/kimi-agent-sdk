import createDebug from "debug";

const NAMESPACE = "kimi-sdk";

/**
 * Debug loggers for different modules
 *
 * Usage:
 *   import { log } from "./logger";
 *   log.protocol("Spawning CLI: %s", executable);
 *
 * Enable logs via environment variable:
 *   DEBUG=kimi-sdk:* node app.js           # all logs
 *   DEBUG=kimi-sdk:protocol node app.js    # protocol only
 *   DEBUG=kimi-sdk:session,kimi-sdk:storage node app.js  # multiple
 *
 * Or programmatically:
 *   import { enableLogs } from "@moonshot-ai/kimi-agent-sdk";
 *   enableLogs("kimi-sdk:*");
 */
export const log = {
  protocol: createDebug(`${NAMESPACE}:protocol`),
  session: createDebug(`${NAMESPACE}:session`),
  storage: createDebug(`${NAMESPACE}:storage`),
  config: createDebug(`${NAMESPACE}:config`),
  cli: createDebug(`${NAMESPACE}:cli`),
  history: createDebug(`${NAMESPACE}:history`),
};

export function enableLogs(namespaces: string = `${NAMESPACE}:*`): void {
  createDebug.enable(namespaces);
}

export function disableLogs(): void {
  createDebug.disable();
}

export function isLogEnabled(namespace: string): boolean {
  return createDebug.enabled(namespace);
}

export function setLogSink(sink: (...args: any[]) => void): void {
  (createDebug as any).log = sink;
}
