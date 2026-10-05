-- =====================================================================
-- 0007_fix_submit_lead_oracle.sql
--
-- WHY THIS FILE EXISTS
--
-- 0004:110-118 returned ok:false/'This number is already on the list.' for a
-- known phone but ok:true/+referral_code/+position for a new one. Known-vs-new
-- was fully distinguishable over the public RPC, so any visitor could probe
-- which numbers are on the list. The comment at 0004:110-111 promised
-- indistinguishability the code did not deliver.
--
-- The fix is forward-only (0001-0006 are never edited in place). The function
-- signature is byte-identical to 0004 (11 args:
-- text x9, timestamptz, text) because Postgres cannot change name/arg types
-- via create-or-replace and app.js calls with named args.
--
-- New behaviour for an already-registered phone: return the SAME success
-- shape as a fresh sign-up -- the existing referral_code, its true position
-- (count(*)+1 where created_at < existing created_at), and its live referred
-- count -- with the same keys (ok, referral_code, position, referred) and no
-- message key. A returning user recovers their code; an attacker learns
-- nothing from status, keys, or message.
--
-- Preserved: honeypot refusal, past/future-consent refusal, malformed-phone
-- refusal, short-name refusal, no-PII-in-response, single insert + outbox
-- only for genuinely new numbers (repeat submissions insert nothing).
-- =====================================================================

create or replace function public.submit_lead(
  p_lane             text,
  p_full_name        text,
  p_phone            text,
  p_platform_extra   text default null,
  p_note             text default null,
  p_referred_by_code text default null,
  p_utm_source       text default null,
  p_utm_medium       text default null,
  p_utm_campaign     text default null,
  -- Defaults to null rather than "now", because inventing a consent time for
  -- a caller who forgot to send one would be a lie. A missing consent time is
  -- rejected a few lines below.
  p_consent_at       timestamptz default null,
  p_honeypot         text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone      text;
  v_code       text;
  v_created    timestamptz;
  v_position   bigint;
  v_referred   bigint;
  v_existing   uuid;
begin
  -- 2a. Refuse anything that is not a real consent moment. Checked here as
  --     well as by the trigger below, so a mistake here is still caught.
  if p_consent_at is null
     or p_consent_at > now()
     or p_consent_at < now() - interval '30 minutes' then
    return jsonb_build_object('ok', false,
      'message', 'Consent must be recorded at the moment you agree.');
  end if;

  -- 2b. Honeypot: a real person never sees this field; a robot fills it.
  if p_honeypot is not null and p_honeypot <> '' then
    return jsonb_build_object('ok', false, 'message', 'Submission refused.');
  end if;

  -- 2c. Normalise and validate the phone number.
  v_phone := public.normalise_nigerian_phone(p_phone);
  if v_phone is null then
    return jsonb_build_object('ok', false,
      'message', 'That does not look like a Nigerian phone number.');
  end if;

  -- 2d. Trim the name to something a person could actually be called.
  if p_full_name is null or char_length(trim(p_full_name)) < 2 then
    return jsonb_build_object('ok', false, 'message', 'Please give your name.');
  end if;

  -- 2e. Is this number already on the list? Return the SAME success shape
  --     as a fresh sign-up -- the existing code, its true queue position,
  --     its live referral count -- so the response cannot be used to
  --     discover who has signed up. A returning user recovers their code;
  --     an attacker learns nothing from status, keys, or message.
  --     No second row and no second outbox event are created here.
  select referral_code, created_at, id into v_code, v_created, v_existing
    from public.leads where phone = v_phone;

  if v_existing is not null then
    select count(*) + 1 into v_position
      from public.leads where created_at < v_created;
    select count(*) into v_referred
      from public.leads where referred_by_code = v_code;

    return jsonb_build_object(
      'ok',            true,
      'referral_code', v_code,
      'position',      v_position,
      'referred',      v_referred
    );
  end if;

  -- 2f. Add the sign-up. The trigger assigns the invite code, refuses
  --     honeypots, refuses invented invite codes, and queues the message
  --     that will send the confirmation.
  insert into public.leads (
    lane, full_name, phone, platform_extra, note,
    referred_by_code, utm_source, utm_medium, utm_campaign,
    consent_at, honeypot
  ) values (
    p_lane, trim(p_full_name), v_phone,
    nullif(trim(p_platform_extra), ''),
    nullif(trim(p_note), ''),
    nullif(upper(trim(p_referred_by_code)), ''),
    nullif(p_utm_source, ''), nullif(p_utm_medium, ''), nullif(p_utm_campaign, ''),
    p_consent_at, p_honeypot
  )
  returning referral_code, created_at into v_code, v_created;

  -- 2g. Only two numbers back. No personal data leaves this function.
  select count(*) + 1 into v_position
    from public.leads where created_at < v_created;
  select count(*) into v_referred
    from public.leads where referred_by_code = v_code;

  return jsonb_build_object(
    'ok',            true,
    'referral_code', v_code,
    'position',      v_position,
    'referred',      v_referred
  );
end;
$$;

-- Grants survive create-or-replace, but re-assert the single public write
-- path so a fresh database ends in the same state as 0004 intended.
grant execute on function public.submit_lead(
  text, text, text, text, text, text, text, text, text, timestamptz, text
) to anon, authenticated;
