import asyncio
from pathlib import Path

from kimi_agent_sdk import prompt


async def main() -> None:
    agent_file = Path(__file__).parent / "myagent.yaml"
    async for msg in prompt(
        "What tools do you have?",
        agent_file=agent_file,
        yolo=True,
    ):
        print(msg.extract_text(), end="", flush=True)
    print()


if __name__ == "__main__":
    asyncio.run(main())
