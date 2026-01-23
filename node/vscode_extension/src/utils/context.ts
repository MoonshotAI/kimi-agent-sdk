import * as vscode from "vscode";
import { isLoggedIn } from "@moonshot-ai/kimi-agent-sdk";

export async function updateLoginContext(): Promise<void> {
  const loggedIn = isLoggedIn();
  await vscode.commands.executeCommand("setContext", "kimi.isLoggedIn", loggedIn);
}
