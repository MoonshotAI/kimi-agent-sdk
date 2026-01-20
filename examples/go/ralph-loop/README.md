# Ralph Loop Example

This example demonstrates the Ralph Loop pattern using the Kimi Agent SDK.

## What is Ralph Loop?

Ralph Loop (also known as the Ralph Wiggum technique) is an AI coding pattern that iteratively runs an AI agent until a task is complete. The core idea:

1. Give the AI agent a task
2. Agent executes the task
3. **Verify completion by running actual commands** (not trusting agent output)
4. If verification fails, continue looping until done

The name comes from Ralph Wiggum from The Simpsons - always making mistakes but never giving up.

### Key Advantages

- **Fresh context each iteration**: Avoids context pollution from long message histories
- **External verification**: Never trust agent output - always verify with real commands
- **Autonomous operation**: Can run unattended for hours with iteration limits

### Use Cases

- **Test coverage improvement**: Run tests, find uncovered code, write tests, repeat
- **Lint fixes**: Run linter, fix errors one by one, verify fixes
- **Code deduplication**: Find duplicate code, refactor, verify
- **Documentation generation**: Generate docs, verify completeness

## Installation

```bash
cd examples/ralph-loop
go build .
```

## Usage

```bash
./ralph-loop \
    --prompt <prompt-file> \
    --verify-cmd <verification-command> \
    --max-iterations <max> \
    --work-dir <directory>
```

### Flags

| Flag | Description | Required |
|------|-------------|----------|
| `--prompt` | Path to the prompt file | Yes |
| `--verify-cmd` | Command to verify task completion (exit 0 = complete) | Yes |
| `--max-iterations` | Maximum number of iterations (default: 10) | No |
| `--work-dir` | Working directory for the agent (default: current) | No |

### Environment Variables

- `KIMI_API_KEY`: Your Kimi API key (required)

## Examples

### Fix Linting Errors

```bash
./ralph-loop \
    --prompt prompts/lint-fix.md \
    --verify-cmd "golangci-lint run ./..." \
    --max-iterations 10 \
    --work-dir /path/to/your/project
```

### Improve Test Coverage

For test coverage, you'll need a script that checks the coverage threshold:

```bash
# scripts/check-coverage.sh
#!/bin/bash
THRESHOLD=$1
COVERAGE=$(go test -coverprofile=coverage.out ./... 2>/dev/null | grep -oP 'coverage: \K[0-9.]+')
if (( $(echo "$COVERAGE >= $THRESHOLD" | bc -l) )); then
    echo "Coverage $COVERAGE% meets threshold $THRESHOLD%"
    exit 0
else
    echo "Coverage $COVERAGE% below threshold $THRESHOLD%"
    exit 1
fi
```

Then run:

```bash
./ralph-loop \
    --prompt prompts/test-coverage.md \
    --verify-cmd "./scripts/check-coverage.sh 80" \
    --max-iterations 20 \
    --work-dir /path/to/your/project
```

## Best Practices

1. **Set reasonable iteration limits**: Avoid infinite loops with stochastic systems. 5-10 for small tasks, 30-50 for larger ones.

2. **Keep tasks small**: Each task should be completable in one context window. Break large tasks into smaller ones.

3. **Use external verification**: Never trust agent output. Always verify with real commands (tests, linters, etc.).

4. **Ensure each iteration is valid**: Each iteration should pass tests. Broken code hamstrings future iterations.

5. **Use auto-approve carefully**: The example uses `kimi.WithAutoApprove()` for autonomous operation. Review security implications for your use case.

## References

- [snarktank/ralph](https://github.com/snarktank/ralph) - Original Ralph concept
- [ralph-claude-code](https://github.com/frankbria/ralph-claude-code) - Claude Code implementation
- [vercel-labs/ralph-loop-agent](https://github.com/vercel-labs/ralph-loop-agent) - AI SDK implementation
- [The Ralph Wiggum Approach](https://blog.sivaramp.com/blog/claude-code-the-ralph-wiggum-approach/) - Detailed explanation
