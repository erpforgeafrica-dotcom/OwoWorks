-- =====================================================================
-- 0000_auth_stub.sql  (LOCAL VERIFICATION ONLY - NOT A PRODUCTION MIGRATION)
--
-- Supabase provisions auth.users. For local verification under PGlite we
-- create an equivalent stub so RLS policies referencing auth.users() resolve.
-- Never run this against a real Supabase project.
-- =====================================================================

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text unique,
  created_at timestamptz not null default now()
);

create or replace function auth.uid() returns uuid
language sql stable as $$ select null::uuid $$;

-- `create role if not exists` is not valid PostgreSQL; wrap in DO blocks.
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;