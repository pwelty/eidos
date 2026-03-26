# PRODUCT.md

## What this is

[Replace with your product description.]

## Architecture

Three-tier Eidos architecture:
1. **Web (Next.js)** — UI and auth, deployed to Vercel
2. **Database (Supabase)** — Postgres + Auth + RLS. All data access goes through Supabase.
3. **Engine (Python/FastAPI)** — background worker on Railway. Polls `commands` table, processes long-running jobs, writes results back. No public API endpoint — headless.

The engine is needed because Vercel serverless functions timeout at 300s and AI/long-running calls can take longer. The engine handles anything that can't complete in a single request.

## Entities

[Define your entities here — one heading per entity with its key fields and relationships.]

## User flows

[Define the key user flows — signup, onboarding, core actions.]

## Background jobs

The engine processes commands from the `commands` table. To add a new job type:
1. Web layer inserts a row: `{ command_type: "your_type", payload: {...}, workspace_id }`
2. Create `engine/engine/handlers/your_type.py` with `async def handle(cmd: dict) -> None`
3. Register in `engine/engine/handlers/__init__.py`

Use deterministic idempotency keys for scheduled commands:
```python
window = datetime.now(timezone.utc).strftime("%Y-%m-%d-%H")
key = f"schedule:{command_type}:{workspace_id}:{window}"
```
