# STATUS.md — verified state of the OwoWorks repo

**Date:** 2026-10-03. **Rule:** nothing below is claimed without a passing check. Items that
cannot be proven here are marked UNVERIFIED with their proof venue, never passed.

## Where this code comes from

The system code is the audited, repaired output of the `amplo` build (8 commits, gate
41/0/0 GREEN): double-entry ledger with deferred-constraint enforcement, escrow-before-live,
task state machine with 24h auto-approve, payout eligibility, dispute lifecycle, RBAC with
trigger-guarded roles, typed settings, append-only audit, RLS policies. This repo rebrands it
as OwoWorks and optimises the web surface; it does not re-prove the database.

## Verified now (local engine — PGlite/WASM, a real PostgreSQL build)

| Claim | Evidence |
|---|---|
| All seven migrations execute on real PostgreSQL | `node scripts/migrateUp.mjs` — 7 APPLIED |
| Core ledger invariants hold | `node db/ledger.test.mjs` — 56 PASS / 0 FAIL / 2 UNVERIFIED |
| Lead capture + `submit_lead` hold | `node db/leads.test.mjs` — 37 PASS / 0 FAIL / 1 UNVERIFIED |
| Abuse controls hold for every DB role | honeypot + consent freshness in trigger AND RLS |
| Referrals pay zero, count queue only | schema + `docs/LEAD-CAPTURE.md` §3 (anti-MLM rule) |
| `anon` cannot touch `leads` or the migration ledger | privilege tests in `db/leads.test.mjs` |
| Phone validation correct | `npm test` — 17 phone + client + 56 + 37 tests |
| Web surface passes integrity | `npm run site` |
| Palette accessible | every pair in `docs/BRAND.md` §2, WCAG 2.2 AA |

Proof bundles: `PROOF/C1-lead-backend-live/` and `PROOF/C2-live-api-proof/`
(manifests + raw command output + artifact hashes).

## Live Supabase project (connected and proven over HTTPS)

- Project `ykyvmgdruterzrmltquz`; credentials authenticate (`node scripts/dbProbe.mjs`).
- **All six migrations `0001`–`0006` are applied live** (recorded in the ledger).
- `node db/live.proof.mjs` — **PASS 14 / FAIL 0 / UNVERIFIED 0 — LIVE API PROOF: ALL HOLD.**
  Proves over the real network, with the shipped publishable key: a visitor can submit a
  sign-up; a visitor cannot read, update or delete the sign-up list; a visitor cannot read
  the migration ledger; duplicates are refused; a signed-in account is also blocked from
  the sign-up list but can read shared campaign data; the row and its outbox event really
  exist. Every test row and account is deleted afterwards (204/204/200).

## Closed live findings

- The migration ledger `public.owoworks_schema_migrations` had inherited public grants
  (`anon[siud]`). `0006` revoked them and enabled RLS; live re-probe now shows
  `anon[----] auth[----]`. **Closed.**
- The web client used `Prefer: return=representation` on a direct `leads` insert, which
  needs SELECT that `anon` does not have. It now calls the single public action
  `submit_lead` (`apps/web/app.js`), proven live. **Closed.**
- `apps/web/config.js` now exists (gitignored, publishable key only, generated from `.env`),
  so the site is live-capable. **Closed.**

## Carry-over truth (from amplo, unchanged)

- **RLS policies verified over HTTP** by `db/live.proof.mjs` (see `PROOF/C2-live-api-proof/`).
- **Pre-launch `noindex`** per SEO-D1 (removal trigger documented in amplo `docs/SEO.md`).
- **PRD has 0 acceptance criteria; admin/roles/settings UI 0%; compliance map unsourced.**

## Blockers (owner actions)

1. Trademark + CAC + domain clearance for "OwoWorks" (web prior-art done; legal clearance NOT done).
2. ~~`gh auth login` → create `erpforgeafrica-dotcom/owoworks` remote → push.~~ **DONE** — remote
   `erpforgeafrica-dotcom/OwoWorks`, `main` pushed and verified on GitHub (HEAD `f9ecdd2`).
3. Railway target account confirmed in-conversation (`railway whoami` before any state change).
4. Registered entity name/jurisdiction + PII-storage decision.
5. Termii API key for the SMS double opt-in worker.

## Identity export verification

| File | Expected | Measured |
|---|---|---|
| `apps/web/assets/identity/og-image.png` | 1200×630 | read back via sharp metadata |
| `apps/web/assets/identity/favicon-180.png` | 180×180 | read back via sharp metadata |
| `apps/web/assets/identity/banner-dark.png` / `banner-light.png` | 1600×480 | read back via sharp metadata |
