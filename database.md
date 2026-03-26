# Eidos - Database Specification

> Schema design, relationships, migrations, and data patterns for database-first applications.

## 1) Core Philosophy

- **Database-First:** Model the real world in the database first; everything else follows
- **Convention Over Configuration:** Consistent patterns reduce cognitive load
- **Relationships Matter:** Treat important joins as first-class entities
- **Everything is Audited:** Who did what, when, and why

> See [Framework Guide](./FRAMEWORKS.md) for database-specific implementation details.

## 2) Database Design

### 2.1) Standard Table Structure

**Required Columns (all tables):**
```sql
CREATE TABLE entity_name (
    -- Identity
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Audit fields
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by_id UUID REFERENCES users(id),
    updated_by_id UUID REFERENCES users(id),

    -- Multi-tenancy (if applicable)
    tenant_id UUID NOT NULL REFERENCES tenants(id),

    -- Soft delete (optional)
    deleted_at TIMESTAMPTZ,
    deleted_by_id UUID REFERENCES users(id),

    -- Versioning (optional)
    version INTEGER NOT NULL DEFAULT 1,

    -- Entity-specific columns
    ...
);

-- Standard indexes
CREATE INDEX idx_entity_tenant ON entity_name(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_entity_created ON entity_name(created_at);
CREATE INDEX idx_entity_updated ON entity_name(updated_at);
CREATE INDEX idx_entity_deleted ON entity_name(deleted_at) WHERE deleted_at IS NOT NULL;
```

### 2.2) Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Tables | Singular, PascalCase | `Project`, `User`, `Invoice` |
| Columns | snake_case | `first_name`, `due_date` |
| Primary Keys | `id` | `id` |
| Foreign Keys | `{table}_id` | `project_id`, `user_id` |
| Indexes | `idx_{table}_{column(s)}` | `idx_project_status` |
| Constraints | `{table}_{type}_{detail}` | `project_check_dates` |
| Join Tables (attributed) | Semantic name | `ProjectMember`, `Enrollment` |
| Join Tables (simple) | `{table1}_{table2}_links` | `user_role_links` |

### 2.3) Data Types

**Preferred Types:**
- **IDs:** UUID (better for distributed systems)
- **Text:** TEXT (no artificial limits)
- **Numbers:** BIGINT for counts, DECIMAL for money
- **Dates:** TIMESTAMPTZ (always with timezone)
- **Status:** ENUM or VARCHAR with CHECK constraint
- **JSON:** JSONB (for flexible structured data)
- **Money:** DECIMAL(19,4) or separate cents column

**Avoid:**
- SERIAL (use UUID instead)
- TIMESTAMP without timezone
- FLOAT/REAL for money
- CHAR (use VARCHAR or TEXT)

### 2.4) Relationships

**One-to-Many:**
```sql
-- Parent
CREATE TABLE projects (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL
);

-- Child (holds foreign key)
CREATE TABLE tasks (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id),
    name TEXT NOT NULL
);
```

**Many-to-Many (Simple):**
```sql
CREATE TABLE user_role_links (
    user_id UUID REFERENCES users(id),
    role_id UUID REFERENCES roles(id),
    PRIMARY KEY (user_id, role_id)
);
```

**Many-to-Many (Attributed - First-Class Entity):**
```sql
CREATE TABLE project_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id),
    user_id UUID NOT NULL REFERENCES users(id),
    role VARCHAR(50) NOT NULL,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    left_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(project_id, user_id, joined_at)
);
```

### 2.5) Constraints

**Common Constraints:**
```sql
-- Not null for required fields
ALTER TABLE projects ADD CONSTRAINT projects_name_required
    CHECK (name IS NOT NULL AND name != '');

-- Unique constraints
ALTER TABLE users ADD CONSTRAINT users_email_unique
    UNIQUE (email) WHERE deleted_at IS NULL;

-- Check constraints for business rules
ALTER TABLE projects ADD CONSTRAINT projects_dates_valid
    CHECK (end_date >= start_date);

-- Enum-style constraints
ALTER TABLE tasks ADD CONSTRAINT tasks_status_valid
    CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled'));

-- Positive numbers
ALTER TABLE invoices ADD CONSTRAINT invoices_amount_positive
    CHECK (amount > 0);
```

### 2.6) Indexes

**Index Strategy:**
```sql
-- Foreign keys (always)
CREATE INDEX idx_tasks_project ON tasks(project_id);

-- Unique constraints that allow nulls
CREATE UNIQUE INDEX idx_users_email ON users(email)
    WHERE email IS NOT NULL AND deleted_at IS NULL;

-- Common query patterns
CREATE INDEX idx_tasks_status_project ON tasks(status, project_id)
    WHERE deleted_at IS NULL;

-- Sorting needs
CREATE INDEX idx_projects_updated ON projects(updated_at DESC);

-- Full-text search
CREATE INDEX idx_projects_search ON projects
    USING gin(to_tsvector('english', name || ' ' || description));

-- JSONB queries
CREATE INDEX idx_tasks_metadata ON tasks
    USING gin(metadata);
```

### 2.7) Views & Materialized Views

**Summary Views:**
```sql
CREATE VIEW project_summary AS
SELECT
    p.id,
    p.name,
    p.status,
    COUNT(DISTINCT t.id) as task_count,
    COUNT(DISTINCT pm.user_id) as member_count,
    MAX(t.updated_at) as last_activity
FROM projects p
LEFT JOIN tasks t ON t.project_id = p.id
LEFT JOIN project_members pm ON pm.project_id = p.id
WHERE p.deleted_at IS NULL
GROUP BY p.id;
```

**Materialized Views for Performance:**
```sql
CREATE MATERIALIZED VIEW user_statistics AS
SELECT
    u.id,
    u.name,
    COUNT(DISTINCT p.id) as project_count,
    COUNT(DISTINCT t.id) as task_count,
    AVG(t.completion_time) as avg_task_time
FROM users u
LEFT JOIN project_members pm ON pm.user_id = u.id
LEFT JOIN projects p ON p.id = pm.project_id
LEFT JOIN tasks t ON t.assignee_id = u.id
GROUP BY u.id;

-- Refresh strategy
CREATE INDEX idx_user_statistics_id ON user_statistics(id);
REFRESH MATERIALIZED VIEW CONCURRENTLY user_statistics;
```

## 3) Row-Level Security (Supabase)

### 3.1) Basic RLS Policies

```sql
-- Enable RLS
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

-- View own tenant's data
CREATE POLICY "View own tenant projects" ON projects
    FOR SELECT
    USING (tenant_id = current_tenant_id());

-- Create in own tenant
CREATE POLICY "Create in own tenant" ON projects
    FOR INSERT
    WITH CHECK (tenant_id = current_tenant_id());

-- Update own tenant's data
CREATE POLICY "Update own tenant projects" ON projects
    FOR UPDATE
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- Delete with permission
CREATE POLICY "Delete with permission" ON projects
    FOR DELETE
    USING (
        tenant_id = current_tenant_id()
        AND has_permission('delete:projects')
    );
```

### 3.2) Helper Functions

```sql
-- Get current tenant
CREATE FUNCTION current_tenant_id()
RETURNS UUID AS $$
BEGIN
    RETURN current_setting('app.current_tenant_id')::UUID;
EXCEPTION
    WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Check permission
CREATE FUNCTION has_permission(permission TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    user_permissions TEXT[];
BEGIN
    SELECT permissions INTO user_permissions
    FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = auth.uid();

    RETURN permission = ANY(user_permissions);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

## 4) Migrations

### 4.1) Migration Structure

```sql
-- migrations/001_create_projects.up.sql
BEGIN;

CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_projects_status ON projects(status);
CREATE INDEX idx_projects_created ON projects(created_at);

COMMIT;

-- migrations/001_create_projects.down.sql
BEGIN;
DROP TABLE IF EXISTS projects CASCADE;
COMMIT;
```

### 4.2) Migration Best Practices

```sql
-- Always use transactions
BEGIN;

-- Make migrations idempotent
CREATE TABLE IF NOT EXISTS ...
DROP TABLE IF EXISTS ...
CREATE INDEX IF NOT EXISTS ...

-- Add columns safely
ALTER TABLE projects
ADD COLUMN IF NOT EXISTS budget DECIMAL(19,4);

-- Provide defaults for NOT NULL columns
ALTER TABLE projects
ADD COLUMN status VARCHAR(50) NOT NULL DEFAULT 'active';

-- Rename safely
ALTER TABLE projects
RENAME COLUMN IF EXISTS old_name TO new_name;

-- Add constraints with names
ALTER TABLE projects
ADD CONSTRAINT projects_budget_positive
CHECK (budget >= 0);

COMMIT;
```

## 5) Performance Patterns

### 5.1) N+1 Query Prevention

```javascript
// Bad - N+1 queries
const projects = await getProjects();
for (const project of projects) {
  project.tasks = await getTasks(project.id); // Query per project
}

// Good - Eager loading (use your ORM's eager loading)
const projects = await getProjectsWithTasks();

// Good - Batch loading
const projectIds = projects.map(p => p.id);
const tasks = await getTasksByProjectIds(projectIds);
const tasksByProject = groupBy(tasks, 'projectId');
```

### 5.2) Database Connection Pooling

```javascript
// Example connection pool configuration
const poolConfig = {
  // Development - minimal pooling
  development: {
    min: 2,
    max: 10,
    idle: 10000
  },

  // Production - robust pooling
  production: {
    min: 5,
    max: 30,
    idle: 30000,
    acquire: 60000,
    evict: 1000,
    handleDisconnects: true
  }
};

const db = createConnection(DATABASE_URL, {
  pool: poolConfig[process.env.NODE_ENV]
});
```

### 5.3) Caching Strategy

```javascript
// Memory cache for immutable data
const userPermissionsCache = new Map();

function getUserPermissions(userId) {
  if (userPermissionsCache.has(userId)) {
    return userPermissionsCache.get(userId);
  }

  const permissions = fetchFromDb(userId);
  userPermissionsCache.set(userId, permissions);
  return permissions;
}

// Redis cache for shared data
async function getProjectCached(projectId) {
  // Check cache
  const cached = await redisClient.get(`project:${projectId}`);
  if (cached) {
    return JSON.parse(cached);
  }

  // Fetch from DB
  const project = await getProjectFromDb(projectId);

  // Cache with TTL
  await redisClient.setex(
    `project:${projectId}`,
    3600, // 1 hour TTL
    JSON.stringify(project)
  );

  return project;
}

// Cache invalidation
async function updateProject(projectId, data) {
  // Update DB
  await updateProjectInDb(projectId, data);

  // Invalidate cache
  await redisClient.del(`project:${projectId}`);
}
```

## 5b) Start flat — avoid JSONB blobs for structured fields

It's tempting to use a JSONB `stage_data` or `metadata` column to store per-stage or per-entity structured data. Don't. Flat columns are:

- Queryable without JSON path syntax
- Indexable
- Selectable by name (less data transferred)
- Visible in DB introspection tools and migrations
- Obvious to future developers

**The migration tax is steep.** Moving from `stage_data->'outline'->>'content'` to a flat `outline text` column requires:
1. Adding the new columns
2. Backfilling all existing rows
3. Dual-writing in every handler during transition
4. Removing read fallbacks once confirmed
5. Removing write fallbacks

That's 4–5 PRs and weeks of risk. If you know the shape of the data up front, just use columns.

```sql
-- WRONG: storing structured fields in JSONB blob
ALTER TABLE contents ADD COLUMN stage_data jsonb;
-- later: stage_data -> 'outline' -> 'content', stage_data -> 'draft' -> 'text', ...

-- RIGHT: flat columns from the start
ALTER TABLE contents
  ADD COLUMN outline text,
  ADD COLUMN script text,
  ADD COLUMN interview_qa jsonb,  -- JSONB is fine for truly schemaless arrays
  ADD COLUMN draft text,
  ADD COLUMN intro text;
```

> **Rule of thumb:** JSONB is appropriate for truly schemaless data (user preferences, webhook payloads, arbitrary metadata). If you can name the fields today, use columns.

## 6) Security Patterns

### 6.1) SQL Injection Prevention

```python
# NEVER do this
query = f"SELECT * FROM users WHERE email = '{email}'"

# Use parameterized queries
query = "SELECT * FROM users WHERE email = $1"
result = await db.fetch(query, email)

# With SQLAlchemy
from sqlalchemy import text

query = text("SELECT * FROM users WHERE email = :email")
result = conn.execute(query, {"email": email})

# Query builder
from sqlalchemy import select

stmt = select(User).where(User.email == email)
result = await session.execute(stmt)
```

## 7) Supabase query gotchas

### 7.1) `.single()` fails when multiple rows match

Supabase's `.single()` returns an **error** (not the first row) when the query matches more than one row. This is different from SQL `LIMIT 1`. The error is silent — callers that ignore it get `null` data and may trigger confusing redirect loops.

```typescript
// WRONG: fails when user has multiple memberships
const { data: membership } = await supabase
  .from("memberships").select("workspace_id").eq("user_id", user.id).single()

// RIGHT: deterministic first result
const { data: membership } = await supabase
  .from("memberships").select("workspace_id").eq("user_id", user.id)
  .order("created_at", { ascending: true }).limit(1).single()
```

Use `.maybeSingle()` when zero-or-one rows are expected — it returns `null` (not an error) when no rows match.

> **Audit all `.single()` calls.** Add `.limit(1)` wherever a user could accumulate multiple rows (memberships, sessions, settings).

### 7.2) PostgREST join syntax fails silently with RLS

Supabase's embedded join syntax (e.g., `select("id, user_profiles(name)")`) fails **silently** when RLS blocks the join target. The query returns rows, but joined fields are `null` — no error returned.

```typescript
// Silent failure if RLS blocks user_profiles
const { data: members } = await supabase
  .from("memberships").select("id, role, user_profiles(name)")

// Fix: fetch separately and merge
const { data: members } = await supabase.from("memberships").select("id, role, user_id")
const userIds = (members ?? []).map(m => m.user_id)
const { data: profiles } = await supabase.from("user_profiles").select("id, name").in("id", userIds)
const profileMap = new Map(profiles?.map(p => [p.id, p.name]))
```

Co-member visibility policy (if users need to see each other's profiles):
```sql
CREATE POLICY "Workspace co-members can read profiles" ON public.user_profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM memberships m1
      JOIN memberships m2 ON m1.workspace_id = m2.workspace_id
      WHERE m1.user_id = auth.uid() AND m2.user_id = user_profiles.id
    )
  );
```

### 7.3) CHECK constraints must be updated when adding enum values

If a column uses a CHECK constraint to limit allowed values, adding a new value requires a migration to drop and recreate the constraint. Inserting the new value without migrating fails with `violates check constraint`.

```sql
-- Migration: add new_provider to CHECK constraint
ALTER TABLE integrations DROP CONSTRAINT integrations_provider_check;
ALTER TABLE integrations ADD CONSTRAINT integrations_provider_check
  CHECK (provider IN ('bluesky', 'mastodon', 'notion', 'new_provider'));
```

**Alternative:** Use a foreign key to a `providers` reference table instead of CHECK constraints for extensible enums. Adds a row, no migration needed.

## 8) Database Checklist

- [ ] Schema follows naming conventions
- [ ] All tables have audit columns
- [ ] Foreign keys are indexed
- [ ] Constraints have descriptive names
- [ ] Soft delete strategy decided
- [ ] RLS policies configured (if using Supabase)
- [ ] Migrations are reversible
- [ ] Test data seeders created
- [ ] Database queries optimized
- [ ] N+1 queries eliminated
- [ ] Connection pooling configured
- [ ] Database indexes reviewed