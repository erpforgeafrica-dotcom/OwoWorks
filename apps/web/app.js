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
function setError(input, message) {
  if (message) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
  return message;
}

if (form) {
  form.addEventListener('submit', e => {
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
    form.hidden = true;
    successText.textContent =
      `Checked ${LANES[lane].heading.toLowerCase()} details for ${name.value.trim()} on ${normalised}` +
      (extra.value.trim() ? `, ${extra.value.trim()}` : '') +
      (note.value.trim() ? `. Note: ${note.value.trim()}` : '.') +
      ' Nothing was stored and nothing was transmitted.';
    successBox.hidden = false;
    successBox.setAttribute('tabindex', '-1');
    successBox.focus();
  });
}

$('#againBtn')?.addEventListener('click', () => {
  successBox.hidden = true;
  form.hidden = false;
  form.reset();
  form.scrollIntoView({ block: 'center' });
  $('#fName').focus();
});
