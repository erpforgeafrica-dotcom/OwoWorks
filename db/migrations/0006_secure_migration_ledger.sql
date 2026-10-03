-- =====================================================================
-- 0006_secure_migration_ledger.sql
--
-- WHY THIS FILE EXISTS
--
-- The migration ledger (`owoworks_schema_migrations`) records which database
-- files have been applied. It was created inside the `public` schema. Supabase
-- exposes `public` through its public API, and a table created there inherits
-- the project's default grants, so the ledger ended up reachable by anyone:
--
--     anon[s i u d]   <- a signed-out visitor could read, insert, update
--                        and delete the deployment record
--
-- A live probe of the real project confirmed this. No personal data is in the
-- ledger, so it is not a data breach; it is a tamper surface, and it is closed
-- here.
--
-- The fix is deliberately done in place rather than by moving the table to a
-- private schema. The migration runner writes the ledger row for this very file
-- immediately after the SQL below runs; if the table were dropped and recreated
-- under a new name mid-run, that write would fail. Hardening in place keeps the
-- runner working. Relocating the ledger to a schema that is not exposed over the
-- API is left as a separate, non-urgent improvement (see docs/LEAD-CAPTURE.md).
-- =====================================================================

-- 1. Take away every privilege from the public-facing roles.
revoke all on table public.owoworks_schema_migrations from anon;
revoke all on table public.owoworks_schema_migrations from authenticated;
revoke all on table public.owoworks_schema_migrations from public;

-- 2. Turn on row level security as a second lock. With no policy defined, no
--    ordinary role can touch a row even if a grant is re-added by mistake.
--    The table owner (the migration runner) and service_role bypass RLS, so
--    migrations and administration continue to work.
alter table public.owoworks_schema_migrations enable row level security;

-- 3. Administration keeps access.
grant all on table public.owoworks_schema_migrations to service_role;

comment on table public.owoworks_schema_migrations is
  'Deployment record. Not reachable through the public API by design.';