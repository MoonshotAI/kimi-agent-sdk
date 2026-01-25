/**
 * Bridge Protocol - Communication between VS Code extension and webview.
 *
 * Architecture:
 * - Webview calls Methods via RPC (request/response)
 * - Extension broadcasts Events to webview (one-way notifications)
 *
 * RPC flow: webview.call(method, params) -> extension.dispatch -> webview.resolve(result)
 * Event flow: extension.broadcast(event, data) -> webview.on(event, handler)
 */

export const Methods = {
  CheckWorkspace: "checkWorkspace",
  CheckCLI: "checkCLI",
  CheckLoginStatus: "checkLoginStatus",
  Login: "login",
  Logout: "logout",
  SaveConfig: "saveConfig",
  GetExtensionConfig: "getExtensionConfig",
  OpenSettings: "openSettings",
  OpenFolder: "openFolder",
  GetModels: "getModels",

  GetMCPServers: "getMCPServers",
  AddMCPServer: "addMCPServer",
  UpdateMCPServer: "updateMCPServer",
  RemoveMCPServer: "removeMCPServer",
  AuthMCP: "authMCP",
  ResetAuthMCP: "resetAuthMCP",
  TestMCP: "testMCP",

  StreamChat: "streamChat",
  AbortChat: "abortChat",
  ResetSession: "resetSession",
  RespondApproval: "respondApproval",

  GetKimiSessions: "getKimiSessions",
  LoadKimiSessionHistory: "loadKimiSessionHistory",
  DeleteKimiSession: "deleteKimiSession",
  GetProjectFiles: "getProjectFiles",
  GetEditorContext: "getEditorContext",
  InsertText: "insertText",
  PickMedia: "pickMedia",
  OpenFile: "openFile",
  CheckFileExists: "checkFileExists",
  CheckFilesExist: "checkFilesExist",
  OpenFileDiff: "openFileDiff",
  TrackFiles: "trackFiles",
  ClearTrackedFiles: "clearTrackedFiles",
  RevertFiles: "revertFiles",
  KeepChanges: "keepChanges",
  GetImageDataUri: "getImageDataUri",
} as const;

export const Events = {
  ExtensionConfigChanged: "extensionConfigChanged",
  MCPServersChanged: "mcpServersChanged",
  StreamEvent: "streamEvent",
  FocusInput: "focusInput",
  InsertMention: "insertMention",
  NewConversation: "newConversation",
  FileChangesUpdated: "fileChangesUpdated",
  RollbackInput: "rollbackInput",
  LoginUrl: "loginUrl",
} as const;
