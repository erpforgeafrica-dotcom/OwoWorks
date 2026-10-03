#!/usr/bin/env node
/**
 * leads.test.mjs â€” adversarial tests for the lead-capture backend.
 *
 * Same discipline as ledger.test.mjs: every case in its own transaction,
 * accepts() commits, rejects() rolls back. RLS anon-insert is UNVERIFIED
 * locally (PGlite superuser bypasses RLS) - venue: Supabase staging + JWTs.
 */
import { withDb, migrate } from '../scripts/migrateUp.mjs';

let pass = 0, fail = 0, unverifiedCount = 0;
function check(label, ok, detail) {
  const line = ok ? `  PASS  ${label}` : `  FAIL  ${label}${detail ? `\n          -> ${detail}` : ''}`;
  console.log(line);
  if (ok) pass++; else fail++;
}
function unverified(label, reason) {
  unverifiedCount++;
  console.log(`  UNVERIFIED  ${label}\n          -> ${reason}`);
}
async function rejects(db, label, sql, frag) {
  await db.exec('begin');
  let err = null;
  try { await db.exec(sql); await db.exec('commit'); }
  catch (e) { err = e; try { await db.exec('rollback'); } catch { /* clean */ } }
  if (!err) { check(label, false, 'database ACCEPTED a write it must refuse'); return; }
  const msg = String(err.message || err);
  const ok = !frag || msg.toLowerCase().includes(frag.toLowerCase());
  check(label, ok, ok ? '' : `wrong reason (wanted "${frag}")\n          got: ${msg.split('\n')[0]}`);
}
async function accepts(db, label, sql) {
  await db.exec('begin');
  try { await db.exec(sql); await db.exec('commit'); check(label, true); return true; }
  catch (e) {
    try { await db.exec('rollback'); } catch { /* clean */ }
    check(label, false, String(e.message || e).split('\n')[0]);
    return false;
  }
}

await withDb(async db => {
  await migrate(db, { quiet: true });

  /* ------------------------------------------------- 1. CAPTURE */
  await accepts(db, 'lead captured, code auto-assigned in legal alphabet',
    `insert into leads(lane, full_name, phone, consent_at)
     values ('promoter','Adaeze Okafor','08030000000', now());`);
  {
    const r = await db.query(
      `select referral_code from leads where phone = '08030000000'`);
    const code = r.rows[0].referral_code;
    check('referral code is 8 chars from the unambiguous alphabet',
      /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/.test(code), `got ${code}`);
    globalThis.__CODE_A = code;
  }

  await rejects(db, 'duplicate phone is refused (one identity per lead)',
    `insert into leads(lane, full_name, phone, referral_code, consent_at)
     values ('promoter','Adaeze Twice','08030000000','AAAAAAAA', now());`,
    'duplicate key');

  await rejects(db, 'malformed phone is refused',
    `insert into leads(lane, full_name, phone, consent_at)
     values ('promoter','Bad Number','08030000', now());`);

  await rejects(db, 'honeypot-filled submission is refused',
    `insert into leads(lane, full_name, phone, consent_at, honeypot)
     values ('promoter','Totally Human','08030000001', now(), 'http://spam.example');`);

  await rejects(db, 'stale consent (older than 30 minutes) is refused',
    `insert into leads(lane, full_name, phone, consent_at)
     values ('promoter','Slow Consent','08030000002', now() - interval '31 minutes');`);

  await rejects(db, 'future consent is refused',
    `insert into leads(lane, full_name, phone, consent_at)
     values ('promoter','Time Traveller','08030000003', now() + interval '5 minutes');`);

  await rejects(db, 'client-supplied code in illegal shape is refused',
    `insert into leads(lane, full_name, phone, referral_code, consent_at)
     values ('promoter','Crafty','08030000004','drop--table', now());`,
    'illegal shape');

  /* ------------------------------------------------- 2. REFERRALS */
  const A = globalThis.__CODE_A;
  await accepts(db, 'referred lead resolves against a real code',
    `insert into leads(lane, full_name, phone, referred_by_code, utm_source, consent_at)
     values ('promoter','Ibrahim Musa','08040000000','${A}','whatsapp', now());`);

  await rejects(db, 'unknown referral code is refused',
    `insert into leads(lane, full_name, phone, referred_by_code, consent_at)
     values ('promoter','Lost Invite','08050000000','ZZZZZZZZ', now());`,
    'unknown referral code');

  {
    const r = await db.query(
      `select preview_referral('${A}') as p`);
    const p = r.rows[0].p;
    check('preview_referral masks the referrer (no phone, no full surname)',
      p.valid === true && p.referrer === 'Adaeze O.' && !('phone' in p),
      `got ${JSON.stringify(p)}`);
  }
  {
    const r = await db.query(`select preview_referral('NOPE1234') as p`);
    check('preview_referral says false for unknown codes',
      r.rows[0].p.valid === false, `got ${JSON.stringify(r.rows[0].p)}`);
  }
  {
    const r = await db.query(`select lead_position('${A}') as p`);
    const p = r.rows[0].p;
    check('lead_position reports queue number and referral count, no PII',
      p.valid === true && p.position === 1 && p.referred === 1 && !('phone' in p),
      `got ${JSON.stringify(p)}`);
  }

  /* ------------------------------------------------- 3. OUTBOX */
  {
    const r = await db.query(
      `select count(*)::int as n from outbox where topic = 'lead.captured'`);
    check('every captured lead emits an outbox event for the SMS worker',
      r.rows[0].n === 2, `found ${r.rows[0].n}`);
  }

  /* ------------------------------------------------- 5. REGRESSION GUARDS
     These exist because a real defect was found and fixed in this file's
     history. Each one failed before the fix. */
  {
    // The alphabet holds 31 characters. An earlier version sampled 1..32,
    // so roughly one sign-up in 32 got a 7-character code.
    const codes = [];
    for (let i = 1; i <= 40; i++) {
      const r = await db.query(
        `insert into leads(lane, full_name, phone, consent_at)
         values ('promoter', $1, $2, now()) returning referral_code`,
        [`Tester ${i}`, `0803000${String(i).padStart(4, '0')}`]);
      codes.push(r.rows[0].referral_code);
    }
    const badLength = codes.filter(c => c.length !== 8);
    const badShape = codes.filter(c => !/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/.test(c));
    check('40 generated codes are ALL exactly 8 characters (regression)',
      badLength.length === 0, `${badLength.length} wrong length: ${badLength.join(',')}`);
    check('40 generated codes use only the look-alike-free alphabet (regression)',
      badShape.length === 0, `${badShape.length} bad: ${badShape.join(',')}`);
    check('generated codes are not all identical (randomness is real)',
      new Set(codes).size === codes.length, `${new Set(codes).size} unique of ${codes.length}`);
    await db.exec('delete from leads');
  }
  {
    // The column is named "phone" and holds Nigerian national format.
    const r = await db.query(
      `select column_name from information_schema.columns
        where table_schema='public' and table_name='leads' and column_name='phone'`);
    check('phone column exists under an honest name', r.rows.length === 1);
  }
  {
    const r = await db.query(`select public.healthcheck() as h`);
    const keys = Object.keys(r.rows[0].h).sort().join(',');
    const body = JSON.stringify(r.rows[0].h);
    check('healthcheck reports ok and leaks nothing',
      r.rows[0].h.status === 'ok' &&
      !body.includes('phone') &&
      keys === 'checked_at,service,status',
      `${keys} :: ${body}`);
  }
  {
    const r = await db.query(
      `select count(*)::int as n from pg_proc p
         join pg_namespace ns on ns.oid = p.pronamespace
        where ns.nspname='public'
          and p.proname in ('prune_unverified_leads','healthcheck',
                            'preview_referral','lead_position')`);
    check('the four operational database functions all exist', r.rows[0].n === 4, `found ${r.rows[0].n}`);
  }
  {
    const r = await db.query(
      `select has_function_privilege('anon','public.prune_unverified_leads(integer)','EXECUTE') as may`);
    check('anon CANNOT run the data-deletion function', r.rows[0].may === false);
  }
  {
    const r = await db.query(
      `select has_function_privilege('anon','public.assign_role(uuid, public.app_role)','EXECUTE') as may`);
    check('anon CANNOT assign roles', r.rows[0].may === false);
  }
  {
    const r = await db.query(
      `select has_table_privilege('anon','public.leads','SELECT')  as sel,
              has_table_privilege('anon','public.leads','UPDATE')  as upd,
              has_table_privilege('anon','public.leads','DELETE')  as del,
              has_table_privilege('anon','public.leads','INSERT')  as ins,
              has_table_privilege('anon','public.ledger_entries','SELECT') as money`);
    check('anon cannot touch the leads table at all (submit_lead RPC only)',
      r.rows[0].sel === false && r.rows[0].upd === false &&
      r.rows[0].del === false && r.rows[0].ins === false, JSON.stringify(r.rows[0]));
    check('anon cannot read the money ledger', r.rows[0].money === false);
  }
  {
    const r = await db.query(
      `select has_table_privilege('anon','public.owoworks_schema_migrations','SELECT') as s,
              has_table_privilege('anon','public.owoworks_schema_migrations','INSERT') as i,
              has_table_privilege('anon','public.owoworks_schema_migrations','UPDATE') as u,
              has_table_privilege('anon','public.owoworks_schema_migrations','DELETE') as d`);
    check('anon cannot touch the migration ledger (regression: 0006)',
      !r.rows[0].s && !r.rows[0].i && !r.rows[0].u && !r.rows[0].d, JSON.stringify(r.rows[0]));
  }
  {
    const r = await db.query(
      `select relrowsecurity as on from pg_class
        where oid = 'public.owoworks_schema_migrations'::regclass`);
    check('migration ledger has row level security turned on (regression: 0006)',
      r.rows[0].on === true);
  }
  {
    const r = await db.query(
      `select has_function_privilege(
         'anon',
         'public.submit_lead(text,text,text,text,text,text,text,text,text,timestamptz,text)',
         'EXECUTE') as may`);
    check('anon MAY call submit_lead (the single public write path)', r.rows[0].may === true);
  }

  /* ------------------------------------------------- 5b. submit_lead RPC */
  {
    const args = `( 'promoter','Ada Nwosu','0803 111 2222','Instagram',null,null,
                    'whatsapp','share',null, now(), null )`;
    const r = await db.query(`select public.submit_lead${args} as r`);
    const v = r.rows[0].r;
    check('submit_lead returns ok plus a queue position and invite code',
      v.ok === true && /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/.test(v.referral_code) &&
      typeof v.position === 'number' && typeof v.referred === 'number',
      JSON.stringify(v));
    check('submit_lead response contains NO personal data',
      !JSON.stringify(v).toLowerCase().includes('0803') &&
      !JSON.stringify(v).toLowerCase().includes('ada'),
      JSON.stringify(v));
    const n = await db.query(`select count(*)::int as n from leads where phone = '08031112222'`);
    check('submit_lead actually stored the row, normalised from spaced input',
      n.rows[0].n === 1, `rows=${n.rows[0].n}`);
  }
  {
    const r = await db.query(
      `select public.submit_lead('promoter','Ada Again','+2348031112222',null,null,null,
                                null,null,null, now(), null) as r`);
    check('submit_lead refuses a duplicate number with the same answer every time',
      r.rows[0].r.ok === false &&
      /already on the list/i.test(r.rows[0].r.message), JSON.stringify(r.rows[0].r));
  }
  {
    const r = await db.query(
      `select public.submit_lead('promoter','Bot Person','08059998888',null,null,null,
                                null,null,null, now(), 'http://spam.example') as r`);
    check('submit_lead refuses a filled honeypot',
      r.rows[0].r.ok === false, JSON.stringify(r.rows[0].r));
    const n = await db.query(`select count(*)::int as n from leads where phone='08059998888'`);
    check('a refused honeypot submission stores nothing', n.rows[0].n === 0);
  }
  {
    const r = await db.query(
      `select public.submit_lead('promoter','Old Consent','08057776666',null,null,null,
                                null,null,null, now() - interval '3 hours', null) as r`);
    check('submit_lead refuses consent given hours ago', r.rows[0].r.ok === false);
    const r2 = await db.query(
      `select public.submit_lead('promoter','Future Consent','08056665555',null,null,null,
                                 null,null,null, now() + interval '2 hours', null) as r`);
    check('submit_lead refuses consent dated in the future', r2.rows[0].r.ok === false);
  }
  {
    const r = await db.query(
      `select public.submit_lead('promoter','Bad Phone','12345',null,null,null,
                                null,null,null, now(), null) as r`);
    check('submit_lead refuses an unreadable phone number',
      r.rows[0].r.ok === false && /Nigerian/i.test(r.rows[0].r.message),
      JSON.stringify(r.rows[0].r));
  }
  {
    const r = await db.query(
      `select public.normalise_nigerian_phone(x) as out
         from unnest(array['0803 000 0000','08030000000','+234 803 000 0000',
                           '2348030000000','0803000000','12345','',null]) as x`);
    const out = r.rows.map(v => v.out);
    check('phone helper accepts every valid spelling and rejects the rest',
      out[0] === '08030000000' && out[1] === '08030000000' &&
      out[2] === '08030000000' && out[3] === '08030000000' &&
      out.slice(4).every(v => v === null), JSON.stringify(out));
  }

  /* ------------------------------------------------- 6. RLS VENUE */
  unverified('anon INSERT-only policy over HTTP (no select/update/delete for anon)',
    'PGlite superuser bypasses RLS by design. Table GRANTs are proven above; the policy itself is proven by db/live.proof.mjs against the real Supabase project with an anon JWT.');
});

console.log(`\n  PASS ${pass}   FAIL ${fail}   UNVERIFIED ${unverifiedCount}`);
console.log(`  LEAD CAPTURE: ${fail === 0 ? 'ALL HOLD' : 'BREACHED'}`);
process.exit(fail === 0 ? 0 : 1);