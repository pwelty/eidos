# Framework Implementation Guide

> Specific technology implementations for the Eidos pattern. Each framework maintains the same core principles while leveraging platform-specific features.

## Core Technology Stacks

### Stack 1: JavaScript/TypeScript Full-Stack
- **Database:** PostgreSQL with Supabase (Auth + Realtime)
- **Frontend:** Next.js (App Router) + Tailwind CSS
- **Backend:** Next.js API Routes or Node.js/Express
- **Workers:** Node.js with Bull/BullMQ + Redis
- **Validation:** Zod or Joi
- **ORM:** Prisma or Drizzle

### Stack 2: Python + Modern Frontend
- **Database:** PostgreSQL
- **Frontend:** React/Vue/Angular + TailwindCSS
- **Backend:** FastAPI + SQLAlchemy
- **Workers:** Celery + Redis
- **Validation:** Pydantic
- **Auth:** Auth0, Firebase Auth, or custom JWT

### Stack 3: Full Python Stack
- **Database:** PostgreSQL
- **Frontend:** Django templates or modern SPA framework
- **Backend:** Django or FastAPI
- **Workers:** Celery or RQ
- **Validation:** Django forms or Pydantic
- **Auth:** Django auth or FastAPI security

### Stack 4: .NET Stack
- **Database:** PostgreSQL or SQL Server
- **Frontend:** Blazor, React, or Vue
- **Backend:** ASP.NET Core
- **Workers:** Hangfire or MassTransit
- **Validation:** FluentValidation
- **Auth:** Identity Server or Azure AD

### Stack 5: Ruby Stack
- **Database:** PostgreSQL
- **Frontend:** Rails views + Hotwire or separate SPA
- **Backend:** Ruby on Rails
- **Workers:** Sidekiq + Redis
- **Validation:** Rails validations
- **Auth:** Devise or Omniauth

## Database Implementation Details

### PostgreSQL with Supabase
```sql
-- Standard audit columns
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by_id UUID REFERENCES auth.users(id),
    updated_by_id UUID REFERENCES auth.users(id)
);

-- Row Level Security
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tenant projects" ON projects
    FOR SELECT USING (tenant_id = current_tenant_id());
```

### MySQL Implementation
```sql
CREATE TABLE projects (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_by_id CHAR(36),
    updated_by_id CHAR(36),
    INDEX idx_projects_created (created_at),
    FOREIGN KEY (created_by_id) REFERENCES users(id)
);
```

### MongoDB Implementation
```javascript
// Schema with Mongoose
const projectSchema = new Schema({
  _id: { type: ObjectId, default: new ObjectId },
  name: { type: String, required: true },
  tenantId: { type: ObjectId, ref: 'Tenant', required: true },
  createdBy: { type: ObjectId, ref: 'User' },
  updatedBy: { type: ObjectId, ref: 'User' }
}, {
  timestamps: true,
  toJSON: { transform: (doc, ret) => { ret.id = ret._id; delete ret._id; } }
});
```

## Frontend Framework Specifics

### Next.js App Router
```typescript
// app/projects/page.tsx
export default async function ProjectsPage() {
  const projects = await getProjects();

  return (
    <div>
      <ProjectsList projects={projects} />
      <CreateProjectButton />
    </div>
  );
}

// Server Actions
async function createProject(formData: FormData) {
  'use server';

  const project = await db.project.create({
    data: {
      name: formData.get('name') as string,
      createdById: getCurrentUserId()
    }
  });

  revalidatePath('/projects');
  redirect(`/projects/${project.id}`);
}
```

### React + Express API
```typescript
// React Component
function ProjectsList() {
  const { data: projects, mutate } = useSWR('/api/projects', fetcher);

  const createProject = async (data: ProjectData) => {
    await api.post('/projects', data);
    mutate(); // Revalidate cache
  };

  return (
    <div>
      {projects?.map(project => (
        <ProjectCard key={project.id} project={project} />
      ))}
    </div>
  );
}

// Express API
app.get('/api/projects', authenticate, async (req, res) => {
  const projects = await db.projects.findMany({
    where: { tenantId: req.user.tenantId }
  });
  res.json(projects);
});
```

### Django Templates + HTMX
```python
# views.py
def projects_list(request):
    projects = Project.objects.filter(tenant=request.user.tenant)
    return render(request, 'projects/list.html', {'projects': projects})

# Template
<div hx-get="/projects/search" hx-trigger="input changed delay:300ms" hx-target="#results">
    <input type="search" name="q" placeholder="Search projects...">
</div>
<div id="results">
    {% for project in projects %}
        <div class="project-card">{{ project.name }}</div>
    {% endfor %}
</div>
```

### Vue.js + FastAPI
```vue
<template>
  <div>
    <ProjectSearch @search="searchProjects" />
    <ProjectCard
      v-for="project in projects"
      :key="project.id"
      :project="project"
      @update="updateProject"
    />
  </div>
</template>

<script setup lang="ts">
const { data: projects, refresh } = await $fetch('/api/projects');

const updateProject = async (id: string, updates: Partial<Project>) => {
  await $fetch(`/api/projects/${id}`, {
    method: 'PATCH',
    body: updates
  });
  refresh();
};
</script>
```

## Backend Framework Specifics

### FastAPI Implementation
```python
from fastapi import FastAPI, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

class ProjectCreate(BaseModel):
    name: str
    description: Optional[str] = None

@app.post("/projects", response_model=Project)
async def create_project(
    project_data: ProjectCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    project = models.Project(
        **project_data.dict(),
        created_by_id=current_user.id,
        tenant_id=current_user.tenant_id
    )
    db.add(project)
    db.commit()
    db.refresh(project)

    # Emit domain event
    await event_bus.emit(ProjectCreated(
        project_id=project.id,
        name=project.name,
        created_by=current_user.id
    ))

    return project
```

### Django REST Framework
```python
from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated

class ProjectViewSet(viewsets.ModelViewSet):
    serializer_class = ProjectSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Project.objects.filter(tenant=self.request.user.tenant)

    def perform_create(self, serializer):
        project = serializer.save(
            created_by=self.request.user,
            tenant=self.request.user.tenant
        )
        # Emit event
        signals.project_created.send(
            sender=self.__class__,
            project=project,
            user=self.request.user
        )
```

### ASP.NET Core
```csharp
[ApiController]
[Route("api/[controller]")]
public class ProjectsController : ControllerBase
{
    private readonly IProjectService _projectService;
    private readonly ICurrentUser _currentUser;

    [HttpPost]
    public async Task<ActionResult<ProjectDto>> CreateProject(CreateProjectRequest request)
    {
        var command = new CreateProjectCommand
        {
            Name = request.Name,
            Description = request.Description,
            CreatedById = _currentUser.Id,
            TenantId = _currentUser.TenantId
        };

        var project = await _projectService.CreateAsync(command);

        await _eventBus.PublishAsync(new ProjectCreatedEvent
        {
            ProjectId = project.Id,
            Name = project.Name,
            CreatedBy = _currentUser.Id
        });

        return CreatedAtAction(nameof(GetProject), new { id = project.Id }, project);
    }
}
```

## Authentication Implementation

### Supabase Auth
```typescript
// Client-side
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(url, key);

// Login
const { data, error } = await supabase.auth.signInWithPassword({
  email: 'user@example.com',
  password: 'password'
});

// Server-side middleware
export async function middleware(request: NextRequest) {
  const token = request.cookies.get('sb-access-token')?.value;

  if (!token) {
    return NextResponse.redirect('/login');
  }

  const { data: user } = await supabase.auth.getUser(token);
  if (!user) {
    return NextResponse.redirect('/login');
  }

  // Add user to headers
  const response = NextResponse.next();
  response.headers.set('x-user-id', user.id);
  return response;
}
```

### Firebase Auth
```typescript
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';

const auth = getAuth();

// Client login
const userCredential = await signInWithEmailAndPassword(auth, email, password);
const token = await userCredential.user.getIdToken();

// Server verification
import { auth as adminAuth } from 'firebase-admin/auth';

export async function verifyToken(token: string) {
  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    return decodedToken;
  } catch (error) {
    throw new Error('Invalid token');
  }
}
```

### Custom JWT (FastAPI)
```python
from jose import JWTError, jwt
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

async def get_current_user(token: str = Depends(oauth2_scheme)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
        token_data = TokenData(username=username)
    except JWTError:
        raise credentials_exception

    user = get_user(fake_users_db, username=token_data.username)
    if user is None:
        raise credentials_exception
    return user
```

## Worker/Job Queue Implementation

### Celery (Python)
```python
from celery import Celery

celery_app = Celery('tasks', broker='redis://localhost:6379')

@celery_app.task(bind=True, max_retries=3)
def generate_report(self, project_id: str):
    try:
        project = get_project(project_id)
        report_data = calculate_report_data(project)
        report_url = upload_to_storage(report_data)

        # Update command status
        update_command_status(self.request.id, 'completed', {'report_url': report_url})

        return {'report_url': report_url}
    except Exception as exc:
        self.retry(countdown=60 * (self.request.retries + 1))
```

### Bull (Node.js)
```typescript
import Bull from 'bull';
import Redis from 'ioredis';

const reportQueue = new Bull('report generation', {
  redis: { host: 'localhost', port: 6379 }
});

reportQueue.process('generate', async (job, done) => {
  const { projectId } = job.data;

  try {
    const project = await getProject(projectId);
    const reportData = await calculateReportData(project);
    const reportUrl = await uploadToStorage(reportData);

    // Update progress
    job.progress(100);

    // Complete job
    done(null, { reportUrl });
  } catch (error) {
    done(error);
  }
});

// Add job
const job = await reportQueue.add('generate', { projectId: '123' }, {
  attempts: 3,
  backoff: 'exponential'
});
```

### Hangfire (.NET)
```csharp
[AutomaticRetry(Attempts = 3)]
public class ReportService : IReportService
{
    public async Task<string> GenerateReportAsync(string projectId)
    {
        var project = await _projectRepository.GetByIdAsync(projectId);
        var reportData = await CalculateReportDataAsync(project);
        var reportUrl = await _storageService.UploadAsync(reportData);

        // Update command status
        await _commandService.UpdateStatusAsync(
            Context.BackgroundJob.Id,
            CommandStatus.Completed,
            new { reportUrl }
        );

        return reportUrl;
    }
}

// Schedule job
BackgroundJob.Enqueue<IReportService>(x => x.GenerateReportAsync(projectId));
```

## State Management Patterns

### React Context + Reducer
```typescript
interface AppState {
  user: User | null;
  projects: Project[];
  loading: boolean;
}

const AppContext = createContext<{
  state: AppState;
  dispatch: Dispatch<AppAction>;
}>({} as any);

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_PROJECTS':
      return { ...state, projects: action.payload };
    case 'ADD_PROJECT':
      return { ...state, projects: [...state.projects, action.payload] };
    default:
      return state;
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);
  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}
```

### Vue Pinia Store
```typescript
export const useProjectStore = defineStore('projects', () => {
  const projects = ref<Project[]>([]);
  const loading = ref(false);

  const fetchProjects = async () => {
    loading.value = true;
    try {
      const response = await api.get('/projects');
      projects.value = response.data;
    } finally {
      loading.value = false;
    }
  };

  const addProject = (project: Project) => {
    projects.value.push(project);
  };

  return {
    projects: readonly(projects),
    loading: readonly(loading),
    fetchProjects,
    addProject
  };
});
```

## Real-time Updates

### Supabase Realtime
```typescript
useEffect(() => {
  const subscription = supabase
    .channel('projects')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'projects'
    }, (payload) => {
      if (payload.eventType === 'INSERT') {
        setProjects(prev => [...prev, payload.new]);
      } else if (payload.eventType === 'UPDATE') {
        setProjects(prev =>
          prev.map(p => p.id === payload.new.id ? payload.new : p)
        );
      }
    })
    .subscribe();

  return () => subscription.unsubscribe();
}, []);
```

### Socket.io
```typescript
// Server
io.on('connection', (socket) => {
  socket.on('join-project', (projectId) => {
    socket.join(`project:${projectId}`);
  });

  socket.on('project-update', (data) => {
    socket.to(`project:${data.projectId}`).emit('project-updated', data);
  });
});

// Client
const socket = io();

useEffect(() => {
  socket.emit('join-project', projectId);

  socket.on('project-updated', (data) => {
    setProject(data.project);
  });

  return () => socket.off('project-updated');
}, [projectId]);
```

### Server-Sent Events
```python
# FastAPI SSE
from fastapi.responses import StreamingResponse

@app.get("/events/{project_id}")
async def stream_events(project_id: str, current_user: User = Depends(get_current_user)):
    async def event_generator():
        async for event in event_stream.subscribe(f"project:{project_id}"):
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/plain")
```

```typescript
// Client consumption
useEffect(() => {
  const eventSource = new EventSource(`/api/events/${projectId}`);

  eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    handleRealtimeUpdate(data);
  };

  return () => eventSource.close();
}, [projectId]);
```

## Testing Strategies

### Jest + React Testing Library
```typescript
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectsList } from './ProjectsList';

test('creates new project', async () => {
  const mockCreate = jest.fn();
  render(<ProjectsList onCreateProject={mockCreate} />);

  await userEvent.click(screen.getByRole('button', { name: /create project/i }));
  await userEvent.type(screen.getByLabelText(/name/i), 'New Project');
  await userEvent.click(screen.getByRole('button', { name: /save/i }));

  await waitFor(() => {
    expect(mockCreate).toHaveBeenCalledWith({ name: 'New Project' });
  });
});
```

### FastAPI TestClient
```python
from fastapi.testclient import TestClient
import pytest

@pytest.fixture
def client():
    return TestClient(app)

def test_create_project(client, auth_headers):
    response = client.post(
        "/projects",
        json={"name": "Test Project"},
        headers=auth_headers
    )
    assert response.status_code == 201
    assert response.json()["name"] == "Test Project"

def test_list_projects_requires_auth(client):
    response = client.get("/projects")
    assert response.status_code == 401
```

### Django Test Case
```python
from django.test import TestCase, Client
from django.contrib.auth import get_user_model

class ProjectViewTest(TestCase):
    def setUp(self):
        self.client = Client()
        self.user = get_user_model().objects.create_user(
            username='testuser',
            password='testpass123'
        )
        self.client.login(username='testuser', password='testpass123')

    def test_create_project(self):
        response = self.client.post('/projects/', {
            'name': 'Test Project',
            'description': 'Test description'
        })
        self.assertEqual(response.status_code, 201)
        self.assertTrue(Project.objects.filter(name='Test Project').exists())
```

## Deployment Configurations

### Docker Compose Development
```yaml
version: '3.8'
services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: myapp
      POSTGRES_USER: user
      POSTGRES_PASSWORD: password
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  web:
    build: .
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://user:password@postgres:5432/myapp
      REDIS_URL: redis://redis:6379
    depends_on:
      - postgres
      - redis
    volumes:
      - .:/app
      - /app/node_modules

volumes:
  postgres_data:
```

### Kubernetes Production
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-app
spec:
  replicas: 3
  selector:
    matchLabels:
      app: web-app
  template:
    metadata:
      labels:
        app: web-app
    spec:
      containers:
      - name: web
        image: myapp:latest
        ports:
        - containerPort: 3000
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: app-secrets
              key: database-url
        - name: REDIS_URL
          valueFrom:
            configMapKeyRef:
              name: app-config
              key: redis-url
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
```

This framework guide provides concrete implementation patterns while maintaining the core architectural principles defined in the main specification files.