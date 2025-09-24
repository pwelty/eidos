# Eidos App

> *εἶδος (eidos):* The eternal, unchanging Form in Platonic philosophy

**Eidos App** defines the Form of the Application - the perfect, eternal pattern that all database-driven applications participate in. Just as Plato argued that all earthly chairs are imperfect copies of the Form of Chair, all applications are instances of this Form.

This specification provides the complete blueprint for database-driven applications, independent of any particular technology stack or platform. Whether implemented as a web app, mobile app, or desktop application - whether built with Next.js, Rails, Django, or any future framework - the Form remains constant.

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

1. **[Database Specification](./eidos_database.md)** - Schema design, relationships, migrations
2. **[UI Specification](./eidos_ui.md)** - Frontend patterns, CRUD pages, navigation, theming
3. **[Engine Specification](./eidos_engine.md)** - Async processing, business logic, job handling
4. **[API Specification](./eidos_api.md)** - External interfaces, OAuth2, rate limiting
5. **[Foundations Specification](./eidos_foundations.md)** - Testing, observability, security, configuration

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
│   (Next.js)     │────▶│    Database     │◀────│     Engine      │
│                 │◀────│   (Supabase)    │────▶│    (Python)     │
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

## Technology Stack

- **Database:** Supabase (Postgres + Auth + Storage + Realtime)
- **UI:** Next.js (App Router) + Tailwind CSS
- **Engine:** Python (FastAPI + Celery)
- **API:** Next.js API Routes or separate FastAPI
- **Observability:** Better Stack (Logs + Uptime)

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

Begin with the [Database Specification](./eidos_database.md) to understand the data foundation, then proceed to the [UI Specification](./eidos_ui.md) for implementation details.