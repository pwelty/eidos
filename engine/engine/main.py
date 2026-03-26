"""FastAPI app entry point. Only exposes /health for Railway's healthcheck.
The engine is a headless background worker — no public API needed unless
you need to receive inbound webhooks (use Supabase Edge Functions instead).
"""

import os
import asyncio
import logging

import sentry_sdk
from dotenv import load_dotenv
from fastapi import FastAPI

# load_dotenv() is required when run via launchd or Railway —
# those environments don't have a shell that sources .env files.
load_dotenv()

sentry_sdk.init(
    dsn=os.getenv("SENTRY_DSN"),
    environment=os.getenv("ENVIRONMENT", "production"),
    traces_sample_rate=0.1,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

app = FastAPI()


@app.on_event("startup")
async def startup():
    from engine.db import init_pool
    from engine.poller import start_poller

    await init_pool()
    asyncio.create_task(start_poller())
    log.info("Engine started")


@app.on_event("shutdown")
async def shutdown():
    from engine.db import close_pool

    await close_pool()


@app.get("/health")
async def health():
    return {"status": "ok"}
