import type { SlashCommandInfo } from "@moonshot-ai/kimi-agent-sdk";

// Built-in commands that are always available (shown before wire data arrives)
export const BUILTIN_SLASH_COMMANDS: SlashCommandInfo[] = [
  { name: "clear", description: "Clear the context (reset)", aliases: [] },
  { name: "compact", description: "Compact the context", aliases: [] },
  { name: "init", description: "Analyze the codebase and generate an AGENTS.md file", aliases: [] },
  { name: "yolo", description: "Enable YOLO mode (auto approve all actions)", aliases: [] },
];

// { name: "debug", description: "Debug the context" },
// { name: "feedback", description: "Submit feedback to make Kimi Code better" },
// { name: "help", description: "Emergency!!!" },
// { name: "mcp", description: "Show MCP servers and tools" },
// { name: "poop", description: "Poop!" },
// { name: "release-notes", description: "Show release notes" },
// { name: "reload", description: "Reload configuration" },
// {
//   name: "sessions",
//   description: "List sessions and resume optionally (resume)",
// },
// { name: "setup", description: "Setup LLM provider and model." },
// {
//   name: "share",
//   description:
//     "Get a shareable URL for the current session for the developers to debug your issues. (session-url)",
// },
// { name: "usage", description: "Display API usage and quota information" },
// { name: "user-guide", description: "Open user guide in browser" },
// { name: "version", description: "Show version information" },
