# OwoWorks — Brand Book v1.0

**Status:** ACTIVE (pilot, pre-launch) · **Date:** 2026-10-02 · **Owner:** erpforgeafrica-dotcom
**Single source of truth for the name, story, palette, voice and assets.** Any surface that
contradicts this file is a defect. Machine-readable manifest: `brand.yaml`.

Skills honoured in this book (LOADED with timestamps in amplo `STATE.md`):
`canvas-design` (visual philosophy → artifacts), `copywriting` (clarity, honesty, customer
language), `marketing-psychology` (JTBD, inversion, theory of constraints), plus the naming /
brand-package method of `cofoundy/brand-skills` and the token + contrast discipline of
`aiagentskills/skills/.../applying-brand-guidelines`. Provenance, URLs and access dates:
`docs/BRAND-SKILLS.md`. No third-party skill code was executed; methods were read and applied.

---

## 1. The name

**OwoWorks** — pronounced *oh-woh-works*.

- **Owo** = money (Yoruba). Short, ownable spelling, pan-Nigerian recognition, globally pronounceable.
- **Works** = jobs that exist, work that is real, and *"it works"* — the trust answer to a
  scam-burned category.
- Read as a sentence it promises the whole model: **money that works as hard as you do.**

### Naming record (prior art checked 2026-10-02, web search)

| Candidate | Verdict | Evidence |
|---|---|---|
| HustleBridge | REJECTED — taken | Active gig-income brand, 200+ creators (LinkedIn, Brandon Cook, 2025-08-21) |
| NaijaBridge | REJECTED — taken | naijabridge.com, Nigerian classified ads, active 2025 |
| NaijaVoice | REJECTED — taken | naijavoice.app, language learning, founded 2026, active |
| NaijaStage | REJECTED — crowded | The Stage Nigeria, AfricaStage, StageRave, Naija.Events (all entertainment) |
| Aiki | REJECTED — taken | aikiapp.com marketplace + aiki.ng employability portal, both Lagos |
| WakaWorks | REJECTED — taken | wakawork.com, Nigerian artisan marketplace, active 2026 |
| PromoteNaija | REJECTED — taken | promotenaija.com music promo + #PromoteNaija VConnect campaign |
| GigNaija | REJECTED — taken | naijagigs.net + NiYA Gigs (Federal Ministry of Youth Development) + gigs.ng |
| KudiBridge | REJECTED — collision risk | Kudi is Nomba's former name (major Nigerian fintech) |
| **OwoWorks** | **ACCEPTED** | No exact hit. Residual risk (see below). |

**Residual risk, stated not hidden:** OWORKS (oworks.net, tech services) is a near-spelling in an
unrelated class and country; Owo is also a town in Ondo State. Web search is not a trademark search:
a Nigerian trademark clearance (CAC + Trademarks Registry) is REQUIRED before launch spend. Domain
and CAC availability are UNVERIFIED — recorded as blockers in `STATUS.md`, not assumed.

### Story (the kernel)

The world's virtual job stage denies Nigerians entry — no PayPal, no minimums they can reach, no
trust. OwoWorks employs Nigerians to promote brands globally and at home, and pays in what they
actually use: mobile data first, cash as they grow. Every reward is for a **checked result**, never
for fake likes, never for recruiting people.

- **One-liner:** Naija promotes the world — and gets paid.
- **Promoter line:** Your phone is your office. Promote real brands, earn real data and cash.
- **Business line:** Pay only for outcomes you can count: checked clicks, sign-ups, promo-code use.
- **Trust line:** No joining fee. No payment for recruiting. No income promises. Ever.

### Archetype

Everyman + Hero: ordinary students, traders and riders doing dignified, verifiable paid work. The
brand never talks down, never hypes, never recruits — it **employs**.

---

## 2. Palette — every pair measured 2026-10-02 (WCAG 2.2 AA)

Heritage note: primary green is Nigeria's flag green `#008751`. Gold is the reward accent. Nothing
here is decoration: each pair below carries its measured ratio and its usage law.

### Dark theme (default)

| Token | Value | Used for | Proved pair |
|---|---|---|---|
| `--ink` | `#04120b` | page background | gold on ink 9.57:1 ✓ |
| `--field` | `#0a2115` | cards, form shells | brand green on field 3.69:1 (large/bold UI only) |
| `--brand` | `#008751` | primary buttons WITH WHITE TEXT, badges, brand tile | white on brand 4.58:1 ✓ |
| `--brand-deep` | `#046a41` | button hover, focus rings on light | white on deep 6.68:1 ✓ |
| `--gold` | `#d9b263` | reward accents ON DARK ONLY, eyebrows, coin | gold on ink 9.57:1 ✓ |
| `--gold-bright` | `#f4dc9d` | links on dark | 14.7:1 class (inherited scale) |
| `--text` | `#eef3ee` | body on dark | 17.7:1 ✓ |
| `--muted` | `#93a29a` | secondary on dark | 6.9:1 ✓ |
| `--faint` | `#8d9c93` | placeholders, legal microcopy | 6.9:1 ✓ |
| `--line-strong` | `#4d6d58` | input borders on dark | 3.44:1 ✓ (UI boundary ≥3.0) |
| `--signal` | `#3ecf8e` | success on dark | 9.2:1 ✓ |
| `--danger` | `#ff9b9b` | errors on dark | 9.1:1 ✓ |

### Light theme (`[data-theme="light"]`)

| Token | Value | Rule |
|---|---|---|
| page / cards | `#f4f7f2` / `#ffffff` | body `#101915` on cream 16.58:1 ✓ |
| brand text on light | `#046a41` ONLY | 6.18:1 ✓ (`#008751` body text FAILS at 4.24 — banned for text) |
| gold text on light | `#6d5518` ONLY | 6.6–7.1:1 ✓ |
| input border on white | `#4d6d58` | 5.76:1 ✓ |
| danger / signal on white | `#b33636` / `#0d7a4c` | 6.0 / 5.4:1 ✓ |

### Hard laws (violations are brand defects)

1. **Gold never sits on brand green** (measured 2.29:1). Gold lives on dark ink only.
2. **Never dark text on brand green** (4.18:1). Brand-green surfaces always carry white text (4.58:1).
3. **Never brand-green body text on light** (4.24:1). Light-mode brand text is deep green, always.
4. Buttons: brand-green + white (primary), gold gradient + `#161003` (reward CTA, dark surfaces only).
5. No new brand colours without a measured pair in this table. The table is the law.

---

## 3. Typography

Zero-dependency system stack (no webfont downloads — speed is a brand value on 2G):

- **Display:** Georgia, "Times New Roman", serif — trust, premium, newspaper-grade headlines.
- **Body/UI:** "Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif.
- Scale: display `clamp(2rem, 5.2vw, 3.6rem)` tight `-0.015em`; section `clamp(1.5rem, 3vw, 2.1rem)`;
  body 16px/1.65; microcopy ≥13px and never below the `--faint` contrast floor.
- No italics for meaning, no all-caps paragraphs, no exclamation points (copywriting skill §style).

---

## 4. Logo and identity

Concept (canvas-design method: philosophy first — *"a coin held up like a small sun over a bridge
arch; labour made visible"*): a rounded Naija-green tile carrying a gold ring broken at the top-right
by an upward arrow — money in motion, rising. Wordmark in Georgia serif, "Owo" in text colour,
"Works" in brand green (light) / gold (dark).

| Asset | File | Rule |
|---|---|---|
| Master logo (dark bg) | `apps/web/assets/identity/logo-dark.svg` | gold ring + arrow, cream wordmark |
| Master logo (light bg) | `apps/web/assets/identity/logo-light.svg` | green tile, deep-green wordmark |
| App icon / favicon | `apps/web/assets/identity/favicon.svg` (+ `.png` 180px) | tile + ring only, legible at 16px |
| Social share | `apps/web/assets/identity/og-image.png` (1200×630) | exported from SVG source via sharp; dimensions verified |
| Banner pair | `apps/web/assets/identity/banner-dark.png`, `banner-light.png` | README theme-aware `<picture>` |

Minimum clear space = height of the ring; minimum digital size 24px; never recolour, stretch,
drop-shadow or place on photography without the scrim. Design decisions: `apps/web/assets/identity/DESIGN_BRIEF.json`.

---

## 5. Voice (copywriting + marketing-psychology, applied)

JTBD: the user hires us for *"prove this is real, tell me the pay, pay me fast."* Every screen must
answer all three or it fails.

1. **Clarity over cleverness.** "Earn data for checked posts" beats any slogan near a button.
2. **Customer language.** MTN/Glo/Airtel, Opay/Kuda/PalmPay, "hold", "on the way" — never escrow,
   attribution, aggregator, cohort, margin near a user.
3. **Specificity.** "48 to 72 hour hold" not "fast payouts". "MTN, Glo, Airtel" not "all networks".
4. **Honest over sensational.** No income figures, no "passive", no "guaranteed", no "instant".
   Fabricated proof is a legal liability, not a marketing tactic.
5. **Inversion (what guarantees failure):** a pending state with no date (Sidegig's "checking Gigs"),
   a price revealed at payout, support that never answers. The product forbids all three by design:
   24h auto-approve, per-task NGN price up front, dispute SLA 48–72h.
6. Pidgin is seasoning, never the meal: one warm line per screen maximum ("How far? Let's work.").

Banned words until measured: guaranteed, passive income, risk-free, earn ₦X per day, no investment,
instant payout, double your money, financial freedom.

---

## 6. Asset inventory

```
apps/web/assets/identity/
  logo-dark.svg / logo-light.svg   master artwork (source of truth)
  favicon.svg / favicon-180.png    app icon + PNG export
  og-image.png                     1200x630 social share (PNG export, verified)
  banner-dark.png / banner-light.png
  DESIGN_BRIEF.json                decisions (repo-branding structure)
brand.yaml                         SSOT manifest (brand-skills method)
```

## 7. Governance

- This file + `brand.yaml` are versioned with the repo. Rebrands go through a PR with designer review.
- Palette changes require measured ratios appended to §2 before merge.
- Quarterly brand audit (6 dimensions: recognition, consistency, trust signals, voice compliance,
  asset hygiene, collision watch). First review: 2027-01-02.
