import asyncio
from pathlib import Path

from kaos.path import KaosPath
from kimi_agent_sdk import Session, TextPart

SESSION_ID = "project-tracker-demo"

PROMPT_TEMPLATE = """You are a project log summarizer.

Rules:
- The user sends one log entry per message.
- Keep a running summary across all logs in this session (including after resume).
- Count total occurrences of the exact words "bug" and "todo" (case-insensitive).
- Output format:
Summary: <1-2 sentences, may include emoji>
Pressure: <one colored circle> <score>/10 - <short reason>
- Pressure score is subjective (0-10), not formulaic.
- Emoji mapping for pressure: 0-2 🟢, 3-5 🟡, 6-8 🟠, 9-10 🔴.
- Keep it concise.

Log entry:
{log}
"""

STRESS_LOGS = [
    "2025-02-01: bug in login flow; todo to rollback the auth change; bug also hits "
    "mobile users; todo to add extra monitoring.",
    "2025-02-02: bug in payment retries; bug caused duplicate charges; todo to write "
    "a postmortem; todo to add rate limits.",
    "2025-02-03: bug in data migration broke reports; todo to rebuild dashboards; "
    "team notes rising on-call fatigue.",
]

OPTIMISTIC_LOGS = [
    "2025-02-04: hotfix deployed, metrics stabilizing, customer complaints down, "
    "on-call load back to normal.",
    "2025-02-05: rollout completed, incident trend flat, dashboards green, "
    "team velocity recovering.",
    "2025-02-06: release review done, monitoring steady, customer sentiment "
    "improving, focus back on roadmap.",
]


async def stream_turn(session: Session, log: str, label: str) -> None:
    print(f"\n--- {label} ---")
    async for msg in session.prompt(
        PROMPT_TEMPLATE.format(log=log),
        merge_wire_messages=True,
    ):
        match msg:
            case TextPart(text=text):
                print(text, end="", flush=True)
    print()


async def main() -> None:
    work_dir = KaosPath(Path(__file__).parent)

    async with await Session.create(
        work_dir=work_dir,
        session_id=SESSION_ID,
        yolo=True,
    ) as session:
        for idx, log in enumerate(STRESS_LOGS, start=1):
            await stream_turn(session, log, f"Log {idx} (before close)")

    print("\n[session closed]\n")

    resumed = await Session.resume(
        work_dir=work_dir,
        session_id=SESSION_ID,
        yolo=True,
    )
    if resumed is None:
        raise RuntimeError("No session found to resume.")

    async with resumed as session:
        for idx, log in enumerate(OPTIMISTIC_LOGS, start=1):
            await stream_turn(session, log, f"Log {idx} (after resume)")


if __name__ == "__main__":
    asyncio.run(main())
