from __future__ import annotations

from kimi_cli.wire.types import StepBegin, TurnEnd
from kosong.message import TextPart, ToolCall
from kosong.tooling import ToolOk, ToolResult

from kimi_agent_sdk._aggregator import MessageAggregator


def test_aggregator_flushes_step_with_tool_results() -> None:
    agg = MessageAggregator()
    assert agg.feed(StepBegin(n=1)) == []

    agg.feed(TextPart(text="hello"))
    call = ToolCall(
        id="call-1",
        function=ToolCall.FunctionBody(name="echo", arguments="{}"),
    )
    agg.feed(call)
    agg.feed(ToolResult(tool_call_id="call-1", return_value=ToolOk(output="ok")))

    messages = agg.feed(StepBegin(n=2))
    assert len(messages) == 2
    assert messages[0].role == "assistant"
    assert messages[0].extract_text() == "hello"
    assert messages[0].tool_calls
    assert messages[1].role == "tool"
    assert messages[1].tool_call_id == "call-1"


def test_aggregator_ignores_turn_end() -> None:
    agg = MessageAggregator()
    agg.feed(TextPart(text="hello"))
    assert agg.feed(TurnEnd()) == []

    messages = agg.flush()
    assert len(messages) == 1
    assert messages[0].extract_text() == "hello"


def test_aggregator_final_only_returns_last_step() -> None:
    agg = MessageAggregator(final_message_only=True)
    agg.feed(TextPart(text="first"))
    agg.feed(StepBegin(n=1))
    agg.feed(TextPart(text="final"))

    messages = agg.flush()
    assert len(messages) == 1
    assert messages[0].extract_text() == "final"
