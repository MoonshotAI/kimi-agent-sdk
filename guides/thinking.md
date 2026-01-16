# Thinking

This guide explains how to enable and access the model's thinking process through the Kimi Agent SDK.

## Overview

Some models support a "thinking" capability that exposes their internal reasoning process. When enabled, the model returns both its thinking content and the final response as separate content parts. This can be useful for:

- Debugging and understanding model behavior
- Providing transparency in complex reasoning tasks
- Building applications that display the reasoning process to users

## Enabling Thinking

To enable thinking, use the `kimi.WithThinking(true)` option when creating a session:

```go
session, err := kimi.NewSession(
    kimi.WithAPIKey(os.Getenv("KIMI_API_KEY")),
    kimi.WithModel("kimi-k2-thinking-turbo"),
    kimi.WithThinking(true),
)
if err != nil {
    panic(err)
}
defer session.Close()
```

To explicitly disable thinking (even for models that default to thinking), use `kimi.WithThinking(false)`.

## Receiving Thinking Content

Thinking content is delivered as `wire.ContentPart` messages with `Type` set to `wire.ContentPartTypeThink`. The thinking text is stored in the `Think` field.

```go
for step := range turn.Steps {
    for msg := range step.Messages {
        if cp, ok := msg.(wire.ContentPart); ok {
            switch cp.Type {
            case wire.ContentPartTypeThink:
                if cp.Think.Valid {
                    fmt.Printf("[Thinking] %s\n", cp.Think.Value)
                }
            case wire.ContentPartTypeText:
                if cp.Text.Valid {
                    fmt.Printf("[Response] %s\n", cp.Text.Value)
                }
            }
        }
    }
}
```

### Content Part Types

| Type | Field | Description |
|------|-------|-------------|
| `ContentPartTypeThink` | `Think` | Model's internal reasoning process |
| `ContentPartTypeText` | `Text` | Final response text |
| `ContentPartTypeImageURL` | `ImageURL` | Image content |
| `ContentPartTypeAudioURL` | `AudioURL` | Audio content |
| `ContentPartTypeVideoURL` | `VideoURL` | Video content |

## Complete Example

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
    // Create a session with thinking enabled
    session, err := kimi.NewSession(
        kimi.WithAPIKey(os.Getenv("KIMI_API_KEY")),
        kimi.WithModel("kimi-k2-thinking-turbo"),
        kimi.WithThinking(true),
    )
    if err != nil {
        fmt.Fprintf(os.Stderr, "Failed to create session: %v\n", err)
        os.Exit(1)
    }
    defer session.Close()

    // Send a prompt that requires reasoning
    turn, err := session.Prompt(context.Background(),
        wire.NewStringContent("What is the result of 17 * 23? Show your reasoning."))
    if err != nil {
        fmt.Fprintf(os.Stderr, "Failed to send prompt: %v\n", err)
        os.Exit(1)
    }

    // Process the response, separating thinking from final output
    fmt.Println("=== Model Response ===")
    for step := range turn.Steps {
        for msg := range step.Messages {
            if cp, ok := msg.(wire.ContentPart); ok {
                switch cp.Type {
                case wire.ContentPartTypeThink:
                    if cp.Think.Valid {
                        fmt.Println("\n--- Thinking ---")
                        fmt.Println(cp.Think.Value)
                    }
                case wire.ContentPartTypeText:
                    if cp.Text.Valid {
                        fmt.Println("\n--- Response ---")
                        fmt.Println(cp.Text.Value)
                    }
                }
            }
        }
    }

    // Check for errors
    if err := turn.Err(); err != nil {
        fmt.Fprintf(os.Stderr, "Turn error: %v\n", err)
        os.Exit(1)
    }

    // Show usage statistics
    usage := turn.Usage()
    if usage != nil {
        fmt.Printf("\nTokens used: input=%d, output=%d\n",
            usage.Tokens.InputOther, usage.Tokens.Output)
    }
}
```

## Best Practices

1. **Use thinking for complex tasks** - Thinking is most useful for tasks that require multi-step reasoning, such as math problems, logical deductions, or complex analysis.

2. **Consider UI presentation** - When displaying thinking to users, consider collapsing or styling it differently from the main response to avoid overwhelming them.

3. **Be aware of token usage** - Thinking content counts toward token usage. For cost-sensitive applications, you may want to disable thinking for simple queries.

4. **Handle Optional fields properly** - Always check the `Valid` field before accessing `Value` to avoid using uninitialized data:
   ```go
   if cp.Think.Valid {
       // Safe to use cp.Think.Value
   }
   ```

5. **Choose appropriate models** - Not all models support thinking. Use models that have the thinking capability, such as `kimi-k2-thinking-turbo`.
