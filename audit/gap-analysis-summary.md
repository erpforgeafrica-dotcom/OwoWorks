# Promota/OwoWorks — Gap Analysis Summary

**Generated:** 2026-10-05  
**Repository:** `C:\Users\pc\owoworks`  
**Scope:** Complete gap analysis across docs, DB schema (7 migrations), server implementation, tests, and Railway deployment

---

## Executive Summary

| Category | Status | Details |
|----------|--------|---------|
| **Lead Capture** | ? **COMPLETE & PROVEN LIVE** | `submit_lead` RPC + referral engine + outbox events; 37 DB tests + 17 client tests + live proof (14/0/0) |
| **Brand / Design System** | ? **COMPLETE** | WCAG 2.2 AA palette, zero-dep typography, theme toggle, assets verified |
| **Static Site Integrity** | ? **COMPLETE** | Anchors, assets, SEO basics, a11y tokens, CSP, security headers all pass |
| **Database Schema** | ? **COMPLETE & PROVEN** | 7 migrations apply cleanly; ledger invariants hold (56 tests); RLS policies proven live |
| **Migration System** | ? **COMPLETE & PROVEN** | PGlite local + Supabase remote with advisory locks, checksums, drift detection |
| **Railway Deployment** | ? **LIVE** | `https://web-production-045b1.up.railway.app` — verified 19/0 |
| **RLS Policies** | ? **PROVEN LIVE** | 14/0/0 over HTTPS with anon JWT — visitor can submit, cannot read/update/delete |
| **CI/CD** | ?? **MANUAL ONLY** | Deploy works but no GitHub Actions; manual `git push` ? Railway auto-deploy |
| **Admin Dashboard** | ? **0% BUILT** | DB schema + RLS ready; no API, no UI |
| **Promoter Dashboard** | ? **0% BUILT** | DB schema ready; only lead capture form exists |
| **Business / Campaign Manager** | ? **0% BUILT** | DB schema ready; needs payment gateway integration |
| **Partner Portal** | ? **0% BUILT** | DB schema ready |
| **Payouts / Ledger Execution** | ? **DB ONLY** | Double-entry ledger proven; no payout worker, no provider integrations |
| **Task State Machine** | ? **DB ONLY** | State machine + 24h auto-approve proven; no API, no assignment, no promoter UI |
| **Disputes** | ? **DB ONLY** | Lifecycle proven; no API, no UI |
| **SMS/Termii Verification** | ? **MISSING WORKER** | Outbox handoff ready; Termii API key missing (blocker #5) |
| **KYC/IDV** | ? **NOT STARTED** | DB fields ready; needs provider (Smile Identity/VerifyMe) |
| **Payment Gateway** | ? **NOT STARTED** | Ledger accounts ready; needs Flutterwave/Paystack/Monnify |
| **Platform OAuth** | ? **NOT STARTED** | No token storage, no OAuth flows |
| **Rate Limiting** | ?? **DB ONLY** | Trigger + RLS abuse controls proven; no edge/app rate limiting |
| **Observability** | ? **MINIMAL** | Console.log only; no structured logging/metrics/alerting |
| **Legal Pages** | ? **MISSING** | Terms/Privacy/Refund promised in footer; not created |
| **Webhooks** | ? **MISSING** | Outbox pattern ready; no HTTP webhook receivers for providers |
| **Compliance/Regulatory** | ? **BLOCKERS** | Trademark/CAC/domain UNVERIFIED; legal entity + NDPA + SEC compliance needed |

---

## Gap Matrix Statistics

| Metric | Count |
|--------|-------|
| **Total Features Analyzed** | 33 |
| **? Complete & Deployed** | 7 |
| **?? Partial / Needs Work** | 3 |
| **? Not Started / Missing** | 23 |
| **Features Requiring External Dependencies** | 15 |
| **Features Closeable Without External Deps** | 18 |

---

## Critical Blockers (Owner Action Required)

| # | Blocker | Source | Status |
|---|---------|--------|--------|
| 1 | Trademark + CAC + domain clearance for "Promota" | STATUS.md #79 | UNVERIFIED |
| 2 | Registered entity name/jurisdiction + PII-storage decision | STATUS.md #85 | UNVERIFIED |
| 3 | Termii API key for SMS double opt-in worker | STATUS.md #87, LEAD-CAPTURE.md §4 | MISSING |
| 4 | Payment gateway (Flutterwave/Paystack/Monnify) for cash payouts | Implied by BRAND.md payout rules | NOT STARTED |
| 5 | KYC/IDV provider (Smile Identity/VerifyMe/Youverify) | BRAND.md, STATUS.md | NOT STARTED |
| 6 | Data aggregator (Termii/Migo/Arkesel) for MTN/Glo/Airtel bundles | BRAND.md FAQ | NOT STARTED |
| 7 | Legal counsel for NDPA compliance + SEC anti-MLM compliance | BRAND.md, LEAD-CAPTURE.md | NOT STARTED |

---

## What Works End-to-End Today

1. **Visitor lands on pilot page** ? sees branded, accessible, themeable site (WCAG 2.2 AA)
2. **Visitor fills lead form** ? client-side validation (phone, honeypot, consent timestamp)
3. **Form submits to `submit_lead` RPC** ? server validates, inserts lead, assigns 8-char referral code, emits `lead.captured` outbox event
4. **Response returns** ? `{ok, referral_code, position, referred}` — zero PII
5. **Success screen shows** ? personal invite link, queue position, referral count, share intents (WhatsApp/X/Facebook)
6. **Invitee clicks `?ref=CODE`** ? banner shows masked referrer name, code attaches to their signup
7. **All proven live** ? `live.proof.mjs` PASS 14/0/0 over HTTPS with real Supabase project

---

## What the Database Provides (Ready for API Layer)

| Domain | Tables | Key Triggers/Functions | Test Coverage |
|--------|--------|------------------------|---------------|
| **Identity & RBAC** | `profiles`, `permissions`, `role_permissions`, `user_permissions` | `assign_role()`, `guard_role_change()`, `has_perm()` | 56 PASS (ledger) |
| **Double-Entry Ledger** | `accounts`, `ledger_entries`, `postings` | Balance constraint (deferred), single-currency, immutability | 56 PASS |
| **Campaigns & Escrow** | `campaigns` | `assert_campaign_funded()`, `apply_campaign_autopause()`, `assert_campaign_margin_floor()` | 56 PASS |
| **Tasks** | `tasks` | `assert_task_transition()`, `auto_approve_stale_tasks()` | 56 PASS |
| **Payouts** | `payouts` | `assert_payout_eligibility()` (KYC t2 + age for cash; verified phone for data) | 56 PASS |
| **Disputes** | `disputes` | `assert_dispute_transition()` (named reviewer required) | 56 PASS |
| **Settings** | `settings` | Typed, versioned, admin-only writes | 56 PASS |
| **Audit** | `audit_log` | Append-only trigger | 56 PASS |
| **Leads & Referrals** | `leads` | `assign_referral_code()`, `notify_lead_captured()`, `submit_lead()`, `preview_referral()`, `lead_position()` | 37 PASS + live proof |
| **Outbox** | `outbox` | `claim_outbox_batch()` (SKIP LOCKED) | 56 PASS + 37 PASS |

---

## Effort Estimates to Close Major Gaps

| Feature | Effort | External Deps Required | Notes |
|---------|--------|------------------------|-------|
| Admin Dashboard (API + UI) | 2-3 weeks | No | DB + RLS ready; needs REST API + React/Vue admin panel |
| Promoter Dashboard (tasks, payouts, disputes) | 3-4 weeks | No | DB ready; needs auth + task assignment + payout history UI |
| Business Campaign Manager | 2-3 weeks | **Yes** (payment gateway) | Escrow funding flow + campaign CRUD + budget tracking |
| Partner Portal | 1-2 weeks | No | DB ready; partner role + permissions exist |
| SMS/Termii Verification Worker | 3-5 days | **Yes** (Termii API key) | Outbox handler + OTP send/verify + `verified_at` update |
| KYC/IDV Integration | 2-3 weeks | **Yes** (KYC provider) | Document upload + provider webhook + tier assignment |
| Payment Gateway Integration | 2-3 weeks | **Yes** (Flutterwave/Paystack) | Payout worker + webhook + reconciliation + idempotency |
| Platform OAuth (YouTube/FB/Twitter) | 2-3 weeks | **Yes** (OAuth providers) | Token storage + API verification + follower count |
| Fraud Detection / Trust Scoring | 2-3 weeks | No (rules-based first) | Trust score computation + review queue + hold/ban automation |
| Data Aggregator Integration | 2-3 weeks | **Yes** (Termii/Migo/Arkesel) | Airtime/data fulfillment + webhook + reconciliation |
| Observability Stack | 1 week | No (self-hosted/Grafana Cloud) | Structured logging + metrics + alerting dashboards |
| Legal Pages | 3-5 days | **Yes** (legal counsel) | Terms + Privacy + Refund policy |
| GitHub Actions CI/CD | 2-4 hours | No | Test + build + deploy workflow |

---

## Test Coverage Summary

| Test Suite | Tests | Pass | Fail | Unverified | Scope |
|------------|-------|------|------|------------|-------|
| `phone.test.mjs` | 17 | 17 | 0 | 0 | Client phone normalization |
| `lead.test.mjs` | 17 | 17 | 0 | 0 | Client ref/UTM/payload/submit args/share links |
| `ledger.test.mjs` | 56 | 56 | 0 | 2 | DB invariants (balance, immutability, idempotency, campaigns, tasks, payouts, roles, disputes, settings, sweeps, outbox, reversal) |
| `leads.test.mjs` | 37 | 37 | 0 | 1 | DB lead capture (capture, referrals, outbox, regression, submit_lead RPC, RLS grants) |
| `live.proof.mjs` | 14 | 14 | 0 | 0 | Live HTTPS RLS matrix (anon submit, no read, no update, no delete, duplicate refused, signed-in blocked, row+outbox exist, cleanup) |
| `verifyLive.mjs` | 19 | 19 | 0 | 0 | Deployed site integrity (static assets, CSP, headers, runtime config, real sign-up) |
| `checkSite.mjs` | ~40 | All | 0 | 0 | Static integrity (anchors, assets, SEO, theme, a11y, reduced-motion, no dummy content) |

**Total:** ~200 automated checks, **0 failures** across all suites.

---

## Railway Deployment Status

| Aspect | Status | Evidence |
|--------|--------|----------|
| **Account** | `Engr.emmamickado@gmail.com` / `m1ckad0's Projects` | `railway whoami` confirmed 2026-10-03 |
| **Project** | `owoworks` (`60ac6fc7-c53d-4150-b419-5ca790e35a96`) | `PROOF/C3-railway-live/` |
| **Service** | `web` / `production` | |
| **Domain** | `https://web-production-045b1.up.railway.app` | |
| **Build** | Dockerfile (node:22-alpine, no npm install) | `railway.json` builder=DOCKERFILE |
| **Runtime Config** | Injected via `server.mjs` from `SUPABASE_URL` + `SUPABASE_ANON_KEY` env vars | `/config.js` endpoint |
| **Security** | Strict CSP, `nosniff`, `frame-deny`, `referrer-policy: no-referrer` | `verifyLive.mjs` PASS |
| **Healthcheck** | `/healthz` returns `{ok: true, config: true}` | `railway.json` healthcheckPath |
| **Verification** | `verifyLive.mjs` PASS 19/0 | `PROOF/C3-railway-live/` |

---

## Recommendations (Priority Order)

### Immediate (This Week)
1. **Add GitHub Actions CI/CD** — 2-4 hours, zero external deps
2. **Add edge rate limiting** (Railway/Cloudflare) — 1 day, zero external deps
3. **Draft legal pages** (Terms/Privacy/Refund) — 3-5 days, needs legal review
4. **Create Termii account + get API key** — unblocks SMS verification worker

### Short Term (2-4 Weeks)
5. **Build Admin Dashboard API + minimal UI** — DB ready, highest leverage for operations
6. **Build Promoter Dashboard** — task assignment, payout history, dispute view
7. **Implement SMS/Termii verification worker** — consumes `lead.captured` outbox
8. **Add observability** (structured logging + Grafana Cloud free tier)

### Medium Term (1-2 Months)
9. **Integrate payment gateway** (Flutterwave/Paystack) for cash payouts
10. **Integrate KYC provider** (Smile Identity/VerifyMe) for cash eligibility
11. **Integrate data aggregator** (Termii/Migo) for MTN/Glo/Airtel bundles
12. **Build Business Campaign Manager** — escrow funding, campaign CRUD, budget tracking
13. **Build Partner Portal** — agency/reseller/community onboarding

### Long Term / Regulatory (Ongoing)
14. **Trademark registration** (Nigeria + international)
15. **CAC registration** (legal entity)
16. **Domain acquisition** (promota.ng / promota.com)
17. **NDPA compliance audit** (data protection)
18. **SEC compliance review** (anti-MLM structure already built-in via referral design)

---

## Files Referenced in This Analysis

### Documentation
- `README.md` — Project overview, run commands, pre-launch truths
- `STATUS.md` — Verified state, live proof, blockers, carry-over truths
- `docs/LEAD-CAPTURE.md` — Lead capture architecture, growth loop, anti-MLM rule, go-live checklist
- `docs/BRAND.md` — Brand book (palette, typography, logo, voice, governance)
- `docs/BRAND-SKILLS.md` — Skill provenance
- `brand.yaml` — Machine-readable brand manifest

### Database Migrations (7 production + 1 local stub)
- `db/migrations/0001_core.sql` — Identity, RBAC, ledger, campaigns, tasks, payouts, disputes, settings, audit, RLS
- `db/migrations/0002_leads.sql` — Lead capture, referrals, outbox, abuse controls, public RPCs
- `db/migrations/0003_access_control.sql` — Grants/revokes, function privileges, indexes, prune, healthcheck
- `db/migrations/0004_submit_lead.sql` — `submit_lead` RPC, `normalise_nigerian_phone`
- `db/migrations/0005_fix_phone_normaliser.sql` — Phone normalizer fix
- `db/migrations/0006_secure_migration_ledger.sql` — Migration ledger hardening (RLS + revoke)
- `db/migrations/0007_fix_submit_lead_oracle.sql` — `submit_lead` indistinguishability fix
- `db/migrations/local/0000_auth_stub.sql` — Local auth stub (PGlite only)

### Server & Client
- `server.mjs` — Production static server with runtime config injection
- `apps/web/app.js` — Client app (theme, form, validation, submit_lead, referrals, invites)
- `apps/web/index.html` — Pilot landing page (noindex, theme-aware, accessible)
- `apps/web/theme-boot.js` — No-flash theme boot script

### Tests
- `apps/web/phone.test.mjs` — Phone normalization (17 tests)
- `apps/web/lead.test.mjs` — Client logic (17 tests)
- `db/ledger.test.mjs` — Ledger invariants (56 tests)
- `db/leads.test.mjs` — Lead capture DB (37 tests)
- `db/live.proof.mjs` — Live HTTPS RLS proof (14 tests)
- `scripts/verifyLive.mjs` — Deployed site verification (19 tests)
- `scripts/checkSite.mjs` — Static integrity (~40 checks)

### Deployment
- `Dockerfile` — node:22-alpine runtime image
- `railway.json` — Railway config (Dockerfile builder, healthcheck)
- `scripts/migrateRemote.mjs` — Safe remote migration runner
- `scripts/migrateUp.mjs` — Local PGlite migration runner

### Proof Bundles
- `PROOF/C1-lead-backend-live/` — Local DB test evidence
- `PROOF/C2-live-api-proof/` — Live Supabase API proof
- `PROOF/C3-railway-live/` — Railway deployment verification

---

## Conclusion

**The Promota/OwoWorks repository is exceptionally well-engineered at the data layer.** The 7 migrations implement a production-grade financial backbone (double-entry ledger, escrow-before-live, task state machine, payout eligibility, dispute lifecycle, RBAC, audit log) with adversarial tests proving every invariant. The lead capture + referral growth engine is **complete and proven live** over HTTPS.

**The gap is entirely in the application layer:** no admin UI, no promoter dashboard, no business campaign manager, no partner portal, no payout execution workers, no SMS/Termii verification worker, no KYC/IDV, no payment gateway, no platform OAuth. All of these have **database schemas ready** — they need API endpoints, background workers, and frontend UIs.

**External dependencies block the money-moving features** (Termii, payment gateway, KYC provider, data aggregator). The admin/promoter/business/partner UIs can be built **without any external dependencies** since the database contracts are complete and tested.

**Recommended next step:** Build the Admin Dashboard API + minimal UI first (2-3 weeks, no external deps). This unlocks operational visibility for all subsequent work.
