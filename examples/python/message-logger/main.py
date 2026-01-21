import asyncio
from datetime import datetime
from pathlib import Path

from kaos.path import KaosPath
from kimi_agent_sdk import prompt

from utils import format_console_message, format_message


TASK_PROMPT = """You are a cataloging assistant.

Task:
- Inspect the local repository under ./examples/python
- List every Python example subfolder
- For each example, report:
  - A 1-2 sentence description of what it does
  - A difficulty label: Easy, Medium, or Hard
  - Who it is for (what type of user or need)
- If a README exists, do NOT copy it directly
- Always read both README and the main entry file, then synthesize your own description
- Keep the final report concise and structured

Rules:
- You must read from the filesystem to avoid guessing
- Avoid emojis and keep output ASCII
- Output a single Markdown report and nothing else
- Use a single table
- Table columns: Example, Description, Difficulty, Best For
"""


async def main() -> None:
    # Go from examples/python/message-logger/main.py up three levels to the repository root
    repo_root = KaosPath(Path(__file__).resolve().parents[3])
    output_dir = Path(__file__).parent
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    log_path = output_dir / f"messages-{timestamp}.log"
    report_path = output_dir / "examples-catalog.md"
    final_report = None

    with log_path.open("w", encoding="utf-8") as handle:
        async for message in prompt(
            TASK_PROMPT,
            work_dir=repo_root,
            yolo=True,
        ):
            log_line = format_message(message)
            handle.write(f"{log_line}\n")
            handle.flush()
            print(format_console_message(message))
            if message.role == "assistant":
                text = message.extract_text().strip()
                if text:
                    final_report = text

    if not final_report:
        raise RuntimeError("No final report generated.")

    report_path.write_text(final_report, encoding="utf-8")
    
    print(f"Wrote message log to {log_path}")
    print(f"Wrote catalog report to {report_path}")


if __name__ == "__main__":
    asyncio.run(main())
