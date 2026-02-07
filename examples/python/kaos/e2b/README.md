# E2B KAOS Example

[E2B](https://e2b.dev) is a cloud sandbox platform for running commands and file operations in remote isolated environments.

This example creates (or connects to) an E2B sandbox, installs `E2BKaos` as the KAOS backend, and runs the agent inside the remote environment.

> For architecture overview and backend comparison, see the [parent README](../README.md).

## Run

```sh
cd examples/python/kaos/e2b
uv sync --reinstall

# Required
export KIMI_API_KEY=your-api-key
export KIMI_BASE_URL=https://api.moonshot.ai/v1
export KIMI_MODEL_NAME=kimi-k2-thinking-turbo
export E2B_API_KEY=your-e2b-api-key

# Optional
export KIMI_WORK_DIR=/home/user/kimi-workdir  # working directory inside the sandbox

uv run main.py
```

The sandbox lifecycle is managed outside of the SDK. See the `_get_sandbox()` function in `main.py` for how to connect to an existing sandbox instead of creating a new one.
