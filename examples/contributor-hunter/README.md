# Contributor Hunter

A simple example demonstrating the basic usage of the Kimi Agent SDK. This tool analyzes a GitHub repository, identifies its top contributor, researches their background using web search, and generates a comprehensive Markdown report.

## Features

- Analyzes GitHub repository contributor statistics
- Identifies the top contributor by commit count
- Gathers GitHub profile information
- Researches contributor background via web search
- Generates a detailed Markdown report

## How It Works

1. The agent visits the GitHub repository's contributors page
2. Identifies the person with the most commits
3. Visits their GitHub profile to gather basic information
4. Uses web search to research their background, achievements, and other open source contributions
5. Writes a comprehensive Markdown report directly to the specified output file

## Prerequisites

- Go 1.25 or later
- [Kimi CLI](https://github.com/MoonshotAI/kimi-cli) installed
- Kimi Code subscription (required for Kimi Code features)
- Complete the setup process by running `/login`

## Installation

```bash
cd examples/contributor-hunter
go build .
```

## Usage

```bash
./contributor-hunter --repo <github-repo-url> --output <report-file>
```

### Command Line Arguments

| Argument | Description | Required | Default |
|----------|-------------|----------|---------|
| `--repo` | GitHub repository URL | Yes | - |
| `--output` | Output Markdown report file path | Yes | - |
| `--prompt` | Path to prompt template file | No | `prompts/analyze-contributor.md` |

### Examples

Analyze the Go programming language repository:

```bash
./contributor-hunter \
    --repo https://github.com/golang/go \
    --output go-top-contributor.md
```

Analyze a smaller project:

```bash
./contributor-hunter \
    --repo https://github.com/gin-gonic/gin \
    --output gin-top-contributor.md
```

Use a custom prompt:

```bash
./contributor-hunter \
    --repo https://github.com/kubernetes/kubernetes \
    --output k8s-top-contributor.md \
    --prompt custom-prompt.md
```

## Output

The generated report includes:

- **Overview**: Repository URL, top contributor username, total commits, analysis date
- **GitHub Profile**: Username, real name, company, location, bio, website
- **Background & Career**: Professional background gathered from web search
- **Notable Achievements**: Awards, notable projects, and accomplishments
- **Other Open Source Contributions**: Other significant projects they contribute to
- **Sources**: URLs used for research

## Design Philosophy

This example demonstrates the simplest possible usage of the Kimi Agent SDK:

- No external tools defined - the agent uses its built-in capabilities
- The agent directly saves the report file using its file writing abilities
- Minimal code with straightforward prompt engineering
