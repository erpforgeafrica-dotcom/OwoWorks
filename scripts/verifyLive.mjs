#!/usr/bin/env node
/**
 * verifyLive.mjs — prove the DEPLOYED site works over HTTPS using the exact
 * config the running container serves at /config.js (not the local .env).
 *
 * This closes the last gap the local tests cannot: that the deployed server
 * injects the right Supabase URL + publishable key at runtime, that the page
 * loads, and that a real visitor's sign-up actually lands in the database and
 * is then cleaned up (checked with the admin key from .env).
 *
 * Usage: node scripts/verifyLive.mjs https://your-service.up.railway.app
 * Reads SUPABASE_SECRET_KEY from .env for admin verification only. Never prints
 * the anon or secret key values.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = (process.argv[2] || '').replace(/\/$/, '');
if (!BASE) { console.error('Usage: node scripts/verifyLive.mjs <base-url>'); process.exit(2); }

const env = Object.fromEntries(
  readFileSync(join(process.cwd(), '.env'), 'utf8')
    .split(/\r?\n/)
    .filter(l => l && !l.startsWith('#'))
    .map(l => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')];
    })
);
const ADMIN = env.SUPABASE_SECRET_KEY;
const EXPECTED_URL = env.SUPABASE_URL;

let pass = 0, fail = 0;
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? `\n          -> ${detail}` : ''}`); }
};

const h = (key) => ({ 'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' });

console.log(`Live deploy verification against ${BASE}\n`);

/* ---------------------------------------------------- 1. STATIC + HEADERS */
let cfg = null;
{
  const res = await fetch(BASE + '/');
  const html = await res.text();
  check('home page returns 200 HTML', res.status === 200 && /text\/html/.test(res.headers.get('content-type') || ''),
    `status=${res.status}`);
  check('page is the Promota pilot', /Promota/.test(html) && /theme-boot\.js/.test(html),
    'missing Promota markers');
  check('no unbuilt config.example reference shipped', !html.includes('config.example.js'));
  check('content-security-policy present', /default-src 'self'/.test(res.headers.get('content-security-policy') || ''),
    res.headers.get('content-security-policy') || 'missing');
  check('nosniff + frame-deny set',
    res.headers.get('x-content-type-options') === 'nosniff' && res.headers.get('x-frame-options') === 'DENY');

  for (const path of ['/healthz', '/styles.css', '/theme-boot.js', '/assets/identity/favicon.svg']) {
    const r = await fetch(BASE + path);
    check(`${path} served`, r.status === 200, `status=${r.status}`);
  }

  const hc = await fetch(BASE + '/healthz');
  const hb = await hc.json().catch(() => ({}));
  check('healthz reports config configured', hb.ok === true && hb.config === true, JSON.stringify(hb));
}

/* --------------------------------------------- 2. RUNTIME CONFIG INJECTED */
{
  const res = await fetch(BASE + '/config.js');
  const text = await res.text();
  const m = text.match(/window\.PROMOTA\s*=\s*(\{[\s\S]*?\})\s*;/);
  if (m) { try { cfg = JSON.parse(m[1]); } catch { cfg = null; } }
  check('/config.js served as javascript', res.status === 200 && /javascript/.test(res.headers.get('content-type') || ''),
    `status=${res.status}`);
  check('/config.js carries a Supabase URL', !!cfg && /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(cfg.SUPABASE_URL || ''),
    cfg ? 'url shape invalid' : 'config not parseable');
  check('/config.js carries only a publishable key',
    !!cfg && typeof cfg.SUPABASE_ANON_KEY === 'string' && cfg.SUPABASE_ANON_KEY.startsWith('sb_publishable_'),
    'key missing or not a publishable key');
  check('deployed config matches this project', !!cfg && cfg.SUPABASE_URL === EXPECTED_URL);
}

/* ------------------------------------------ 3. END-TO-END VISITOR SIGN-UP */
if (cfg) {
  const suffix = String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
  const phone = '080' + suffix;
  console.log(`\nTest number ${phone.slice(0, 4)}****${phone.slice(-2)}`);
  try {
    const r = await fetch(cfg.SUPABASE_URL + '/rest/v1/rpc/submit_lead', {
      method: 'POST', headers: h(cfg.SUPABASE_ANON_KEY), body: JSON.stringify({
        p_lane: 'promoter', p_full_name: 'Deploy Verifier', p_phone: phone,
        p_platform_extra: null, p_note: null, p_referred_by_code: null,
        p_utm_source: 'deploy-verify', p_utm_medium: null, p_utm_campaign: null,
        p_consent_at: new Date().toISOString(), p_honeypot: null
      })
    });
    const body = await r.json().catch(() => null);
    check('visitor can submit a sign-up through the deployed config',
      r.status === 200 && body && body.ok === true, `status=${r.status} body=${JSON.stringify(body)}`);
    check('response has an 8-char invite code and no phone',
      !!body && /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/.test(body.referral_code || '') &&
      !JSON.stringify(body).includes(phone), JSON.stringify(body));

    const leak = await fetch(cfg.SUPABASE_URL + '/rest/v1/leads?select=phone&limit=1', { headers: h(cfg.SUPABASE_ANON_KEY) });
    const leakText = await leak.text();
    check('visitor cannot read the sign-up list', !leakText.includes(phone), `status=${leak.status}`);

    if (ADMIN) {
      const admin = await fetch(cfg.SUPABASE_URL + '/rest/v1/leads?phone=eq.' + phone + '&select=phone', { headers: h(ADMIN) });
      const rows = await admin.json().catch(() => []);
      check('admin confirms the row really landed in the database',
        Array.isArray(rows) && rows.length === 1, `status=${admin.status} rows=${Array.isArray(rows) ? rows.length : '?'}`);
      const d = await fetch(cfg.SUPABASE_URL + '/rest/v1/leads?phone=eq.' + phone, { method: 'DELETE', headers: h(ADMIN) });
      check('test row cleaned up', d.status === 204, `status=${d.status}`);
    } else {
      console.log('  SKIP  admin confirmation (no SUPABASE_SECRET_KEY in .env)');
    }
  } catch (e) {
    check('end-to-end sign-up', false, e.message);
  }
} else {
  check('end-to-end sign-up', false, 'no usable runtime config');
}

console.log(`\n  PASS ${pass}   FAIL ${fail}`);
console.log(`  DEPLOY VERIFY: ${fail === 0 ? 'ALL HOLD' : 'BREACHED'}`);
process.exit(fail === 0 ? 0 : 1);
