<picture>
  <source media="(prefers-color-scheme: dark)" srcset="apps/web/assets/identity/banner-dark.png" />
  <img src="apps/web/assets/identity/banner-light.png" alt="Promota — Naija promotes the world" width="100%" />
</picture>

# Promota — Naija promotes the world

Money that works as hard as you do. A two-sided promotion marketplace: businesses fund
campaigns; verified Nigerians promote from their own accounts with disclosure and earn mobile
data first, cash as they grow — for checked results only.

- **Brand law:** `docs/BRAND.md` (palette pairs measured, voice rules, asset inventory).
- **Skill provenance:** `docs/BRAND-SKILLS.md` (what was adopted, from where, what was NOT installed).
- **Verified state:** `STATUS.md` (claims with evidence; blockers named, nothing assumed).

## Run

```powershell
npm test     # phone validation, 17 tests
npm run site # page integrity: anchors, assets, SEO basics, theme switch, a11y tokens
npm run serve # preview at http://127.0.0.1:8080 (loopback only)
```

## Layout

```
apps/web/          pilot landing (themed, no backend yet — the form says so on the page)
db/migrations/     Supabase schema: RBAC, ledger, escrow, tasks, payouts, disputes, RLS
scripts/           site checker, preview server, identity exporter
apps/web/assets/identity/   SVG masters + verified PNG exports + DESIGN_BRIEF.json
docs/              BRAND.md, BRAND-SKILLS.md
```

## Pre-launch truths (do not edit these away without proof)

- The form validates and discards. No backend, no auth, no lead capture yet.
- `noindex` stays until the SEO-D1 removal trigger is met (see amplo `docs/SEO.md`).
- RLS policies are deployed but UNPROVEN — staging with real JWTs required.
- "Promota" cleared a web prior-art check only. Trademark + CAC + domain: UNVERIFIED.
