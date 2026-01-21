import asyncio

from kaos.path import KaosPath
from kimi_agent_sdk import prompt


async def main() -> None:
    async for message in prompt(
        "Please create a file named hello.txt in the current working directory and write 'hello world' into it.",
        work_dir=KaosPath.cwd(),
        yolo=True,
    ):
        print(message.extract_text(), end="", flush=True)
    print()


if __name__ == "__main__":
    asyncio.run(main())
