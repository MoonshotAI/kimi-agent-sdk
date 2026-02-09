# BoxLite KAOS Example

[BoxLite](https://github.com/boxlite-ai/boxlite) is a local sandbox runtime that runs isolated container workloads on your machine.

This example creates a BoxLite box, installs `BoxliteKaos` as the KAOS backend, and runs the agent inside the container's filesystem and process environment.

> For architecture overview and backend comparison, see the [parent README](../README.md).

## Run

```sh
cd examples/python/kaos/boxlite
uv sync --reinstall

# Required
export KIMI_API_KEY=your-api-key
export KIMI_BASE_URL=https://api.moonshot.ai/v1
export KIMI_MODEL_NAME=kimi-k2-thinking-turbo

# Optional
export BOXLITE_IMAGE=python:3.12-slim   # default image
export KIMI_WORK_DIR=/root/kimi-workdir  # working directory inside the box

uv run main.py
```

The script creates a BoxLite box, runs the agent, and stops the box on exit.
