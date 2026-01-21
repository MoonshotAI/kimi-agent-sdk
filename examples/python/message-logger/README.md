# Example: Message Logger

This example uses the high-level `prompt()` API to catalog every Python example
under `examples/python`. It writes every streamed `Message` to a log file (one
line per message), prints a readable stream to the console, and saves the final
Markdown report.

## Run

```sh
cd examples/python/message-logger
uv sync --reinstall

# configure your API key
export KIMI_API_KEY=your-api-key
export KIMI_BASE_URL=https://api.moonshot.ai/v1
export KIMI_MODEL_NAME=kimi-k2-thinking-turbo

uv run main.py
```

Outputs:

- `messages-<timestamp>.log`: one line per message
- `examples-catalog.md`: the final Markdown report for Python examples
