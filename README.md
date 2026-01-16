# Kimi Agent SDK

SDKs for programmatically controlling [Kimi CLI](https://github.com/MoonshotAI/kimi-cli).

## Overview

Kimi Agent SDK provides a programmatic interface to interact with the Kimi CLI, enabling you to:

- **Build custom applications** - Integrate Kimi Agent into your own tools and workflows
- **Automate tasks** - Script complex multi-turn conversations
- **Extend capabilities** - Register custom tools that the model can call
- **Handle approvals** - Programmatically respond to permission requests

## Available SDKs

| Language | Package | Status |
|----------|---------|--------|
| Go | [go/](./go) | Available |
| Node.js | [node/agent_sdk/](./node/agent_sdk/) | Available |
| Python | [python/](./python/) | Available |

## Quick Start (Go)

### Installation

```bash
go get github.com/MoonshotAI/kimi-agent-sdk/go
```

### Prerequisites

- [Kimi CLI](https://github.com/MoonshotAI/kimi-cli) installed and available in PATH
- API key from [Moonshot AI](https://platform.moonshot.ai/)

### Basic Usage

```go
package main

import (
    "context"
    "fmt"
    "os"

    kimi "github.com/MoonshotAI/kimi-agent-sdk/go"
    "github.com/MoonshotAI/kimi-agent-sdk/go/wire"
)

func main() {
    // Create a session
    session, err := kimi.NewSession(
        kimi.WithAPIKey(os.Getenv("KIMI_API_KEY")),
        kimi.WithModel("kimi-k2-thinking-turbo"),
    )
    if err != nil {
        panic(err)
    }
    defer session.Close()

    // Send a prompt
    turn, err := session.Prompt(context.Background(),
        wire.NewStringContent("Hello! What can you help me with?"))
    if err != nil {
        panic(err)
    }

    // Stream the response
    for step := range turn.Steps {
        for msg := range step.Messages {
            if cp, ok := msg.(wire.ContentPart); ok && cp.Type == wire.ContentPartTypeText {
                fmt.Print(cp.Text.Value)
            }
        }
    }
    fmt.Println()

    // Check for errors
    if err := turn.Err(); err != nil {
        panic(err)
    }
}
```

## Core Concepts

### Session

A `Session` represents a connection to the Kimi CLI process. It manages the lifecycle of the underlying process and handles all communication.

```go
session, err := kimi.NewSession(options...)
defer session.Close()
```

### Turn

A `Turn` represents a single request-response cycle. Each call to `Prompt()` returns a new turn that streams the agent's response.

```go
turn, err := session.Prompt(ctx, content)

// Consume the response
for step := range turn.Steps {
    for msg := range step.Messages {
        // Handle messages
    }
}

// Check results
err := turn.Err()
result := turn.Result()
usage := turn.Usage()
```

### External Tools

Register custom functions that the model can call during execution:

```go
// Define your tool
type SearchArgs struct {
    Query string `json:"query" description:"Search query"`
    Limit int    `json:"limit,omitempty" description:"Max results"`
}

func search(args SearchArgs) (string, error) {
    // Your implementation
    return fmt.Sprintf("Results for: %s", args.Query), nil
}

// Register it
tool, _ := kimi.CreateTool(search,
    kimi.WithDescription("Search the knowledge base"),
)

session, _ := kimi.NewSession(
    kimi.WithTools(tool),
)
```

### Approval Requests

Handle permission requests when the agent wants to perform sensitive operations:

```go
for step := range turn.Steps {
    for msg := range step.Messages {
        if req, ok := msg.(wire.ApprovalRequest); ok {
            fmt.Printf("Action: %s\n", req.Action)
            req.Respond(wire.ApprovalRequestResponseApprove)
        }
    }
}
```

## Documentation

See the [guides](./guides) for detailed documentation:

- [Quick Start](./guides/quickstart.md) - Get up and running
- [Configuration](./guides/configuration.md) - All available options
- [Thinking](./guides/thinking.md) - Access the model's reasoning process
- [Approval Requests](./guides/approval-requests.md) - Handle permission flows
- [External Tools](./guides/external-tools.md) - Register custom tools
- [Turn Cancellation](./guides/turn-cancellation.md) - Cancel and continue sessions
- [Costs and Usage](./guides/costs-and-usage.md) - Track token consumption

## Examples

See the [examples](./examples) directory for complete working examples:

- [Ralph Loop](./examples/ralph-loop) - Iterative AI task pattern with external verification
- [Rumor Buster](./examples/rumor-buster) - Demonstrates ExternalTool capability for fact-checking

## Architecture

```
┌─────────────────┐     JSON-RPC 2.0      ┌─────────────────┐
│                 │ ◄──────────────────►  │                 │
│   Your App      │      (stdio)          │   Kimi CLI      │
│   + SDK         │                       │                 │
│                 │                       │                 │
└─────────────────┘                       └─────────────────┘
        │                                         │
        │                                         │
        ▼                                         ▼
   External Tools                           Moonshot API
   (your functions)                         (LLM inference)
```

The SDK communicates with the Kimi CLI over stdio using JSON-RPC 2.0. The CLI handles all interactions with the Moonshot API, while the SDK provides a clean interface for your application.
