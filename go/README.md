# Kimi Agent SDK for Go

Go SDK for programmatically controlling Kimi Agent sessions via the [kimi-cli](https://github.com/MoonshotAI/kimi-cli).

## Installation

```bash
go get github.com/MoonshotAI/kimi-agent-sdk/go
```

## Prerequisites

- `kimi` CLI installed and available in PATH
- `KIMI_BASE_URL`, `KIMI_API_KEY`, `KIMI_MODEL_NAME` environment variables set, or use `kimi.Option` instead

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
    session, err := kimi.NewSession(
        kimi.WithBaseURL("https://api.moonshot.ai/v1"),
        kimi.WithAPIKey("your-api-key"),
        kimi.WithModel("kimi-k2-thinking-turbo"),
    )
    if err != nil {
        panic(err)
    }
    defer session.Close()

    turn, err := session.Prompt(context.Background(), wire.NewStringContent("Hello!"))
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

    // Check for errors that occurred during streaming
    if err := turn.Err(); err != nil {
        panic(err)
    }
}
```

## Turn Methods

After consuming all messages from a turn, you can inspect the turn's final state:

- `turn.Err()` - Returns any error that occurred during streaming
- `turn.Result()` - Returns the `wire.PromptResult` containing the final status
- `turn.Usage()` - Returns token usage information (`Context` and `Tokens`)

## Responding to Requests

For `wire.Request` messages (e.g., `ApprovalRequest`), you **must** call `Respond()`. Failing to do so will block the session indefinitely.

```go
for step := range turn.Steps {
    for msg := range step.Messages {
        if req, ok := msg.(wire.ApprovalRequest); ok {
            // Approve the request
            req.Respond(wire.ApprovalRequestResponseApprove)
            // Or reject: req.Respond(wire.ApprovalRequestResponseReject)
        }
    }
}
```

## External Tools

You can register external tools that the model can call during a session. Use `CreateTool` to create a tool from a Go function, and `WithTools` to register them.

> **Note**: External tools require `wire_protocol_version >= 2`. The SDK automatically detects the protocol version from the CLI. If your CLI version doesn't support protocol v2, external tools will be silently ignored.

### Defining a Tool

```go
// Define argument struct - JSON schema is generated automatically
type WeatherArgs struct {
    Location string `json:"location" description:"City name"`
    Unit     string `json:"unit,omitempty" description:"Temperature unit (celsius or fahrenheit)"`
}

// Define result type - can be string, fmt.Stringer, or any JSON-serializable type
type WeatherResult struct {
    Temperature float64 `json:"temperature"`
    Condition   string  `json:"condition"`
}

// Create the tool function
func getWeather(args WeatherArgs) (WeatherResult, error) {
    // Your implementation here
    return WeatherResult{Temperature: 22.0, Condition: "Sunny"}, nil
}
```

### Registering Tools

```go
tool, err := kimi.CreateTool(getWeather,
    kimi.WithName("get_weather"),
    kimi.WithDescription("Get current weather for a location"),
)
if err != nil {
    panic(err)
}

session, err := kimi.NewSession(
    kimi.WithTools(tool),
    // ... other options
)
```

### Tool Options

- `WithName(name)` - Set tool name (defaults to function name)
- `WithDescription(desc)` - Set tool description
- `WithFieldDescription(field, desc)` - Set description for a struct field (alternative to `description` tag)
- `WithSchema(schema)` - Set JSON schema directly, bypassing automatic generation

### JSON Schema Generation

The SDK automatically generates JSON schema from the argument struct:

- Struct fields become object properties
- Fields with `omitempty` or `omitzero` tag are optional
- Pointer fields are always optional
- Use `description` tag or `WithFieldDescription` to document fields

### How It Works

When the model calls your tool, the SDK automatically:
1. Receives `ToolCall` request from the CLI
2. Parses arguments and calls your function
3. Converts the result to string:
   - `string` → returned directly
   - `fmt.Stringer` → calls `.String()`
   - Other types → JSON serialized
4. Sends the result back via `ToolResult`

You don't need to handle external tool calls manually - just consume messages as usual.

## Important Notes

1. **Sequential Prompts**: Call `Prompt` sequentially. Wait for the previous turn to complete before starting a new one.

2. **Resource Cleanup**: Always use `defer session.Close()` to ensure proper cleanup.

3. **Consume All Messages**: You must consume all messages from `step.Messages` and all steps from `turn.Steps` before starting a new Prompt.

4. **Cancellation**: You can cancel a turn either by canceling the context or by calling `turn.Cancel()` explicitly.
