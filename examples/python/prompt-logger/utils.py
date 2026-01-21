import json

from kimi_agent_sdk import Message, ToolCall

ROLE_EMOJI = {
    "assistant": "🤖",
    "tool": "🛠️",
    "user": "👤",
    "system": "⚙️",
}


def normalize_text(text: str, *, escape_newlines: bool = True) -> str:
    if not text:
        return "<empty>"
    text = text.replace("\r\n", "\n")
    return text.replace("\n", "\\n") if escape_newlines else text


def format_tool_calls(tool_calls: list[ToolCall] | None) -> str:
    if not tool_calls:
        return "[]"
    payload = []
    for call in tool_calls:
        function = call.function
        if isinstance(function, dict):
            name = function.get("name")
            arguments = function.get("arguments")
        else:
            name = getattr(function, "name", None)
            arguments = getattr(function, "arguments", None)
        payload.append(
            {
                "id": call.id,
                "type": call.type,
                "name": name,
                "arguments": arguments,
            }
        )
    return json.dumps(payload, ensure_ascii=True)


def format_message(message: Message) -> str:
    role = message.role.upper()
    text = normalize_text(message.extract_text(), escape_newlines=True)
    if message.tool_calls:
        tool_calls = format_tool_calls(message.tool_calls)
    elif message.role == "tool" and message.tool_call_id:
        tool_calls = json.dumps(
            [{"tool_call_id": message.tool_call_id}],
            ensure_ascii=True,
        )
    else:
        tool_calls = "[]"
    return f"{role} | {text} | tool_calls={tool_calls}"


def format_console_message(message: Message) -> str:
    role = message.role
    emoji = ROLE_EMOJI.get(role, "💬")
    text = normalize_text(message.extract_text(), escape_newlines=False).strip()
    text = text if text else "<empty>"
    text = text.replace("\n", "\n  ")
    tool_hint = ""
    if message.tool_calls:
        tool_hint = f" [tool_calls: {len(message.tool_calls)}]"
    elif message.role == "tool" and message.tool_call_id:
        tool_hint = f" [tool_call_id: {message.tool_call_id}]"
    return f"{emoji} {role.upper()}{tool_hint}\n  {text}"
