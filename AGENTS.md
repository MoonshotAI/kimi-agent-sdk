# Kimi Agent SDK API Specification

This document defines the API specification that all Kimi Agent SDK implementations must follow. The SDK enables programmatic interaction with the Kimi CLI Agent through the Wire protocol.

## Table of Contents

1. [Overview](#overview)
2. [Core API](#core-api)
3. [Wire Protocol](#wire-protocol)
4. [Configuration Options](#configuration-options)

---

## Overview

### Purpose

The Kimi Agent SDK provides a programmatic interface to interact with the Kimi CLI Agent. It manages the lifecycle of agent sessions, handles the streaming Wire protocol, and provides both low-level and high-level APIs for different use cases.

### Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    User Application                      │
├──────────────────────────────────────────────────────────┤
│  High-level API: prompt()                                │
│  - One-shot conversation                                 │
│  - Automatic session management                          │
│  - Message aggregation (optional)                        │
├──────────────────────────────────────────────────────────┤
│  Low-level API: Session + Turn                           │
│  - Session lifecycle management                          │
│  - Turn iteration for streaming events                   │
│  - Manual approval handling                              │
├──────────────────────────────────────────────────────────┤
│  Wire Protocol (JSON-RPC 2.0 over stdio)                 │
│  - Bi-directional communication                          │
│  - Events (notifications) and Requests (require response)│
└──────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                    Kimi CLI Process                     │
│                    (kimi --wire)                        │
└─────────────────────────────────────────────────────────┘
```

---

## Core API

All SDK implementations MUST provide these core APIs.

### Session Management

#### createSession(options) → Session

Creates and initializes a new session connected to the Kimi CLI process.

```typescript
createSession(options: SessionOptions): Session
```

A Session represents a persistent connection to the Kimi CLI process. It manages:
- CLI process lifecycle (spawn, monitor, terminate)
- Wire protocol communication (JSON-RPC over stdio)
- Turn management and state tracking

#### Session.prompt(content) → Turn

Send a user message and start a new conversation turn.

```typescript
Session.prompt(content: Content): Turn
```

**Behavior:**
- Returns immediately with a Turn object (or async generator)
- The Turn provides streaming access to Wire events
- Only one Turn can be active at a time per Session

#### Session.close()

Close the session and release all resources.

```typescript
Session.close(): void
```

**Behavior:**
- Cancel any active Turn
- Terminate the CLI subprocess
- Clean up resources (file handles, channels, etc.)

### Turn Management

A Turn represents a single conversation round-trip. It provides streaming access to Wire events and controls turn lifecycle.

#### Turn Properties

| Property   | Description                                      |
| ---------- | ------------------------------------------------ |
| `id`       | Unique identifier for this turn within session   |
| `steps`    | Iterator for streaming Wire messages             |

#### Turn.cancel()

Cancel the current turn and stop processing.

```typescript
Turn.cancel(): void
```

**Behavior:**
- Send cancel RPC to CLI
- Stop the turn iteration
- Clean up turn-specific resources

#### Turn.result() → PromptResult

Get the final result after the turn completes.

```typescript
Turn.result(): PromptResult
```

### Step Object

Steps are nested within a Turn. Each Step represents one "loop iteration" of the agent (one LLM call + tool execution cycle).

```
Turn
├── Step 1
│   ├── ContentPart (assistant response)
│   ├── ToolCall
│   └── ToolResult
├── Step 2
│   ├── ContentPart
│   └── ...
└── ...
```

### Simplified API: prompt()

A convenience function for one-shot conversations that handles session lifecycle automatically.

```typescript
prompt(content: Content, options?: SessionOptions): Turn
```

**Behavior:**
1. Create a new Session
2. Send the prompt
3. Yield/return all events
4. Automatically close the Session when done

### External Tools

External tools allow you to extend the agent's capabilities by registering custom tools that the agent can invoke during a conversation.

#### ExternalTool Interface

```typescript
interface ExternalTool {
  name: string;           // Unique tool name
  description: string;    // Description for the agent to understand when to use this tool
  parameters: object;     // JSON Schema defining the tool's input parameters
  handler: (params: object) => Promise<ToolResult>;  // Async function to execute the tool
}
```

#### Registering External Tools

External tools are registered during session creation via the `tools` option:

```typescript
const session = createSession({
  workDir: "/path/to/project",
  tools: [
    {
      name: "search_database",
      description: "Search the internal database for records matching a query",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          limit: { type: "number", description: "Maximum results to return" }
        },
        required: ["query"]
      },
      handler: async (params) => {
        const results = await db.search(params.query, params.limit);
        return { content: JSON.stringify(results) };
      }
    }
  ]
});
```

#### Tool Execution Flow

When the agent decides to use an external tool:

1. The SDK receives a tool call request via the Wire protocol
2. The SDK matches the tool name to a registered `ExternalTool`
3. The `handler` function is invoked with the parsed parameters
4. The handler's return value (`ToolResult`) is sent back to the agent

```
Agent                SDK                    Your Handler
  │                   │                          │
  │──ToolCall────────►│                          │
  │                   │──handler(params)────────►│
  │                   │                          │
  │                   │◄─────ToolResult──────────│
  │◄──ToolResult──────│                          │
  │                   │                          │
```

---

## Wire Protocol

The SDK communicates with Kimi CLI using Wire Protocol version `2` (JSON-RPC 2.0 over stdio).

For complete Wire protocol documentation including event types, RPC methods, and type definitions, see:

**[Kimi CLI Wire Mode Documentation](https://moonshotai.github.io/kimi-cli/en/customization/wire-mode.html)**

---

## Configuration Options

### Session Options

| Option        | Type                     | Description                                     |
| ------------- | ------------------------ | ----------------------------------------------- |
| `workDir`     | `string`                 | Working directory path for the session          |
| `sessionId`   | `string`                 | Custom session identifier for resume/persistence|
| `model`       | `string`                 | Model name (e.g., "kimi")                       |
| `thinking`    | `boolean`                | Enable thinking mode for detailed reasoning     |
| `yolo`        | `boolean`                | Auto-approve all approval requests              |
| `configFile`  | `string`                 | Path to configuration file                      |
| `config`      | `Config`                 | Inline configuration object                     |
| `executable`  | `string`                 | Path to CLI executable                          |
| `env`         | `Record<string, string>` | Environment variables for CLI process           |
| `mcpConfigs`  | `MCPConfig[]`            | MCP server configurations                       |
| `agentFile`   | `string`                 | Path to agent specification file                |
| `skillsDir`   | `string`                 | Path to skills directory                        |
| `tools`       | `ExternalTool[]`         | Custom external tools to register               |

### Loop Control Options

| Option              | Type     | Description                            |
| ------------------- | -------- | -------------------------------------- |
| `maxStepsPerTurn`   | `number` | Maximum steps allowed in one turn      |
| `maxRetriesPerStep` | `number` | Maximum retries allowed per step       |
