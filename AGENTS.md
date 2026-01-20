# Kimi Agent SDK API Specification

This document defines the API specification that all Kimi Agent SDK implementations must follow. The SDK enables programmatic interaction with the Kimi CLI Agent through the Wire protocol.

## Table of Contents

1. [Overview](#overview)
2. [Core API](#core-api)
3. [Type Definitions](#type-definitions)
4. [Wire Protocol](#wire-protocol)
5. [Configuration Options](#configuration-options)
6. [Error Handling](#error-handling)
7. [Implementation Guidelines](#implementation-guidelines)

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

## Type Definitions

For detailed type definitions used in the Wire protocol, see the official documentation:

**[Wire Mode Type Definitions](https://moonshotai.github.io/kimi-cli/en/customization/wire-mode.html#contentpart)**

Key types include:
- `Content` / `ContentPart` - User input and output content
- `ToolCall` / `ToolResult` - Tool invocation and results
- `ApprovalRequest` / `ApprovalResponse` - User approval flow
- `DisplayBlock` - Rich display content for UIs
- `TokenUsage` - Token consumption statistics

---

## Wire Protocol

The SDK communicates with Kimi CLI using Wire Protocol version `2` (JSON-RPC 2.0 over stdio).

For complete Wire protocol documentation including event types, RPC methods, and type definitions, see:

**[Kimi CLI Wire Mode Documentation](https://moonshotai.github.io/kimi-cli/en/customization/wire-mode.html)**

---

## Configuration Options

### Session Options

```typescript
interface SessionOptions {
  workDir?: string;        // Working directory path
  sessionId?: string;      // Custom session identifier
  model?: string;          // Model name (e.g., "kimi")
  thinking?: boolean;      // Enable thinking mode
  yolo?: boolean;          // Auto-approve all requests
  configFile?: string;     // Path to config file
  config?: Config;         // Inline configuration object
  executable?: string;     // CLI executable path
  env?: Record<string, string>;  // Environment variables
  mcpConfigs?: MCPConfig[];      // MCP server configurations
  agentFile?: string;      // Agent specification file
  skillsDir?: string;      // Skills directory path
  tools?: ExternalTool[];  // Custom external tools
}
```

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

```typescript
interface LoopOptions {
  maxStepsPerTurn?: number;    // Maximum steps in one turn
  maxRetriesPerStep?: number;  // Maximum retries per step
}
```

| Option              | Type     | Description                            |
| ------------------- | -------- | -------------------------------------- |
| `maxStepsPerTurn`   | `number` | Maximum steps allowed in one turn      |
| `maxRetriesPerStep` | `number` | Maximum retries allowed per step       |

---

## Implementation Guidelines

### Process Management

1. **Spawning**: Start CLI with `kimi --wire` and connect to stdin/stdout
2. **Monitoring**: Watch for process exit and propagate errors
3. **Termination**: Send cancel if turn active, then terminate gracefully

```
Session.close():
  1. Cancel active turn (if any)
  2. Wait for data exchange to complete
  3. Close stdio pipes
  4. Terminate CLI process
```

### Concurrency Handling

1. **Single Turn Per Session**: Only one turn can be active at a time
2. **No Concurrent Access**: Session is not thread-safe and must not be accessed concurrently
3. **Async Iteration**: Turn events should be consumable via async iteration

### Resource Cleanup

1. **Session as Context Manager**: Support `with`/`using` for automatic cleanup
2. **Turn Completion**: Clean up turn resources when iteration completes
3. **Error Recovery**: Ensure cleanup even when errors occur

### Streaming Processing

1. **Event Routing**: Route events to correct turn/step based on nesting
2. **Backpressure**: Handle slow consumers without unbounded buffering
3. **Cancellation**: Support cancellation at any point in the stream

### Approval Handling

When an `ApprovalRequest` arrives:

1. If `yolo` mode: Auto-approve with `"approve"`
2. If handler provided: Call handler and use returned response
3. Default: Reject with `"reject"`

```typescript
// Typical approval flow
if (event is ApprovalRequest) {
  const response = yolo ? "approve" : await handler(event);
  await sendApprovalResponse(event.id, response);
}
```