-- =====================================================================
-- 0005_fix_phone_normaliser.sql
--
-- 0004 had two defects in public.normalise_nigerian_phone, both caught by
-- db/leads.test.mjs before anything reached the public:
--
--   1. The country-code branch expected the wrong number of digits, so
--      "+234 803 000 0000" was rejected as not a Nigerian number.
--   2. Even when the digits matched, it returned the digits unchanged.
--      A number written as +234 803 000 0000 must be stored in the local
--      form 08030000000, otherwise the table's own check would refuse it.
--
-- A corrected migration is added rather than editing 0004, because 0004 has
-- already run on the live database and quietly changing an applied file
-- would hide the history.
-- =====================================================================

create or replace function public.normalise_nigerian_phone(p_input text)
returns text
language sql
immutable
as $$
  with d as (
    select regexp_replace(coalesce(p_input, ''), '[^0-9]', '', 'g') as digits
  )
  select case
    -- Written with the country code: 234 then the local number with its
    -- leading zero replaced by the country code. Put the zero back.
    when d.digits ~ '^234[789][01]\d{8}$' then '0' || substr(d.digits, 4)
    -- Already in local form.
    when d.digits ~ '^0[789][01]\d{8}$'    then d.digits
    else null
  end
  from d;
$$;