# Example: E2B Sandbox

This example runs Kimi Agent SDK on an E2B sandbox by swapping KAOS to `E2BKaos`.
The sandbox lifecycle is managed outside of the SDK.

## Requirements

- `E2B_API_KEY` in the environment.

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

## Notes

- If `E2B_SANDBOX_ID` is not set, the script creates a new sandbox and prints the ID.
- This example never kills sandboxes; lifecycle remains external.
- `KIMI_WORK_DIR` is created inside the sandbox if missing.
- Defaults: template `base`, timeout `300s` (create mode).
- Uses `agent.yaml` to disable the Grep tool, which only supports local KAOS.
