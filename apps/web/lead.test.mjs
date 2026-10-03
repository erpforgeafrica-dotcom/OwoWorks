import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Exercise the real functions from the shipped file, not copies.
const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(HERE, 'app.js'), 'utf8');

const grab = (name) => {
  const key = `function ${name}`;
  const i = src.indexOf(key);
  if (i === -1) throw new Error('missing ' + name);
  let depth = 0, started = false;
  for (let j = src.indexOf('{', i); j < src.length; j++) {
    if (src[j] === '{') { depth++; started = true; }
    else if (src[j] === '}') { depth--; if (started && depth === 0) return src.slice(i, j + 1); }
  }
  throw new Error('unbalanced ' + name);
};

const code = [
  grab('getRefFromLocation'),
  grab('isReferralCodeFormat'),
  grab('getUtm'),
  grab('buildLeadPayload'),
  grab('buildSubmitArgs'),
  grab('shareLinks')
].join('\n');

const fns = new Function(`
  const window = {};
  const location = { search: '' };
  ${code}
  return { getRefFromLocation, isReferralCodeFormat, getUtm, buildLeadPayload, buildSubmitArgs, shareLinks };
`)();

let pass = 0, fail = 0;
const t = (label, cond, detail) => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? `\n          -> ${detail}` : ''}`); }
};

const { getRefFromLocation, isReferralCodeFormat, getUtm, buildLeadPayload, buildSubmitArgs, shareLinks } = fns;

// ref parsing
t('ref extracted and uppercased', getRefFromLocation('?ref=ab12cd34') === 'AB12CD34');
t('ref absent without param', getRefFromLocation('?lane=promoter') === null);
t('ref captured bounded at 16 chars (exact-8 enforced downstream)',
  getRefFromLocation('?ref=' + 'A'.repeat(17)) === 'A'.repeat(16));
t('ref taken from multi-param query', getRefFromLocation('?utm_source=x&ref=AB12CD34') === 'AB12CD34');

// code format (must match the database alphabet exactly)
t('valid 8-char code accepted', isReferralCodeFormat('A2B4C6D8'));
t('ambiguous glyphs rejected (0/O/1/I/L)',
  !isReferralCodeFormat('AB12CD3O') && !isReferralCodeFormat('AB12CD31') &&
  !isReferralCodeFormat('AB12CDL4') && !isReferralCodeFormat('AB02CD34') &&
  !isReferralCodeFormat('AB1CDEFG'));
t('wrong lengths rejected',
  !isReferralCodeFormat('ABC123') && !isReferralCodeFormat('A'.repeat(9)));
t('lowercase rejected (codes are uppercase)', !isReferralCodeFormat('ab12cd34'));

// utm
{
  const u = getUtm('?utm_source=whatsapp&utm_medium=share&utm_campaign=pilot');
  t('utm captured', u.utm_source === 'whatsapp' && u.utm_medium === 'share' && u.utm_campaign === 'pilot',
    JSON.stringify(u));
  const e = getUtm('');
  t('utm absent without params', e.utm_source === null && e.utm_medium === null && e.utm_campaign === null);
}

// payload
{
  const p = buildLeadPayload({
    lane: 'promoter', name: 'Adaeze Okafor', phone: '08030000000',
    extra: 'YouTube', note: 'Lagos', ref: 'AB12CD34',
    utm: { utm_source: 'whatsapp', utm_medium: null, utm_campaign: null },
    now: '2026-10-02T12:00:00.000Z'
  });
  t('payload carries lane/name/phone', p.lane === 'promoter' && p.full_name === 'Adaeze Okafor' && p.phone === '08030000000');
  t('payload carries ref + utm + fresh consent',
    p.referred_by_code === 'AB12CD34' && p.utm_source === 'whatsapp' && p.consent_at === '2026-10-02T12:00:00.000Z',
    JSON.stringify(p));
  t('payload honeypot is empty (bots fill it, users never do)', p.honeypot === '');
  t('payload has no secrets, keys or PII beyond the lead itself',
    !('apikey' in p) && !('Authorization' in p) && !('password' in p));
}

// submit_lead argument mapping (the single public write path)
{
  const payload = buildLeadPayload({
    lane: 'owner', name: 'Chidi', phone: '08030000000', extra: 'Shop', note: null,
    ref: 'AB12CD34', utm: { utm_source: 'x', utm_medium: null, utm_campaign: null },
    now: '2026-10-02T12:00:00.000Z'
  });
  const a = buildSubmitArgs(payload);
  const keys = Object.keys(a).sort().join(',');
  t('submit args use the exact p_* names the function declares',
    keys === 'p_consent_at,p_full_name,p_honeypot,p_lane,p_note,p_phone,p_platform_extra,p_referred_by_code,p_utm_campaign,p_utm_medium,p_utm_source',
    keys);
  t('submit args carry the values through unchanged',
    a.p_lane === 'owner' && a.p_full_name === 'Chidi' && a.p_phone === '08030000000' &&
    a.p_referred_by_code === 'AB12CD34' && a.p_consent_at === '2026-10-02T12:00:00.000Z',
    JSON.stringify(a));
  t('submit args keep the honeypot empty for a human', a.p_honeypot === '');
  t('submit args expose no key material', !JSON.stringify(a).includes('sb_'));
}

// share links
{
  const s = shareLinks('https://owoworks.example/?lane=promoter', 'AB12CD34');
  t('share URL embeds the code', s.url === 'https://owoworks.example/?ref=AB12CD34', s.url);
  t('query stripped before ref attached', !s.url.includes('lane='));
  t('whatsapp intent encoded', s.whatsapp.startsWith('https://wa.me/?text=') && s.whatsapp.includes('AB12CD34'));
  t('twitter intent encoded', s.twitter.includes('twitter.com/intent/tweet') && s.twitter.includes('AB12CD34'));
  t('facebook intent encoded', s.facebook.includes('facebook.com/sharer') && s.facebook.includes(encodeURIComponent('https://owoworks.example/?ref=AB12CD34')));
  t('share copy makes no income promise',
    !/earn â‚¦|guaranteed|instant|passive/i.test(decodeURIComponent(s.whatsapp)));
}

console.log(`\n  PASS ${pass}   FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
