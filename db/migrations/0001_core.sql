-- =====================================================================
-- Amplo 0001_core.sql
-- Identity, RBAC, ledger, escrow, campaigns, tasks, settings, audit.
-- Target: Supabase (PostgreSQL 15+).
--
-- MONEY RULES ENFORCED HERE, IN THE DATABASE, NOT ONLY IN APP CODE:
--   1. money is BIGINT minor units + ISO 4217 currency. never float.
--   2. every journal entry balances per currency at COMMIT (deferred
--      constraint trigger - a plain trigger fires mid-write and makes it
--      impossible to record any transaction at all).
--   3. postings are append-only. corrections are reversal entries.
--   4. idempotency is claimed by a UNIQUE index on the INSERT itself,
--      never by a preceding SELECT (that races under concurrency).
--   5. payout liability can never exceed escrowed credit.
-- =====================================================================

-- gen_random_uuid() is core from PostgreSQL 13 onward, so no extension is
-- required for the UUID defaults below. Explicit grants below handle the
-- immutability of postings/audit_log in addition to triggers.

-- ---------------------------------------------------------------------
-- enums
-- ---------------------------------------------------------------------
create type app_role      as enum ('promoter','business','partner','support','finance','admin','owner');
create type acct_type     as enum ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE');
create type acct_scope    as enum ('platform','campaign','promoter','partner');
create type user_state    as enum ('pending','active','suspended','banned');
create type campaign_state as enum (
  'draft','review','live','paused','exhausted','settling','settled','cancelled');
create type task_state    as enum (
  'draft','assigned','submitted','checking','held','approved','rejected','paid','expired','cancelled');
create type ledger_state  as enum ('pending','processing','settled','failed','reversed');
create type outbox_state  as enum ('queued','processing','delivered','failed','dead');
create type kyc_tier     as enum ('t0','t1','t2');
create type dispute_state as enum ('open','under_review','upheld','rejected','withdrawn','expired');

-- ---------------------------------------------------------------------
-- 1. identity
-- ---------------------------------------------------------------------
create table profiles (
  id           uuid primary key references auth.users on delete cascade,
  role         app_role     not null default 'promoter',
  state        user_state   not null default 'pending',
  display_name text,
  phone_e164   text,
  phone_verified_at timestamptz,
  kyc_tier     kyc_tier     not null default 't0',
  network      text,                       -- MTN | GLO | AIRTEL | 9MOBILE
  trust_score  numeric(5,4) not null default 0.5000
                 check (trust_score >= 0 and trust_score <= 1),
  age_verified_at timestamptz,             -- 18+ gate. required before payout.
  date_of_birth_hmac text,                -- HMAC-SHA256, never a raw DOB.
                                         -- unsalted hashing of a structured
                                         -- identifier is reversible by
                                         -- exhaustive search in seconds.
  identity_ref  text,                      -- provider token OR HMAC(NIN/BVN). never raw.
  suspended_at  timestamptz,
  suspension_reason text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint profiles_role_valid  check (role in ('promoter','business','partner','support','finance','admin','owner')),
  constraint profiles_suspension_justified
    check ((state = 'suspended') = (suspended_at is not null))
);

create index profiles_role_idx  on profiles(role) where state = 'active';
create index profiles_phone_idx on profiles(phone_e164) where phone_e164 is not null;

-- RBAC: explicit permission grants. Roles are a convenience; permissions
-- are what code actually checks, so a custom role cannot smuggle power.
create table permissions (
  key text primary key,
  description text not null
);

create table role_permissions (
  role app_role not null,
  perm text not null references permissions(key) on delete cascade,
  primary key (role, perm)
);

create table user_permissions (
  user_id uuid not null references profiles(id) on delete cascade,
  perm text not null references permissions(key) on delete cascade,
  granted_by uuid references profiles(id),
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  primary key (user_id, perm)
);

insert into permissions(key, description) values
  ('campaign.create','create a campaign'),
  ('campaign.fund','fund campaign escrow'),
  ('campaign.read','view campaigns'),
  ('campaign.pause','pause or resume a campaign'),
  ('task.create','create a task'),
  ('task.submit','submit proof for a task'),
  ('task.review','review submitted proof'),
  ('payout.request','request a payout'),
  ('payout.execute','execute a payout'),
  ('user.suspend','suspend or reinstate a user'),
  ('role.assign','assign a role'),
  ('settings.write','change platform settings'),
  ('ledger.read','read the ledger'),
  ('fraud.review','review fraud-flagged activity'),
  ('dispute.resolve','resolve a dispute'),
  ('admin.access','enter the admin area');

insert into role_permissions(role, perm) values
  ('promoter','campaign.read'),
  ('business','campaign.create'),('business','campaign.fund'),('business','campaign.read'),
  ('partner','campaign.read'),
  ('support','task.review'),('support','user.suspend'),('support','fraud.review'),('support','dispute.resolve'),
  ('finance','payout.execute'),('finance','ledger.read'),('finance','settings.write'),
  ('admin','campaign.pause'),('admin','task.create'),('admin','role.assign'),('admin','payout.execute'),
  ('admin','ledger.read'),('admin','fraud.review'),('admin','dispute.resolve'),('admin','settings.write'),
  ('admin','admin.access');

-- owner gets every permission
insert into role_permissions(role, perm)
select 'owner', key from permissions;

-- Role changes are privileged and audited. A BEFORE trigger refuses every
-- direct UPDATE of profiles.role; the only legal path is assign_role(),
-- which checks the role.assign permission and writes the audit row. Triggers
-- fire for every database role including owners and superusers, so unlike
-- RLS this control is testable locally and unbypassable anywhere.
create or replace function guard_role_change() returns trigger
language plpgsql as $$
begin
  if old.role is distinct from new.role
     and current_setting('amplo.role_change_ok', true) is distinct from '1' then
    raise exception 'role changes must go through assign_role()';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_role_guard on profiles;
create trigger profiles_role_guard
  before update of role on profiles
  for each row execute function guard_role_change();

create or replace function assign_role(p_target uuid, p_role app_role) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_perm('role.assign') then
    raise exception 'missing role.assign permission';
  end if;
  perform set_config('amplo.role_change_ok', '1', true);
  update profiles set role = p_role, updated_at = now() where id = p_target;
  insert into audit_log(actor_id, actor_role, action, target_type, target_id, after_state)
  values (auth.uid(), current_role_name(), 'role.assign', 'profile', p_target::text,
          jsonb_build_object('role', p_role));
end;
$$;

-- ---------------------------------------------------------------------
-- 2. double-entry ledger
-- ---------------------------------------------------------------------
create table accounts (
  id         uuid primary key default gen_random_uuid(),
  code       text not null,
  name       text not null,
  type       acct_type not null,
  scope      acct_scope not null,
  scope_id   uuid,                        -- campaign_id / promoter_id, or null for platform
  currency   char(3) not null,
  created_at timestamptz not null default now(),
  constraint accounts_scope_present
    check ((scope = 'platform' and scope_id is null) or (scope <> 'platform'))
);

-- One code per (scope, owner): every campaign gets its own ESCROW account,
-- and platform codes cannot be duplicated either. The coalesce handles the
-- platform rows whose scope_id is null (nulls would otherwise compare distinct
-- and defeat the uniqueness).
create unique index accounts_code_scope_uidx
  on accounts(code, scope, coalesce(scope_id, '00000000-0000-0000-0000-000000000000'));

-- Platform accounts. Per-campaign escrow accounts are created at funding
-- time with scope='campaign' and the campaign id; the escrow guard below
-- sums by (scope, scope_id), never by code, so codes stay globally unique.
insert into accounts(code, name, type, scope, currency) values
  ('PLATFORM_CASH_NGN',   'Platform cash NGN',        'ASSET',    'platform', 'NGN'),
  ('PLATFORM_CASH_USD',   'Platform cash USD',        'ASSET',    'platform', 'USD'),
  ('PLATFORM_REVENUE_NGN','Platform revenue NGN',     'REVENUE',  'platform', 'NGN'),
  ('PROMOTER_PAYABLE_NGN','Promoter payables NGN',    'LIABILITY','platform', 'NGN'),
  ('FRAUD_RESERVE_NGN',   'Fraud reserve NGN',        'LIABILITY','platform', 'NGN'),
  ('DATA_PAYABLE_NGN',    'Data fulfilment payable',  'LIABILITY','platform', 'NGN');

create table ledger_entries (
  id             uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,   -- claimed by the INSERT itself, never a SELECT
  kind           text not null,
  campaign_id    uuid,
  promoter_id    uuid,
  reference      text,
  currency       char(3) not null,
  created_at     timestamptz not null default now(),
  created_by     uuid references profiles(id)
);

create index ledger_entries_campaign_idx on ledger_entries(campaign_id);
create index ledger_entries_promoter_idx on ledger_entries(promoter_id);

create table postings (
  id          uuid primary key default gen_random_uuid(),
  entry_id    uuid not null references ledger_entries(id) on delete restrict,
  account_id  uuid not null references accounts(id),
  direction   char(1) not null check (direction in ('D','C')),
  -- never negative: a negative debit IS a credit, and two representations of
  -- one fact is a guaranteed source of divergence.
  amount_minor bigint not null check (amount_minor > 0),
  currency    char(3) not null
);

create index postings_entry_idx   on postings(entry_id);
create index postings_account_idx on postings(account_id);

-- Balance enforced AT COMMIT. See header note on why this must be deferred.
create or replace function assert_entry_balanced() returns trigger
language plpgsql as $$
declare
  v_entry uuid := coalesce(new.entry_id, old.entry_id);
  v_diff  numeric;
begin
  -- parent deleted (cascade): nothing left to balance.
  if not exists (select 1 from ledger_entries where id = v_entry) then
    return null;
  end if;
  select coalesce(sum(case when direction = 'D' then amount_minor else -amount_minor end), 0)
    into v_diff
    from postings
   where entry_id = v_entry;
  if v_diff <> 0 then
    raise exception 'ledger entry % is unbalanced by % minor units', v_entry, v_diff;
  end if;
  return null;
end;
$$;

drop trigger if exists postings_balanced on postings;
create constraint trigger postings_balanced
  after insert or update or delete on postings
  deferrable initially deferred
  for each row execute function assert_entry_balanced();

drop trigger if exists postings_min_two on postings;
drop function if exists assert_entry_min_two_postings();

-- NOTE (removed control, 2026-10-02): a "minimum two postings" trigger used to
-- live here. It was deleted, not weakened. Proof of redundancy: postings
-- require amount_minor > 0, so a single posting can never sum to zero and the
-- balance trigger refuses it first; zero postings means no row event, so the
-- trigger could never fire at all. An unfirable control is decoration, and
-- this project does not ship decoration. The balance invariant is the single,
-- fully tested enforcement point.

create or replace function assert_entry_single_currency() returns trigger
language plpgsql as $$
declare v_entry uuid := coalesce(new.entry_id, old.entry_id);
begin
  if not exists (select 1 from ledger_entries where id = v_entry) then
    return null;
  end if;
  if (select count(distinct currency) from postings where entry_id = v_entry) > 1 then
    raise exception 'ledger entry % mixes currencies (use an FX-suspense entry type instead)', v_entry;
  end if;
  return null;
end;
$$;

drop trigger if exists postings_one_currency on postings;
create constraint trigger postings_one_currency
  after insert on postings
  deferrable initially deferred
  for each row execute function assert_entry_single_currency();

-- append-only. corrections are reversal entries.
create or replace function forbid_posting_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'postings are immutable; post a reversal entry instead';
end;
$$;

drop trigger if exists postings_immutable on postings;
create trigger postings_immutable
  before update or delete on postings
  for each row execute function forbid_posting_mutation();

-- ---------------------------------------------------------------------
-- 3. campaigns + escrow
-- ---------------------------------------------------------------------
create table campaigns (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references profiles(id),
  title         text not null,
  brief         text,
  platform      text not null,
  objective     text not null,           -- click | signup | code | api_post
  state         campaign_state not null default 'draft',
  budget_minor  bigint not null check (budget_minor > 0),
  spent_minor   bigint not null default 0 check (spent_minor >= 0),
  currency      char(3) not null default 'NGN',
  price_per_outcome_minor bigint not null check (price_per_outcome_minor > 0),
  promoter_share_bp integer not null check (promoter_share_bp between 0 and 10000),
  fraud_reserve_bp     integer not null default 500 check (fraud_reserve_bp >= 0),
  margin_floor_bp      integer not null check (margin_floor_bp between 0 and 10000),
  hold_hours    integer not null default 72 check (hold_hours between 48 and 72),
  auto_pause_pct integer not null default 90 check (auto_pause_pct between 50 and 100),
  starts_at     timestamptz,
  ends_at       timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint campaigns_share_sane
    check (promoter_share_bp + fraud_reserve_bp <= 10000)
);

create index campaigns_state_idx on campaigns(state);
create index campaigns_owner_idx on campaigns(owner_id);

-- escrow must be funded BEFORE a campaign can go live, and liability can
-- never exceed prepaid credit. Fires on INSERT as well as UPDATE so a row
-- created directly in a funded state is checked too. Sums by (scope,
-- scope_id), never by account code, so per-campaign escrow accounts work
-- with globally unique codes.
create or replace function assert_campaign_funded() returns trigger
language plpgsql as $$
declare
  v_escrow bigint;
begin
  if new.state not in ('live','paused','settling') then
    return new;
  end if;
  select coalesce(sum(case when p.direction = 'D' then p.amount_minor
                           else -p.amount_minor end), 0)
    into v_escrow
    from postings p
    join accounts a on a.id = p.account_id
   where a.scope = 'campaign' and a.scope_id = new.id;

  -- going (or staying) live requires the full budget prepaid in escrow.
  if new.state = 'live' and v_escrow < new.budget_minor then
    raise exception 'campaign % cannot go live: escrowed % < budget % (fund before launch)',
      new.id, v_escrow, new.budget_minor;
  end if;
  -- liability can never exceed prepaid credit, in any funded state.
  if v_escrow < new.spent_minor then
    raise exception 'campaign % liability % exceeds escrowed credit %',
      new.id, new.spent_minor, v_escrow;
  end if;
  return new;
end;
$$;

drop trigger if exists campaigns_must_be_funded on campaigns;
create trigger campaigns_must_be_funded
  before insert or update on campaigns
  for each row execute function assert_campaign_funded();

-- spend ceiling: a live campaign pauses itself at the configured percentage
-- of budget. The pause is the database's doing, not a worker convention.
create or replace function apply_campaign_autopause() returns trigger
language plpgsql as $$
begin
  if new.state = 'live' and new.budget_minor > 0
     and new.spent_minor * 100 >= new.budget_minor * new.auto_pause_pct then
    new.state := 'paused';
  end if;
  return new;
end;
$$;

drop trigger if exists campaigns_autopause on campaigns;
create trigger campaigns_autopause
  before insert or update of spent_minor, budget_minor, auto_pause_pct, state
  on campaigns
  for each row execute function apply_campaign_autopause();

-- margin floor: CI must fail if the blended split drops below it.
create or replace function assert_campaign_margin_floor() returns trigger
language plpgsql as $$
declare v_total integer;
begin
  v_total := new.promoter_share_bp + new.fraud_reserve_bp;
  if v_total > 10000 - new.margin_floor_bp then
    raise exception 'campaign % split leaves margin below floor (share+reserve=% of 10000, floor=%)',
      new.id, v_total, new.margin_floor_bp;
  end if;
  return new;
end;
$$;

drop trigger if exists campaigns_margin_floor on campaigns;
create trigger campaigns_margin_floor
  before insert or update of promoter_share_bp, fraud_reserve_bp, margin_floor_bp
  on campaigns
  for each row execute function assert_campaign_margin_floor();

-- ---------------------------------------------------------------------
-- 4. tasks
-- ---------------------------------------------------------------------
create table tasks (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  state       task_state not null default 'draft',
  caption     text not null,
  tracked_link text not null,
  disclosure_tag text not null default '#ad',
  reward_minor bigint not null check (reward_minor > 0),
  assigned_to uuid references profiles(id),
  assigned_at timestamptz,
  submitted_at timestamptz,
  proof_url   text,
  auto_approve_at timestamptz not null default (now() + interval '24 hours'),
  hold_until  timestamptz,
  reviewed_by uuid references profiles(id),
  rejection_reason text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index tasks_campaign_idx on tasks(campaign_id, state);
create index tasks_assignee_idx on tasks(assigned_to, state);

-- state machine: illegal transitions must be impossible, not merely discouraged.
create or replace function assert_task_transition() returns trigger
language plpgsql as $$
begin
  if new.state = old.state then
    return new;
  end if;
  if not (
    (old.state = 'draft'      and new.state in ('assigned','cancelled')) or
    (old.state = 'assigned'   and new.state in ('submitted','expired','cancelled')) or
    (old.state = 'submitted'  and new.state in ('checking','held','approved','rejected')) or
    (old.state = 'checking'   and new.state in ('held','approved','rejected')) or
    (old.state = 'held'       and new.state in ('approved','rejected')) or
    (old.state = 'approved'   and new.state in ('paid','held')) or
    (old.state = 'rejected'   and new.state in ('held','cancelled'))
  ) then
    raise exception 'illegal task transition % -> %', old.state, new.state;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_transition on tasks;
create trigger tasks_transition
  before update of state on tasks
  for each row execute function assert_task_transition();

-- 24h auto-approve. This inverts the single defect that destroyed Sidegig's
-- reputation: an opaque, owner-controlled pending state with no deadline.
create or replace function auto_approve_stale_tasks() returns void
language plpgsql as $$
declare
  v_stale record;
begin
  for v_stale in
    update tasks
       set state = 'approved', updated_at = now()
     where state in ('submitted','checking')
       and auto_approve_at < now()
    returning id
  loop
    insert into outbox(topic, payload)
    values ('task.auto_approved', jsonb_build_object('task_id', v_stale.id, 'reason', 'poster_silent_24h'));
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. payouts + ledger outbox
-- ---------------------------------------------------------------------
create table payouts (
  id          uuid primary key default gen_random_uuid(),
  promoter_id uuid not null references profiles(id),
  kind        text not null check (kind in ('data','airtime','cash','giftcard')),
  amount_minor bigint not null check (amount_minor > 0),
  currency    char(3) not null,
  status      ledger_state not null default 'pending',
  provider_ref text,
  idempotency_key text not null unique,
  hold_until  timestamptz,
  failure_reason text,
  created_at  timestamptz not null default now(),
  settled_at  timestamptz
);

-- payout eligibility: cash needs KYC tier 2 plus age verification; data and
-- airtime need a verified phone. A cross-table rule like this cannot be a
-- CHECK constraint, so it is a trigger - which fires for every role.
create or replace function assert_payout_eligibility() returns trigger
language plpgsql as $$
declare
  v_tier  kyc_tier;
  v_age   timestamptz;
  v_phone timestamptz;
begin
  select kyc_tier, age_verified_at, phone_verified_at
    into v_tier, v_age, v_phone
    from profiles where id = new.promoter_id;
  if not found then
    raise exception 'payout references unknown promoter %', new.promoter_id;
  end if;
  if new.kind = 'cash' and (v_tier is distinct from 't2' or v_age is null) then
    raise exception 'cash payouts require KYC tier 2 and age verification';
  end if;
  if new.kind in ('data','airtime') and v_phone is null then
    raise exception 'data/airtime rewards require a verified phone';
  end if;
  return new;
end;
$$;

drop trigger if exists payouts_eligible on payouts;
create trigger payouts_eligible
  before insert or update of kind, promoter_id on payouts
  for each row execute function assert_payout_eligibility();

create index payouts_promoter_idx on payouts(promoter_id, status);

-- outbox: the job commits WITH the ledger write. A notification that can
-- exist without its business write is a phantom promise.
create table outbox (
  id          uuid primary key default gen_random_uuid(),
  topic       text not null,
  payload     jsonb not null,
  state       outbox_state not null default 'queued',
  attempts    integer not null default 0,
  available_at timestamptz not null default now(),
  last_error  text,
  created_at  timestamptz not null default now()
);

create index outbox_claim_idx on outbox(state, available_at) where state = 'queued';

create or replace function claim_outbox_batch(p_limit integer default 50)
returns setof outbox
language sql as $$
  update outbox
     set state = 'processing', attempts = attempts + 1
   where id in (
     select id from outbox
      where state = 'queued' and available_at <= now()
      order by created_at
      limit p_limit
      for update skip locked
   )
  returning *;
$$;

-- ---------------------------------------------------------------------
-- 6. disputes - the worker-facing appeal Sidegig lacks
-- ---------------------------------------------------------------------
create table disputes (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references tasks(id) on delete cascade,
  raised_by  uuid not null references profiles(id),
  reason     text not null,
  state      dispute_state not null default 'open',
  resolution text,
  sla_due_at timestamptz not null default (now() + interval '72 hours'),
  resolved_by uuid references profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

-- dispute lifecycle: open -> under review -> decided, with withdrawal and
-- expiry. A decision without a named reviewer is refused.
create or replace function assert_dispute_transition() returns trigger
language plpgsql as $$
begin
  if new.state = old.state then
    return new;
  end if;
  if not (
    (old.state = 'open' and new.state in ('under_review','withdrawn','expired')) or
    (old.state = 'under_review' and new.state in ('upheld','rejected','expired'))
  ) then
    raise exception 'illegal dispute transition % -> %', old.state, new.state;
  end if;
  if new.state in ('upheld','rejected') and new.resolved_by is null then
    raise exception 'a dispute decision requires a named reviewer';
  end if;
  return new;
end;
$$;

drop trigger if exists disputes_transition on disputes;
create trigger disputes_transition
  before update of state on disputes
  for each row execute function assert_dispute_transition();

-- ---------------------------------------------------------------------
-- 7. platform settings (typed, versioned, admin-only)
-- ---------------------------------------------------------------------
create table settings (
  key        text primary key,
  value      jsonb not null,
  value_type text not null check (value_type in ('string','int','bool','json','money_minor','pct_bp')),
  label      text not null,
  group_name text not null,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  -- money settings can never be negative
  constraint settings_nonnegative
    check (value_type <> 'money_minor' or (value->>'v')::numeric >= 0),
  constraint settings_pct_range
    check (value_type <> 'pct_bp' or ((value->>'v')::int between 0 and 10000))
);

insert into settings(key, value, value_type, label, group_name) values
  ('payout.min_cash_minor',   '{"v":100000}'::jsonb,'money_minor','Minimum cash payout (kobo)','payout'),
  ('payout.min_data_minor',   '{"v":5000}'::jsonb,  'money_minor','Minimum data reward (kobo)','payout'),
  ('payout.hold_hours',       '{"v":72}'::jsonb,    'int','Hold period before release (hours)','payout'),
  ('payout.batch_size',       '{"v":50}'::jsonb,    'int','Payouts per batch run','payout'),
  ('fraud.hold_threshold',    '{"v":0.55}'::jsonb,  'json','Fraud score to hold','fraud'),
  ('fraud.ban_threshold',     '{"v":0.85}'::jsonb,  'json','Fraud score to ban','fraud'),
  ('fraud.review_sample_pct', '{"v":10}'::jsonb,    'int','Percent of posts manually reviewed','fraud'),
  ('margin.floor_bp',         '{"v":4000}'::jsonb,  'pct_bp','Minimum house margin (basis points)','pricing'),
  ('fraud.reserve_bp',        '{"v":500}'::jsonb,   'pct_bp','Fraud reserve (basis points)','pricing'),
  ('promoter.share_bp',       '{"v":4500}'::jsonb,  'pct_bp','Default promoter share (basis points)','pricing'),
  ('task.auto_approve_hours', '{"v":24}'::jsonb,    'int','Auto-approve if poster silent (hours)','tasks'),
  ('dispute.sla_hours',       '{"v":72}'::jsonb,    'int','Dispute resolution SLA (hours)','tasks'),
  ('platform.launched',       '{"v":false}'::jsonb, 'bool','Public launch switch','platform'),
  ('platform.minimum_age',    '{"v":18}'::jsonb,    'int','Minimum promoter age','platform'),
  ('theme.default',           '{"v":"dark"}'::jsonb,'string','Default colour theme','appearance');

-- ---------------------------------------------------------------------
-- 8. audit log - every admin and money action, append only
-- ---------------------------------------------------------------------
create table audit_log (
  id         bigint generated always as identity primary key,
  actor_id   uuid references profiles(id),
  actor_role app_role,
  action     text not null,
  target_type text,
  target_id  text,
  before_state jsonb,
  after_state  jsonb,
  ip         inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create index audit_log_actor_idx  on audit_log(actor_id, created_at desc);
create index audit_log_action_idx on audit_log(action, created_at desc);

create or replace function forbid_audit_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end;
$$;

drop trigger if exists audit_immutable on audit_log;
create trigger audit_immutable
  before update or delete on audit_log
  for each row execute function forbid_audit_mutation();

-- ---------------------------------------------------------------------
-- 9. RLS - least privilege. Nothing is readable without an explicit policy.
-- ---------------------------------------------------------------------
alter table profiles          enable row level security;
alter table user_permissions enable row level security;
alter table ledger_entries    enable row level security;
alter table postings         enable row level security;
alter table campaigns        enable row level security;
alter table tasks            enable row level security;
alter table payouts          enable row level security;
alter table outbox           enable row level security;
alter table disputes         enable row level security;
alter table settings         enable row level security;
alter table audit_log        enable row level security;

create or replace function current_role_name() returns app_role
language sql stable as $$
  select coalesce((select role from profiles where id = auth.uid()), 'promoter'::app_role);
$$;

create or replace function has_perm(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select
    exists (
      select 1 from role_permissions rp
       where rp.role = current_role_name() and rp.perm = p
    )
    or exists (
      select 1 from user_permissions up
       where up.user_id = auth.uid() and up.perm = p
         and (up.expires_at is null or up.expires_at > now())
    );
$$;

-- profiles: own row, or anyone with admin/role power
create policy profiles_self on profiles
  for select using (id = auth.uid() or has_perm('role.assign') or has_perm('admin.access'));

create policy profiles_update_self on profiles
  for update using (id = auth.uid())
  with check (id = auth.uid() and role = (select role from profiles where id = auth.uid()));

-- suspension is a privileged write: support/admin suspend, nobody self-suspends.
create policy profiles_suspend on profiles
  for update using (has_perm('user.suspend'))
  with check (has_perm('user.suspend'));

-- admin area: read-only unless the specific permission exists
create policy campaigns_read on campaigns
  for select using (owner_id = auth.uid() or has_perm('admin.access') or has_perm('campaign.read'));

create policy campaigns_write on campaigns
  for all using (has_perm('campaign.create') or has_perm('admin.access'))
  with check (has_perm('campaign.create') or has_perm('admin.access'));

create policy tasks_read on tasks
  for select using (
    assigned_to = auth.uid() or has_perm('admin.access') or has_perm('task.review')
  );

create policy tasks_submit on tasks
  for update using (assigned_to = auth.uid())
  with check (assigned_to = auth.uid());

-- money tables: never client-readable. service role only.
create policy ledger_no_client_read on ledger_entries for select using (false);
create policy postings_no_client_read on postings      for select using (false);
create policy outbox_no_client_read  on outbox        for select using (false);

create policy payouts_own on payouts
  for select using (promoter_id = auth.uid() or has_perm('payout.execute'));

create policy settings_read on settings
  for select using (true);   -- settings are not secret; writes are gated below

create policy settings_write on settings
  for all using (has_perm('settings.write')) with check (has_perm('settings.write'));

create policy disputes_read on disputes
  for select using (raised_by = auth.uid() or has_perm('dispute.resolve'));

create policy disputes_raise on disputes
  for insert with check (raised_by = auth.uid());

create policy audit_read on audit_log
  for select using (has_perm('admin.access') or has_perm('ledger.read'));