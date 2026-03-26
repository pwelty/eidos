"""Command handler registry.

Add a new handler:
  1. Create engine/handlers/your_command.py with:
       async def handle(cmd: dict) -> None: ...
  2. Register it here:
       from engine.handlers import your_command
       HANDLERS["your_command"] = your_command.handle

Idempotency keys must be deterministic — use time-window-based keys, not uuid4():
  window = datetime.now(timezone.utc).strftime("%Y-%m-%d-%H")
  key = f"schedule:{command_type}:{workspace_id}:{window}"
"""

from typing import Callable, Awaitable

Handler = Callable[[dict], Awaitable[None]]

HANDLERS: dict[str, Handler] = {}

# Register handlers:
# from engine.handlers import example
# HANDLERS["example"] = example.handle
