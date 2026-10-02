#!/usr/bin/env node
/**
 * leads.test.mjs — adversarial tests for the lead-capture backend.
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
    `insert into leads(lane, full_name, phone_e164, consent_at)
     values ('promoter','Adaeze Okafor','08030000000', now());`);
  {
    const r = await db.query(
      `select referral_code from leads where phone_e164 = '08030000000'`);
    const code = r.rows[0].referral_code;
    check('referral code is 8 chars from the unambiguous alphabet',
      /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/.test(code), `got ${code}`);
    globalThis.__CODE_A = code;
  }

  await rejects(db, 'duplicate phone is refused (one identity per lead)',
    `insert into leads(lane, full_name, phone_e164, referral_code, consent_at)
     values ('promoter','Adaeze Twice','08030000000','AAAAAAAA', now());`,
    'duplicate key');

  await rejects(db, 'malformed phone is refused',
    `insert into leads(lane, full_name, phone_e164, consent_at)
     values ('promoter','Bad Number','08030000', now());`);

  await rejects(db, 'honeypot-filled submission is refused',
    `insert into leads(lane, full_name, phone_e164, consent_at, honeypot)
     values ('promoter','Totally Human','08030000001', now(), 'http://spam.example');`);

  await rejects(db, 'stale consent (older than 30 minutes) is refused',
    `insert into leads(lane, full_name, phone_e164, consent_at)
     values ('promoter','Slow Consent','08030000002', now() - interval '31 minutes');`);

  await rejects(db, 'future consent is refused',
    `insert into leads(lane, full_name, phone_e164, consent_at)
     values ('promoter','Time Traveller','08030000003', now() + interval '5 minutes');`);

  await rejects(db, 'client-supplied code in illegal shape is refused',
    `insert into leads(lane, full_name, phone_e164, referral_code, consent_at)
     values ('promoter','Crafty','08030000004','drop--table', now());`,
    'illegal shape');

  /* ------------------------------------------------- 2. REFERRALS */
  const A = globalThis.__CODE_A;
  await accepts(db, 'referred lead resolves against a real code',
    `insert into leads(lane, full_name, phone_e164, referred_by_code, utm_source, consent_at)
     values ('promoter','Ibrahim Musa','08040000000','${A}','whatsapp', now());`);

  await rejects(db, 'unknown referral code is refused',
    `insert into leads(lane, full_name, phone_e164, referred_by_code, consent_at)
     values ('promoter','Lost Invite','08050000000','ZZZZZZZZ', now());`,
    'unknown referral code');

  {
    const r = await db.query(
      `select preview_referral('${A}') as p`);
    const p = r.rows[0].p;
    check('preview_referral masks the referrer (no phone, no full surname)',
      p.valid === true && p.referrer === 'Adaeze O.' && !('phone_e164' in p),
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
      p.valid === true && p.position === 1 && p.referred === 1 && !('phone_e164' in p),
      `got ${JSON.stringify(p)}`);
  }

  /* ------------------------------------------------- 3. OUTBOX */
  {
    const r = await db.query(
      `select count(*)::int as n from outbox where topic = 'lead.captured'`);
    check('every captured lead emits an outbox event for the SMS worker',
      r.rows[0].n === 2, `found ${r.rows[0].n}`);
  }

  /* ------------------------------------------------- 4. RLS VENUE */
  unverified('anon INSERT-only policy (no select/update/delete for anon)',
    'PGlite superuser bypasses RLS by design. Prove on Supabase staging: anon insert succeeds, anon select returns 0 rows, unauthenticated update fails.');
});

console.log(`\n  PASS ${pass}   FAIL ${fail}   UNVERIFIED ${unverifiedCount}`);
console.log(`  LEAD CAPTURE: ${fail === 0 ? 'ALL HOLD' : 'BREACHED'}`);
process.exit(fail === 0 ? 0 : 1);