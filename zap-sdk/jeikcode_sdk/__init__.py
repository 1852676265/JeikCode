"""Backward-compatibility shim for legacy `jeikcode_sdk` import paths.

In new code, prefer importing from `zap_sdk`.
"""

from __future__ import annotations

import sys
from zap_sdk import (
    AsyncJeikCodeClient,
    AsyncZapClient,
    JeikCodeClient,
    Protocol,
    ReasoningComposer,
    ReasoningEffort,
    StreamEvent,
    StreamEventType,
    StreamParser,
    SubagentState,
    ToolState,
    TurnResult,
    ZapClient,
    collect_events,
    parse_reasoning_effort,
)
from zap_sdk import client, events, reasoning, stream
import zap_sdk as _zap_sdk

__all__ = _zap_sdk.__all__
__version__ = _zap_sdk.__version__

# Map submodules so `from jeikcode_sdk.events import ...` works seamlessly
sys.modules.setdefault("jeikcode_sdk.client", client)
sys.modules.setdefault("jeikcode_sdk.events", events)
sys.modules.setdefault("jeikcode_sdk.reasoning", reasoning)
sys.modules.setdefault("jeikcode_sdk.stream", stream)
