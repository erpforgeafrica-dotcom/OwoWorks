-- =====================================================================
-- 0003_access_control.sql
--
-- Locks down who may touch what, explicitly. Previous migrations created
-- the correct policies, but PostgreSQL grants EXECUTE on new functions to
-- PUBLIC by default, and Supabase grants table privileges broadly. This file
-- replaces those defaults with a deliberate, minimal list.
--
-- Plain-language summary:
--   * A visitor on the website may add ONE thing: their sign-up details.
--     They may not read the list, change a row, or delete anything.
--   * A signed-in member may read and edit only their own profile, and only
--     what their role allows.
--   * Nobody but the trusted server may change money records or the audit log.
--   * Only two read-only helpers (referral preview, queue position) are
--     callable by the website, and they return no personal data.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Strip the broad Supabase defaults from the application tables.
--    We re-grant what is genuinely needed in section 2.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','permissions','role_permissions','user_permissions',
    'accounts','ledger_entries','postings',
    'campaigns','tasks','payouts','outbox','disputes','settings','audit_log',
    'leads'
  ] loop
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Nothing in the public schema should be creatable or droppable by web roles.
revoke create on schema public from anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Grants that are actually required
-- ---------------------------------------------------------------------

-- 2a. Sign-ups. Anonymous visitors may insert, and ONLY insert.
grant insert on public.leads to anon;

-- 2b. Signed-in members manage their own profile row.
grant select, update on public.profiles to authenticated;

-- 2c. Signed-in members read the public catalogue (campaigns and their tasks)
--     and submit work on tasks. Writes are further restricted by row policies.
grant select on public.campaigns, public.tasks to authenticated;
grant update on public.tasks to authenticated;

-- 2d. Signed-in members read platform settings, read their own payouts,
--     and raise their own disputes.
grant select on public.settings, public.payouts, public.disputes to authenticated;
grant insert on public.disputes to authenticated;

-- 2e. The two read-only website helpers. Nothing else is callable by web roles.
grant execute on function public.preview_referral(text) to anon, authenticated;
grant execute on function public.lead_position(text)     to anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Functions that must NEVER be callable from a web request.
--    By default PostgreSQL grants EXECUTE to PUBLIC on every new function,
--    which would let a visitor call privileged helpers directly.
--    Trigger functions are excluded on purpose: they can only fire from a
--    table write, and revoking them would break the triggers themselves.
-- ---------------------------------------------------------------------
do $$
declare sig text;
begin
  foreach sig in array array[
    'public.assign_role(uuid, public.app_role)',
    'public.claim_outbox_batch(integer)',
    'public.auto_approve_stale_tasks()'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', sig);
  end loop;
end $$;

-- The server-side role keeps everything it needs.
grant execute on function public.assign_role(uuid, public.app_role) to service_role;
grant execute on function public.claim_outbox_batch(integer)      to service_role;
grant execute on function public.auto_approve_stale_tasks()      to service_role;

-- Read-only helpers used inside policies stay callable; they cannot write.
grant execute on function public.current_role_name() to anon, authenticated;
grant execute on function public.has_perm(text)       to anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Money and audit tables: server only.
--    RLS already hides rows from members; revoking privileges means the
--    tables are unreachable even if a policy is ever edited by mistake.
-- ---------------------------------------------------------------------
revoke all on public.accounts, public.ledger_entries, public.postings,
                public.outbox, public.audit_log,
                public.permissions, public.role_permissions, public.user_permissions
  from anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Indexes for the queries this application actually runs.
--    Without these the sign-up table slows down as the list grows.
--    (Codes and phone numbers already have indexes from their unique
--    constraints, so those are not repeated here.)
-- ---------------------------------------------------------------------

-- Queue position asks "how many people arrived before this one?".  Without
-- this index that question scans the whole table.
create index if not exists leads_created_at_idx on public.leads (created_at);

-- "Everyone who joined with my code" — the count shown on the success screen.
create index if not exists leads_invited_by_idx on public.leads (referred_by_code)
  where referred_by_code is not null;

-- Finding people who asked for a specific kind of work.
create index if not exists leads_lane_idx on public.leads (lane);

-- (The message queue is already indexed by its own claim migration, and the
-- codes and phone numbers are already indexed by their unique constraints,
-- so nothing else needs duplicating here.)

-- ---------------------------------------------------------------------
-- 6. Housekeeping: never keep a phone number longer than we must.
--    Verification status drives retention, so unverified rows are dropped
--    first. This runs from the database's own scheduler.
-- ---------------------------------------------------------------------
create or replace function public.prune_unverified_leads(p_keep_days integer default 30)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare removed bigint;
begin
  if p_keep_days < 7 then
    raise exception 'keep period must be at least 7 days';
  end if;
  delete from public.leads
   where verified_at is null
     and created_at < now() - make_interval(days => p_keep_days);
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke execute on function public.prune_unverified_leads(integer) from public, anon, authenticated;
grant execute on function public.prune_unverified_leads(integer) to service_role;

-- ---------------------------------------------------------------------
-- 7. A public health check.
--    The website uses it to confirm the database is reachable before it tells
--    a visitor their sign-up worked. It exposes no data at all.
-- ---------------------------------------------------------------------
create or replace function public.healthcheck()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'status',  'ok',
    'service', 'owoworks',
    'checked_at', now()
  );
$$;

grant execute on function public.healthcheck() to anon, authenticated;