# Configuration

This guide covers all configuration options available in the Kimi Agent SDK.

## Quick Reference

| Option | Description |
|--------|-------------|
| `kimi.WithAPIKey(key)` | Set API key |
| `kimi.WithBaseURL(url)` | Set API endpoint |
| `kimi.WithModel(model)` | Set model name |
| `kimi.WithExecutable(path)` | Set CLI executable path |
| `kimi.WithWorkDir(dir)` | Set working directory |
| `kimi.WithSession(id)` | Resume existing session |
| `kimi.WithConfig(cfg)` | Provide configuration struct |
| `kimi.WithConfigFile(path)` | Load configuration from file |
| `kimi.WithMCPConfig(cfg)` | Set MCP configuration |
| `kimi.WithMCPConfigFile(path)` | Load MCP config from file |
| `kimi.WithAutoApprove()` | Auto-approve all requests |
| `kimi.WithThinking(bool)` | Enable/disable thinking mode |
| `kimi.WithSkillsDir(dir)` | Set skills directory |
| `kimi.WithArgs(args...)` | Add custom CLI arguments |
| `kimi.WithTools(tools...)` | Register external tools |

## Basic Configuration

### API Credentials

```go
session, err := kimi.NewSession(
    kimi.WithAPIKey("your-api-key"),
    kimi.WithBaseURL("https://api.moonshot.ai/v1"),
)
```

These can also be set via environment variables:
- `KIMI_API_KEY`
- `KIMI_BASE_URL`

### Model Selection

```go
session, err := kimi.NewSession(
    kimi.WithModel("kimi-k2-thinking-turbo"),
)
```

Or via environment variable: `KIMI_MODEL_NAME`

## Execution Environment

### Custom Executable

By default, the SDK runs `kimi` from PATH. You can specify a custom path:

```go
session, err := kimi.NewSession(
    kimi.WithExecutable("/path/to/kimi"),
)
```

### Working Directory

Set the directory where the agent operates:

```go
session, err := kimi.NewSession(
    kimi.WithWorkDir("/path/to/project"),
)
```

### Custom Arguments

Pass additional CLI arguments:

```go
session, err := kimi.NewSession(
    kimi.WithArgs("--verbose", "--debug"),
)
```

## Session Management

### Resume Existing Session

Continue a previous conversation:

```go
session, err := kimi.NewSession(
    kimi.WithSession("session-id-from-previous-run"),
)
```

## Configuration File

### Using Config Struct

```go
config := &kimi.Config{
    DefaultModel: "my-model",
    Providers: map[string]kimi.LLMProvider{
        "my-provider": {
            Type:    kimi.ProviderTypeKimi,
            BaseURL: "https://api.moonshot.ai/v1",
            APIKey:  "your-api-key",
        },
    },
    Models: map[string]kimi.LLMModel{
        "my-model": {
            Provider:       "my-provider",
            Model:          "moonshot-v1-128k",
            MaxContextSize: 128000,
        },
    },
    LoopControl: kimi.LoopControl{
        MaxStepsPerRun:    25,
        MaxRetriesPerStep: 3,
    },
}

session, err := kimi.NewSession(
    kimi.WithConfig(config),
)
```

### Using Config File

```go
session, err := kimi.NewSession(
    kimi.WithConfigFile("/path/to/config.json"),
)
```

### Config Structure

```go
type Config struct {
    DefaultModel string                 `json:"default_model"`
    Models       map[string]LLMModel    `json:"models"`
    Providers    map[string]LLMProvider `json:"providers"`
    LoopControl  LoopControl            `json:"loop_control"`
    Services     Services               `json:"services"`
    MCP          MCPConfig              `json:"mcp"`
}
```

### Provider Types

Supported provider types:

| Type | Constant |
|------|----------|
| Kimi | `ProviderTypeKimi` |
| OpenAI (Legacy) | `ProviderTypeOpenAILegacy` |
| OpenAI (Responses) | `ProviderTypeOpenAIResponses` |
| Anthropic | `ProviderTypeAnthropic` |
| Google GenAI | `ProviderTypeGoogleGenAI` |
| Gemini | `ProviderTypeGemini` |
| Vertex AI | `ProviderTypeVertexAI` |

### Model Capabilities

```go
type LLMModel struct {
    Provider       string                   `json:"provider"`
    Model          string                   `json:"model"`
    MaxContextSize int                      `json:"max_context_size"`
    Capabilities   map[ModelCapability]bool `json:"capabilities,omitempty"`
}
```

Available capabilities:
- `ModelCapabilityImageIn` - Supports image input
- `ModelCapabilityVideoIn` - Supports video input
- `ModelCapabilityThinking` - Supports thinking mode

### Loop Control

Control agent execution limits:

```go
type LoopControl struct {
    MaxStepsPerRun    int `json:"max_steps_per_run"`
    MaxRetriesPerStep int `json:"max_retries_per_step"`
}
```

## MCP Configuration

### MCP Config Struct

```go
mcpConfig := &kimi.MCPConfig{
    Client: kimi.MCPClientConfig{
        ToolCallTimeoutMS: 30000,
    },
}

session, err := kimi.NewSession(
    kimi.WithMCPConfig(mcpConfig),
)
```

### MCP Config File

```go
session, err := kimi.NewSession(
    kimi.WithMCPConfigFile("/path/to/mcp-config.json"),
)
```

## Behavior Control

### Auto Approve

Automatically approve all requests without prompting:

```go
session, err := kimi.NewSession(
    kimi.WithAutoApprove(),
)
```

> **Warning**: Use with caution. This bypasses safety checks for tool execution.

### Thinking Mode

Enable or disable the model's thinking/reasoning mode:

```go
// Enable thinking
session, err := kimi.NewSession(
    kimi.WithThinking(true),
)

// Disable thinking
session, err := kimi.NewSession(
    kimi.WithThinking(false),
)
```

## Advanced Options

### Skills Directory

Specify a custom directory for skills:

```go
session, err := kimi.NewSession(
    kimi.WithSkillsDir("/path/to/skills"),
)
```

### External Tools

Register custom tools for the model to use. See [External Tools](external-tools.md) for details.

```go
session, err := kimi.NewSession(
    kimi.WithTools(tool1, tool2),
)
```

## Configuration Priority

When the same setting is specified in multiple places, the priority is:

1. **SDK Options** (highest) - `kimi.WithXxx()` functions
2. **Environment Variables**
3. **Configuration File** (lowest)

## Example: Complete Configuration

```go
package main

import (
    "context"
    "fmt"

    kimi "github.com/MoonshotAI/kimi-agent-sdk/go"
    "github.com/MoonshotAI/kimi-agent-sdk/go/wire"
)

func main() {
    config := &kimi.Config{
        DefaultModel: "my-model",
        Providers: map[string]kimi.LLMProvider{
            "moonshot": {
                Type:    kimi.ProviderTypeKimi,
                BaseURL: "https://api.moonshot.ai/v1",
                APIKey:  "your-api-key",
            },
        },
        Models: map[string]kimi.LLMModel{
            "my-model": {
                Provider:       "moonshot",
                Model:          "moonshot-v1-128k",
                MaxContextSize: 128000,
                Capabilities: map[kimi.ModelCapability]bool{
                    kimi.ModelCapabilityImageIn: true,
                },
            },
        },
        LoopControl: kimi.LoopControl{
            MaxStepsPerRun:    25,
            MaxRetriesPerStep: 3,
        },
    }

    session, err := kimi.NewSession(
        kimi.WithConfig(config),
        kimi.WithWorkDir("/path/to/project"),
        kimi.WithThinking(true),
    )
    if err != nil {
        panic(err)
    }
    defer session.Close()

    turn, _ := session.Prompt(context.Background(), wire.NewStringContent("Hello!"))
    for step := range turn.Steps {
        for msg := range step.Messages {
            if cp, ok := msg.(wire.ContentPart); ok {
                fmt.Print(cp.Text.Value)
            }
        }
    }
}
```
