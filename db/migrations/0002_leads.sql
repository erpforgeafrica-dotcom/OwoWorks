-- =====================================================================
-- 0002_leads.sql â€” pilot lead capture with referral growth engine.
--
-- Mechanics adopted from best-rated open source (see docs/LEAD-CAPTURE.md):
--   - Dub (dubinc/dub, 24K stars): referral attribution with reversal on
--     fraud; UTM capture; partner commission discipline (single-level, capped).
--   - Formbricks (formbricks/formbricks, 12.8K stars): conversion-optimized
--     capture, progressive profiling, privacy-first posture.
-- Patterns adopted, code original (both are AGPLv3 - ideas only, no copying).
--
-- ANTI-MLM RULE (non-negotiable, from the threat model): referrals count toward
-- queue priority and future bonuses ONLY on verified outcomes. There is NO cash
-- for signups - unlike competitors who pay per referral (the exact shape Nigeria's
-- SEC prosecutes: "monetary rewards for referrals"). A referral that never does
-- verified work is worth exactly zero naira.
-- =====================================================================

create table leads (
  id              uuid primary key default gen_random_uuid(),
  lane            text not null check (lane in ('promoter','business','partner')),
  full_name       text not null check (char_length(full_name) between 2 and 120),
  -- The visitor's phone number, stored in the ordinary Nigerian way
  -- (0803 000 0000 -> 08030000000). Named "phone", not "e164", because it is
  -- not stored in international format.
  phone           text not null unique check (phone ~ '^0\d{10}$'),
  network         text check (network in ('MTN','GLO','AIRTEL','9MOBILE')),
  platform_extra  text,
  note            text,
  city            text,
  referral_code   text not null unique,
  referred_by_code text references leads(referral_code) on delete set null,
  utm_source      text,
  utm_medium      text,
  utm_campaign   text,
  -- NDPA s.27: consent is a recorded fact with a timestamp, not a checkbox
  -- the user cannot see. The client must send the moment consent was given.
  consent_at      timestamptz not null,
  verified_at     timestamptz,          -- OTP confirmation (Termii), ships later
  status          text not null default 'new'
                    check (status in ('new','verified','invited','active','dead')),
  -- honeypot: real users never fill it; bots do. Refused below.
  honeypot        text,
  created_at      timestamptz not null default now(),
  -- a lead cannot refer itself, even crafted by hand.
  constraint leads_no_self_referral
    check (referred_by_code is null or referred_by_code <> referral_code)
);

create index leads_referred_by_idx on leads(referred_by_code) where referred_by_code is not null;
create index leads_status_idx on leads(status, created_at desc);
create index leads_phone_idx on leads(phone);

-- Referral codes: 8 characters, with no look-alike glyphs (no 0/O, no 1/I/L),
-- so a code can be read aloud or copied from a screenshot without mistakes.
-- Assigned by the database, never trusted from the client.
create or replace function assign_referral_code() returns trigger
language plpgsql as $$
declare
  v_chars text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_code  text;
  v_tries integer := 0;
  v_i     integer;
  v_hex   text;
  v_n     integer;
begin
  if new.referral_code is null or new.referral_code = '' then
    loop
      -- Unpredictable: derived from a cryptographically random UUID rather
      -- than the guessable random(). A 32-character hex string gives us
      -- plenty of fresh values, and collisions are re-rolled below.
      v_hex := replace(gen_random_uuid()::text, '-', '');
      v_code := '';
      for v_i in 1..8 loop
        v_n   := ('x' || substr(v_hex, v_i, 1))::bit(4)::integer;
        -- (v_n * 31) / 16 is always between 0 and 29, so the character
        -- index is never out of range and the code is always 8 characters.
        v_code := v_code || substr(v_chars, (v_n * length(v_chars)) / 16 + 1, 1);
      end loop;
      exit when not exists (select 1 from leads where referral_code = v_code);
      v_tries := v_tries + 1;
      if v_tries > 20 then
        raise exception 'could not allocate a referral code after 20 tries';
      end if;
    end loop;
    new.referral_code := v_code;
  elsif new.referral_code !~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$' then
    raise exception 'referral code has an illegal shape';
  end if;

  if new.referred_by_code is not null
     and not exists (select 1 from leads where referral_code = new.referred_by_code) then
    raise exception 'unknown referral code %', new.referred_by_code;
  end if;
  return new;
end;
$$;

drop trigger if exists leads_assign_code on leads;
create trigger leads_assign_code
  before insert on leads
  for each row execute function assign_referral_code();

-- Every captured lead wakes the future SMS worker through the outbox, so a
-- confirmation can never exist without its lead (same atomicity rule as money).
create or replace function notify_lead_captured() returns trigger
language plpgsql as $$
begin
  insert into outbox(topic, payload)
  values ('lead.captured', jsonb_build_object(
    'lead_id', new.id, 'lane', new.lane, 'phone', new.phone));
  return new;
end;
$$;

drop trigger if exists leads_notify on leads;
create trigger leads_notify
  after insert on leads
  for each row execute function notify_lead_captured();

-- Abuse controls that must hold for EVERY database role (triggers fire for
-- owners and superusers too - unlike RLS, which owners bypass). The RLS
-- policy below repeats the same conditions as the access layer: both must
-- agree, so a future edit that weakens one is caught by the other.
create or replace function assert_lead_validity() returns trigger
language plpgsql as $$
begin
  if new.honeypot is not null and new.honeypot <> '' then
    raise exception 'honeypot must stay empty';
  end if;
  if new.consent_at is null
     or new.consent_at > now()
     or new.consent_at < now() - interval '30 minutes' then
    raise exception 'consent must be fresh (given within the last 30 minutes, never in the future)';
  end if;
  return new;
end;
$$;

drop trigger if exists leads_valid on leads;
create trigger leads_valid
  before insert on leads
  for each row execute function assert_lead_validity();

-- ---------------------------------------------------------------------
-- RLS: the anonymous internet may APPEND leads and nothing else.
-- No SELECT (phone numbers are not enumerable), no UPDATE, no DELETE.
-- Writes carry their own validity: fresh consent, valid phone, empty honeypot.
-- ---------------------------------------------------------------------
alter table leads enable row level security;

create policy leads_anon_insert on leads
  for insert to anon
  with check (
    consent_at is not null
    and consent_at <= now()
    and consent_at > now() - interval '30 minutes'
    and phone ~ '^0\d{10}$'
    and (honeypot is null or honeypot = '')
  );

-- ---------------------------------------------------------------------
-- Public RPCs (SECURITY DEFINER, PII-free by construction).
-- ---------------------------------------------------------------------

-- preview_referral: is this invite code real, and who is it from (masked)?
-- Codes are public share tokens by design, like Dub links - but the phone
-- book behind them is never exposed. Returns {valid, referrer} or {valid:false}.
create or replace function preview_referral(p_code text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select case when l.id is null
    then jsonb_build_object('valid', false)
    else jsonb_build_object(
      'valid', true,
      'referrer', split_part(l.full_name, ' ', 1) || ' ' ||
                  left(nullif(split_part(l.full_name, ' ', 2), ''), 1) || '.',
      'lane', l.lane)
  end
  from (select 1) as one
  left join leads l on l.referral_code = upper(trim(p_code));
$$;

-- lead_position: queue number + referral count for a code. Powers
-- "You are #N in line" and the referrer count without leaking any PII.
create or replace function lead_position(p_code text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select case when m.id is null
    then jsonb_build_object('valid', false)
    else jsonb_build_object(
      'valid', true,
      'position', (select count(*) + 1 from leads
                    where created_at < m.created_at),
      'referred', (select count(*) from leads
                    where referred_by_code = m.referral_code))
  end
  from (select id, created_at, referral_code from leads
         where referral_code = upper(trim(p_code))) as m;
$$;