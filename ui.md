# Eidos - UI Specification

> Frontend patterns for database-driven web applications with consistent CRUD, navigation, and theming.

## 1) UI Philosophy

- **Database-driven:** UI components and pages are generated from database schema
- **Consistency:** Every entity follows the same page patterns
- **Linkability:** Everything that can be linked, should be linked
- **Progressive disclosure:** Show summary in lists, full details on dedicated pages
- **Responsive & accessible:** Mobile-first, keyboard navigable, screen reader friendly

## 2) Technology Approach

- **Framework:** Modern component-based frontend framework
- **Styling:** Utility-first CSS framework or component styling system
- **Components:** Design system with consistent, reusable components
- **State:** Minimal client state, server-centric data management
- **Data fetching:** Server-side rendering with optimistic updates
- **Realtime:** WebSocket or server-sent events for live updates

> See [Framework Guide](./FRAMEWORKS.md) for specific technology implementations.

## 3) App Shell & Navigation

### 3.1) Layout Structure
```
┌─────────────────────────────────────────────┐
│ Logo        App Name          User │ Logout │ <- Header
├────────┬────────────────────┬───────────────┤
│        │                    │               │
│  Nav   │   Main Content     │   Context     │
│ Tables │                    │   Sidebar     │
│        │                    │   (dynamic)   │
│        │                    │               │
├────────┴────────────────────┴───────────────┤
│ © Footer | Links | Terms | Privacy | v1.0.1 │ <- Footer
└─────────────────────────────────────────────┘
```

### 3.2) Components

**Top Bar:**
- Left: App logo (links to dashboard)
- Center: Optional global search
- Right: User menu (Profile, Settings, Tools), Logout button

**Left Sidebar:**
- Navigation tree of all entities
- Grouped by domain/category
- Each item links to entity's Index page
- Collapsible sections
- Current page highlighted
- Icons for each entity type

**Right Sidebar:**
- Contextual content that changes per page:
  - On Detail: Audit history, related actions
  - On Index: Saved filters, bulk action queue
  - On Edit: Help text, validation rules
- Toggleable (hidden by default on mobile)

**Footer:**
- Copyright and organization name
- Version/build information
- Key links: Documentation, API Docs, Status Page
- Legal: Terms of Service, Privacy Policy

### 3.3) Responsive Behavior
- **Desktop (>1024px):** Full layout with both sidebars
- **Tablet (768-1024px):** Left sidebar collapses to icons
- **Mobile (<768px):**
  - Left sidebar becomes hamburger menu
  - Right sidebar stacks below content
  - Top bar simplifies to logo + menu + user

> **GOTCHA: Keep mobile nav in sync with desktop nav.** When desktop and mobile use separate nav structures (common when building a hamburger menu separately from a sidebar), new routes added to the desktop nav are routinely missed in the mobile nav. Users on mobile have no way to discover those features.
>
> Prevention: export the nav groups as a named constant shared by both nav components. Add a test that asserts every known route appears in the constant — it catches drift at commit time.
>
> ```typescript
> export const NAV_GROUPS = [
>   { label: "Sources", items: [
>     { href: "/feeds", label: "RSS" },
>     { href: "/websites", label: "Websites" },  // easy to miss when added later
>   ]},
> ]
> // Both desktop sidebar and mobile hamburger import NAV_GROUPS
> ```

## 4) Page Types

### 4.1) Index/List Page (`/[entities]`)

**Purpose:** Browse and manage all records of an entity type

**URL Pattern:** `/projects`, `/users`, `/invoices`

**Components:**
```
[Search Bar]                           [Filters] [Create New]

[Bulk Actions ▼] [Selected: 3]        [Columns ▼] [Export ▼]

┌─────┬──────────┬──────────┬──────────┬──────────┬─────┐
│ □   │ Name ↕   │ Status   │ Owner    │ Updated  │ ••• │
├─────┼──────────┼──────────┼──────────┼──────────┼─────┤
│ ☑   │ Project A│ Active   │ John     │ 2h ago   │ ⋮   │
│ ☑   │ Project B│ Draft    │ Jane     │ 1d ago   │ ⋮   │
│ ☑   │ Project C│ Complete │ Bob      │ 3d ago   │ ⋮   │
└─────┴──────────┴──────────┴──────────┴──────────┴─────┘

[← Previous] Page 1 of 10 [Next →]     Showing 1-25 of 247
```

**Features:**
- **Search:** Full-text search across searchable fields
- **Filters:** 
  - Quick filters (status, date range)
  - Advanced filter builder
  - Save filter combinations as views
- **Sorting:** Click column headers to sort
- **Pagination:** 
  - Page size selector (10/25/50/100)
  - Jump to page
  - Showing X-Y of Z indicator
- **Bulk Actions:**
  - Select all/none/visible
  - Bulk delete/archive
  - Bulk status update
  - Bulk export
- **Row Actions:** (••• menu or inline icons)
  - View
  - Edit  
  - Duplicate
  - Archive/Delete
- **Column Management:**
  - Show/hide columns
  - Reorder columns
  - Persist preferences per user

**Empty State:**
- Friendly message explaining what this entity is
- Large "Create First [Entity]" button
- Optional tutorial or example

### 4.2) Detail/View Page (`/[entities]/[id]`)

**Purpose:** View complete information about a single record

**URL Pattern:** `/projects/123`, `/users/abc-def`

**Layout:**
```
[← Back to Projects]                    [Edit] [Archive] [⋮]

# Project Alpha
[Status: Active]

## Details
┌────────────────────────────────────────────┐
│ Title:        Project Alpha                │
│ Description:  Building the next big thing  │
│ Owner:        John Doe                     │
│ Start Date:   Jan 1, 2024                  │
│ End Date:     Dec 31, 2024                 │
│ Budget:       $50,000                      │
└────────────────────────────────────────────┘

## Tasks (12)                        [Add Task]
┌──────────────┬──────────┬──────────┬──────┐
│ Task Name    │ Status   │ Assignee │      │
├──────────────┼──────────┼──────────┼──────┤
│ Design UI    │ Done     │ Jane     │ View │
│ Build API    │ In Prog  │ Bob      │ View │
└──────────────┴──────────┴──────────┴──────┘
[View All Tasks →]

## Team Members (4)                  [Add Member]
[Jane] [Bob] [Alice] [Charlie]

## Activity
Created by John Doe on Jan 1, 2024
Last updated by Jane Smith 2 hours ago
```

**Components:**
- **Header:**
  - Back navigation
  - Entity title/name
  - Status badge
  - Action buttons (Edit, Duplicate, Archive, More)
- **Fields Section:**
  - All entity fields in read-only format
  - Grouped logically
  - Empty fields show "Not set" or "-"
- **Related Entities:** One box per relationship
  - Title with count badge
  - List/grid/tag view depending on relationship type
  - Quick actions (Add, Remove, View All)
  - Pagination for long lists
  - Empty state with Add CTA
- **Metadata Footer:**
  - Created by/at
  - Updated by/at  
  - Version (if versioned)

### 4.3) Edit Page (`/[entities]/[id]/edit` or `/[entities]/new`)

**Purpose:** Create or modify a record

**URL Patterns:** 
- Edit: `/projects/123/edit`
- Create: `/projects/new`

**Layout:**
```
# Edit Project                          [Save] [Cancel]

* Required fields

## Basic Information
Title *        [_________________________]
Description    [_________________________]
               [_________________________]
Status *       [Active ▼                ]
Owner *        [Select user...           ]

## Schedule
Start Date     [📅 01/01/2024            ]
End Date       [📅 12/31/2024            ]

## Budget
Amount         [💵 50,000                ]
Currency       [USD ▼                    ]

[Save] [Save & Continue] [Cancel]
```

**Features:**
- **Field Types:** Appropriate input for each data type
- **Validation:**
  - Required field indicators (*)
  - Inline error messages
  - Real-time validation where appropriate
  - Success checkmarks for valid fields
- **Dirty State Tracking:**
  - Track unsaved changes
  - Navigation warning: "You have unsaved changes"
  - Visual indicators for changed fields
- **Autosave (optional):**
  - Save draft every 30 seconds
  - "Last saved at" indicator
  - Restore draft on return
- **Help Text:** Tooltips or inline help for complex fields
- **Actions:**
  - Save - saves and redirects to Detail
  - Save & Continue - saves without redirect
  - Save & New - saves and opens new Create form
  - Cancel - returns to previous page (with dirty check)
  - Reset - reverts to last saved state

### 4.4) Dashboard (`/` or `/dashboard`)

**Purpose:** Overview and quick access to key information

**Components:**
- **Stats Cards:** Key metrics with trends
- **Recent Activity:** Timeline of recent changes
- **Quick Actions:** Shortcuts to common tasks
- **Charts/Graphs:** Visual representations of data
- **Upcoming Items:** Deadlines, tasks, events
- **Favorites:** Pinned entities for quick access

**Customization:**
- Widget layout saved per user
- Add/remove widgets
- Resize and reorder
- Filter widgets by date range or other criteria

## 5) UI Components

### 5.1) Field Display Components

| Data Type | View Mode | Edit Mode |
|-----------|-----------|-----------|
| String | Text | `<input type="text">` |
| Text | Paragraph/Markdown | `<textarea>` |
| Integer | Number | `<input type="number">` |
| Decimal | Formatted number | Number input with precision |
| Boolean | Checkbox/Toggle | Checkbox/Toggle |
| Date | Formatted date | Date picker |
| DateTime | Formatted datetime | DateTime picker |
| Enum | Badge/Pill | Select/Radio group |
| JSON | Syntax highlighted | JSON editor |
| File | Download link | File upload |
| Image | Thumbnail | Image upload with preview |
| URL | Clickable link | URL input |
| Email | Mailto link | Email input |
| Phone | Tel link | Phone input |
| Currency | Formatted with symbol | Currency input |
| Percentage | XX% | Percentage input |
| Rating | Stars/Hearts | Star selector |
| Tags | Tag pills | Tag input |
| Color | Color swatch | Color picker |
| UUID | Monospace with copy | Read-only with copy |
| Foreign Key | Link to related | Searchable select |
| Many-to-Many | Tag list/cards | Multi-select/Transfer |

### 5.2) Relationship Components

**One-to-Many Box:**
```
┌─────────────────────────────────────┐
│ Tasks (12)              [Add Task] │
├─────────────────────────────────────┤
│ ✓ Design the UI         Jane  View │
│ ○ Build the API         Bob   View │
│ ○ Write tests           -     View │
├─────────────────────────────────────┤
│            [View All →]             │
└─────────────────────────────────────┘
```

**Many-to-Many Tags:**
```
┌─────────────────────────────────────┐
│ Categories                    [+]   │
├─────────────────────────────────────┤
│ [Frontend ×] [React ×] [UI/UX ×]   │
└─────────────────────────────────────┘
```

**Belongs-To Link:**
```
Organization: [Acme Corp →]
```

### 5.3) Common UI Patterns

**Loading States:**
- Skeleton screens for initial load
- Inline spinners for actions
- Progress bars for long operations
- Optimistic updates where appropriate

**Error States:**
- Inline field errors
- Toast notifications for actions
- Error boundaries for crashes
- Friendly error messages with actions

**Empty States:**
- Explain what the entity/relationship is
- Provide clear CTA to add first item
- Optional illustration or icon
- Link to documentation if complex

**Confirmation Dialogs:**
- Destructive actions require confirmation
- Show what will be affected
- Allow typing entity name for dangerous operations
- Provide undo when possible

## 6) Theming System

### 6.1) Theme Configuration

**Location:** `/settings/theme`

**Customizable Elements:**
- **Brand:**
  - Logo upload
  - App name
  - Favicon
- **Colors:**
  - Primary (brand color)
  - Secondary
  - Accent
  - Success/Warning/Error/Info
  - Surface colors
  - Text colors
- **Typography:**
  - Font families (heading, body, mono)
  - Font sizes scale
  - Line heights
  - Font weights
- **Layout:**
  - Border radius scale
  - Spacing scale
  - Shadow scale
  - Breakpoints
- **Components:**
  - Button styles
  - Form styles
  - Card styles
  - Table styles

### 6.2) Theme Preview

Live preview showing all components:
- Headings (h1-h6)
- Paragraphs and lists
- Links and buttons
- Form elements
- Tables
- Cards and boxes
- Alerts and badges
- Code blocks

### 6.3) Dark Mode

- Respect system preference by default
- Allow user override
- Separate color tokens for light/dark
- Smooth transition between modes
- Persist preference

## 7) Accessibility

### 7.1) Requirements
- WCAG 2.1 Level AA compliance
- Keyboard navigation for all interactive elements
- Screen reader announcements for state changes
- Focus indicators visible and clear
- Color contrast ratios meet standards
- Reduced motion option respected

### 7.2) Implementation
- Semantic HTML structure
- ARIA labels and descriptions
- Skip navigation links
- Focus management in SPAs
- Error identification and description
- Form labels and fieldsets
- Alt text for images
- Captions for videos

## 8) Performance

### 8.1) Targets
- First Contentful Paint: < 1.5s
- Time to Interactive: < 3.5s
- Cumulative Layout Shift: < 0.1
- Interaction to Next Paint: < 200ms

### 8.2) Techniques
- Server-side rendering with hydration
- Code splitting per route and component
- Lazy loading for below-fold content
- Image optimization and responsive images
- Font subsetting and preloading
- HTTP/2 and compression
- CDN and edge caching for static assets
- Database query optimization
- Virtual scrolling for long lists
- Debounced search and filters
- Optimistic UI updates
- Progressive enhancement

## 9) UI State Management

### 9.1) Server State
- Source of truth is always the database
- Use server-side rendering for initial page load
- Server-side mutations with proper invalidation
- Revalidate cached data after mutations

### 9.2) Client State
- Minimal, only for UI concerns:
  - Open/closed modals
  - Selected items for bulk actions
  - Temporary form state
  - UI preferences (sidebar collapsed)
- Use framework's built-in state management
- Persist preferences to localStorage

### 9.3) Realtime Updates
- Subscribe to realtime events for:
  - Other users' changes
  - Async job status updates
  - Notifications
- Merge updates optimistically
- Show indicators for new/updated content

## 10) Testing

### 10.1) Component Tests
- Test individual components in isolation
- Verify props, events, and rendering
- Test accessibility with jest-axe
- Snapshot tests for stability

### 10.2) Integration Tests
- Test page components with mocked data
- Verify data flow and state management
- Test error and loading states
- Test form validation and submission

### 10.3) E2E Tests
- Critical user journeys:
  - Create → View → Edit → Delete
  - Search and filter
  - Bulk operations
  - Relationship management
- Visual regression tests
- Cross-browser testing
- Mobile responsive testing

## 11) Next.js App Router gotchas

### 11.1) useSearchParams requires Suspense

Any component using `useSearchParams()` fails static generation unless wrapped in a `<Suspense>` boundary. The error is cryptic.

```tsx
export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <PageInner />
    </Suspense>
  )
}
function PageInner() {
  const searchParams = useSearchParams()
  // ...
}
```

Wrap all auth pages (reset-password, email confirmation, OAuth callback) in Suspense by default.

### 11.2) Layout + page duplicate queries — use React.cache()

In App Router, layout and page render independently. Both often need user/auth data, producing duplicate DB queries. Use React's `cache()` to deduplicate within the same render pass:

```tsx
import { cache } from "react"

export const getUser = cache(async () => {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
})
// Layout and page both call getUser() — React deduplicates automatically
```

### 11.3) Parallelize server component queries with Promise.all

Server components execute `await` sequentially by default — each query is a waterfall. Independent queries must be parallelized explicitly:

```tsx
// Before: ~600ms (sequential)
const user = await getUser()
const membership = await getMembership(user.id)
const profile = await getProfile(user.id)

// After: ~200ms (parallel)
const user = await getUser()
const [membership, profile] = await Promise.all([
  getMembership(user.id),
  getProfile(user.id),
])
```

### 11.4) Middleware matcher: be specific

Overly broad middleware matchers cause infinite redirect loops and unexpected behavior on static routes:

```tsx
// Dangerous — catches everything including _next/static, favicons, API routes
matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]

// Better — enumerate only the paths that need auth protection
matcher: ["/dashboard", "/settings/:path*", "/admin/:path*"]
```

### 11.5) Skeleton loading colors

Don't use your accent color for skeleton loading states. Accent colors flash visibly during loading transitions and look like a bug.

```tsx
// Looks broken — accent color flashes
<Skeleton className="bg-accent" />

// Correct
<Skeleton className="bg-muted" />
```

### 11.6) Don't use client context for server data

Fetching server data via React context + useEffect adds an extra round-trip, causes a loading flash on every page, and usually benefits nothing. Use Server Components and `React.cache()` instead.

```tsx
// WRONG: WorkspaceProvider fetches workspace data client-side via useEffect
// Every page has an extra DB query + loading flash

// RIGHT: Server components fetch what they need, cached via React.cache()
const workspace = await getWorkspace(workspaceId)
```

### 11.7) Hydration mismatches from Math.random()

`Math.random()` generates different values on server vs client, causing React hydration mismatches. Use `useId()` for any component that needs a stable unique ID:

```tsx
"use client"
import { useId } from "react"

function Component() {
  const id = `input-${useId()}`  // Stable, SSR-safe
}
```

### 11.8) Inline forms over separate pages for integrations

Don't create a separate `/integrations/new` page. Expand credential forms inline on the list page when the user clicks "Connect." This avoids redirect chains and keeps context visible.

Pattern: config array defines fields per integration type. Cards expand/collapse with `useState`. Connected integrations show status badges, "Test" and "Disconnect" actions.

### 11.9) Standard page title convention

Sentence case, em dash, app name:

```tsx
export const metadata = { title: "Settings — Appname" }
export const metadata = { title: "Admin — Appname" }
// Not: "SETTINGS — APPNAME" or "settings | appname"
```

### 11.10) Impression tracking for content feeds

Tracking which items a user has actually read (vs. scrolled past) is deceptively tricky. Three common failure modes:

1. **Firing on scroll-into-view** counts items the user never stopped at
2. **Firing on click** misses items read inline without navigation
3. **Double-counting** when the component remounts (tab switch, route revalidation)

**Recommended pattern:** Use `IntersectionObserver` with a minimum dwell time (500–1000ms), deduplicated per session via a `Set`:

```tsx
"use client"
import { useEffect, useRef } from "react"

const seen = new Set<string>()  // Module-level — persists across remounts

export function ArticleCard({ article }: { article: Article }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current || seen.has(article.id)) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        // Require 500ms dwell before recording
        const timer = setTimeout(async () => {
          if (seen.has(article.id)) return
          seen.add(article.id)
          await recordImpression(article.id)
        }, 500)
        return () => clearTimeout(timer)
      },
      { threshold: 0.5 }  // At least 50% visible
    )

    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [article.id])

  return <div ref={ref}>...</div>
}
```

The `seen` Set is module-level (not component state), so it survives remounts. Server action `recordImpression` should be idempotent — use `INSERT ... ON CONFLICT DO NOTHING`.

> **GOTCHA:** Don't use component-local state for the seen set — it resets on every remount, causing double-counts when the feed re-renders after revalidation.

## 12) Checklist

### Per Entity
- [ ] Index page with search, filter, sort, pagination
- [ ] Detail page with all fields and relationships
- [ ] Edit page with validation and dirty state
- [ ] Create page with smart defaults
- [ ] Proper loading and error states
- [ ] Responsive layout works on mobile
- [ ] Keyboard navigation works
- [ ] Screen reader tested

### Global
- [ ] App shell with navigation
- [ ] Theme configuration page
- [ ] Dark mode support
- [ ] Dashboard with widgets
- [ ] User menu and settings
- [ ] Footer with links
- [ ] 404 and error pages
- [ ] Accessibility audit passed
- [ ] Performance budgets met
- [ ] Browser testing complete