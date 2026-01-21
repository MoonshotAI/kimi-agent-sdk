"""
Approval handling types for Kimi Agent SDK.

This module defines the ApprovalHandlerFn type for custom approval handling in agent sessions.
Approval handlers allow you to programmatically approve or reject tool execution requests from
the agent, providing fine-grained control over what actions the agent can perform.

Key types:

- `ApprovalHandlerFn` is a callback function type that receives ApprovalRequest objects and
  resolves them with "approve", "approve_for_session", or "reject".

Example:

```python
from kimi_agent_sdk import ApprovalRequest


def my_handler(request: ApprovalRequest) -> None:
    if request.sender == "bash":
        request.resolve("approve")
    else:
        request.resolve("reject")
```
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from kimi_cli.wire.types import ApprovalRequest

type ApprovalHandlerFn = (
    Callable[[ApprovalRequest], None] | Callable[[ApprovalRequest], Awaitable[None]]
)
"""
Approval handler callback function type.

The callback receives an ApprovalRequest with the following attributes and is responsible
for calling request.resolve(...):
    - id: Unique request identifier
    - tool_call_id: Associated tool call ID
    - sender: Name of the tool that initiated the request
    - action: Action type
    - description: Detailed description
    - display: List of visualization info

Resolve with:
    - "approve": Approve this request
    - "approve_for_session": Approve and auto-approve subsequent similar requests
    - "reject": Reject the request
"""
