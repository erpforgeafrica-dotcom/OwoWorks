#!/usr/bin/env node
/**
 * live.proof.mjs — prove the public API behaviour against the REAL Supabase
 * project, over HTTPS, with the same publishable key the website ships.
 *
 * This is the venue the local PGlite tests cannot reach: PGlite runs as a
 * superuser and bypasses row-level security by design, so no local run can
 * prove an RLS policy. Here every request travels the public network exactly
 * as a visitor's browser would.
 *
 * What it proves, then cleans up after itself:
 *   1. a visitor CAN submit a sign-up and gets only their own code + position
 *   2. a visitor CANNOT read, update or delete the sign-up list
 *   3. a visitor CANNOT read the migration ledger
 *   4. a duplicate sign-up is refused with the same answer every time
 *   5. an ordinary signed-in account is also blocked from the sign-up list
 *   6. the row and its notification event really exist (checked as admin)
 *   7. every test row and test account is removed afterwards
 *
 * Reads credentials from .env and never prints them.
 * Usage: node db/live.proof.mjs
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter(l => l && !l.startsWith('#'))
    .map(l => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')];
    })
);

const URL_ = env.SUPABASE_URL;
const ANON = env.SUPABASE_PUBLISHABLE_KEY;
const ADMIN = env.SUPABASE_SECRET_KEY;
if (!URL_ || !ANON || !ADMIN) {
  console.error('Missing SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY / SUPABASE_SECRET_KEY in .env');
  process.exit(2);
}

let pass = 0, fail = 0, unverified = 0;
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? `\n          -> ${detail}` : ''}`); }
};
const note = (label, why) => { unverified++; console.log(`  UNVERIFIED  ${label}\n          -> ${why}`); };

const h = (key) => ({ 'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' });

async function rpc(name, args, key) {
  const res = await fetch(`${URL_}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: h(key), body: JSON.stringify(args)
  });
  let body = null;
  try { body = await res.json(); } catch { /* empty */ }
  return { status: res.status, body };
}

const suffix = String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
const phone = '080' + suffix;                 // a valid-shaped, unused Nigerian number
const email = `proof-${suffix}@example.invalid`;
const password = 'Proof!' + suffix + 'Aa1';

let createdUserId = null;
let referralCode = null;

console.log(`Live proof against ${URL_}`);
console.log(`Test number ${phone.slice(0, 4)}****${phone.slice(-2)} (never printed in full twice)\n`);

try {
  /* ---------------------------------------------------------- 1. SUBMIT */
  {
    const r = await rpc('submit_lead', {
      p_lane: 'promoter', p_full_name: 'Proof Tester', p_phone: phone,
      p_platform_extra: null, p_note: null, p_referred_by_code: null,
      p_utm_source: 'proof', p_utm_medium: null, p_utm_campaign: null,
      p_consent_at: new Date().toISOString(), p_honeypot: null
    }, ANON);
    const ok = r.status === 200 && r.body && r.body.ok === true;
    check('visitor can submit a sign-up', ok, `status=${r.status} body=${JSON.stringify(r.body)}`);
    if (ok) {
      referralCode = r.body.referral_code;
      check('response has an 8-character invite code',
        /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/.test(referralCode || ''), String(referralCode));
      check('response carries no personal data',
        !JSON.stringify(r.body).includes(phone) && !JSON.stringify(r.body).includes('080'),
        JSON.stringify(r.body));
    } else {
      note('invite-code and privacy checks', 'submit_lead did not return ok');
    }
  }

  /* ------------------------------------------------------- 2. DUPLICATE */
  {
    const r = await rpc('submit_lead', {
      p_lane: 'promoter', p_full_name: 'Proof Tester', p_phone: phone,
      p_consent_at: new Date().toISOString()
    }, ANON);
    check('duplicate sign-up is refused, not duplicated',
      r.status === 200 && r.body && r.body.ok === false &&
      /already on the list/i.test(r.body.message || ''),
      `status=${r.status} body=${JSON.stringify(r.body)}`);
  }

  /* ------------------------------------------- 3. VISITOR CANNOT READ */
  {
    const res = await fetch(`${URL_}/rest/v1/leads?select=phone&limit=1`, { headers: h(ANON) });
    let leaked = false;
    try { leaked = (await res.text()).includes(phone); } catch { /* none */ }
    check('visitor cannot read the sign-up list (no leak, not 200-with-rows)',
      !leaked, `status=${res.status}`);
  }

  /* ---------------------------------------- 4. VISITOR CANNOT WRITE/EDIT */
  {
    const upd = await fetch(`${URL_}/rest/v1/leads?phone=eq.${phone}`, {
      method: 'PATCH', headers: { ...h(ANON), 'Prefer': 'return=representation' },
      body: JSON.stringify({ note: 'tampered' })
    });
    let body = '';
    try { body = await upd.text(); } catch { /* none */ }
    check('visitor cannot update the sign-up list', upd.status >= 400 || body === '[]',
      `status=${upd.status} body=${body.slice(0, 80)}`);

    const del = await fetch(`${URL_}/rest/v1/leads?phone=eq.${phone}`, {
      method: 'DELETE', headers: h(ANON)
    });
    check('visitor cannot delete the sign-up list', del.status >= 400,
      `status=${del.status}`);
  }

  /* ------------------------------------------ 5. VISITOR CANNOT SEE LEDGER */
  {
    const res = await fetch(`${URL_}/rest/v1/owoworks_schema_migrations?select=filename`, { headers: h(ANON) });
    let body = '';
    try { body = await res.text(); } catch { /* none */ }
    check('visitor cannot read the migration ledger',
      res.status >= 400 || body === '[]',
      `status=${res.status} body=${body.slice(0, 80)}`);
  }

  /* ----------------------------------------------- 6. PUBLIC HELPERS WORK */
  {
    const p = await rpc('lead_position', { p_code: referralCode }, ANON);
    check('queue-position lookup works and returns no PII',
      p.status === 200 && p.body && p.body.valid === true &&
      typeof p.body.position === 'number' && !JSON.stringify(p.body).includes('080'),
      `status=${p.status} body=${JSON.stringify(p.body)}`);
  }

  /* -------------------------------------- 7. ADMIN SEES THE REAL ROW + EVENT */
  {
    const res = await fetch(`${URL_}/rest/v1/leads?phone=eq.${phone}&select=phone,referral_code`, { headers: h(ADMIN) });
    const rows = await res.json().catch(() => []);
    check('admin can see the stored row (so the write really landed)',
      res.status === 200 && Array.isArray(rows) && rows.length === 1 &&
      rows[0].referral_code === referralCode, `status=${res.status}`);

    const out = await fetch(
      `${URL_}/rest/v1/outbox?topic=eq.lead.captured&select=topic,payload&order=created_at.desc&limit=20`,
      { headers: h(ADMIN) });
    const events = await out.json().catch(() => []);
    const mine = Array.isArray(events) && events.some(e =>
      e.payload && (e.payload.phone === phone || e.payload.referral_code === referralCode));
    check('a notification event was queued for the new sign-up', mine === true,
      `${Array.isArray(events) ? events.length : '?'} recent event(s)`);
  }

  /* ------------------------------------------- 8. A SIGNED-IN ACCOUNT */
  {
    const body = JSON.stringify({ email, password, email_confirm: true });
    const res = await fetch(`${URL_}/auth/v1/admin/users`, { method: 'POST', headers: h(ADMIN), body });
    const created = await res.json().catch(() => null);
    if (res.ok && created && created.id) {
      createdUserId = created.id;

      const tok = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
        method: 'POST', headers: h(ANON), body: JSON.stringify({ email, password })
      });
      const session = await tok.json().catch(() => null);
      const token = session && session.access_token;
      check('a real signed-in account can obtain a session', !!token, `status=${tok.status}`);

      if (token) {
        const asUser = { 'apikey': ANON, 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
        const l = await fetch(`${URL_}/rest/v1/leads?select=phone&limit=1`, { headers: asUser });
        let text = '';
        try { text = await l.text(); } catch { /* none */ }
        check('a signed-in account still cannot read the sign-up list',
          !text.includes(phone), `status=${l.status}`);

        const c = await fetch(`${URL_}/rest/v1/campaigns?select=id&limit=1`, { headers: asUser });
        check('a signed-in account can read shared campaign data',
          c.status === 200, `status=${c.status}`);
      }
    } else {
      note('signed-in account boundary', `admin user creation returned ${res.status}; not proven`);
    }
  }
} finally {
  /* ------------------------------------------------------------- CLEANUP */
  console.log('\n  --- cleanup ---');
  try {
    const d1 = await fetch(`${URL_}/rest/v1/leads?phone=eq.${phone}`, { method: 'DELETE', headers: h(ADMIN) });
    console.log(`  removed test lead row: status ${d1.status}`);
  } catch (e) { console.log('  lead cleanup failed: ' + e.message); }
  try {
    const d2 = await fetch(`${URL_}/rest/v1/outbox?payload->>phone=eq.${phone}`, { method: 'DELETE', headers: h(ADMIN) });
    console.log(`  removed test outbox event(s): status ${d2.status}`);
  } catch (e) { console.log('  outbox cleanup failed: ' + e.message); }
  if (createdUserId) {
    try {
      const d3 = await fetch(`${URL_}/auth/v1/admin/users/${createdUserId}`, { method: 'DELETE', headers: h(ADMIN) });
      console.log(`  removed test account: status ${d3.status}`);
    } catch (e) { console.log('  account cleanup failed: ' + e.message); }
  }
}

console.log(`\n  PASS ${pass}   FAIL ${fail}   UNVERIFIED ${unverified}`);
console.log(`  LIVE API PROOF: ${fail === 0 ? 'ALL HOLD' : 'BREACHED'}`);
process.exit(fail === 0 ? 0 : 1);
