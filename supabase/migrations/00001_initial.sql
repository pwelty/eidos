-- Initial schema for an Eidos app.
-- Run via: supabase db push
--
-- GOTCHA (Supabase .single()): Never use .single() where multiple rows may match.
-- Always chain .order("created_at", { ascending: true }).limit(1).single() instead.
-- .single() returns an error (not first row) when multiple rows match.
--
-- GOTCHA (RLS joins): PostgREST joins fail silently when RLS blocks the join target.
-- The query returns rows with null joined fields — no error. Test every join under RLS.
--
-- GOTCHA (CHECK constraints): Adding new enum values requires a migration to
-- drop and recreate the constraint. Consider foreign key tables for extensible enums.

-- ─── User profiles ────────────────────────────────────────────────────────────

CREATE TABLE public.user_profiles (
  id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text,
  avatar_url  text,
  admin       boolean NOT NULL DEFAULT false,  -- guard all admin routes with this
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.user_profiles (id, name)
  VALUES (NEW.id, NEW.raw_user_meta_data ->> 'full_name');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- ─── Workspaces ───────────────────────────────────────────────────────────────

CREATE TABLE public.workspaces (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.memberships (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role         text NOT NULL DEFAULT 'member',  -- 'owner' | 'admin' | 'member'
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, user_id)
);

-- Helper function for RLS policies — returns workspaces the user belongs to.
CREATE OR REPLACE FUNCTION public.user_workspace_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT workspace_id FROM public.memberships WHERE user_id = auth.uid()
$$;

-- ─── Commands (engine job queue) ──────────────────────────────────────────────

CREATE TABLE public.commands (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  command_type   text NOT NULL,
  payload        jsonb NOT NULL DEFAULT '{}',
  status         text NOT NULL DEFAULT 'pending',  -- pending | processing | done | failed
  error          text,
  idempotency_key text UNIQUE,  -- use time-window keys, NOT uuid4()
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_commands_pending ON public.commands(status, created_at)
  WHERE status = 'pending';

-- ─── API keys ─────────────────────────────────────────────────────────────────

CREATE TABLE public.api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name         text NOT NULL,
  key_hash     text NOT NULL UNIQUE,  -- SHA-256 of the plaintext key; shown once at creation
  scopes       text[] NOT NULL DEFAULT '{}',
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ─── RLS policies ─────────────────────────────────────────────────────────────

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

-- user_profiles: users can read/update their own profile
CREATE POLICY "Users can read own profile" ON public.user_profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.user_profiles
  FOR UPDATE USING (auth.uid() = id);

-- Co-member profile visibility (needed for workspace member lists).
-- GOTCHA: without this, PostgREST joins to user_profiles return null silently.
CREATE POLICY "Workspace co-members can read profiles" ON public.user_profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.memberships m1
      JOIN public.memberships m2 ON m1.workspace_id = m2.workspace_id
      WHERE m1.user_id = auth.uid()
        AND m2.user_id = user_profiles.id
    )
  );

-- workspaces: members can read their workspaces
CREATE POLICY "Workspace members can read workspace" ON public.workspaces
  FOR SELECT USING (id IN (SELECT public.user_workspace_ids()));

CREATE POLICY "Workspace members can update workspace" ON public.workspaces
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.memberships
      WHERE workspace_id = workspaces.id
        AND user_id = auth.uid()
        AND role IN ('owner', 'admin')
    )
  );

-- memberships: users can see their own membership + co-members
CREATE POLICY "Users can read own memberships" ON public.memberships
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Workspace members can read co-memberships" ON public.memberships
  FOR SELECT USING (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE POLICY "Workspace owners can manage memberships" ON public.memberships
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.workspace_id = memberships.workspace_id
        AND m.user_id = auth.uid()
        AND m.role = 'owner'
    )
  );

-- commands: workspace members can read their workspace's commands
CREATE POLICY "Workspace members can read commands" ON public.commands
  FOR SELECT USING (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE POLICY "Workspace members can insert commands" ON public.commands
  FOR INSERT WITH CHECK (workspace_id IN (SELECT public.user_workspace_ids()));

-- api_keys: workspace admins can manage keys
CREATE POLICY "Workspace admins can manage api keys" ON public.api_keys
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.memberships
      WHERE workspace_id = api_keys.workspace_id
        AND user_id = auth.uid()
        AND role IN ('owner', 'admin')
    )
  );
