export { CLIManager, getCLIManager, initCLIManager, compareVersion } from "./cli.manager";
export { MCPManager } from "./mcp.manager";
export { BaselineManager } from "./baseline.manager";
export { FileManager, type BroadcastFn } from "./file.manager";
export {
  getPlatformKey,
  readManifest,
  readInstalled,
  writeInstalled,
  downloadAndInstall,
  type Manifest,
  type PlatformAsset,
  type InstalledInfo,
} from "./cli-downloader";
