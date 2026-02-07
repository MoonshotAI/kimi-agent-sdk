from __future__ import annotations

import asyncio
import os
from pathlib import Path

import boxlite
from boxlite_kaos import BoxliteKaos
from kaos import reset_current_kaos, set_current_kaos
from kaos.path import KaosPath

from kimi_agent_sdk import prompt


async def main() -> None:
    # Step 1: pick a working directory inside the box.
    work_dir_path: str = os.getenv("KIMI_WORK_DIR", DEFAULT_WORK_DIR)
    # Step 2: choose the image for BoxLite.
    image = os.getenv("BOXLITE_IMAGE", DEFAULT_IMAGE)

    # Step 3: create a BoxLite box.
    runtime = boxlite.Boxlite.default()
    box = await runtime.create(boxlite.BoxOptions(image=image))
    await box.start()
    print(f"Created box: {box.id}")

    # Step 4: install BoxLite as the KAOS backend for the SDK.
    boxlite_kaos = BoxliteKaos(
        box,
        cwd=work_dir_path,
        home_dir=DEFAULT_HOME_DIR,
    )
    token = set_current_kaos(boxlite_kaos)
    try:
        # Step 5: use KaosPath to access the box filesystem.
        work_dir: KaosPath = KaosPath(work_dir_path)
        await work_dir.mkdir(parents=True, exist_ok=True)

        # Step 6: call the high-level prompt API as usual.
        async for msg in prompt(
            "You are in a BoxLite sandbox. Explore the environment. Try all your tools!",
            work_dir=work_dir,
            agent_file=AGENT_FILE,
            yolo=True,
        ):
            print("─" * 60)
            print(msg)
        print("─" * 60)
    finally:
        reset_current_kaos(token)
        await box.stop()


DEFAULT_HOME_DIR = "/root"
DEFAULT_WORK_DIR = "/root/kimi-workdir"
DEFAULT_IMAGE = "python:3.12-slim"
AGENT_FILE = Path(__file__).resolve().with_name("agent.yaml")


if __name__ == "__main__":
    asyncio.run(main())
