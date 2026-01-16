# External Tools

This guide explains how to create and register external tools that the Kimi agent can call during a session.

## Overview

External tools allow you to extend the agent's capabilities by providing custom functions. When the model determines it needs to use your tool, the SDK automatically:

1. Receives the tool call request from the CLI
2. Parses arguments and calls your function
3. Sends the result back to the model

## Creating a Tool

### Step 1: Define the Argument Struct

```go
type WeatherArgs struct {
    Location string `json:"location" description:"City name to get weather for"`
    Unit     string `json:"unit,omitempty" description:"Temperature unit (celsius or fahrenheit)"`
}
```

The SDK automatically generates a JSON schema from your struct.

### Step 2: Define the Return Type

The return type can be:
- `string` - Returned directly
- `fmt.Stringer` - The `String()` method is called
- Any other type - JSON serialized

```go
// Option 1: Return string directly
func getWeather(args WeatherArgs) (string, error) {
    return fmt.Sprintf("Weather in %s: 22°C", args.Location), nil
}

// Option 2: Return a struct (will be JSON serialized)
type WeatherResult struct {
    Temperature float64 `json:"temperature"`
    Condition   string  `json:"condition"`
}

func getWeather(args WeatherArgs) (WeatherResult, error) {
    return WeatherResult{Temperature: 22.0, Condition: "Sunny"}, nil
}
```

### Step 3: Create the Tool

```go
tool, err := kimi.CreateTool(getWeather,
    kimi.WithDescription("Get current weather for a location"),
)
if err != nil {
    panic(err)
}
```

> **Note**: The tool name is automatically derived from the function name. In this example, the tool will be named based on `getWeather`. Use `kimi.WithName()` only if you need to override the default name.

### Step 4: Register with Session

```go
session, err := kimi.NewSession(
    kimi.WithTools(tool),
)
```

## Tool Options

### WithName

Set the tool name (defaults to function name):

```go
kimi.WithName("my_custom_tool")
```

### WithDescription

Set the tool description shown to the model:

```go
kimi.WithDescription("A detailed description of what this tool does")
```

### WithFieldDescription

Override or add descriptions for struct fields:

```go
kimi.WithFieldDescription("Location", "The city name, e.g., 'Beijing' or 'New York'")
```

This takes precedence over the `description` struct tag.

### WithSchema

Provide a custom JSON schema directly, bypassing automatic generation:

```go
schema := json.RawMessage(`{
    "type": "object",
    "properties": {
        "query": {"type": "string", "description": "Search query"},
        "limit": {"type": "integer", "minimum": 1, "maximum": 100}
    },
    "required": ["query"]
}`)

tool, err := kimi.CreateTool(search,
    kimi.WithSchema(schema),
)
```

Use this when you need full control over the schema (e.g., for advanced constraints like `minimum`, `maximum`, `pattern`, `enum`, etc.) or when the automatic generation doesn't meet your needs.

## JSON Schema Generation

The SDK automatically generates JSON schema from your argument struct.

### Type Mappings

| Go Type | JSON Schema Type |
|---------|-----------------|
| `string` | `"string"` |
| `bool` | `"boolean"` |
| `int`, `int8`, `int16`, `int32`, `int64` | `"integer"` |
| `uint`, `uint8`, `uint16`, `uint32`, `uint64` | `"integer"` |
| `float32`, `float64` | `"number"` |
| `struct` | `"object"` |
| `[]T`, `[N]T` | `"array"` |
| `map[string]T` | `"object"` |
| `*T` | Same as `T`, but optional |

### Required vs Optional Fields

Fields are **required** by default. They become **optional** when:

1. The `json` tag includes `omitempty` or `omitzero`:
   ```go
   Limit int `json:"limit,omitempty"`  // optional
   ```

2. The field is a pointer type:
   ```go
   Options *SearchOptions `json:"options"`  // optional
   ```

### Field Descriptions

Use the `description` struct tag:

```go
type SearchArgs struct {
    Query  string `json:"query" description:"The search query string"`
    Limit  int    `json:"limit,omitempty" description:"Maximum number of results"`
}
```

### Nested Structs

Nested structs are fully supported:

```go
type OrderArgs struct {
    Customer CustomerInfo `json:"customer"`
    Items    []OrderItem  `json:"items"`
}

type CustomerInfo struct {
    Name  string `json:"name"`
    Email string `json:"email"`
}

type OrderItem struct {
    ProductID string `json:"product_id"`
    Quantity  int    `json:"quantity"`
}
```

## Unsupported Types

These types will cause `CreateTool` to return an error:

- `func` types
- `interface{}` / `any` (except in special cases)
- `chan` types

## How Tool Calls Work

When the model calls your tool, the flow is:

```
Model → CLI → SDK (ToolCall Request) → Your Function → SDK (ToolResult) → CLI → Model
```

You don't need to handle external tool `ToolCall` requests manually. The SDK intercepts them and calls your registered functions automatically.

## Error Handling

Return an error to indicate tool failure:

```go
func divide(args DivideArgs) (float64, error) {
    if args.Divisor == 0 {
        return 0, fmt.Errorf("cannot divide by zero")
    }
    return args.Dividend / args.Divisor, nil
}
```

The error message will be sent back to the model as part of the tool result.

## Multiple Tools

Register multiple tools at once:

```go
weatherTool, _ := kimi.CreateTool(getWeather,
    kimi.WithName("get_weather"),
)

calculatorTool, _ := kimi.CreateTool(calculate,
    kimi.WithName("calculator"),
)

searchTool, _ := kimi.CreateTool(search,
    kimi.WithName("search"),
)

session, err := kimi.NewSession(
    kimi.WithTools(weatherTool, calculatorTool, searchTool),
)
```

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

// Define argument struct
type CalculatorArgs struct {
    Operation string  `json:"operation" description:"One of: add, subtract, multiply, divide"`
    A         float64 `json:"a" description:"First operand"`
    B         float64 `json:"b" description:"Second operand"`
}

// Define result struct
type CalculatorResult struct {
    Result    float64 `json:"result"`
    Operation string  `json:"operation"`
}

// Implement the tool function
func calculate(args CalculatorArgs) (CalculatorResult, error) {
    var result float64

    switch args.Operation {
    case "add":
        result = args.A + args.B
    case "subtract":
        result = args.A - args.B
    case "multiply":
        result = args.A * args.B
    case "divide":
        if args.B == 0 {
            return CalculatorResult{}, fmt.Errorf("division by zero")
        }
        result = args.A / args.B
    default:
        return CalculatorResult{}, fmt.Errorf("unknown operation: %s", args.Operation)
    }

    return CalculatorResult{
        Result:    result,
        Operation: args.Operation,
    }, nil
}

func main() {
    // Create the tool
    tool, err := kimi.CreateTool(calculate,
        kimi.WithName("calculator"),
        kimi.WithDescription("Perform basic arithmetic operations"),
    )
    if err != nil {
        panic(err)
    }

    // Create session with the tool
    session, err := kimi.NewSession(
        kimi.WithAPIKey(os.Getenv("KIMI_API_KEY")),
        kimi.WithTools(tool),
    )
    if err != nil {
        panic(err)
    }
    defer session.Close()

    // Send a prompt that will trigger tool usage
    turn, err := session.Prompt(context.Background(),
        wire.NewStringContent("What is 123 multiplied by 456?"))
    if err != nil {
        panic(err)
    }

    // Consume the response
    for step := range turn.Steps {
        for msg := range step.Messages {
            switch m := msg.(type) {
            case wire.ContentPart:
                if m.Type == wire.ContentPartTypeText {
                    fmt.Print(m.Text.Value)
                }
            case wire.ToolCall:
                fmt.Printf("\n[Tool called: %s]\n", m.Function.Name)
            case wire.ToolResult:
                fmt.Printf("[Tool result: %s]\n", m.ReturnValue.Output.Text.Value)
            }
        }
    }
    fmt.Println()

    if err := turn.Err(); err != nil {
        fmt.Printf("Error: %v\n", err)
    }
}
```

## Best Practices

1. **Descriptive names** - Use clear, action-oriented names like `search_documents` not `sd`
2. **Detailed descriptions** - Help the model understand when to use each tool
3. **Validate inputs** - Check arguments before processing
4. **Return structured data** - When possible, return structs for richer information
5. **Handle errors gracefully** - Return meaningful error messages
6. **Keep tools focused** - One tool should do one thing well
