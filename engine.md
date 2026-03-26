# Eidos - Engine Specification

> Asynchronous processing and business logic engine for handling complex operations outside the request/response cycle.

## 1) Engine Philosophy

- **Separation of Concerns:** UI handles presentation, Engine handles business logic
- **Asynchronous by Design:** Long-running operations don't block the UI
- **Database as Queue:** Leverage the database for job queuing and state management
- **Idempotent Operations:** Every job can be safely retried
- **Observable:** Full visibility into job status and history

## 2) Technology Approach

- **Language:** Server-side language with async support
- **Framework:** Web framework for HTTP endpoints
- **Worker:** Job queue system with message broker
- **Database Access:** Database ORM or query builder
- **Validation:** Schema validation library
- **Observability:** Distributed tracing system
- **Logging:** Structured logging with correlation IDs

> See [Framework Guide](./FRAMEWORKS.md) for specific technology implementations.

## 3) Architecture

### 3.1) System Design
```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│     UI      │────▶│   Database  │◀────│   Engine    │
│             │     │  (Commands) │     │  (Worker)   │
└─────────────┘     └─────────────┘     └─────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │   Events    │
                    └─────────────┘
```

### 3.2) Database Schema

**Commands Table:**
```sql
CREATE TABLE commands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    result JSONB,
    error_message TEXT,
    idempotency_key VARCHAR(255) UNIQUE,
    tenant_id UUID NOT NULL,
    user_id UUID NOT NULL,
    request_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    attempts INT DEFAULT 0,
    max_attempts INT DEFAULT 3
);

CREATE INDEX idx_commands_status ON commands(status, created_at);
CREATE INDEX idx_commands_type ON commands(type);
CREATE INDEX idx_commands_tenant ON commands(tenant_id);
```

**Domain Events Table:**
```sql
CREATE TABLE domain_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type VARCHAR(100) NOT NULL,
    aggregate_id UUID NOT NULL,
    aggregate_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    metadata JSONB,
    command_id UUID REFERENCES commands(id),
    tenant_id UUID NOT NULL,
    user_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_events_aggregate ON domain_events(aggregate_type, aggregate_id);
CREATE INDEX idx_events_type ON domain_events(type);
CREATE INDEX idx_events_created ON domain_events(created_at);
```

**Dead Letter Queue:**
```sql
CREATE TABLE dead_letters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    command_id UUID REFERENCES commands(id),
    error_message TEXT,
    error_details JSONB,
    original_payload JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## 4) Command Processing

### 4.1) Command Types

**Naming Convention:** `{bounded_context}.{action}`

Examples:
- `project.calculate_budget`
- `report.generate_monthly`
- `user.send_welcome_email`
- `invoice.process_payment`
- `data.import_csv`

### 4.2) Command Flow

1. **UI Creates Command:**
```python
command = {
    "type": "project.calculate_budget",
    "payload": {
        "project_id": "123",
        "include_contingency": True
    },
    "idempotency_key": "proj-123-budget-2024"
}
```

2. **Engine Polls/Subscribes:**
```python
# Poll for new commands
SELECT * FROM commands 
WHERE status = 'pending' 
AND attempts < max_attempts
ORDER BY created_at 
LIMIT 10
FOR UPDATE SKIP LOCKED;
```

3. **Claim commands quickly, then process independently:**

> **CRITICAL:** Never hold a database connection/transaction for the duration of a handler. Handlers call external APIs (HTTP, AI, email) which can take minutes. Connection poolers (Supabase Supavisor in transaction mode) will kill long-held connections. Claim in a short transaction, release the connection, then process.

```python
# WRONG: holds connection for entire handler duration (breaks with connection poolers)
async with pool.acquire() as conn:
    async with conn.transaction():
        rows = await conn.fetch("SELECT ... FOR UPDATE SKIP LOCKED LIMIT 10")
        for row in rows:
            await process_command(conn, row)  # Minutes-long — pooler kills this

# RIGHT: short claim transaction, then process independently
claimed = []
async with pool.acquire() as conn:
    async with conn.transaction():
        rows = await conn.fetch("SELECT ... FOR UPDATE SKIP LOCKED LIMIT 10")
        for row in rows:
            await conn.execute("UPDATE commands SET status='processing' WHERE id=$1", row['id'])
            claimed.append(dict(row))
# Connection released here

for row_dict in claimed:
    await process_command(row_dict)  # Acquires its own short connections per query

async def process_command(command: dict):
    try:
        handler = get_handler(command['type'])
        result = await handler.execute(command['payload'])
        await update_command_result(command['id'], 'completed', result)
        await emit_domain_event(
            type=f"{command['type']}.completed",
            aggregate_id=command['payload'].get('project_id'),
            payload=result
        )
    except Exception as e:
        await handle_failure(command, e)
```

### 4.3) Idempotency

**Strategy:** Use idempotency keys to prevent duplicate processing

> **GOTCHA:** Never use `uuid4()` in an idempotency key — every call generates a unique value, defeating deduplication entirely. Use time-window-based keys so the scheduler can't create duplicate commands within the same period.

```python
# WRONG: uuid4() makes every key unique — no deduplication
idempotency_key = f"schedule:{command_type}:{workspace_id}:{uuid4()}"

# RIGHT: time-window key deduplicates within a window (e.g., hourly)
window = datetime.now(timezone.utc).strftime("%Y-%m-%d-%H")
idempotency_key = f"schedule:{command_type}:{workspace_id}:{window}"

async def create_command(cmd: CommandCreate) -> Command:
    # Check for existing command with same idempotency key
    existing = await db.query(
        "SELECT * FROM commands WHERE idempotency_key = $1",
        cmd.idempotency_key
    )

    if existing:
        return existing  # Return existing result

    # Create new command
    return await db.query(
        "INSERT INTO commands (...) VALUES (...) RETURNING *",
        ...
    )
```

## 5) Task Implementation

### 5.1) Task Structure

```javascript
// Generic task structure - adapt to your language/framework
class TaskBase {
  constructor(db, logger, tracer) {
    this.db = db;
    this.logger = logger;
    this.tracer = tracer;
  }

  async execute(payload) {
    // Override in subclasses
    throw new Error('Not implemented');
  }

  async validate(payload) {
    // Validate payload before execution
    return true;
  }

  async compensate(payload, error) {
    // Compensating action on failure
  }
}

class CalculateBudgetTask extends TaskBase {
  async execute(payload) {
    // Validate payload
    const { project_id, include_contingency = false, contingency_percent = 0.1 } = payload;

    // Fetch project data
    const project = await this.db.getProject(project_id);

    // Calculate budget
    const budget = await this.calculateBudget(project, { include_contingency, contingency_percent });

    // Update project
    await this.db.updateProject(project_id, {
      calculated_budget: budget
    });

    return {
      project_id,
      budget,
      calculation_date: new Date().toISOString()
    };
  }
}
```

### 5.2) Error Handling

> **GOTCHA: Retryable misses must not tombstone.** When a handler fetches external content (scraping, API call) and gets an empty/null result due to a transient error (rate limit, paywall, timeout), do NOT write a null/empty value to the database. Writing null marks the record as permanently processed, blocking all future retries. Return `{"status": "no_content"}` and let the retry mechanism try again later.

```python
# WRONG: writes null, marks article as permanently unavailable
async def fetch_content(article_id):
    content = await scraper.fetch(url)
    if not content:
        await db.execute("UPDATE articles SET content = NULL WHERE id = $1", article_id)

# RIGHT: transient miss returns status, does not write
async def fetch_content(article_id):
    content = await scraper.fetch(url)
    if not content:
        return {"status": "no_content"}  # Caller leaves DB unchanged
    await db.execute("UPDATE articles SET content = $1 WHERE id = $2", content, article_id)
    return {"status": "ok"}
```

Also skip processing entirely for known-unscrapable URLs (PDFs, binary files) — detect by URL pattern *before* calling the external service:

```python
if url.lower().endswith(".pdf"):
    return {"status": "skipped_pdf"}
```

```python
class RetryableError(Exception):
    """Errors that should trigger retry"""
    pass

class PermanentError(Exception):
    """Errors that should not retry"""
    pass

async def handle_failure(command: Command, error: Exception):
    command.attempts += 1
    
    if isinstance(error, PermanentError):
        # Send to dead letter queue
        await create_dead_letter(command, error)
        await update_command_status(command.id, 'failed', error=str(error))
    
    elif command.attempts >= command.max_attempts:
        # Max retries exceeded
        await create_dead_letter(command, error)
        await update_command_status(command.id, 'failed', error="Max retries exceeded")
    
    elif isinstance(error, RetryableError):
        # Schedule retry with backoff
        delay = calculate_backoff(command.attempts)
        await update_command_status(command.id, 'pending')
        await schedule_retry(command, delay)
    
    else:
        # Unknown error - treat as permanent
        await create_dead_letter(command, error)
        await update_command_status(command.id, 'failed', error=str(error))
```

## 6) Event Emission

### 6.1) Event Types

**Naming:** `{aggregate}.{action}.{status}`

Examples:
- `project.budget.calculated`
- `user.registration.completed`
- `invoice.payment.failed`
- `report.generation.started`

### 6.2) Event Structure

```python
class DomainEvent(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    type: str
    aggregate_id: UUID
    aggregate_type: str
    payload: Dict[str, Any]
    metadata: Dict[str, Any] = {}
    command_id: Optional[UUID] = None
    tenant_id: UUID
    user_id: Optional[UUID] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)

async def emit_event(event: DomainEvent):
    # Save to database
    await db.execute(
        """
        INSERT INTO domain_events 
        (type, aggregate_id, aggregate_type, payload, metadata, command_id, tenant_id, user_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        """,
        event.type, event.aggregate_id, event.aggregate_type,
        event.payload, event.metadata, event.command_id,
        event.tenant_id, event.user_id
    )
    
    # Notify subscribers (via Supabase Realtime or Redis pub/sub)
    await publish_to_realtime(event)
```

## 7) Job Scheduling

### 7.1) Periodic Tasks

Using your framework's scheduler (cron-like syntax):

```yaml
# Example scheduler configuration
schedules:
  generate-daily-reports:
    task: 'tasks.generate_daily_reports'
    schedule: '0 2 * * *'  # 2 AM daily

  cleanup-old-commands:
    task: 'tasks.cleanup_old_commands'
    schedule: '0 3 * * 0'  # Sunday 3 AM

  send-reminder-emails:
    task: 'tasks.send_reminder_emails'
    schedule: '0 9 * * *'  # 9 AM daily
```

### 7.2) Delayed Execution

```python
async def schedule_delayed_command(
    command_type: str,
    payload: Dict,
    delay_seconds: int
):
    eta = datetime.utcnow() + timedelta(seconds=delay_seconds)
    
    await db.execute(
        """
        INSERT INTO commands (type, payload, status, scheduled_at)
        VALUES ($1, $2, 'scheduled', $3)
        """,
        command_type, payload, eta
    )
```

## 8) Security

### 8.1) Authentication

```javascript
// Generic security context - adapt to your JWT library
class SecurityContext {
  constructor(token) {
    this.token = token;
    this.claims = this.decodeJWT(token);
    this.tenantId = this.claims.tenant_id;
    this.userId = this.claims.user_id;
    this.scopes = this.claims.scopes || [];
  }

  hasScope(scope) {
    return this.scopes.includes(scope);
  }

  validateTenant(tenantId) {
    if (this.tenantId !== tenantId) {
      throw new Error('Tenant mismatch');
    }
  }

  decodeJWT(token) {
    // Use your JWT library to decode and verify
    return jwt.verify(token, process.env.JWT_SECRET);
  }
}
```

### 8.2) Database Access

```python
# Use service account with minimal permissions
ENGINE_DB_PERMISSIONS = [
    "SELECT ON commands",
    "UPDATE ON commands",
    "INSERT ON domain_events",
    "INSERT ON dead_letters",
    "EXECUTE ON FUNCTION process_command",
]

# Use RLS bypass only when necessary
async def bypass_rls_for_system_operation(operation):
    async with db.transaction() as tx:
        await tx.execute("SET LOCAL app.current_user = 'system'")
        result = await operation(tx)
    return result
```

## 9) Observability

### 9.1) Tracing

```python
from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode

tracer = trace.get_tracer(__name__)

async def process_command_with_tracing(command: Command):
    with tracer.start_as_current_span(
        f"command.{command.type}",
        attributes={
            "command.id": str(command.id),
            "command.type": command.type,
            "tenant.id": str(command.tenant_id),
        }
    ) as span:
        try:
            result = await process_command(command)
            span.set_status(Status(StatusCode.OK))
            return result
        except Exception as e:
            span.set_status(Status(StatusCode.ERROR, str(e)))
            span.record_exception(e)
            raise
```

### 9.2) Metrics

```python
from prometheus_client import Counter, Histogram, Gauge

# Metrics
commands_processed = Counter(
    'engine_commands_processed_total',
    'Total commands processed',
    ['type', 'status', 'tenant']
)

command_duration = Histogram(
    'engine_command_duration_seconds',
    'Command processing duration',
    ['type']
)

commands_pending = Gauge(
    'engine_commands_pending',
    'Number of pending commands'
)

# Usage
@command_duration.time()
async def process_timed_command(command):
    result = await process_command(command)
    commands_processed.labels(
        type=command.type,
        status='success',
        tenant=command.tenant_id
    ).inc()
    return result
```

### 9.3) Logging

```python
import structlog

logger = structlog.get_logger()

async def process_command_with_logging(command: Command):
    log = logger.bind(
        command_id=str(command.id),
        command_type=command.type,
        tenant_id=str(command.tenant_id),
        user_id=str(command.user_id),
        request_id=str(command.request_id)
    )
    
    log.info("command.started")
    
    try:
        result = await process_command(command)
        log.info("command.completed", result=result)
        return result
    except Exception as e:
        log.error("command.failed", error=str(e), exc_info=True)
        raise
```

## 10) Testing

### 10.1) Unit Tests

```python
import pytest
from unittest.mock import AsyncMock

@pytest.mark.asyncio
async def test_calculate_budget_task():
    # Setup
    db = AsyncMock()
    db.get_project.return_value = {
        "id": "123",
        "tasks": [{"cost": 100}, {"cost": 200}]
    }
    
    task = CalculateBudgetTask(db, logger, tracer)
    
    # Execute
    result = await task.execute({
        "project_id": "123",
        "include_contingency": True,
        "contingency_percent": 0.1
    })
    
    # Assert
    assert result["budget"] == 330  # 300 + 10%
    db.update_project.assert_called_once()
```

### 10.2) Integration Tests

```python
@pytest.mark.integration
async def test_command_processing_flow():
    # Create command
    command = await create_command({
        "type": "project.calculate_budget",
        "payload": {"project_id": "123"}
    })
    
    # Process
    await engine.process_pending_commands()
    
    # Verify
    command = await get_command(command.id)
    assert command.status == "completed"
    
    # Check events
    events = await get_domain_events(command_id=command.id)
    assert len(events) == 1
    assert events[0].type == "project.budget.calculated"
```

### 10.3) Contract Tests

```python
# Shared schema between UI and Engine
from pydantic import BaseModel

class ProjectBudgetCommand(BaseModel):
    project_id: str
    include_contingency: bool = False
    
    class Config:
        schema_extra = {
            "example": {
                "project_id": "123",
                "include_contingency": True
            }
        }

# Test schema compatibility
def test_command_contract():
    # UI sends this
    ui_payload = {"project_id": "123", "include_contingency": True}
    
    # Engine can parse it
    command = ProjectBudgetCommand(**ui_payload)
    assert command.project_id == "123"
```

## 11) Deployment

### 11.1) Container Configuration

```dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY . .

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD python -c "import requests; requests.get('http://localhost:8000/health').raise_for_status()"

# Run worker
CMD ["celery", "-A", "app.worker", "worker", "--loglevel=info"]
```

### 11.2) Environment Variables

```env
# Database
DATABASE_URL=postgresql://user:pass@host:5432/db
DATABASE_POOL_SIZE=10
DATABASE_MAX_OVERFLOW=20

# Redis (for Celery)
REDIS_URL=redis://localhost:6379/0

# Security
JWT_SECRET=your-secret-key
SERVICE_ACCOUNT_KEY=your-service-key

# Observability
OTEL_EXPORTER_OTLP_ENDPOINT=http://collector:4317
LOG_LEVEL=INFO
BETTER_STACK_TOKEN=your-token

# Performance
WORKER_CONCURRENCY=4
COMMAND_BATCH_SIZE=10
COMMAND_POLL_INTERVAL=5
```

### 11.3) Scaling

```yaml
# Kubernetes HPA
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: engine-worker
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: engine-worker
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Pods
    pods:
      metric:
        name: pending_commands
      target:
        type: AverageValue
        averageValue: "30"
```

## 12) Monitoring & Alerts

### 12.1) Key Metrics

- Commands per second (by type)
- Command success/failure rate
- Command processing duration (P50, P95, P99)
- Queue depth (pending commands)
- Worker utilization
- Dead letter queue size

### 12.2) Alerts

```yaml
alerts:
  - name: HighCommandFailureRate
    condition: failure_rate > 0.05  # 5%
    duration: 5m
    severity: warning
    
  - name: CommandQueueBacklog
    condition: pending_commands > 1000
    duration: 10m
    severity: critical
    
  - name: WorkerDown
    condition: worker_heartbeat == 0
    duration: 2m
    severity: critical
    
  - name: DeadLetterQueueGrowing
    condition: rate(dead_letters) > 10/min
    duration: 5m
    severity: warning
```

## 13) Gotchas

### 13.1) Sync API clients block the event loop

The Anthropic Python SDK's default client (`anthropic.Anthropic`) is synchronous. Calling it from an `async` handler blocks the entire event loop, stalling healthchecks and all concurrent operations.

```python
# WRONG: blocks event loop
result = anthropic_client.messages.create(...)

# RIGHT: wrap sync calls in asyncio.to_thread()
result = await asyncio.to_thread(anthropic_client.messages.create, ...)

# BEST: use the native async client
client = anthropic.AsyncAnthropic()
result = await client.messages.create(...)
```

The same applies to any sync SDK (OpenAI, Stripe, etc.) called from async handlers.

### 13.2) Python operator precedence in inline ternary expressions

Python's `or` has higher precedence than inline `if/else`. This silently produces wrong results:

```python
# WRONG: evaluates as (A or B) if C else "" — not A or (B if C else "")
summary = (entry.get("summary") or entry.get("content", [{}])[0].get("value", "") if entry.get("content") else "")

# RIGHT: use explicit conditionals
if entry.get("content"):
    summary = entry.get("summary") or entry.get("content", [{}])[0].get("value", "")
else:
    summary = ""
```

Avoid inline ternary expressions when more than two values are involved.

### 13.3) AI batch response matching: use index, not title

When sending batched items to an LLM for scoring/filtering, don't match results back to inputs by title or string. The model may rephrase, truncate, or reorder. Always use positional (index) matching:

```
Score EVERY post. Return a JSON array with EXACTLY N elements,
one per post, in the SAME ORDER as listed above. Do not include titles.
```

Drop the `"title"` field from the required output — it wastes tokens and creates a fragile matching dependency.

### 13.4) Engine doesn't need a public API domain

The engine is a headless background worker — it polls Supabase, processes commands, writes results back. The only inbound HTTP endpoint needed is `/health` for Railway's healthcheck.

Clients (web, mobile) talk directly to Supabase via their platform SDKs. A public engine API domain is only needed if the engine must receive inbound webhooks (Stripe, email). Even then, Supabase Edge Functions can receive webhooks and write to the commands table instead.

### 13.5) Size token budgets by task type

Different generation tasks need very different token budgets. A budget that's fine for filtering (2–3k tokens) will silently truncate a briefing (needs 6–10k+). Truncation produces empty or incomplete output with no error — the handler succeeds but the result is useless.

```python
TOKEN_BUDGETS = {
    "filter":   2_000,   # Score/filter a batch of items
    "classify":  3_000,   # Categorize content
    "summarize": 4_000,   # Summarize a single article
    "brief":     8_000,   # Full briefing across multiple sources
    "report":   12_000,   # Long-form synthesis
}
```

Signal to watch for: handler completes with `status=ok` but output has empty sections or fewer items than expected. Always log the actual token usage after generation so you can spot near-ceiling calls in production.

### 13.6) Always complete the pipeline on empty inputs

When a pipeline stage has nothing to process (zero feeds, zero new articles, zero scored items), it must still write its completion record and emit its domain event. Without the completion signal, the frontend either hangs waiting for an update or never gets a "done" indicator.

```python
async def scan_feeds(workspace_id: str):
    feeds = await get_feeds(workspace_id)
    if not feeds:
        # Still emit completion — frontend is waiting for this
        await emit_event("scan.completed", {"workspace_id": workspace_id, "new_articles": 0})
        return {"status": "ok", "new_articles": 0}
    # ... normal processing
```

## 14) Pipeline composition

For multi-stage pipelines (scan → fetch → score → brief), each stage is a separate command type. The output of one stage triggers insertion of the next.

### 14.1) Fan-out pattern

A coordinator command (`daily.pipeline`) fans out to per-resource commands. Each resource is claimed independently, so failures in one don't block others.

```
daily.pipeline
  └─► scan.feeds           (one per workspace)
        └─► fetch.articles  (one per new article)
              └─► score.articles  (one per batch)
                    └─► generate.brief  (one per workspace)
```

The coordinator writes the child commands directly to the `commands` table. Children pick up on the next poll cycle.

```python
async def handle_daily_pipeline(payload: dict):
    workspace_ids = await get_active_workspace_ids()
    for ws_id in workspace_ids:
        window = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        await insert_command(
            type="scan.feeds",
            payload={"workspace_id": ws_id},
            idempotency_key=f"scan:{ws_id}:{window}",
        )
    return {"status": "ok", "workspaces_queued": len(workspace_ids)}
```

### 14.2) Stage dependencies

Each stage must be tolerant of being called when the previous stage hasn't fully completed — either because commands run in parallel or because a retry re-fires. Two rules:

1. **Read only committed data** — never depend on another command's in-flight state
2. **Write idempotently** — inserting a child command that already exists (same idempotency key) must be a no-op, not an error

### 14.3) Commands table as audit log

Because every stage writes a command row with `started_at`, `completed_at`, `result`, and `error_message`, the commands table is a complete audit log of every pipeline run. This is free introspection — no separate logging needed to answer "what ran, when, and what did it return?"

```sql
-- What happened in yesterday's pipeline for workspace X?
SELECT type, status, started_at, completed_at, result, error_message
FROM commands
WHERE payload->>'workspace_id' = 'ws_abc'
  AND created_at >= NOW() - INTERVAL '24 hours'
ORDER BY created_at;
```

### 14.4) Separate fetch from score

Keeping "fetch article content" and "score/filter articles" as distinct command types pays off:

- Re-scoring with updated interests doesn't require re-fetching (expensive HTTP calls)
- Fetch failures don't block scoring of already-fetched articles
- Token costs for scoring are predictable and batchable independently of fetch latency
- Scraper bugs can be fixed and articles re-fetched without redoing the scoring logic

## 16) Checklist

### Core Functionality
- [ ] Command polling/subscription working
- [ ] Idempotency enforced
- [ ] Retry logic with backoff
- [ ] Dead letter queue configured
- [ ] Domain events emitted

### Task Implementation
- [ ] All task handlers implemented
- [ ] Payload validation with Pydantic
- [ ] Error handling and compensation
- [ ] Business logic isolated from infrastructure

### Security
- [ ] JWT validation
- [ ] Tenant isolation enforced
- [ ] Service account permissions minimal
- [ ] Secrets in secure store

### Observability
- [ ] Structured logging configured
- [ ] Tracing with OpenTelemetry
- [ ] Metrics exported
- [ ] Better Stack integration
- [ ] Alerts configured

### Testing
- [ ] Unit tests for all tasks
- [ ] Integration tests for flows
- [ ] Contract tests with UI
- [ ] Load tests performed

### Deployment
- [ ] Docker image built
- [ ] Health checks working
- [ ] Auto-scaling configured
- [ ] Graceful shutdown implemented
- [ ] Monitoring dashboards created