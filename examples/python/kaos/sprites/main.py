from __future__ import annotations

import asyncio
import os
from pathlib import Path
from secrets import token_hex

from kaos import reset_current_kaos, set_current_kaos
from kaos.path import KaosPath
from sprites import Sprite, SpritesClient
from sprites_kaos import SpritesKaos

from kimi_agent_sdk import prompt


async def main() -> None:
    # Step 1: ensure Sprites is configured.
    sprite_token = os.getenv("SPRITE_TOKEN")
    if not sprite_token:
        raise RuntimeError("SPRITE_TOKEN is required to use Sprites")

    # Step 2: pick a working directory inside the sprite.
    work_dir_path: str = os.getenv("KIMI_WORK_DIR", DEFAULT_WORK_DIR)
    base_url: str = os.getenv("SPRITES_BASE_URL", DEFAULT_SPRITES_BASE_URL)

    # Step 3: connect to a sprite (or create one if SPRITE_NAME is not set).
    client = SpritesClient(token=sprite_token, base_url=base_url, timeout=DEFAULT_TIMEOUT_SEC)
    sprite_name = os.getenv("SPRITE_NAME")
    sprite, created = await _get_sprite(client, sprite_name=sprite_name)
    print(f"{'Created' if created else 'Using'} sprite: {sprite.name}")

    # Step 4: install Sprites as the KAOS backend for the SDK.
    sprites_kaos = SpritesKaos(
        sprite,
        cwd=work_dir_path,
        home_dir=DEFAULT_HOME_DIR,
    )
    token = set_current_kaos(sprites_kaos)
    try:
        # Step 5: use KaosPath to access the sprite filesystem.
        work_dir: KaosPath = KaosPath(work_dir_path)
        await work_dir.mkdir(parents=True, exist_ok=True)

        # Step 6: call the high-level prompt API as usual.
        async for msg in prompt(
            "You are in a Sprites sandbox. Explore the environment. Try all your tools!",
            work_dir=work_dir,
            agent_file=AGENT_FILE,
            yolo=True,
        ):
            print("─" * 60)
            print(msg)
        print("─" * 60)
    finally:
        reset_current_kaos(token)
        if created and os.getenv("SPRITE_DELETE_ON_EXIT") == "1":
            await asyncio.to_thread(client.delete_sprite, sprite.name)
            print(f"Deleted sprite: {sprite.name}")
        else:
            print(f"Sprite kept: {sprite.name}")
        client.close()


async def _get_sprite(client: SpritesClient, *, sprite_name: str | None) -> tuple[Sprite, bool]:
    if sprite_name:
        sprite: Sprite = await asyncio.to_thread(client.get_sprite, sprite_name)
        return sprite, False

    generated_name = f"{DEFAULT_SPRITE_NAME_PREFIX}-{token_hex(4)}"
    sprite = await asyncio.to_thread(client.create_sprite, generated_name)
    return sprite, True


DEFAULT_HOME_DIR = "/home/sprite"
DEFAULT_WORK_DIR = "/home/sprite/kimi-workdir"
DEFAULT_TIMEOUT_SEC = 30.0
DEFAULT_SPRITES_BASE_URL = "https://api.sprites.dev"
DEFAULT_SPRITE_NAME_PREFIX = "kimi-agent"
AGENT_FILE = Path(__file__).resolve().with_name("agent.yaml")


if __name__ == "__main__":
    asyncio.run(main())
