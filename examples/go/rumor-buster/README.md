# Rumor Buster Example

This example demonstrates the ExternalTool capability of the Kimi Agent SDK. It verifies claims (distinguishing facts from rumors) using an AI agent with web search, then generates a verification report.

## How It Works

1. Main process loads a list of claims to verify from a JSON file
2. Main process registers an ExternalTool called `report_verification_result`
3. Agent receives the claims and instructions to:
   - Search the web for each claim
   - Determine if each claim is a fact or rumor
   - Call the tool to report results (claim_id, verdict, evidence_urls, summary)
4. Main process collects all tool call results
5. Main process generates a final verification report

## Installation

```bash
cd examples/rumor-buster
go build .
```

## Usage

```bash
./rumor-buster \
    --claims <claims-file.json> \
    --prompt <prompt-file.md> \
    --output <report-file.txt>
```

### Flags

| Flag | Description | Required | Default |
|------|-------------|----------|---------|
| `--claims` | Path to JSON file containing claims to verify | Yes | - |
| `--prompt` | Path to the prompt file | No | `prompts/verify-claims.md` |
| `--output` | Output report file path | No | stdout |

### Environment Variables

- `KIMI_API_KEY`: Your Kimi API key (required)

## Claims File Format

The claims file should be a JSON array of claim objects:

```json
[
  {
    "id": "claim-1",
    "statement": "The Great Wall of China is visible from space with the naked eye"
  },
  {
    "id": "claim-2",
    "statement": "Humans only use 10% of their brain"
  },
  {
    "id": "claim-3",
    "statement": "Water conducts electricity"
  }
]
```

## Example

```bash
# Create a test claims file
cat > test-claims.json << 'EOF'
[
  {"id": "c1", "statement": "The Great Wall of China is visible from space with the naked eye"},
  {"id": "c2", "statement": "Goldfish have a 3-second memory"},
  {"id": "c3", "statement": "Lightning never strikes the same place twice"}
]
EOF

# Run verification
./rumor-buster --claims test-claims.json --output report.txt

# View the report
cat report.txt
```

## Sample Output

```
========================================
       RUMOR BUSTER REPORT
       Generated: 2024-01-15T10:30:00Z
========================================

[c1] ✗ RUMOR
Summary: The Great Wall is not visible from low Earth orbit with the naked eye. Astronauts have confirmed this misconception.
Evidence:
  - https://www.nasa.gov/...
  - https://www.scientificamerican.com/...

[c2] ✗ RUMOR
Summary: Humans use virtually all parts of their brain, and most of the brain is active almost all the time.
Evidence:
  - https://www.scientificamerican.com/...

[c3] ✗ RUMOR
Summary: Lightning frequently strikes the same location, especially tall structures like the Empire State Building.
Evidence:
  - https://www.weather.gov/...

========================================
Summary: 0 facts, 3 rumors verified
========================================
```

## How the ExternalTool Works

The example demonstrates how to:

1. **Define a tool function** with typed arguments:
```go
type VerificationResult struct {
    ClaimID      string   `json:"claim_id"`
    Verdict      string   `json:"verdict"`
    EvidenceURLs []string `json:"evidence_urls"`
    Summary      string   `json:"summary"`
}
```

2. **Create the tool** using `kimi.CreateTool`:
```go
reportTool, err := kimi.CreateTool(
    func(result VerificationResult) (string, error) {
        // Handle the result
        return "Success", nil
    },
    kimi.WithName("report_verification_result"),
    kimi.WithDescription("Report the verification result for a claim"),
)
```

3. **Register the tool** with the session:
```go
session, err := kimi.NewSession(
    kimi.WithTools(reportTool),
)
```

4. **Collect results** when the agent calls the tool - the function you provided is invoked with the parsed arguments.

## Best Practices

1. **Clear tool descriptions**: Provide detailed descriptions for the tool and its fields to help the agent understand how to use it correctly.

2. **Structured data**: Use strongly-typed structs for tool arguments to ensure type safety and automatic schema generation.

3. **Prompt engineering**: Clearly instruct the agent to call the tool for every item that needs processing.

4. **Error handling**: Handle both tool creation errors and session errors appropriately.
