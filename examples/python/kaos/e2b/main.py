from __future__ import annotations

import asyncio
import os
from pathlib import Path

from e2b import AsyncSandbox
from e2b_kaos import E2BKaos
from kaos import reset_current_kaos, set_current_kaos
from kaos.path import KaosPath

from kimi_agent_sdk import prompt


async def main() -> None:
    # Step 1: ensure E2B is configured.
    api_key = os.getenv("E2B_API_KEY")
    if not api_key:
        raise RuntimeError("E2B_API_KEY is required to use E2B sandboxes")

    # Step 2: pick a working directory inside the sandbox.
    work_dir_path: str = os.getenv("KIMI_WORK_DIR", DEFAULT_WORK_DIR)
    # Step 3: create a sandbox (or connect to one).
    sandbox: AsyncSandbox = await _get_sandbox()
    print(f"Created sandbox: {sandbox.sandbox_id}")

    # Step 4: install E2B as the KAOS backend for the SDK.
    e2b_kaos: E2BKaos = E2BKaos(
        sandbox,
        cwd=work_dir_path,
    )
    token = set_current_kaos(e2b_kaos)
    try:
        # Step 5: use KaosPath to access the sandbox filesystem.
        work_dir: KaosPath = KaosPath(work_dir_path)
        await work_dir.mkdir(parents=True, exist_ok=True)

        # Step 6: call the high-level prompt API as usual.
        async for msg in prompt(
            "You are in a E2B sandbox. Explore the environment. Try all your tools!",
            work_dir=work_dir,
            agent_file=AGENT_FILE,
            yolo=True,
        ):
            print("─" * 60)
            print(msg)
        print("─" * 60)
    finally:
        reset_current_kaos(token)


async def _get_sandbox() -> AsyncSandbox:
    # Tutorial tip: swap this with a connect flow if you already have a sandbox.
    #
    # sandbox_id = os.getenv("E2B_SANDBOX_ID")
    # if sandbox_id:
    #     return await AsyncSandbox.connect(sandbox_id)
    sandbox: AsyncSandbox = await AsyncSandbox.create(
        template=DEFAULT_TEMPLATE,
        timeout=DEFAULT_TIMEOUT_SEC,
    )
    return sandbox


DEFAULT_WORK_DIR = "/home/user/kimi-workdir"
DEFAULT_TEMPLATE = "base"
DEFAULT_TIMEOUT_SEC = 300
AGENT_FILE = Path(__file__).resolve().with_name("agent.yaml")


if __name__ == "__main__":
    asyncio.run(main())
