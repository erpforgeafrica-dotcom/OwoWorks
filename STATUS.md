# STATUS.md — verified state of the OwoWorks repo

**Date:** 2026-10-02. **Rule:** nothing below is claimed without a passing check. Items that
cannot be proven here are marked UNVERIFIED with their proof venue, never passed.

## Where this code comes from

The system code is the audited, repaired output of the `amplo` build (8 commits, gate
41/0/0 GREEN): double-entry ledger with deferred-constraint enforcement, escrow-before-live,
task state machine with 24h auto-approve, payout eligibility, dispute lifecycle, RBAC with
trigger-guarded roles, typed settings, append-only audit, RLS policies. This repo rebrands it
as OwoWorks and optimises the web surface; it does not re-prove the database.

| Claim | Evidence |
|---|---|
| Migrations execute on real PostgreSQL | `npm run db:sql` in amplo + `db/ledger.test.mjs` 56/56 (see amplo `PROOF/`) |
| Web surface passes integrity | `npm run site` in THIS repo (run before every commit) |
| Phone validation correct | `npm test` — 17 tests incl. 12-digit regression |
| Palette accessible | every pair in `docs/BRAND.md` §2 measured 2026-10-02, WCAG 2.2 AA |
| Logo PNG exports genuine | dimensions read back from the files (see table below) |

## Carry-over truth (from amplo, unchanged)

- **No backend, no auth, no lead capture.** The form validates and discards; the page says so.
- **RLS policies UNVERIFIED** — need Supabase staging + real JWTs. Proof venue named, not faked.
- **Pre-launch `noindex`** per SEO-D1 (removal trigger documented in amplo `docs/SEO.md`).
- **PRD has 0 acceptance criteria; admin/roles/settings UI 0%; compliance map unsourced.**

## Blockers (owner actions)

1. Trademark + CAC + domain clearance for "OwoWorks" (web prior-art done; legal clearance NOT done).
2. `gh auth login` → create `erpforgeafrica-dotcom/owoworks` remote → push.
3. `SUPABASE_ACCESS_TOKEN` → Supabase project wiring + RLS JWT proof.
4. Registered entity name/jurisdiction + PII-storage decision.

## Identity export verification

| File | Expected | Measured |
|---|---|---|
| `apps/web/assets/identity/og-image.png` | 1200×630 | read back via sharp metadata |
| `apps/web/assets/identity/favicon-180.png` | 180×180 | read back via sharp metadata |
| `apps/web/assets/identity/banner-dark.png` / `banner-light.png` | 1600×480 | read back via sharp metadata |
