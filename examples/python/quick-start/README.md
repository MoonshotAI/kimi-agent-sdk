# Example: Quick Start (Prompt)

This example shows the smallest possible `prompt()` usage. It sends a single
chat request that asks the agent to create `hello.txt` with the content
`hello world`, then streams the assistant's reply.

## Run

```sh
cd examples/python/quick-start
uv sync --reinstall

# configure your API key
export KIMI_API_KEY=your-api-key
export KIMI_BASE_URL=https://api.moonshot.ai/v1
export KIMI_MODEL_NAME=kimi-k2-thinking-turbo

uv run main.py
```

After the run, `hello.txt` should appear in this folder.
