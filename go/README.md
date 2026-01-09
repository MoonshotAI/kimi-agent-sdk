# Kimi Agent SDK for Go

Go SDK for programmatically controlling Kimi Agent sessions via the `kimi` CLI.

## Installation

```bash
go get github.com/MoonshotAI/kimi-agent-sdk/go
```

## Prerequisites

- `kimi` CLI installed and available in PATH
- `KIMI_API_KEY` environment variable set

## Usage

```go
package main

import (
    "context"
    "fmt"

    kimi "github.com/MoonshotAI/kimi-agent-sdk/go"
    "github.com/MoonshotAI/kimi-agent-sdk/go/wire"
)

func main() {
    session, err := kimi.NewSession(kimi.WithAutoApprove())
    if err != nil {
        panic(err)
    }
    defer session.Close()

    turn, err := session.RoundTrip(context.Background(), wire.NewStringUserInput("Hello!"))
    if err != nil {
        panic(err)
    }

    for step := range turn.Steps {
        for msg := range step.Messages {
            if cp, ok := msg.(wire.ContentPart); ok && cp.Type == wire.ContentPartTypeText {
                fmt.Print(cp.Text)
            }
        }
    }
}
```

## Important Notes

1. **Sequential RoundTrips**: Call `RoundTrip` sequentially. Wait for the previous turn to complete before starting a new one.

2. **Resource Cleanup**: Always use `defer session.Close()` to ensure proper cleanup.

3. **Responding to Requests**: For `wire.Request` messages (e.g., `ApprovalRequest`), you **must** call `Respond()`. Failing to do so will block the session indefinitely.

4. **Consume All Messages**: You must consume all messages from `step.Messages` and all steps from `turn.Steps` before starting a new RoundTrip.

5. **Cancellation**: You can cancel a turn either by canceling the context or by calling `turn.Cancel()` explicitly.
