# Quick Start

This guide will help you get started with the Kimi Agent SDK for Go in minutes.

## Installation

```bash
go get github.com/MoonshotAI/kimi-agent-sdk/go
```

## Prerequisites

1. **Kimi CLI**: Install the `kimi` CLI and ensure it's available in your PATH
2. **Environment Variables** (or use SDK options):
   - `KIMI_API_KEY` - Your API key
   - `KIMI_BASE_URL` - API endpoint (optional)
   - `KIMI_MODEL_NAME` - Model to use (optional)

## Your First Program

Here's a complete example that sends a prompt and prints the response:

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
    // Create a new session
    session, err := kimi.NewSession(
        kimi.WithAPIKey(os.Getenv("KIMI_API_KEY")),
        kimi.WithModel("kimi-k2-thinking-turbo"),
    )
    if err != nil {
        fmt.Fprintf(os.Stderr, "Failed to create session: %v\n", err)
        os.Exit(1)
    }
    defer session.Close()

    // Send a prompt
    turn, err := session.Prompt(context.Background(), wire.NewStringContent("Hello! What can you do?"))
    if err != nil {
        fmt.Fprintf(os.Stderr, "Failed to send prompt: %v\n", err)
        os.Exit(1)
    }

    // Consume the streamed response
    for step := range turn.Steps {
        for msg := range step.Messages {
            switch m := msg.(type) {
            case wire.ContentPart:
                if m.Type == wire.ContentPartTypeText {
                    fmt.Print(m.Text.Value)
                }
            }
        }
    }
    fmt.Println()

    // Check for errors that occurred during streaming
    if err := turn.Err(); err != nil {
        fmt.Fprintf(os.Stderr, "Turn error: %v\n", err)
        os.Exit(1)
    }

    // Get the final result
    result := turn.Result()
    fmt.Printf("\nStatus: %s\n", result.Status)
}
```

## Core Concepts

### Session

A `Session` represents a connection to the Kimi CLI. It manages the underlying process and communication.

```go
session, err := kimi.NewSession(options...)
defer session.Close()  // Always close when done
```

### Turn

A `Turn` represents a single conversation round-trip. When you call `Prompt()`, you get a `Turn` that lets you consume the streamed response.

```go
turn, err := session.Prompt(ctx, content)
```

Key methods:
- `turn.Steps` - Channel for receiving steps
- `turn.Err()` - Returns any error that occurred
- `turn.Result()` - Returns the final prompt result
- `turn.Usage()` - Returns token usage statistics
- `turn.Cancel()` - Cancels the current turn

### Step

Each `Step` represents a processing step in the agent's response. A turn may have multiple steps.

```go
for step := range turn.Steps {
    for msg := range step.Messages {
        // Process messages
    }
}
```

### Message Types

Messages can be events or requests:

**Events** (informational):
- `wire.ContentPart` - Text, thinking, or media content
- `wire.ToolCall` - Tool invocation
- `wire.ToolResult` - Tool execution result
- `wire.StatusUpdate` - Usage statistics

**Requests** (require response):
- `wire.ApprovalRequest` - Requires user approval
- `wire.ToolCall` (as Request) - External tool invocation (handled automatically by SDK)

For a complete list of wire message types, see the [Wire Message Types](https://moonshotai.github.io/kimi-cli/en/customization/wire-mode.html#wire-message-types) documentation.

## Handling Multiple Turns

You can send multiple prompts in sequence:

```go
// First turn
turn1, _ := session.Prompt(ctx, wire.NewStringContent("What is 2+2?"))
for step := range turn1.Steps {
    for msg := range step.Messages {
        // Process...
    }
}

// Second turn (continues the conversation)
turn2, _ := session.Prompt(ctx, wire.NewStringContent("Now multiply that by 10"))
for step := range turn2.Steps {
    for msg := range step.Messages {
        // Process...
    }
}
```

> **Important**: Always consume all messages or call `turn.Cancel()` before starting a new turn.

## Error Handling

Errors can occur at different stages:

```go
// 1. Session creation error
session, err := kimi.NewSession(...)
if err != nil {
    // Handle: failed to start CLI, init error
}

// 2. Prompt error (immediate failure)
turn, err := session.Prompt(ctx, content)
if err != nil {
    // Handle: context cancelled, RPC error
}

// 3. Turn error (during streaming)
for step := range turn.Steps {
    for msg := range step.Messages {
        // Process...
    }
}
if err := turn.Err(); err != nil {
    // Handle: streaming error, process crash
}
```

## What's Next

- [Configuration](configuration.md) - Learn about all available options
- [Thinking](thinking.md) - Access the model's reasoning process
- [Approval Requests](approval-requests.md) - Handle user approval flows
- [External Tools](external-tools.md) - Register custom tools for the model to use
- [Turn Cancellation](turn-cancellation.md) - Cancel turns and continue sessions
- [Costs and Usage](costs-and-usage.md) - Track token consumption
