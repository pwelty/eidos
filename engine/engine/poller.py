"""Command poll loop.

CRITICAL pattern — claim-then-process, NOT hold-connection-during-process:

The poller claims commands in a SHORT transaction (SELECT FOR UPDATE + status update),
releases the connection, then processes each command independently. This prevents
transaction mode pooler timeouts on long-running handlers (AI calls, HTTP fetches, etc).

WRONG pattern (causes TimeoutError at end of long handlers):
  async with pool.acquire() as conn:
      async with conn.transaction():
          rows = await conn.fetch("SELECT ... FOR UPDATE")
          for row in rows:
              await process_command(conn, row)   # Holds connection for minutes

RIGHT pattern (this file):
  Claim commands → release connection → process independently.
"""

import asyncio
import logging

from engine.db import get_pool
from engine.handlers import HANDLERS

log = logging.getLogger(__name__)

POLL_INTERVAL = 5  # seconds


async def start_poller() -> None:
    log.info("Poller started")
    while True:
        try:
            await poll_once()
        except Exception:
            log.exception("Poller error")
        await asyncio.sleep(POLL_INTERVAL)


async def poll_once() -> None:
    pool = await get_pool()

    # Step 1: claim pending commands in a short transaction.
    claimed: list[dict] = []
    async with pool.acquire() as conn:
        async with conn.transaction():
            rows = await conn.fetch(
                """
                SELECT id, command_type, payload, workspace_id
                FROM commands
                WHERE status = 'pending'
                ORDER BY created_at
                LIMIT 10
                FOR UPDATE SKIP LOCKED
                """
            )
            for row in rows:
                await conn.execute(
                    "UPDATE commands SET status = 'processing' WHERE id = $1",
                    row["id"],
                )
                claimed.append(dict(row))
    # Connection released here — before any slow processing.

    # Step 2: process each command independently (no held connection).
    for cmd in claimed:
        asyncio.create_task(_process(cmd))


async def _process(cmd: dict) -> None:
    handler = HANDLERS.get(cmd["command_type"])
    if not handler:
        log.warning("No handler for command_type=%s", cmd["command_type"])
        await _set_status(cmd["id"], "failed", "no handler")
        return

    try:
        await handler(cmd)
        await _set_status(cmd["id"], "done", None)
    except Exception as exc:
        log.exception("Handler failed for command %s", cmd["id"])
        await _set_status(cmd["id"], "failed", str(exc))


async def _set_status(command_id: str, status: str, error: str | None) -> None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE commands SET status = $1, error = $2, updated_at = now() WHERE id = $3",
            status,
            error,
            command_id,
        )
