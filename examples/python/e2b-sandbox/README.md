# Example: E2B Sandbox

This example demonstrates how to extend KAOS with a custom backend.

It vendors an `E2BKaos` implementation in `e2b_kaos.py`, then installs it via `set_current_kaos`
so Kimi Code tools operate on the E2B sandbox environment.

## Run

```sh
cd examples/python/e2b-sandbox
uv sync --reinstall

# Required
export KIMI_API_KEY=your-api-key
export KIMI_BASE_URL=https://api.moonshot.ai/v1
export KIMI_MODEL_NAME=kimi-k2-thinking-turbo
export E2B_API_KEY=your-e2b-api-key

# Optional
export E2B_SANDBOX_ID=...
export KIMI_WORK_DIR=/home/user/kimi-workdir

uv run main.py
```

If `E2B_SANDBOX_ID` is not set, the script creates a sandbox and prints the ID. The
sandbox lifecycle is managed outside of the SDK.
