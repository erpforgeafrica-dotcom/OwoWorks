const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

/* ---------- theme: stored choice > OS preference > dark. Mirrors the
   no-flash boot script in <head>; keep the two in sync. ---------- */
const THEME_KEY = 'owoworks-theme';
const THEME_META = { dark: '#04120b', light: '#f4f7f2' };

function readTheme() {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch (e) { /* storage unavailable */ }
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
  return 'dark';
}

function paintTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const meta = document.getElementById('themeColor');
  if (meta) meta.setAttribute('content', THEME_META[theme]);
  const light = theme === 'light';
  $$('#themeBtn, #themeBtnMobile').forEach(btn => {
    btn.setAttribute('aria-pressed', String(light));
    btn.setAttribute('aria-label', light ? 'Switch to dark theme' : 'Switch to light theme');
    btn.textContent = light ? 'Dark' : 'Light';
    if (btn.id === 'themeBtnMobile') btn.textContent = light ? 'Dark theme' : 'Light theme';
  });
}

function setTheme(theme) {
  try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* session only */ }
  paintTheme(theme);
}

paintTheme(readTheme());
$$('#themeBtn, #themeBtnMobile').forEach(btn => {
  btn.addEventListener('click', () => {
    setTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
  });
});

/* ---------- mobile menu ---------- */
const menuBtn = $('#menuBtn');
const mobileMenu = $('#mobileMenu');

if (menuBtn && mobileMenu) {
  menuBtn.addEventListener('click', () => {
    const open = mobileMenu.classList.toggle('open');
    menuBtn.setAttribute('aria-expanded', String(open));
  });
  mobileMenu.addEventListener('click', e => {
    if (e.target.tagName === 'A') {
      mobileMenu.classList.remove('open');
      menuBtn.setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && mobileMenu.classList.contains('open')) {
      mobileMenu.classList.remove('open');
      menuBtn.setAttribute('aria-expanded', 'false');
      menuBtn.focus();
    }
  });
}

/* ---------- FAQ accordion (buttons already carry aria-controls in markup) --- */
$$('#faqList .q').forEach(btn => {
  btn.addEventListener('click', () => {
    const panel = document.getElementById(btn.getAttribute('aria-controls')) || btn.nextElementSibling;
    const open = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!open));
    panel.classList.toggle('open', !open);
    btn.querySelector('span').textContent = open ? '+' : '–';
  });
});

/* ---------- lanes ---------- */
const LANES = {
  promoter: { label: 'Your main platform', placeholder: 'YouTube', heading: 'Promoter' },
  owner:    { label: 'What your business sells', placeholder: 'A course, a shop, an app', heading: 'Business' },
  partner:  { label: 'Your partner type', placeholder: 'Agency, data reseller, community', heading: 'Partner' }
};

const tabs = $$('.tab');
const extraLabel = $('#extraLabel');
const extraInput = $('#fExtra');
const form = $('#leadForm');
const status = $('#formStatus');
const successBox = $('#successBox');
const successText = $('#successText');
const submitBtn = $('#submitBtn');
let lane = 'promoter';

function selectLane(name, focusTab) {
  if (!LANES[name]) return;
  lane = name;
  tabs.forEach(t => {
    const on = t.dataset.form === name;
    t.setAttribute('aria-checked', String(on));
    t.classList.toggle('active', on);
    t.tabIndex = on ? 0 : -1;
    if (on && focusTab) t.focus();
  });
  extraLabel.textContent = LANES[name].label;
  extraInput.placeholder = LANES[name].placeholder;
}

tabs.forEach((t, i) => {
  t.addEventListener('click', () => selectLane(t.dataset.form));
  // Roving tabindex radiogroup: arrows move, selection follows focus.
  t.addEventListener('keydown', e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    const next = tabs[(i + dir + tabs.length) % tabs.length];
    selectLane(next.dataset.form, true);
  });
});

$$('[data-lane]').forEach(el => {
  el.addEventListener('click', () => {
    selectLane(el.dataset.lane);
    if (form) form.scrollIntoView({ block: 'center' });
  });
});

const fromUrl = new URLSearchParams(location.search).get('lane');
if (fromUrl && LANES[fromUrl]) selectLane(fromUrl);

/* ---------- Nigerian phone validation ----------
   National form is 0 + 10 digits (11 total); international is 234 + 10 digits
   (13 total). A 12-digit "234..." input is malformed and must be rejected, not
   normalised into a 10-digit number. Prefixes follow NCC live allocation. */
const MSISDN_PREFIXES = ['080', '081', '070', '090', '071'];

function validMsisdn(local) {
  if (!/^0\d{10}$/.test(local)) return null;
  return MSISDN_PREFIXES.some(p => local.startsWith(p)) ? local : null;
}

function normalisePhone(raw) {
  const d = raw.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('0')) return validMsisdn(d);
  if (d.length === 13 && d.startsWith('234')) return validMsisdn('0' + d.slice(3));
  return null;
}

/* ---------- lead form ----------
   The status message always describes the field that receives focus. The old
   code let the last error overwrite the first while focus went to the first -
   announcing the wrong error to screen readers. */
/* ---------- lead capture backend ----------
   Live mode calls one Supabase PostgREST function, submit_lead (no SDK, no
   dependency). The publishable key is public by design; database grants and
   row-level security are the enforcement. The function is the only write
   path - the public holds no direct table privilege. Without window.PROMOTA
   (see config.example.js) the form reports that it is not connected; it never
   pretends to have sent anything. */
function backendConfig() {
  const c = (typeof window !== 'undefined' && window.PROMOTA) || null;
  if (c && c.SUPABASE_URL && c.SUPABASE_ANON_KEY) return c;
  return null;
}

function getRefFromLocation(search) {
  const m = /[?&]ref=([A-Za-z0-9]{1,16})/.exec(search || '');
  return m ? m[1].toUpperCase() : null;
}

function isReferralCodeFormat(code) {
  return /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/.test(code || '');
}

function getUtm(search) {
  const q = new URLSearchParams(search || '');
  return {
    utm_source: q.get('utm_source') || null,
    utm_medium: q.get('utm_medium') || null,
    utm_campaign: q.get('utm_campaign') || null
  };
}

function buildLeadPayload(o) {
  return {
    lane: o.lane,
    full_name: o.name,
    phone: o.phone,
    platform_extra: o.extra || null,
    note: o.note || null,
    referred_by_code: o.ref || null,
    utm_source: o.utm.utm_source,
    utm_medium: o.utm.utm_medium,
    utm_campaign: o.utm.utm_campaign,
    consent_at: o.now,
    honeypot: ''
  };
}

function shareLinks(pageUrl, code) {
  const url = pageUrl.split('?')[0] + '?ref=' + code;
  const text = 'I joined the Promota pilot list - real virtual jobs for Nigerians, paid in data and cash for checked work. No joining fee, no stories. Join with my invite:';
  return {
    url,
    whatsapp: 'https://wa.me/?text=' + encodeURIComponent(text + ' ' + url),
    twitter: 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text) + '&url=' + encodeURIComponent(url),
    facebook: 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(url)
  };
}

/* Map the form payload onto the named arguments of submit_lead. Kept as a
   pure function so apps/web/lead.test.mjs can assert the contract exactly. */
function buildSubmitArgs(payload) {
  return {
    p_lane: payload.lane,
    p_full_name: payload.full_name,
    p_phone: payload.phone,
    p_platform_extra: payload.platform_extra,
    p_note: payload.note,
    p_referred_by_code: payload.referred_by_code,
    p_utm_source: payload.utm_source,
    p_utm_medium: payload.utm_medium,
    p_utm_campaign: payload.utm_campaign,
    p_consent_at: payload.consent_at,
    p_honeypot: payload.honeypot
  };
}

async function submitLead(cfg, payload) {
  const res = await fetch(cfg.SUPABASE_URL + '/rest/v1/rpc/submit_lead', {
    method: 'POST',
    headers: {
      'apikey': cfg.SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + cfg.SUPABASE_ANON_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(buildSubmitArgs(payload))
  });
  if (!res.ok) {
    const err = new Error('The list is not reachable right now. Your details were not sent - please try again.');
    err.code = 'network';
    throw err;
  }
  // submit_lead answers with a plain object: { ok, referral_code, position,
  // referred }, or { ok:false, message } when it refuses. It never returns
  // personal data.
  const out = await res.json();
  if (!out || out.ok !== true) {
    const err = new Error(out && out.message ? out.message : 'That sign-up could not be completed.');
    err.code = 'refused';
    throw err;
  }
  return out;
}

async function rpcPosition(cfg, code) {
  try {
    const res = await fetch(cfg.SUPABASE_URL + '/rest/v1/rpc/lead_position', {
      method: 'POST',
      headers: {
        'apikey': cfg.SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + cfg.SUPABASE_ANON_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ p_code: code })
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) { return null; }
}

async function rpcPreview(cfg, code) {
  try {
    const res = await fetch(cfg.SUPABASE_URL + '/rest/v1/rpc/preview_referral', {
      method: 'POST',
      headers: {
        'apikey': cfg.SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + cfg.SUPABASE_ANON_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ p_code: code })
    });
    if (!res.ok) return { valid: false };
    return await res.json();
  } catch (e) { return { valid: false }; }
}

/* Invite landing: ?ref=CODE shows who invited you (masked) and attaches the
   code to your signup. Without a backend the code is still attached locally
   and honoured when the backend arrives - never silently dropped. */
let pendingRef = getRefFromLocation(typeof location !== 'undefined' ? location.search : '');
const inviteBanner = $('#inviteBanner');
const inviteText = $('#inviteText');
async function resolveInvite() {
  if (!pendingRef || !inviteBanner) return;
  if (!isReferralCodeFormat(pendingRef)) { pendingRef = null; return; }
  const cfg = backendConfig();
  if (!cfg) {
    inviteText.textContent = 'You arrived with an invite code. It will be attached to your signup.';
    inviteBanner.hidden = false;
    return;
  }
  const p = await rpcPreview(cfg, pendingRef);
  if (p && p.valid) {
    inviteText.textContent = `You were invited by ${p.referrer} - their code will be attached to your signup.`;
    inviteBanner.hidden = false;
  } else {
    pendingRef = null;
  }
}
if (typeof document !== 'undefined') resolveInvite();

function setError(input, message) {
  if (message) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
  return message;
}

if (form) {
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const name = $('#fName');
    const phone = $('#fPhone');
    const extra = $('#fExtra');
    const note = $('#fNote');

    const nameError = !name.value.trim() ? 'Enter your name.' : null;
    const normalised = normalisePhone(phone.value);
    const phoneError = !normalised
      ? 'Use a Nigerian number, for example 0803 000 0000 or +234 803 000 0000.'
      : null;

    setError(name, nameError);
    setError(phone, phoneError);

    // Show the error for the field the user is sent to - never a mismatched one.
    const firstBad = nameError ? { input: name, message: nameError }
      : phoneError ? { input: phone, message: phoneError } : null;
    if (firstBad) {
      status.textContent = firstBad.message;
      status.className = 'form-status error';
      firstBad.input.focus();
      return;
    }

    status.textContent = '';
    status.className = 'form-status';
    const cfg = backendConfig();
    const payload = buildLeadPayload({
      lane,
      name: name.value.trim(),
      phone: normalised,
      extra: extra.value.trim(),
      note: note.value.trim(),
      ref: pendingRef,
      utm: getUtm(location.search),
      now: new Date().toISOString()
    });

    if (!cfg) {
      // Not connected: say so plainly. Never show a success screen for a
      // sign-up that was not sent.
      status.textContent = 'This form is not connected yet. Please try again later.';
      status.className = 'form-status error';
      return;
    }

    submitBtn.disabled = true;
    status.textContent = 'Sending…';
    try {
      const lead = await submitLead(cfg, payload);
      form.hidden = true;
      $('#successTitle').textContent = 'You are on the list';
      successText.textContent =
        `You are on the list, ${payload.full_name}. Your invite code is below - share it and move up the queue.`;
      showReferral(lead.referral_code, cfg, lead);
      successBox.hidden = false;
      successBox.setAttribute('tabindex', '-1');
      successBox.focus();
    } catch (err) {
      status.textContent = err.message;
      status.className = 'form-status error';
      phone.focus();
    } finally {
      submitBtn.disabled = false;
    }
  });
}

const refBox = $('#refBox');
const refCode = $('#refCode');
const refLink = $('#refLink');
const refPosition = $('#refPosition');

async function showReferral(code, cfg, result) {
  if (!refBox) return;
  const links = shareLinks(location.href, code);
  refCode.textContent = code;
  refLink.textContent = links.url;
  refLink.href = links.url;
  $('#shareWa').href = links.whatsapp;
  $('#shareTw').href = links.twitter;
  $('#shareFb').href = links.facebook;
  refBox.hidden = false;
  // submit_lead already returned the queue numbers; only fall back to a
  // separate lookup when they were not supplied.
  const pos = (result && typeof result.position === 'number')
    ? { valid: true, position: result.position, referred: result.referred }
    : await rpcPosition(cfg, code);
  if (pos && pos.valid) {
    refPosition.textContent =
      `You are number ${pos.position} in line` +
      (pos.referred > 0 ? `, and ${pos.referred} ${pos.referred === 1 ? 'person has' : 'people have'} joined with your code.` : '. Share your code to move up.');
  } else {
    refPosition.textContent = 'Share your code below - every invite moves you up the queue.';
  }
}

$('#copyRef')?.addEventListener('click', async e => {
  const btn = e.currentTarget;
  try {
    await navigator.clipboard.writeText(refLink.textContent);
    btn.textContent = 'Copied';
  } catch (err) {
    btn.textContent = 'Copy the link above';
  }
  setTimeout(() => { btn.textContent = 'Copy invite link'; }, 2500);
});

$('#againBtn')?.addEventListener('click', () => {
  successBox.hidden = true;
  form.hidden = false;
  form.reset();
  form.scrollIntoView({ block: 'center' });
  $('#fName').focus();
});
