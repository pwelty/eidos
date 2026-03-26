"""asyncpg connection pool.

CRITICAL: Use transaction mode pooler (port 6543) for Railway connections.
Session mode (port 5432) is unreachable from Railway's GCP network.

CRITICAL: statement_cache_size=0 is required for transaction mode poolers.
Prepared statements are not supported through Supabase's transaction pooler.

Get the exact pooler hostname from Supabase Dashboard:
  Project Settings → Database → Connection string → Transaction mode → URI
Do NOT guess the hostname — aws-0 vs aws-1 varies per project.
"""

import os
import asyncpg

_pool: asyncpg.Pool | None = None


async def init_pool() -> None:
    global _pool
    _pool = await asyncpg.create_pool(
        os.environ["DATABASE_URL"],
        min_size=2,
        max_size=10,
        statement_cache_size=0,  # Required for Supabase transaction mode pooler
    )


async def get_pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("Pool not initialized — call init_pool() first")
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool:
        await _pool.close()
        _pool = None
