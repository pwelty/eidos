# Eidos App

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub issues](https://img.shields.io/github/issues/pwelty/eidos)](https://github.com/pwelty/eidos/issues)
[![GitHub stars](https://img.shields.io/github/stars/pwelty/eidos)](https://github.com/pwelty/eidos/stargazers)

> *εἶδος (eidos):* The eternal, unchanging Form in Platonic philosophy

**Eidos App** defines the Form of the Application - the perfect, eternal pattern that all database-driven applications participate in. Just as Plato argued that all earthly chairs are imperfect copies of the Form of Chair, all applications are instances of this Form.

This specification provides the complete blueprint for database-driven applications, independent of any particular technology stack or platform. Whether implemented as a web app, mobile app, or desktop application - whether built with modern frontend frameworks, MVC frameworks, or any future technology - the Form remains constant.

## The Form Defines:
- The eternal pattern of CRUD operations
- The unchanging nature of entity relationships
- The ideal structure of user interfaces
- The perfect separation of concerns

Your application is not the Form - it participates in the Form.

---

# Web App Meta-Spec Suite

> A modular, database-first blueprint for building relationship-heavy web applications with clear separation of concerns.

## Document Structure

This specification is organized into focused documents:

1. **[Database Specification](./database.md)** - Schema design, relationships, migrations, RLS, performance
2. **[UI Specification](./ui.md)** - Frontend patterns, CRUD pages, navigation, theming
3. **[Engine Specification](./engine.md)** - Async processing, business logic, job handling
4. **[API Specification](./api.md)** - External interfaces, OAuth2, rate limiting
5. **[Foundations Specification](./foundations.md)** - Testing, observability, security, error handling
6. **[Deployment Specification](./deployment.md)** - Railway, Vercel, Supabase setup and gotchas
7. **[Framework Guide](./FRAMEWORKS.md)** - Specific implementation details for popular frameworks

## Core Philosophy

- **DB-first:** Model the real world in the database first; UI, API, and code follow the schema
- **Convention > Configuration:** Stable patterns enable rapid scaffolding
- **Clear Separation:** UI handles presentation, Engine handles logic, API handles external access
- **Everything is Connected:** Consistent linking and navigation throughout
- **First-Class Relationships:** Treat important joins as full entities

## System Architecture

```
┌─────────────────┐     ┌─────────────────┐
│   External      │────▶│      API        │
│   Clients       │◀────│  (Optional)     │
└─────────────────┘     └────────┬────────┘
                                 │
┌─────────────────┐              ▼
│      UI         │     ┌─────────────────┐     ┌─────────────────┐
│   (Frontend)    │────▶│    Database     │◀────│     Engine      │
│                 │◀────│   (PostgreSQL)  │────▶│   (Workers)     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         │                       ▲                        │
         └───────────────────────┴────────────────────────┘
                         Realtime Updates
```

## Quick Start

1. Start with **Database Spec** - Design your database schema and relationships
2. Implement **UI Spec** - Build CRUD pages following the patterns
3. Add **Engine Spec** - Implement async business logic as needed
4. Expose **API Spec** - Add external access if required

## Reference Implementation

- **Database:** Supabase (Postgres + Auth + Storage + Realtime)
- **UI:** Next.js (App Router) + Tailwind CSS + shadcn/ui
- **Engine:** Python (FastAPI + asyncpg, Railway)
- **API:** Next.js API Routes or separate FastAPI
- **Observability:** Sentry (errors) + PostHog (analytics)

See [Framework Guide](./FRAMEWORKS.md) for framework-agnostic implementations.

## Project Structure

Standard flat layout — `web/` and `engine/` at root level:

```
project/
├── web/                    # Next.js app (App Router)
│   ├── app/                # Routes, layouts, pages
│   │   ├── (app)/          # Authenticated routes
│   │   ├── (auth)/         # Auth routes (login, signup)
│   │   ├── (marketing)/    # Public pages
│   │   └── api/            # Route handlers
│   ├── components/         # Shared UI components
│   ├── actions/            # Server actions
│   ├── lib/                # Utilities
│   │   ├── supabase/       # server.ts, client.ts, admin.ts
│   │   └── utils.ts        # cn() and other helpers
│   └── __tests__/          # Vitest unit tests
├── engine/                 # Python FastAPI background worker
│   ├── engine/             # Package directory (matches pyproject name)
│   │   ├── main.py         # FastAPI app + /health endpoint
│   │   ├── poller.py       # Command poll loop
│   │   ├── handlers/       # One file per command type
│   │   └── db.py           # asyncpg pool setup
│   ├── tests/              # pytest test suite
│   ├── Dockerfile          # Railway deployment
│   ├── railway.toml        # builder = "DOCKERFILE", no startCommand
│   └── pyproject.toml      # hatchling build (explicit packages = ["engine"])
├── supabase/               # Migrations, seed, RLS policies
│   └── migrations/         # Numbered SQL files
├── CLAUDE.md               # AI agent context (stack, commands, conventions)
├── PRODUCT.md              # Product vision and feature definitions
└── DECISIONS.md            # Architecture decisions log
```

**Railway root directory:** `engine` (no leading/trailing slash)
**Vercel root directory:** `web`

> **GOTCHA:** Railway's Railpack auto-detect fails if the root directory is wrong. Always set `builder = "DOCKERFILE"` in `railway.toml`. Never add `startCommand` — Railway's shell doesn't expand `${PORT}` in toml. Use shell-form `CMD` in the Dockerfile so `$PORT` expands at runtime.

> **GOTCHA:** `vercel link` from the `web/` subdirectory auto-creates a project named `web`. Use `vercel link --yes --project <actual-name>` to target the correct project.

> **GOTCHA (pyproject.toml):** If the project name differs from the package directory (e.g., `my-engine` vs `engine/`), hatchling fails. Add `[tool.hatch.build.targets.wheel] packages = ["engine"]`.

## Implementation Phases

1. **Phase 1 - Data Model:** Design schema, relationships, constraints
2. **Phase 2 - Basic CRUD:** Index, Detail, Edit pages per entity
3. **Phase 3 - Relationships:** Related boxes, linking/unlinking
4. **Phase 4 - Polish:** Bulk operations, filters, search
5. **Phase 5 - Theming:** Brand customization, dark mode
6. **Phase 6 - Async:** Background jobs, status tracking
7. **Phase 7 - External API:** OAuth2, rate limiting, OpenAPI

## Key Principles

- Every entity gets three pages: Index/List, Detail/View, and Edit
- Relationships are visible and navigable
- Validation happens both client and server side
- All actions are audited
- Testing is required (TDD for business logic)
- Observability is built-in from the start

## Next Steps

Begin with the [Database Specification](./database.md) to understand the data foundation, then proceed to the [UI Specification](./ui.md) for implementation details.

## Contributing

We welcome contributions to the Eidos specification! Please see our [Contributing Guidelines](./CONTRIBUTING.md) for details on how to get involved.

## License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.

## Acknowledgments

- Inspired by Plato's Theory of Forms
- Built with insights from years of database-driven application development
- Community contributions and feedback