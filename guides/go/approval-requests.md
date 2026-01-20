# Approval Requests

This guide explains how to handle approval requests when the Kimi agent needs permission to perform certain actions.

## What Are Approval Requests?

When the Kimi agent wants to perform potentially sensitive operations (like executing commands, modifying files, or accessing external resources), it sends an `ApprovalRequest` to get user confirmation before proceeding.

## ApprovalRequest Structure

```go
type ApprovalRequest struct {
    ID          string         // Unique request identifier
    ToolCallID  string         // Associated tool call ID
    Sender      string         // Who is requesting (e.g., "agent")
    Action      string         // What action is being requested
    Description string         // Human-readable description
    Display     []DisplayBlock // Rich display information
}
```

### Display Blocks

Display blocks provide rich information about the request:

```go
type DisplayBlock struct {
    Type    DisplayBlockType // "brief", "diff", "todo", "unknown"
    Text    string           // Text content
    Path    string           // File path (for diffs)
    OldText string           // Old content (for diffs)
    NewText string           // New content (for diffs)
    Items   []DisplayBlockTodoItem // Todo items
}
```

## Response Options

When you receive an `ApprovalRequest`, you must respond with one of these options:

| Response | Constant | Description |
|----------|----------|-------------|
| Approve | `wire.ApprovalRequestResponseApprove` | Allow this specific action |
| Approve for Session | `wire.ApprovalRequestResponseApproveForSession` | Allow this and similar actions for the rest of the session |
| Reject | `wire.ApprovalRequestResponseReject` | Deny the action |

## Handling Approval Requests

### Basic Handler

```go
for step := range turn.Steps {
    for msg := range step.Messages {
        if req, ok := msg.(wire.ApprovalRequest); ok {
            fmt.Printf("Request ID: %s\n", req.ID)
            fmt.Printf("Action: %s\n", req.Action)
            fmt.Printf("Description: %s\n", req.Description)

            // Approve the request
            if err := req.Respond(wire.ApprovalRequestResponseApprove); err != nil {
                fmt.Printf("Failed to respond: %v\n", err)
            }
        }
    }
}
```

### Interactive Approval

```go
func handleApproval(req wire.ApprovalRequest) wire.ApprovalRequestResponse {
    fmt.Printf("\n=== Approval Required ===\n")
    fmt.Printf("Action: %s\n", req.Action)
    fmt.Printf("Description: %s\n", req.Description)

    // Display rich information
    for _, block := range req.Display {
        switch block.Type {
        case wire.DisplayBlockTypeBrief:
            fmt.Printf("Brief: %s\n", block.Text)
        case wire.DisplayBlockTypeDiff:
            fmt.Printf("File: %s\n", block.Path)
            fmt.Printf("- %s\n", block.OldText)
            fmt.Printf("+ %s\n", block.NewText)
        }
    }

    fmt.Print("Approve? (y/n/a): ")
    var input string
    fmt.Scanln(&input)

    switch input {
    case "y":
        return wire.ApprovalRequestResponseApprove
    case "a":
        return wire.ApprovalRequestResponseApproveForSession
    default:
        return wire.ApprovalRequestResponseReject
    }
}

// Usage
for step := range turn.Steps {
    for msg := range step.Messages {
        if req, ok := msg.(wire.ApprovalRequest); ok {
            response := handleApproval(req)
            req.Respond(response)
        }
    }
}
```

### Auto-Approve Mode

For automated pipelines or when you trust the agent fully, use `kimi.WithAutoApprove()`:

```go
session, err := kimi.NewSession(
    kimi.WithAutoApprove(),
)
```

> **Warning**: Auto-approve bypasses all safety checks. Use only in controlled environments.

## Important: You Must Respond

**Failing to respond to an `ApprovalRequest` will block the session indefinitely.**

The agent waits for your response before proceeding. Always ensure your code handles all `ApprovalRequest` messages:

```go
for step := range turn.Steps {
    for msg := range step.Messages {
        switch m := msg.(type) {
        case wire.ApprovalRequest:
            // MUST respond - pick one:
            m.Respond(wire.ApprovalRequestResponseApprove)
            // or m.Respond(wire.ApprovalRequestResponseApproveForSession)
            // or m.Respond(wire.ApprovalRequestResponseReject)
        case wire.ContentPart:
            // Handle content...
        }
    }
}
```

## ApprovalRequestResolved Event

After an approval request is handled, you'll receive an `ApprovalRequestResolved` event confirming the resolution:

```go
type ApprovalRequestResolved struct {
    RequestID string                  // ID of the resolved request
    Response  ApprovalRequestResponse // How it was resolved
}
```

Example handling:

```go
for msg := range step.Messages {
    switch m := msg.(type) {
    case wire.ApprovalRequest:
        m.Respond(wire.ApprovalRequestResponseApprove)
    case wire.ApprovalRequestResolved:
        fmt.Printf("Request %s resolved with: %s\n", m.RequestID, m.Response)
    }
}
```

## Complete Example

```go
package main

import (
    "bufio"
    "context"
    "fmt"
    "os"
    "strings"

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

    reader := bufio.NewReader(os.Stdin)

    turn, err := session.Prompt(context.Background(),
        wire.NewStringContent("Create a file called test.txt with 'Hello World'"))
    if err != nil {
        panic(err)
    }

    for step := range turn.Steps {
        for msg := range step.Messages {
            switch m := msg.(type) {
            case wire.ContentPart:
                if m.Type == wire.ContentPartTypeText {
                    fmt.Print(m.Text.Value)
                }
            case wire.ApprovalRequest:
                fmt.Printf("\n\n--- Approval Required ---\n")
                fmt.Printf("Action: %s\n", m.Action)
                fmt.Printf("Description: %s\n", m.Description)
                fmt.Print("Approve? (y/n): ")

                input, _ := reader.ReadString('\n')
                input = strings.TrimSpace(input)

                if input == "y" {
                    m.Respond(wire.ApprovalRequestResponseApprove)
                    fmt.Println("Approved!")
                } else {
                    m.Respond(wire.ApprovalRequestResponseReject)
                    fmt.Println("Rejected!")
                }
            }
        }
    }

    if err := turn.Err(); err != nil {
        fmt.Printf("Error: %v\n", err)
    }
}
```

## Best Practices

1. **Always handle ApprovalRequest** - Never ignore these messages
2. **Log approvals** - Keep track of what was approved for audit purposes
3. **Use ApproveForSession sparingly** - It's convenient but reduces safety
4. **Validate before approving** - Check the action and description carefully
5. **Handle errors** - The `Respond()` method can return errors
