# Example: Project Tracker (Session Resume)

This example shows how a stateful `Session` keeps running history across multiple
log entries and can be resumed later. If you used `prompt()` for each log entry,
the summary and counters would reset each time.

## Run

```sh
cd examples/python/project-tracker
uv sync --reinstall

# configure your API key
export KIMI_API_KEY=your-api-key
export KIMI_BASE_URL=https://api.moonshot.ai/v1
export KIMI_MODEL_NAME=kimi-k2-thinking-turbo

uv run main.py
```
