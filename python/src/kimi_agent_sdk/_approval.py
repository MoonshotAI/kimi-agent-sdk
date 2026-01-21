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
