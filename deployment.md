# Eidos - Deployment Specification

> Deployment patterns, platform configuration, and gotchas for Railway (engine) + Vercel (web) + Supabase.

## 1) Platform overview

| Component | Platform | Notes |
|-----------|----------|-------|
| Web (Next.js) | Vercel | Auto-deploys from GitHub, root dir = `web/` |
| Engine (Python) | Railway | Dockerfile-based, root dir = `engine/` |
| Database | Supabase | Managed Postgres + Auth + Realtime |

---

## 2) Railway (engine)

### 2.1) Dockerfile setup

Use shell-form `CMD` so `$PORT` expands at runtime. Never use `startCommand` in `railway.toml` — Railway's TOML parser does not expand shell variables.

```dockerfile
FROM python:3.11-slim
WORKDIR /app

# Dependency layer (cached until pyproject.toml changes)
COPY pyproject.toml .
COPY engine/ engine/
RUN pip install --no-cache-dir .

COPY . .

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD python -c "import requests; requests.get('http://localhost:${PORT:-8000}/health').raise_for_status()"

# Shell form — $PORT expands at runtime
CMD uvicorn engine.main:app --host 0.0.0.0 --port $PORT
```

```toml
# railway.toml — builder only, no startCommand
[build]
builder = "DOCKERFILE"

[deploy]
healthcheckPath = "/health"
healthcheckTimeout = 30
```

> **GOTCHA:** `startCommand = "uvicorn ... --port ${PORT:-8000}"` passes literally — Railway's TOML does not do shell variable expansion. Remove `startCommand` entirely and let the Dockerfile CMD handle it.

### 2.2) Root directory

Set the Railway service root directory to `engine` (no leading or trailing slash). Without this, Railpack auto-detect fails with "could not determine how to build."

> **GOTCHA:** Railway auto-creates a service when you connect a GitHub repo. If you also created a manual service, you'll have duplicates — delete the manual one.

### 2.3) Supabase connection pooler

Use transaction mode (port 6543), not session mode (port 5432). Session mode is unreachable from Railway's GCP network.

```python
pool = await asyncpg.create_pool(
    database_url,
    statement_cache_size=0,  # Required for transaction mode — prepared statements not supported
)
```

> **GOTCHA:** The Supabase Supavisor pooler hostname is NOT derivable from region alone. `aws-0-us-east-1` and `aws-1-us-east-2` are distinct instances. Always copy the exact hostname from: **Supabase Dashboard → Project Settings → Database → Connection string → Transaction mode → URI**.

> **GOTCHA:** Do not hold database connections during long handler execution. Transaction mode poolers kill connections that are held longer than a few seconds. Use the claim-then-process pattern (see engine.md §4.2).

---

## 3) Vercel (web)

### 3.1) Project setup

```bash
# Always link to the correct project explicitly — don't rely on auto-detection
cd web
vercel link --yes --project <project-name>
vercel switch <team>

# Set env vars before first deploy
echo "https://<ref>.supabase.co" | vercel env add NEXT_PUBLIC_SUPABASE_URL production --yes
echo "<anon-key>" | vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production --yes
echo "https://your-domain.com" | vercel env add NEXT_PUBLIC_SITE_URL production --yes

# Redeploy after setting vars
vercel redeploy <latest-deployment-url>
```

> **GOTCHA:** Running `vercel link` from the `web/` subdirectory auto-creates a project named `web` instead of linking to your actual project. Always pass `--project <name>`.

> **GOTCHA:** The first GitHub-triggered deploy always fails with `MIDDLEWARE_INVOCATION_FAILED` because env vars aren't set yet. The Supabase middleware uses `process.env.NEXT_PUBLIC_SUPABASE_URL!` — the `!` assertion crashes the Edge runtime when undefined. Set env vars first, then redeploy.

> **GOTCHA:** If you accidentally created two Vercel projects (e.g., one via CLI auto-create and one via dashboard), env vars set on one don't apply to the other. Verify which project your custom domain is attached to with `vercel project ls`. Delete the unwanted one with `vercel project rm <name>`.

> **GOTCHA:** `vercel redeploy` requires the team scope to match. If you get "Deployment belongs to a different team", run `vercel switch <team>` first.

### 3.2) Required env vars

| Variable | Value | Notes |
|----------|-------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` | From Supabase dashboard |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJ...` | From Supabase dashboard |
| `NEXT_PUBLIC_SITE_URL` | `https://your-domain.com` | Used for auth redirect URLs — must be production domain |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` | Server-only admin client |
| `SENTRY_DSN` | `https://...` | Optional but recommended |
| `NEXT_PUBLIC_POSTHOG_KEY` | `phc_...` | Optional analytics |

---

## 4) Supabase

### 4.1) Auth redirect URLs

After deploying, add the production domain to **Supabase Dashboard → Authentication → URL Configuration**:
- **Site URL:** `https://your-domain.com`
- **Redirect URLs:** `https://your-domain.com/**` and `http://localhost:3001/**`

Without this, OAuth callbacks, magic link flows, and password reset emails fail silently.

### 4.2) Supabase CLI workflow

Always use the CLI — never paste SQL into the dashboard.

```bash
# Create a new migration
supabase migration new <descriptive_name>
# Edit the generated file, then push
supabase db push

# Push auth/email config
supabase config push --project-ref <ref>
```

> **GOTCHA:** Run `supabase db push` immediately after creating a migration. Never leave migrations un-pushed — they diverge from the remote schema and cause confusion.

---

## 5) pyproject.toml for Railway

```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "my-engine"
version = "0.1.0"
dependencies = [
    "fastapi",
    "uvicorn[standard]",
    "asyncpg",
    "httpx",
    "pydantic-settings",
    "sentry-sdk",
]

[project.optional-dependencies]
dev = ["pytest", "pytest-asyncio", "httpx"]

# REQUIRED if project name differs from package directory name
[tool.hatch.build.targets.wheel]
packages = ["engine"]
```

> **GOTCHA:** If `name = "my-engine"` but the directory is `engine/`, hatchling fails: `ValueError: Unable to determine which files to ship...`. The `packages = ["engine"]` override is required.

---

## 6) Observability setup

### 6.1) PostHog — CORS proxy required

PostHog's client-side SDK requires a CORS proxy when using a custom domain. Without it, ad blockers and privacy extensions silently block tracking requests.

Add rewrites to `next.config.ts`:

```typescript
async rewrites() {
  return [
    { source: "/ingest/static/:path*", destination: "https://us-assets.i.posthog.com/static/:path*" },
    { source: "/ingest/:path*", destination: "https://us.i.posthog.com/:path*" },
  ]
}
```

Initialize with the proxy URL:
```typescript
posthog.init(POSTHOG_KEY, {
  api_host: "/ingest",
  // Only initialize in production
  loaded: (ph) => { if (process.env.NODE_ENV !== "production") ph.opt_out_capturing() }
})
```

### 6.2) Sentry — Next.js requires three config files

Sentry's Next.js integration needs separate config files for each runtime:

```
sentry.client.config.ts   — browser error capture
sentry.server.config.ts   — server error capture
sentry.edge.config.ts     — edge runtime error capture
```

Source maps require `SENTRY_AUTH_TOKEN` set in CI and in `next.config.ts`:

```typescript
import { withSentryConfig } from "@sentry/nextjs"
export default withSentryConfig(nextConfig, { org: "...", project: "..." })
```

## 7) Deployment checklist

### Before first deploy
- [ ] Supabase project created, ref and keys ready
- [ ] Vercel project created and linked (`vercel link --yes --project <name>`)
- [ ] All env vars set on Vercel (`vercel env add ...`)
- [ ] Production domain added to Supabase auth redirect URLs
- [ ] Railway service created with correct root directory (`engine`)

### After deploy
- [ ] `/health` endpoint returns 200 on Railway
- [ ] Auth flow works end-to-end (signup → email confirm → onboarding)
- [ ] Magic link / email confirmation URLs resolve correctly
- [ ] Sentry is receiving errors (trigger a test exception)
- [ ] PostHog is receiving events (check dashboard)

### Ongoing
- [ ] `supabase db push` run after every migration
- [ ] New env vars added with `vercel env add` (never hardcoded)
- [ ] Railway redeploys automatically on push to main
- [ ] Vercel preview deploys work for PRs
