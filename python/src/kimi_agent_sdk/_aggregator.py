from __future__ import annotations

from dataclasses import dataclass

from kimi_cli.soul.message import tool_result_to_message
from kimi_cli.wire.types import StepBegin, StepInterrupted, ToolCallPart, ToolResult, WireMessage
from kosong.message import ContentPart, Message, ToolCall


def _merge_content(buffer: list[ContentPart], part: ContentPart) -> None:
    if not buffer or not buffer[-1].merge_in_place(part):
        buffer.append(part)


class MessageAggregator:
    """
    Aggregate WireMessage stream into Message stream.

    - final_message_only=False: like JsonPrinter, outputs per step and tool results
    - final_message_only=True: like FinalOnlyJsonPrinter, outputs only the last step text
    """

    @dataclass(slots=True)
    class _ToolCallState:
        tool_call: ToolCall
        tool_result: ToolResult | None

    def __init__(self, final_message_only: bool = False) -> None:
        self._final_message_only = final_message_only
        self._content_buffer: list[ContentPart] = []
        self._tool_call_buffer: dict[str, MessageAggregator._ToolCallState] = {}
        self._last_tool_call: ToolCall | None = None

    def feed(self, msg: WireMessage) -> list[Message]:
        match msg:
            case StepBegin() | StepInterrupted():
                if self._final_message_only:
                    self._reset_buffers()
                    return []
                return self._flush()
            case ContentPart() as part:
                _merge_content(self._content_buffer, part)
            case ToolCall() as call:
                if self._final_message_only:
                    return []
                self._tool_call_buffer[call.id] = MessageAggregator._ToolCallState(
                    tool_call=call, tool_result=None
                )
                self._last_tool_call = call
            case ToolCallPart() as part:
                if self._final_message_only:
                    return []
                if self._last_tool_call is None:
                    return []
                self._last_tool_call.merge_in_place(part)
            case ToolResult() as result:
                if self._final_message_only:
                    return []
                state = self._tool_call_buffer.get(result.tool_call_id)
                if state is None:
                    return []
                state.tool_result = result
            case _:
                pass
        return []

    def flush(self) -> list[Message]:
        return self._flush()

    def _flush(self) -> list[Message]:
        if self._final_message_only:
            return self._flush_final_only()
        return self._flush_full()

    def _flush_final_only(self) -> list[Message]:
        if not self._content_buffer:
            return []
        message = Message(role="assistant", content=self._content_buffer)
        text = message.extract_text()
        self._reset_buffers()
        if not text:
            return []
        return [Message(role="assistant", content=text)]

    def _flush_full(self) -> list[Message]:
        if not self._content_buffer and not self._tool_call_buffer:
            return []

        tool_calls: list[ToolCall] = []
        tool_results: list[ToolResult] = []
        for state in self._tool_call_buffer.values():
            if state.tool_result is None:
                continue
            tool_calls.append(state.tool_call)
            tool_results.append(state.tool_result)

        messages: list[Message] = [
            Message(
                role="assistant",
                content=self._content_buffer,
                tool_calls=tool_calls or None,
            )
        ]
        for result in tool_results:
            messages.append(tool_result_to_message(result))

        self._reset_buffers()
        return messages

    def _reset_buffers(self) -> None:
        self._content_buffer.clear()
        self._tool_call_buffer.clear()
        self._last_tool_call = None
