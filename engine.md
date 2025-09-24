# Eidos - Engine Specification

> Asynchronous processing and business logic engine for handling complex operations outside the request/response cycle.

## 1) Engine Philosophy

- **Separation of Concerns:** UI handles presentation, Engine handles business logic
- **Asynchronous by Design:** Long-running operations don't block the UI
- **Database as Queue:** Leverage the database for job queuing and state management
- **Idempotent Operations:** Every job can be safely retried
- **Observable:** Full visibility into job status and history

## 2) Technology Stack

- **Language:** Python 3.11+
- **Framework:** FastAPI for HTTP endpoints
- **Worker:** Celery with Redis broker (alternatives: RQ, Arq)
- **Database Access:** SQLAlchemy or asyncpg
- **Validation:** Pydantic for data models
- **Observability:** OpenTelemetry for tracing
- **Logging:** Structured JSON logging

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

3. **Process Command:**
```python
async def process_command(command: Command):
    try:
        # Update status
        await update_command_status(command.id, 'processing')
        
        # Execute business logic
        handler = get_handler(command.type)
        result = await handler.execute(command.payload)
        
        # Save result
        await update_command_result(command.id, 'completed', result)
        
        # Emit events
        await emit_domain_event(
            type=f"{command.type}.completed",
            aggregate_id=command.payload['project_id'],
            payload=result
        )
    except Exception as e:
        await handle_failure(command, e)
```

### 4.3) Idempotency

**Strategy:** Use idempotency keys to prevent duplicate processing

```python
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

```python
from pydantic import BaseModel
from typing import Any, Dict
import asyncio

class TaskBase:
    """Base class for all tasks"""
    
    def __init__(self, db, logger, tracer):
        self.db = db
        self.logger = logger
        self.tracer = tracer
    
    async def execute(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Override in subclasses"""
        raise NotImplementedError
    
    async def validate(self, payload: Dict[str, Any]) -> bool:
        """Validate payload before execution"""
        return True
    
    async def compensate(self, payload: Dict[str, Any], error: Exception):
        """Compensating action on failure"""
        pass

class CalculateBudgetTask(TaskBase):
    
    class Payload(BaseModel):
        project_id: str
        include_contingency: bool = False
        contingency_percent: float = 0.1
    
    async def execute(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        # Validate payload
        data = self.Payload(**payload)
        
        # Fetch project data
        project = await self.db.get_project(data.project_id)
        
        # Calculate budget
        budget = await self.calculate_budget(project, data)
        
        # Update project
        await self.db.update_project(
            data.project_id,
            calculated_budget=budget
        )
        
        return {
            "project_id": data.project_id,
            "budget": budget,
            "calculation_date": datetime.utcnow()
        }
```

### 5.2) Error Handling

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

Using Celery Beat:

```python
from celery.schedules import crontab

beat_schedule = {
    'generate-daily-reports': {
        'task': 'tasks.generate_daily_reports',
        'schedule': crontab(hour=2, minute=0),  # 2 AM daily
    },
    'cleanup-old-commands': {
        'task': 'tasks.cleanup_old_commands',
        'schedule': crontab(hour=3, minute=0, day_of_week=0),  # Sunday 3 AM
    },
    'send-reminder-emails': {
        'task': 'tasks.send_reminder_emails',
        'schedule': crontab(hour=9, minute=0),  # 9 AM daily
    },
}
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

```python
from jose import jwt

class SecurityContext:
    def __init__(self, token: str):
        self.token = token
        self.claims = jwt.decode(
            token,
            key=settings.JWT_SECRET,
            algorithms=["HS256"],
            audience="engine"
        )
        self.tenant_id = self.claims.get("tenant_id")
        self.user_id = self.claims.get("user_id")
        self.scopes = self.claims.get("scopes", [])
    
    def has_scope(self, scope: str) -> bool:
        return scope in self.scopes
    
    def validate_tenant(self, tenant_id: str):
        if self.tenant_id != tenant_id:
            raise PermissionError("Tenant mismatch")
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

## 13) Checklist

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