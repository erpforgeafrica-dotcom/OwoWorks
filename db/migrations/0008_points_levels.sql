-- =====================================================================
-- 0008_points_levels.sql — points, levels, referral gating, redemptions
--
-- WHY THIS FILE EXISTS
-- The business is point-based: anybody with a phone joins, is given tasks,
-- earns points, and redeems points for mobile data (and cash at higher
-- levels). Referral activity earns points too, and from a level onward a
-- minimum number of qualified referrals is REQUIRED to advance.
--
-- 0001_core.sql models money (reward_minor, ledger_entries, payouts) and has
-- no notion of points, levels or referral counts. The audit flagged that as
-- B-005 ("Level system PROPOSED only — no XP/points schema"). This migration
-- closes it.
--
-- DESIGN LAWS (same discipline as 0001_core.sql)
-- 1. Points are money-like: append-only, immutable, idempotent. Corrections
--    happen through signed reversing entries, never through UPDATE.
-- 2. Balance is DERIVED (a sum), never a stored column that can drift.
-- 3. Every business number lives in `settings`, not in code. Points per task,
--    the referral award, the cash-unlock level and the referral gate are all
--    owner-tunable without a migration. Seeds below are DEFAULTS PENDING OWNER
--    CONFIRMATION — they are deliberately not hardcoded anywhere.
-- 4. Anti-MLM is structural: a referral can award points, never cash, and a
--    referral only counts once the referee completes a real task.
-- =====================================================================

-- ---------------------------------------------------------------------
-- enums
-- ---------------------------------------------------------------------
create type point_kind as enum (
  'task_reward',    -- completed + approved task
  'referral_reward',-- referee qualified (completed first task)
  'redemption',     -- points spent on data/cash
  'adjustment',     -- admin correction (positive or negative)
  'reversal'        -- signed mirror of a prior entry
);

create type redemption_kind as enum ('data','cash');
create type redemption_state as enum (
  'requested','processing','fulfilled','failed','refunded','reversed');

-- ---------------------------------------------------------------------
-- 1. the levels ladder
--
-- Seeded as a real table (not settings) because it is relational: a level has
-- a points threshold AND a referral requirement, and the gate logic joins
-- against it. Points thresholds are seeded placeholders — the owner sets the
-- real ladder. Referral requirements are 0 for the first levels because the
-- business rule is that referrals only start gating AFTER those levels.
-- ---------------------------------------------------------------------
create table levels (
  level            integer primary key check (level >= 1),
  label            text not null,
  -- lifetime points needed to hold this level
  points_required  integer not null check (points_required >= 0),
  -- qualified referrals needed to hold this level. 0 = not gated.
  min_referrals    integer not null default 0 check (min_referrals >= 0),
  -- whether cash redemption is permitted while holding this level
  cash_unlocked    boolean not null default false,
  note             text,
  updated_at       timestamptz not null default now()
);

insert into levels (level, label, points_required, min_referrals, cash_unlocked, note) values
  (1, 'Starter',       0,     0, false, 'Anyone with a phone. Data rewards available.'),
  (2, 'Worker',      500,     0, false, 'Points only gate progression here.'),
  (3, 'Regular',   1500,     0, false, 'Last level before the referral gate begins.'),
  (4, 'Established',4000,     3, true,  'Referrals now required to advance. Cash unlocks.'),
  (5, 'Senior',    9000,     8, true,  'Placeholder thresholds — owner to confirm.'),
  (6, 'Lead',     18000,    15, true,  'Placeholder thresholds — owner to confirm.');

-- ---------------------------------------------------------------------
-- 2. points ledger (append-only, immutable, idempotent)
-- ---------------------------------------------------------------------
create table point_entries (
  id               uuid primary key default gen_random_uuid(),
  profile_id       uuid not null references profiles(id) on delete cascade,
  task_id          uuid references tasks(id) on delete cascade,
  kind             point_kind not null,
  -- signed: rewards positive, redemptions negative, reversals mirror.
  points           integer not null,
  -- reversal bookkeeping: which entry this one corrects.
  reverses         uuid references point_entries(id),
  idempotency_key  text not null unique,
  memo             text,
  created_at       timestamptz not null default now(),
  -- a zero-point entry is meaningless and would pollute the audit trail
  constraint point_entries_nonzero check (points <> 0),
  -- points can only ever be EARNED as a positive amount. A negative task or
  -- referral reward would be a silent clawback dressed as income, so the only
  -- negative kinds allowed are 'redemption' and 'reversal'.
  constraint point_entries_rewards_positive
    check (kind not in ('task_reward','referral_reward') or points > 0),
  -- a reversal must mirror a real entry of a reversible kind
  constraint point_entries_reversal_shape
    check ((kind = 'reversal') = (reverses is not null)),
  -- a task reward must name its task, so the ledger can be audited back to
  -- the work that earned it. Referral rewards have no task by definition —
  -- they are attributable via the referrals row instead.
  constraint point_entries_task_reward_attributable
    check (kind <> 'task_reward' or task_id is not null)
);

create index point_entries_profile_idx on point_entries(profile_id, created_at desc);
create index point_entries_task_idx    on point_entries(task_id) where task_id is not null;

-- immutability: points are never edited, only reversed.
create or replace function forbid_point_entry_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'point_entries is append-only (use a reversal entry): %', tg_op
    using errcode = 'restrict_violation';
end;
$$;

create trigger point_entries_no_update
  before update on point_entries
  for each row execute function forbid_point_entry_mutation();

create trigger point_entries_no_delete
  before delete on point_entries
  for each row execute function forbid_point_entry_mutation();

-- ---------------------------------------------------------------------
-- 3. referrals between real accounts
--
-- leads.referred_by_code captures the anonymous invite. This table is the
-- settled relationship between two authed profiles, and it is what the level
-- gate counts. A referral only QUALIFIES when the referee completes a task,
-- so invite farming cannot inflate anyone's level.
-- ---------------------------------------------------------------------
create table referrals (
  id            uuid primary key default gen_random_uuid(),
  referrer_id   uuid not null references profiles(id) on delete cascade,
  referee_id    uuid not null unique references profiles(id) on delete cascade,
  created_at    timestamptz not null default now(),
  -- set when the referee completes their first approved task
  qualified_at  timestamptz,
  points_awarded integer not null default 0 check (points_awarded >= 0),
  constraint referrals_no_self check (referrer_id <> referee_id),
  -- qualification implies an award was recorded
  constraint referrals_qualified_has_points
    check (qualified_at is null or points_awarded > 0)
);

create index referrals_referrer_idx on referrals(referrer_id);
create index referrals_qualified_idx on referrals(referrer_id) where qualified_at is not null;

-- ---------------------------------------------------------------------
-- 4. redemptions: points -> data or cash
--
-- points_spent is debited immediately (a point entry of kind 'redemption' is
-- written by redeem_points()). value_minor records what the provider actually
-- delivered, so the naira value of a bundle is auditable against points.
-- ---------------------------------------------------------------------
create table redemptions (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null references profiles(id) on delete cascade,
  kind            redemption_kind not null,
  points_spent    integer not null check (points_spent > 0),
  -- naira value delivered, in kobo. 0 until a provider confirms.
  value_minor     bigint not null default 0 check (value_minor >= 0),
  network         text check (network in ('MTN','GLO','AIRTEL','9MOBILE')),
  state           redemption_state not null default 'requested',
  provider        text,
  provider_ref    text,
  failure_reason  text,
  idempotency_key text not null unique,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- cash must never be marked fulfilled without a naira value
  constraint redemptions_cash_has_value
    check (kind <> 'cash' or state <> 'fulfilled' or value_minor > 0),
  -- a delivered redemption must name its provider reference
  constraint redemptions_fulfilled_has_ref
    check (state <> 'fulfilled' or provider_ref is not null)
);

create index redemptions_profile_idx on redemptions(profile_id, created_at desc);
create index redemptions_pending_idx  on redemptions(state) where state in ('requested','processing');

-- ---------------------------------------------------------------------
-- 5. task point value
--
-- Per-task so an admin can price each task. Defaults to NULL, meaning "use
-- the settings default". A task cannot be worth negative points.
-- ---------------------------------------------------------------------
alter table tasks add column points_awarded integer
  check (points_awarded is null or points_awarded > 0);

-- ---------------------------------------------------------------------
-- 6. settings — every business number, owner-tunable
--
-- SEEDS ARE DEFAULTS PENDING OWNER CONFIRMATION. They live here precisely so
-- the owner can change them from the admin UI without a code change or a new
-- migration. Do not hardcode these values anywhere in application code.
-- ---------------------------------------------------------------------
insert into settings(key, value, value_type, label, group_name) values
  ('points.default_per_task',  '{"v":100}'::jsonb,   'int',
   'Default points for a task when the task sets none','points'),
  ('points.per_referral',      '{"v":150}'::jsonb,   'int',
   'Points awarded to a referrer when their referee completes a first task','points'),
  ('points.referral_qualifies_on_first_task', '{"v":true}'::jsonb, 'bool',
   'A referral only counts after the referee completes a first task','points'),
  ('levels.referral_gate_from','{"v":4}'::jsonb,      'int',
   'First level that requires qualified referrals to advance','levels'),
  ('levels.cash_unlock_from',  '{"v":4}'::jsonb,      'int',
   'First level at which cash redemption is permitted','levels'),
  ('redemption.data_min_points', '{"v":500}'::jsonb, 'int',
   'Minimum points to redeem a mobile data bundle','redemption'),
  ('redemption.cash_min_points', '{"v":10000}'::jsonb,'int',
   'Minimum points to request a cash redemption','redemption')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 7. computed views / functions
-- ---------------------------------------------------------------------

-- Lifetime points = sum of every entry. Reversals are signed, so a reversed
-- reward nets out without deleting history.
create or replace function points_balance(p_profile uuid)
returns integer language sql stable as $$
  select coalesce(sum(points), 0)::integer
    from point_entries where profile_id = p_profile;
$$;

-- Qualified referrals only: an unqualified invite has not earned anything.
create or replace function qualified_referral_count(p_profile uuid)
returns integer language sql stable as $$
  select count(*)::integer from referrals
   where referrer_id = p_profile and qualified_at is not null;
$$;

-- Current level = the highest level whose BOTH gates are satisfied.
-- Points are cumulative lifetime points; referrals are qualified only.
create or replace function level_for(p_profile uuid)
returns integer language sql stable as $$
  select coalesce((
    select l.level from levels l
     where l.points_required <= points_balance(p_profile)
       and (l.min_referrals = 0
            or l.min_referrals <= qualified_referral_count(p_profile))
     order by l.level desc
     limit 1
  ), 1);
$$;

-- What is missing to reach the next level. Returns NULL at the top level.
create or replace function next_level_requirements(p_profile uuid)
returns table (level integer, points_required integer, points_held integer,
               points_needed integer, min_referrals integer,
               referrals_held integer, referrals_needed integer,
               cash_unlocked boolean)
language sql stable as $$
  with cur as (select level_for(p_profile) as lvl),
       nxt as (select l.* from levels l, cur
                where l.level > cur.lvl order by l.level asc limit 1)
  select nxt.level, nxt.points_required, points_balance(p_profile),
         greatest(nxt.points_required - points_balance(p_profile), 0),
         nxt.min_referrals, qualified_referral_count(p_profile),
         greatest(nxt.min_referrals - qualified_referral_count(p_profile), 0),
         nxt.cash_unlocked
    from nxt;
$$;

-- Is this profile allowed to request a cash redemption right now?
create or replace function cash_unlocked(p_profile uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from levels l
     where l.cash_unlocked
       and l.level <= level_for(p_profile)
  );
$$;

-- ---------------------------------------------------------------------
-- 8. the write path: award task points
--
-- Idempotent on (task_id, profile). Awards the task's points_awarded, or the
-- settings default when the task does not set one. Refuses a second award for
-- the same task.
-- ---------------------------------------------------------------------
create or replace function award_task_points(p_task uuid)
returns integer language plpgsql as $$
declare
  v_profile uuid;
  v_points  integer;
  v_level   integer;
begin
  select t.assigned_to,
         coalesce(t.points_awarded,
                  (select (s.value->>'v')::int from settings s
                    where s.key = 'points.default_per_task'))
    into v_profile, v_points
    from tasks t where t.id = p_task;

  if v_profile is null then
    raise exception 'task % is not assigned', p_task using errcode = 'foreign_key_violation';
  end if;
  if v_points is null or v_points <= 0 then
    raise exception 'task % has no point value', p_task using errcode = 'check_violation';
  end if;

  insert into point_entries (profile_id, task_id, kind, points, idempotency_key, memo)
  values (v_profile, p_task, 'task_reward', v_points,
          'task:' || p_task::text, 'Task reward')
  on conflict (idempotency_key) do nothing;

  if not found then
    return 0;  -- already awarded; idempotent no-op
  end if;

  -- level is never stored on the entry: it is derived by level_for() from the
  -- balance, and denormalising it would mean mutating an append-only ledger.
  -- The level at award time is recorded on the outbox event instead.
  v_level := level_for(v_profile);

  insert into outbox (topic, payload) values
    ('points.awarded', jsonb_build_object(
       'profile_id', v_profile, 'task_id', p_task,
       'points', v_points, 'level', v_level));

  return v_points;
end;
$$;

-- ---------------------------------------------------------------------
-- 9. the write path: qualify a referral
--
-- Called when a referee completes their first approved task. Idempotent.
-- Awards points.points_per_referral to the referrer and marks the referral
-- qualified. This is the ONLY place referral points are created, and it pays
-- points only — never cash.
-- ---------------------------------------------------------------------
create or replace function qualify_referral(p_referee uuid)
returns integer language plpgsql as $$
declare
  v_referrer uuid;
  v_points   integer;
  v_ref_id   uuid;
  v_level    integer;
begin
  select id, referrer_id into v_ref_id, v_referrer
    from referrals where referee_id = p_referee;

  if v_ref_id is null then
    return 0;                              -- nobody invited them
  end if;

  if exists (select 1 from referrals where id = v_ref_id and qualified_at is not null) then
    return 0;                              -- already qualified
  end if;

  v_points := (select (value->>'v')::int from settings where key = 'points.per_referral');

  update referrals
     set qualified_at = now(), points_awarded = v_points
   where id = v_ref_id;

  insert into point_entries (profile_id, task_id, kind, points, idempotency_key, memo)
  values (v_referrer, null, 'referral_reward', v_points,
          'referral:' || v_ref_id::text, 'Referral qualified')
  on conflict (idempotency_key) do nothing;

  v_level := level_for(v_referrer);

  insert into outbox (topic, payload) values
    ('referral.qualified', jsonb_build_object(
       'referrer_id', v_referrer, 'referee_id', p_referee,
       'points', v_points, 'level', v_level));

  return v_points;
end;
$$;

-- ---------------------------------------------------------------------
-- 10. the write path: redeem points
--
-- Debits points immediately and records the redemption as 'requested'. The
-- worker fulfils it with the provider and moves it to 'fulfilled'. Cash is
-- refused unless the level unlocks it. Idempotent on idempotency_key.
-- ---------------------------------------------------------------------
create or replace function redeem_points(
  p_profile   uuid,
  p_kind      redemption_kind,
  p_points    integer,
  p_idem      text,
  p_network   text default null
) returns uuid language plpgsql as $$
declare
  v_balance integer;
  v_min     integer;
  v_red     uuid;
begin
  if p_points is null or p_points <= 0 then
    raise exception 'redemption must spend a positive number of points'
      using errcode = 'check_violation';
  end if;

  if p_kind = 'cash' and not cash_unlocked(p_profile) then
    raise exception 'cash redemption is not unlocked at your level'
      using errcode = 'check_violation';
  end if;

  v_min := (select (value->>'v')::int from settings
             where key = case p_kind when 'cash' then 'redemption.cash_min_points'
                                    else 'redemption.data_min_points' end);
  if p_points < v_min then
    raise exception 'minimum redemption is % points', v_min
      using errcode = 'check_violation';
  end if;

  v_balance := points_balance(p_profile);
  if p_points > v_balance then
    raise exception 'insufficient points: have %, need %', v_balance, p_points
      using errcode = 'check_violation';
  end if;

  if p_kind = 'data' and p_network is null then
    raise exception 'a data redemption needs a network'
      using errcode = 'check_violation';
  end if;

  insert into redemptions (profile_id, kind, points_spent, network, idempotency_key)
  values (p_profile, p_kind, p_points, p_network, p_idem)
  on conflict (idempotency_key) do nothing;

  if not found then
    select id into v_red from redemptions where idempotency_key = p_idem;
    return v_red;  -- idempotent replay
  end if;

  insert into point_entries (profile_id, task_id, kind, points, idempotency_key, memo)
  values (p_profile, null, 'redemption', -p_points, p_idem,
          'Redeemed for ' || p_kind::text)
  on conflict (idempotency_key) do nothing;

  select id into v_red from redemptions where idempotency_key = p_idem;

  insert into outbox (topic, payload) values
    ('redemption.requested', jsonb_build_object(
       'redemption_id', v_red, 'profile_id', p_profile,
       'kind', p_kind, 'points', p_points, 'network', p_network));

  return v_red;
end;
$$;

-- ---------------------------------------------------------------------
-- 11. reversal: the only sanctioned way to correct points
-- ---------------------------------------------------------------------
create or replace function reverse_point_entry(p_entry uuid, p_reason text)
returns integer language plpgsql as $$
declare
  v_points integer;
  v_profile uuid;
  v_key    text;
begin
  select points, profile_id into v_points, v_profile
    from point_entries where id = p_entry and kind <> 'reversal';

  if v_points is null then
    raise exception 'entry % is not a reversible point entry', p_entry
      using errcode = 'no_data_found';
  end if;

  v_key := 'reversal:' || p_entry::text;

  insert into point_entries (profile_id, task_id, kind, points, reverses, idempotency_key, memo)
  values (v_profile, (select task_id from point_entries where id = p_entry),
          'reversal', -v_points, p_entry, v_key, coalesce(p_reason, 'reversal'))
  on conflict (idempotency_key) do nothing;

  return v_points;
end;
$$;

-- ---------------------------------------------------------------------
-- 12. RLS — new tables are private by default
-- ---------------------------------------------------------------------
alter table levels      enable row level security;
alter table point_entries enable row level security;
alter table referrals   enable row level security;
alter table redemptions enable row level security;

-- levels is reference data every signed-in user may read.
create policy levels_read_authenticated on levels
  for select to authenticated using (true);

-- a promoter sees only their own points
create policy point_entries_own_read on point_entries
  for select to authenticated using (auth.uid() = profile_id);

-- a promoter sees referrals they made
create policy referrals_own_read on referrals
  for select to authenticated using (auth.uid() = referrer_id);

-- a promoter sees only their own redemptions
create policy redemptions_own_read on redemptions
  for select to authenticated using (auth.uid() = profile_id);

-- Writes are service_role only. The API layer owns mutation; the database
-- refuses direct client writes to the money-adjacent tables.
revoke insert, update, delete on point_entries from anon, authenticated;
revoke insert, update, delete on referrals   from anon, authenticated;
revoke insert, update, delete on redemptions from anon, authenticated;
revoke insert, update, delete on levels      from anon, authenticated;

-- the computed functions are safe to expose: they read only the caller's data
grant execute on function points_balance(uuid)             to anon, authenticated;
grant execute on function qualified_referral_count(uuid)   to anon, authenticated;
grant execute on function level_for(uuid)                  to anon, authenticated;
grant execute on function next_level_requirements(uuid)    to anon, authenticated;
grant execute on function cash_unlocked(uuid)              to anon, authenticated;

-- mutation functions are service_role only
revoke execute on function award_task_points(uuid)  from anon, authenticated;
revoke execute on function qualify_referral(uuid)   from anon, authenticated;
revoke execute on function redeem_points(uuid, redemption_kind, integer, text, text)
  from anon, authenticated;
revoke execute on function reverse_point_entry(uuid, text) from anon, authenticated;