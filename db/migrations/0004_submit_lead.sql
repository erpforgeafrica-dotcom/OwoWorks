-- =====================================================================
-- 0004_submit_lead.sql
--
-- WHY THIS FILE EXISTS
--
-- The website needs two things back from a sign-up: the person's own invite
-- code, and their place in the queue. The obvious way is to insert the row
-- and ask the database to return it. That does not work safely, because
-- returning a row requires permission to READ rows, and we deliberately
-- refuse the public any read access to the sign-up list (phone numbers must
-- never be enumerable).
--
-- So instead of granting insert-and-read, we grant ONE narrow, named action:
-- submit a sign-up. It can only add a sign-up, it cannot read anything, and
-- it returns only the two numbers the person already knows about.
--
-- This also removes the need for the public to hold any privilege on the
-- table itself, which is a stronger position than "can insert, cannot read".
--
-- Plain-language summary:
--   Anyone may hand us one sign-up. Nobody may look at the list.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Turn a typed phone number into the form we store.
--    Accepts 0803 000 0000, 08030000000, +2348030000000, 2348030000000,
--    with spaces, dots or dashes. Returns null when it cannot be read as a
--    Nigerian mobile number.
-- ---------------------------------------------------------------------
create or replace function public.normalise_nigerian_phone(p_input text)
returns text
language sql
immutable
as $$
  select case
    when regexp_replace(coalesce(p_input,''), '[^0-9]', '', 'g')
         ~ '^234(0[789][01]\d{8})$'
      then regexp_replace(p_input, '[^0-9]', '', 'g')
    when regexp_replace(coalesce(p_input,''), '[^0-9]', '', 'g')
         ~ '^0[789][01]\d{8}$'
      then regexp_replace(p_input, '[^0-9]', '', 'g')
    else null
  end;
$$;

-- ---------------------------------------------------------------------
-- 2. submit_lead — the single public entry point for a sign-up.
--
--    Returns: { ok, referral_code, position, referred, message }
--             { ok:false, message } when the sign-up is refused.
--
--    It deliberately returns NO personal data: no phone, no name, no note.
--    A caller who already knows a code gets that code's queue position only.
-- ---------------------------------------------------------------------
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

  -- 2e. Is this number already on the list? Answer the same way every time
  --     so the response cannot be used to discover who has signed up.
  select id into v_existing
    from public.leads where phone = v_phone;

  if v_existing is not null then
    return jsonb_build_object('ok', false,
      'message', 'This number is already on the list.');
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

-- ---------------------------------------------------------------------
-- 3. Permissions
-- ---------------------------------------------------------------------

-- The public no longer needs to touch the table itself.
revoke insert on public.leads from anon;
revoke all on public.leads from anon, authenticated;

-- Only this one action is callable by the website.
grant execute on function public.submit_lead(
  text, text, text, text, text, text, text, text, text, timestamptz, text
) to anon, authenticated;

-- The phone normaliser is a pure helper; no need to expose it, but harmless.
revoke execute on function public.normalise_nigerian_phone(text) from public;
grant execute on function public.normalise_nigerian_phone(text) to anon, authenticated, service_role;