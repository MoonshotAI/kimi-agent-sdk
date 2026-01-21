# Example: Customized Tools

This example shows how to define a custom tool and load it through an agent file
when using the Kimi Agent SDK.

## Run

```sh
cd examples/python/customized-tools
uv sync --reinstall

# configure your API key 
export KIMI_API_KEY=your-api-key
export KIMI_BASE_URL=https://api.moonshot.ai/v1
export KIMI_MODEL_NAME=kimi-k2-thinking-turbo

uv run main.py
```

The agent file `myagent.yaml` registers the custom tool `my_tools.ls:Ls` and
reuses the default tool set.
