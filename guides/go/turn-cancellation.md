# Turn Cancellation

This guide explains how to cancel an ongoing turn and continue using the session afterward.

## Overview

Sometimes you need to stop a turn before it completes—for example, when a user wants to interrupt a long response or when a timeout is reached. The SDK provides two ways to cancel a turn:

1. Call `turn.Cancel()` directly
2. Cancel the context passed to `session.Prompt()`

After cancellation, the session remains active and can be used for subsequent prompts.

## Cancellation Methods

### Method 1: Using turn.Cancel()

The most direct way to cancel a turn:

```go
turn, err := session.Prompt(ctx, wire.NewStringContent("Tell me a long story"))
if err != nil {
    panic(err)
}

// Start consuming messages in a goroutine
go func() {
    for step := range turn.Steps {
        for msg := range step.Messages {
            if cp, ok := msg.(wire.ContentPart); ok && cp.Type == wire.ContentPartTypeText {
                fmt.Print(cp.Text.Value)
            }
        }
    }
}()

// Cancel after 5 seconds
time.Sleep(5 * time.Second)
turn.Cancel()
```

### Method 2: Using Context Cancellation

Cancel via the context passed to `Prompt()`:

```go
ctx, cancel := context.WithCancel(context.Background())

turn, err := session.Prompt(ctx, wire.NewStringContent("Tell me a long story"))
if err != nil {
    panic(err)
}

// Start consuming messages in a goroutine
go func() {
    for step := range turn.Steps {
        for msg := range step.Messages {
            if cp, ok := msg.(wire.ContentPart); ok && cp.Type == wire.ContentPartTypeText {
                fmt.Print(cp.Text.Value)
            }
        }
    }
}()

// Cancel after 5 seconds
time.Sleep(5 * time.Second)
cancel()
```

### Method 3: Using Context with Timeout

Automatically cancel after a timeout:

```go
ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
defer cancel()

turn, err := session.Prompt(ctx, wire.NewStringContent("Analyze this document..."))
if err != nil {
    panic(err)
}

for step := range turn.Steps {
    for msg := range step.Messages {
        // Process messages...
        // Turn will be cancelled automatically after 10 seconds
    }
}
```

## Checking Cancellation Status

After a turn ends, you can check if it was cancelled:

```go
result := turn.Result()
if result.Status == wire.PromptResultStatusCancelled {
    fmt.Println("Turn was cancelled")
} else if result.Status == wire.PromptResultStatusFinished {
    fmt.Println("Turn completed normally")
}
```

### PromptResultStatus Values

| Status | Description |
|--------|-------------|
| `PromptResultStatusPending` | Turn is still in progress |
| `PromptResultStatusFinished` | Turn completed successfully |
| `PromptResultStatusCancelled` | Turn was cancelled |

## Continuing the Session After Cancellation

After cancelling a turn, the session remains active. You can start a new turn immediately:

```go
session, _ := kimi.NewSession(
    kimi.WithAPIKey(os.Getenv("KIMI_API_KEY")),
)
defer session.Close()

// First turn - cancel it
turn1, _ := session.Prompt(ctx, wire.NewStringContent("Tell me a very long story"))
go func() {
    for step := range turn1.Steps {
        for range step.Messages {
        }
    }
}()
time.Sleep(2 * time.Second)
turn1.Cancel()

fmt.Println("First turn cancelled, starting second turn...")

// Second turn - the session is still usable
turn2, _ := session.Prompt(ctx, wire.NewStringContent("What is 2 + 2?"))
for step := range turn2.Steps {
    for msg := range step.Messages {
        if cp, ok := msg.(wire.ContentPart); ok && cp.Type == wire.ContentPartTypeText {
            fmt.Print(cp.Text.Value)
        }
    }
}

if err := turn2.Err(); err != nil {
    fmt.Printf("Error: %v\n", err)
}
```

## Important Notes

1. **Always consume or cancel** - Before starting a new turn, you must either:
   - Consume all messages from the current turn (`for step := range turn.Steps { for range step.Messages {} }`)
   - Call `turn.Cancel()` to abort the current turn

2. **Cancel is safe to call multiple times** - Calling `Cancel()` on an already-cancelled or completed turn is safe.

3. **Context cancellation triggers Cancel RPC** - When you cancel the context, the SDK sends a `cancel` RPC to the CLI to stop the current operation.

4. **Partial results are available** - After cancellation, you can still access:
   - `turn.Usage()` - Token usage up to the point of cancellation
   - Any messages received before cancellation

## Complete Example

```go
package main

import (
    "context"
    "fmt"
    "os"
    "time"

    kimi "github.com/MoonshotAI/kimi-agent-sdk/go"
    "github.com/MoonshotAI/kimi-agent-sdk/go/wire"
)

func main() {
    session, err := kimi.NewSession(
        kimi.WithAPIKey(os.Getenv("KIMI_API_KEY")),
    )
    if err != nil {
        panic(err)
    }
    defer session.Close()

    // Start a turn with a timeout context
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()

    turn, err := session.Prompt(ctx,
        wire.NewStringContent("Write a detailed essay about the history of computing"))
    if err != nil {
        panic(err)
    }

    // Consume messages until cancelled or complete
    for step := range turn.Steps {
        for msg := range step.Messages {
            if cp, ok := msg.(wire.ContentPart); ok && cp.Type == wire.ContentPartTypeText {
                fmt.Print(cp.Text.Value)
            }
        }
    }
    fmt.Println()

    // Check the result
    result := turn.Result()
    switch result.Status {
    case wire.PromptResultStatusCancelled:
        fmt.Println("\n[Turn was cancelled due to timeout]")
    case wire.PromptResultStatusFinished:
        fmt.Println("\n[Turn completed successfully]")
    }

    // Show partial usage
    usage := turn.Usage()
    if usage != nil {
        fmt.Printf("Tokens used before cancellation: input=%d, output=%d\n",
            usage.Tokens.InputOther, usage.Tokens.Output)
    }

    // Continue with a new turn
    fmt.Println("\nStarting follow-up turn...")
    turn2, err := session.Prompt(context.Background(),
        wire.NewStringContent("Summarize what you wrote in one sentence"))
    if err != nil {
        panic(err)
    }

    for step := range turn2.Steps {
        for msg := range step.Messages {
            if cp, ok := msg.(wire.ContentPart); ok && cp.Type == wire.ContentPartTypeText {
                fmt.Print(cp.Text.Value)
            }
        }
    }
    fmt.Println()
}
```

## Best Practices

1. **Use timeouts for long operations** - Wrap prompts with `context.WithTimeout()` to prevent indefinite waits
2. **Clean up properly** - Always call `defer session.Close()` to ensure resources are released
3. **Handle cancellation gracefully** - Check `turn.Result().Status` to determine if a turn was cancelled
4. **Log partial progress** - Use `turn.Usage()` to track tokens consumed before cancellation
