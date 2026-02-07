# Sprites KAOS Example

[Sprites](https://sprites.dev) is a cloud sandbox service with persistent environments, so files and setup can be reused across runs.

This example connects to (or creates) a Sprite, installs `SpritesKaos` as the KAOS backend, and runs the agent inside the Sprite's filesystem and process context.

> For architecture overview and backend comparison, see the [parent README](../README.md).

## Run

```sh
cd examples/python/kaos/sprites
uv sync --reinstall

# Required
export KIMI_API_KEY=your-api-key
export KIMI_BASE_URL=https://api.moonshot.ai/v1
export KIMI_MODEL_NAME=kimi-k2-thinking-turbo
export SPRITE_TOKEN=your-sprite-token

# Optional
export SPRITE_NAME=my-sprite                       # connect to an existing sprite; omit to create one
export SPRITES_BASE_URL=https://api.sprites.dev     # custom API endpoint
export KIMI_WORK_DIR=/home/sprite/kimi-workdir      # working directory inside the sprite
export SPRITE_DELETE_ON_EXIT=1                       # delete auto-created sprite on exit

uv run main.py
```

If `SPRITE_NAME` is not set, the script auto-creates a sprite with a random name and keeps it after exit (unless `SPRITE_DELETE_ON_EXIT=1`).
