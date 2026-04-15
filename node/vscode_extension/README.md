# Kimi Code

AI coding assistant for VS Code, built for long-context workflows and complex coding tasks.

## Features

- **Works alongside you**: Kimi autonomously explores your codebase, reads and writes code, and runs terminal commands with your permission
- **Thinking mode**: Toggle deep reasoning for complex architecture decisions and debugging
- **Native editor integration**: Review AI-proposed changes directly in VS Code's diff viewer
- **MCP support**: Extend capabilities with Model Context Protocol servers
- **Slash commands**: Quick actions like `/init` to analyze your project and `/compact` to manage context
- **Plan mode**: Have Kimi design an implementation plan before writing code
- **Sub-agent support**: Kimi can spawn focused sub-agents for parallel exploration and coding tasks

## Install

1. Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=moonshot-ai.kimi-code)
2. Open a folder in VS Code
3. Click the Kimi icon in the Activity Bar
4. Sign in with [kimi.com/code](https://www.kimi.com/code) subscription to start using Kimi Code

> **Using your own Kimi CLI?** Set a custom executable path in Settings → `kimi.executablePath`

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `kimi.yoloMode` | `false` | Auto-approve all tool calls |
| `kimi.autosave` | `true` | Automatically save files before Kimi reads or writes them |
| `kimi.showThinkingContent` | `false` | Show thinking/reasoning content in the chat UI |
| `kimi.showThinkingExpanded` | `false` | Auto-expand thinking sections (requires Show Thinking Content) |
| `kimi.editorContext` | `never` | Control when to share the active editor's file and cursor position |
| `kimi.useCtrlEnterToSend` | `false` | Use Ctrl/Cmd+Enter to send prompts instead of Enter |
| `kimi.executablePath` | `""` | Path to the Kimi Code executable (leave empty to use bundled CLI) |

## Docs

Official doc for Kimi Code can be found at [www.kimi.com/code/docs](https://www.kimi.com/code/docs/en/kimi-code-for-vscode/guides/getting-started.html)

## License

[Apache-2.0](LICENSE)
