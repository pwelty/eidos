# CLAUDE.md — Eidos starter context

## Stack

| Tier | Tech | Deploy |
|------|------|--------|
| Web (UI) | Next.js 16, Tailwind CSS, shadcn/ui | Vercel (`web/` root dir) |
| Database + Auth | Supabase (Postgres + RLS + Auth) | Supabase |
| Engine (background jobs) | Python 3.12, FastAPI, asyncpg | Railway (`engine/` root dir) |
| Observability | Sentry (errors) + PostHog (analytics) | — |

## Dev commands

```bash
# Web
cd web && npm run dev          # http://localhost:3001
cd web && npm run build
cd web && npm test

# Engine
cd engine && pip install -e ".[dev]"
cd engine && uvicorn engine.main:app --reload --port 8001

# Database
supabase start
supabase db push
supabase db reset   # ⚠️ destructive — local only
```

## Key conventions

### Next.js 16
- `proxy.ts` (not `middleware.ts`) — Node.js runtime only, never set `export const runtime = "edge"`
- All request APIs are async: `await cookies()`, `await headers()`, `await params`, `await searchParams`
- Page-level `searchParams` prop is async — wrap pages using `useSearchParams()` in `<Suspense>`
- Use `React.cache()` for per-request deduplication in cached auth helpers (`lib/auth.ts`)
- `Promise.all()` for independent parallel fetches — never sequential awaits
- turbopack is now the default (`next dev` uses it automatically)

### Supabase client types — NEVER confuse these
| File | Key used | RLS | Use in |
|------|----------|-----|--------|
| `lib/supabase/server.ts` | anon key | enforced | Server Components, layouts, pages |
| `lib/supabase/client.ts` | anon key | enforced | Client Components (`'use client'`) |
| `lib/supabase/admin.ts` | service role | **bypassed** | API routes, server actions needing admin queries |

### .single() gotcha
Never use `.single()` where multiple rows can match. Always chain:
```ts
.order("created_at", { ascending: true }).limit(1).single()
```

### Engine poller pattern
Claim commands in a SHORT transaction, release connection, then process:
- WRONG: hold connection for entire handler duration (causes pooler TimeoutError)
- RIGHT: `claimed = [...]` → release → `for cmd in claimed: asyncio.create_task(_process(cmd))`

### Railway + Supabase
- Transaction mode pooler only (port 6543) — session mode unreachable from GCP
- `statement_cache_size=0` required for asyncpg with transaction pooler
- Exact pooler hostname from Supabase Dashboard only (aws-0 vs aws-1 varies per project)
- `CMD uvicorn engine.main:app --host 0.0.0.0 --port $PORT` in Dockerfile (shell form)
- No `startCommand` in `railway.toml` — Railway doesn't expand `$PORT` in toml

### Vercel deployment
- Link with `vercel link --yes --project <actual-name>` from `web/` — bare `vercel link` creates a project named "web"
- Set env vars BEFORE first push, or MIDDLEWARE_INVOCATION_FAILED on first deploy
- Required env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`

## Environment variables

### web/.env.local
```
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
NEXT_PUBLIC_SITE_URL=http://localhost:3001
SENTRY_DSN=<sentry-dsn>
NEXT_PUBLIC_POSTHOG_KEY=<posthog-key>
```

### engine/.env
```
DATABASE_URL=postgresql://postgres.<ref>:<password>@<pooler-host>:6543/postgres
SENTRY_DSN=<sentry-dsn>
ENVIRONMENT=development
```

## Supabase auth redirect URLs (must configure in dashboard)
- Site URL: `https://your-domain.com`
- Redirect URLs: `https://your-domain.com/**` and `http://localhost:3001/**`

## New project setup checklist

1. `supabase init` + `supabase db push` (run migration)
2. Vercel: `vercel link --yes --project <name>` from `web/`
3. Set all env vars on Vercel BEFORE first push
4. Supabase Dashboard → Authentication → URL Configuration → add domain
5. Railway: connect GitHub repo, set root directory to `engine`
6. Set `DATABASE_URL` on Railway (transaction pooler URL from Supabase Dashboard)
7. Sentry: run `npx @sentry/wizard@latest -i nextjs` from `web/`
8. shadcn: `npx shadcn@latest init` from `web/`
