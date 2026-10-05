# Business Model Audit — Promota (OwoWorks)
**Date:** 2026-10-05
**Repo:** `C:\Users\pc\owoworks` (main, HEAD `a6bccb5`)
**Team:** TEAM A — Product, Business, UX, Content & Compliance
**Evidence Standard:** OBSERVED (code/docs), TESTED (passing tests), HISTORICAL CLAIM (STATUS.md), PROPOSED (copy only), UNKNOWN

---

## 1. Business Model Summary

| Dimension | Claimed / Designed | Evidence Status | Gap |
|---|---|---|---|
| **Core Model** | Two-sided promotion marketplace: businesses fund campaigns → verified Nigerians promote from own accounts with #ad → earn mobile data first, cash as they grow — for checked results only | HISTORICAL CLAIM (README, STATUS, LEAD-CAPTURE) | **Backend NOT IMPLEMENTED** — server.mjs is static-only; campaigns/tasks/payouts/ledger exist only in DB schema (0001_core.sql) |
| **Supply Side** | Promoters: students, traders, riders with 200+ followers on YouTube/Facebook | PROPOSED (index.html §earn step 2) | No follower verification; no platform OAuth; no KYC flow |
| **Demand Side** | Businesses: pay per checked click, sign-up, promo-code use | PROPOSED (index.html #business) | No campaign creation UI/API; no escrow funding flow; no pricing published |
| **Intermediation** | Platform takes margin (floor enforced in DB); promoter share + fraud reserve configured | HISTORICAL CLAIM (0001_core.sql campaigns.promoter_share_bp/fraud_reserve_bp/margin_floor_bp + settings) | **No runtime calculation or payout execution** |
| **Reward Currency** | Mobile data (MTN/Glo/Airtel/9mobile) → cash (NGN) as levels grow | PROPOSED (index.html, FAQ) | Data: Termii aggregator absent; Cash: KYC T2 + age verification absent |
| **Growth Loop** | Referral queue priority only — ZERO cash for referrals (anti-MLM) | OBSERVED (0002_leads.sql, LEAD-CAPTURE.md §3) | **IMPLEMENTED & TESTED** — referral_code, lead_position, preview_referral all proven |
| **Anti-Fraud** | Honeypot, consent freshness, unique phone, trust score, 10% human review, 24h auto-approve, clawback | PARTIAL (DB triggers + settings) | Human review queue, trust scoring, clawback logic NOT IMPLEMENTED |

---

## 2. Pricing & Unit Economics

| Item | Designed Value | Source | Evidence Status | Risk |
|---|---|---|---|---|
| **Promoter share** | 4500 bp (45%) default | `settings.promoter.share_bp` (0001_core.sql) | HISTORICAL CLAIM | No runtime enforcement; no per-campaign override UI |
| **Fraud reserve** | 500 bp (5%) default | `settings.fraud.reserve_bp` (0001_core.sql) | HISTORICAL CLAIM | No accrual/release logic; no reserve accounting |
| **Platform margin floor** | 4000 bp (40%) minimum | `settings.margin.floor_bp` (0001_core.sql) | HISTORICAL CLAIM | Trigger enforces at campaign CREATE; no blended margin calc at payout |
| **Price per outcome** | Per-campaign, set by business | `campaigns.price_per_outcome_minor` (0001_core.sql) | HISTORICAL CLAIM | No pricing UI; no demand-based pricing engine |
| **Min cash payout** | 100,000 minor units (₦1,000) | `settings.payout.min_cash_minor` (0001_core.sql) | HISTORICAL CLAIM | Setting exists; no payout batch worker |
| **Min data reward** | 5,000 minor units (₦50) | `settings.payout.min_data_minor` (0001_core.sql) | HISTORICAL CLAIM | Setting exists; no data fulfillment worker |
| **Hold period** | 72 hours default (48-72h range) | `settings.payout.hold_hours` + `campaigns.hold_hours` (0001_core.sql) | HISTORICAL CLAIM | Column + setting exist; no hold enforcement logic |
| **Auto-pause** | 90% of budget | `campaigns.auto_pause_pct` (0001_core.sql) | HISTORICAL CLAIM | Trigger exists; no campaign live to test |

**Unit Economics Unknowns (NOT modeled in repo):**
- Customer Acquisition Cost (CAC) for promoters (referral loop only)
- Customer Acquisition Cost for businesses (no sales motion defined)
- Lifetime Value (LTV) of promoter (no retention/churn model)
- Data bundle cost per GB from aggregator (Termii pricing unknown)
- Fraud loss rate (no historical data; trust score uncalibrated)
- Platform margin at scale (blended across campaigns unknown)
- Operational cost per payout (batch vs real-time)

---

## 3. Campaign Funding & Reward Liabilities

### 3.1 Funding Model (Designed in DB)
```sql
-- 0001_core.sql: Escrow must be FULLY funded before campaign goes LIVE
-- Liability (spent_minor) can NEVER exceed escrowed credit
-- Auto-pause at 90% of budget (configurable)
-- Margin floor enforced at campaign create
```

### 3.2 Current Implementation Status

| Component | DB Schema | Server Routes | Workers | Status |
|---|---|---|---|---|
| Campaign creation | ✅ campaigns table | ❌ | ❌ | NOT IMPLEMENTED |
| Escrow account per campaign | ✅ accounts (scope='campaign') | ❌ | ❌ | NOT IMPLEMENTED |
| Escrow funding (payment gateway) | ✅ ledger entries + postings | ❌ | ❌ | NOT IMPLEMENTED |
| Pre-launch funding guard | ✅ `assert_campaign_funded()` trigger | ❌ | ❌ | NOT IMPLEMENTED |
| Spend tracking | ✅ campaigns.spent_minor | ❌ | ❌ | NOT IMPLEMENTED |
| Auto-pause at 90% | ✅ `apply_campaign_autopause()` trigger | ❌ | ❌ | NOT IMPLEMENTED |
| Liability ≤ escrow guard | ✅ `assert_campaign_funded()` trigger | ❌ | ❌ | NOT IMPLEMENTED |
| Promoter reward calculation | ✅ promoter_share_bp + fraud_reserve_bp | ❌ | ❌ | NOT IMPLEMENTED |
| Payout creation | ✅ payouts table + idempotency_key | ❌ | ❌ | NOT IMPLEMENTED |
| Payout eligibility (KYC/phone) | ✅ `assert_payout_eligibility()` trigger | ❌ | ❌ | NOT IMPLEMENTED |
| Data fulfillment (Termii) | ✅ payouts.kind='data' | ❌ | ❌ | NOT IMPLEMENTED |
| Cash payout (bank/OPay/Kuda) | ✅ payouts.kind='cash' | ❌ | ❌ | NOT IMPLEMENTED |
| Outbox for async events | ✅ outbox table + claim_outbox_batch() | ❌ | ❌ | NOT IMPLEMENTED |

### 3.3 Liability Separation (Critical Finding)
The schema correctly separates:
- **XP/Points/Levels** — NOT in schema (only mentioned in copy)
- **Cash rewards** — `payouts.kind='cash'` + `PROMOTER_PAYABLE_NGN` liability account
- **Data rewards** — `payouts.kind='data'` + `DATA_PAYABLE_NGN` liability account
- **Giveaway entries** — NOT in schema (proposed in copy only)

**Gap:** No code enforces that giveaway liabilities are tracked separately from earned rewards. The "weekend data giveaway / first-100" mentioned in copy has **zero schema, zero funding, zero terms**.

---

## 4. Fraud Exposure Assessment

| Vector | Mitigation in Code | Mitigation in Ops | Residual Risk |
|---|---|---|---|
| **Duplicate sign-ups** | UNIQUE(phone) + submit_lead returns same shape (0007) | None | LOW — membership oracle closed |
| **Bot form fills** | Honeypot + consent freshness (trigger + RLS) | None | MEDIUM — honeypot bypassable by sophisticated bots |
| **Fake referral codes** | Unknown code rejected (FK + format validation) | None | LOW |
| **Self-referral** | `leads_no_self_referral` constraint | None | LOW — but crafted edge cases untested |
| **Referral farming for cash** | IMPOSSIBLE BY DESIGN: referrals pay ZERO | None | **NONE** — anti-MLM rule enforced in schema + copy |
| **Fake proof submission** | 10% human review (setting), trust score, 24h auto-approve | No review queue UI, no trust score calc | **HIGH** — all mitigations unimplemented |
| **Click fraud** | No click tracking infrastructure | None | **CRITICAL** — objective=click has no verification |
| **Sign-up fraud** | No business callback/webhook | None | **CRITICAL** — objective=signup has no verification |
| **Promo-code fraud** | No code redemption endpoint | None | **CRITICAL** — objective=code has no verification |
| **Account takeover** | No 2FA, no session management, no device fingerprinting | None | **HIGH** |
| **Payout fraud** | KYC T2 + age verification required (trigger) | No KYC flow, no IDV integration | **HIGH** — trigger enforces but no path to eligibility |
| **Clawback on deletion/fraud** | Mentioned in FAQ; no code | None | **HIGH** — no clawback logic |
| **Rate limiting** | NONE in server.mjs | None | **HIGH** — DoS on submit_lead possible |

---

## 5. Customer Support & Abuse Handling

| Capability | Designed | Implemented | Gap |
|---|---|---|---|
| **Dispute lifecycle** | open → under_review → upheld/rejected/withdrawn/expired (0001_core.sql) | DB schema + triggers only | No UI, no API, no SLA automation |
| **Dispute SLA** | 72 hours (settings.dispute.sla_hours) | Column + setting only | No escalation, no auto-expiry action |
| **User suspension/ban** | profiles.state='suspended'/'banned' + user.suspend perm | Schema + perm only | No admin UI, no audit trail UI |
| **Fraud review queue** | fraud.review perm + settings.fraud.* | Perm + settings only | No queue UI, no assignment logic |
| **Support ticketing** | disputes table repurposed | Schema only | No ticketing UI, no responder workflow |
| **Data deletion (NDPA/GDPR)** | No deletion endpoint | None | **LEGAL RISK** — no consent withdrawal, no retention schedule |
| **Refund policy** | Mentioned in footer copy | None | No refund logic, no settlement state for refunds |

---

## 6. Legal & Compliance Dependencies

| Requirement | Status | Evidence | Blocker |
|---|---|---|---|
| **Trademark "Promota"** | UNVERIFIED | BRAND.md §1: "Web prior-art done; legal clearance NOT done" | **BLOCKER** for launch spend |
| **CAC Registration** | UNVERIFIED | STATUS.md Blocker #4 | **BLOCKER** |
| **Domain Ownership** | UNVERIFIED | STATUS.md Blocker #1 | **BLOCKER** |
| **NDPA Consent** | PARTIAL | consent_at timestamp in leads + trigger | No consent withdrawal, no privacy policy published |
| **NDPA Data Retention** | NOT IMPLEMENTED | No retention schedule, no deletion | **LEGAL RISK** |
| **SEC Anti-Pyramid** | DESIGNED IN | Anti-MLM: referrals pay ZERO cash | **COMPLIANT BY DESIGN** — verified in code |
| **Platform Policy (Meta/Google/TikTok)** | DESIGNED IN | #ad disclosure mandatory, no fake engagement incentivized | **COMPLIANT BY DESIGN** — copy enforces |
| **Telecom Licensing (Data)** | UNVERIFIED | Termii aggregator planned; no license check | **BLOCKER** for data rewards |
| **Financial Regulation (Payouts)** | UNVERIFIED | Cash payouts need KYC T2; no PSP license mentioned | **BLOCKER** for cash payouts |
| **Age Verification (18+)** | SCHEMA ONLY | profiles.age_verified_at + KYC tier | No IDV integration |

---

## 7. Operational Ownership

| Function | Owner (Per Schema/Perms) | Actual Owner | Gap |
|---|---|---|---|
| **Campaign approval** | admin (campaign.pause, admin.access) | UNASSIGNED | No admin UI |
| **Escrow funding verification** | finance (payout.execute, ledger.read) | UNASSIGNED | No funding UI |
| **Payout execution** | finance (payout.execute) | UNASSIGNED | No batch worker, no provider integration |
| **Fraud review** | support (fraud.review) | UNASSIGNED | No queue UI |
| **Dispute resolution** | support (dispute.resolve) | UNASSIGNED | No resolution UI |
| **Role assignment** | admin (role.assign) | UNASSIGNED | No admin UI; assign_role() function only |
| **Settings management** | admin (settings.write) | UNASSIGNED | Typed settings table; no UI |
| **Database migrations** | service_role (via migrateRemote.mjs) | DEV | No CI/CD pipeline |
| **SMS worker (Termii)** | UNASSIGNED | UNASSIGNED | **BLOCKER** — no API key, no worker code |
| **Click/signup/code verification workers** | UNASSIGNED | UNASSIGNED | **BLOCKER** — no workers for any objective type |

---

## 8. Prioritized Product/Business Findings

| ID | Severity | Finding | Evidence | Impact | Owner | Acceptance Criteria | Release Implication |
|---|---|---|---|---|---|---|---|
| B-001 | CRITICAL | **Full marketplace backend NOT IMPLEMENTED** — campaigns, tasks, payouts, ledger, escrow, disputes exist only in DB schema; server.mjs serves static files only | server.mjs (125 lines, static-only) vs 0001_core.sql (750 lines) | False advertising risk if "marketplace" claimed; pilot scope must be lead-capture only | Product Owner | Scope decision: (a) implement full backend OR (b) update all docs to "lead-capture pilot only" | NO-GO for marketplace; CONDITIONAL GO for lead-capture pilot only |
| B-002 | CRITICAL | **Data reward fulfillment absent** — Termii API key + worker missing; outbox handoff defined but no consumer | LEAD-CAPTURE.md §4, outbox topic 'lead.captured', 0001_core.sql payouts.kind='data' | Promoters cannot be paid in data; core value prop broken | Backend Lead | Termii sender ID + API key provisioned; worker consumes outbox, sends OTP, marks verified_at | NO-GO for any reward fulfillment |
| B-003 | CRITICAL | **Cash payout rail absent** — KYC T2 + age verification schema exists; no IDV integration, no payout execution worker | 0001_core.sql assert_payout_eligibility(), profiles.kyc_tier/age_verified_at | Promoters cannot earn cash; "cash as they grow" promise unfulfillable | Backend Lead | KYC flow (IDV provider) + payout worker + provider integration (OPay/Kuda/PalmPay) | NO-GO for cash rewards |
| B-004 | HIGH | **Weekend data giveaway / first-100 program PROPOSED only** — mentioned in copy; no eligibility, fairness, funding, terms, legal review | README.md, index.html hero/FAQ, BRAND.md | Legal risk (gambling/lottery laws); user trust risk if unfulfilled | Legal + Product | Eligibility criteria, fairness mechanism, funding source, terms published, legal sign-off | NO-GO until independently approved |
| B-005 | HIGH | **Level system (1-50) PROPOSED only** — mentioned in copy; no XP/points schema, no progression logic | index.html, FAQ, BRAND.md | Retention mechanic promised but absent; no way to "grow" to cash | Product + Backend | XP model, level thresholds, progression rewards, schema migration | NO-GO for retention loop |
| B-006 | HIGH | **Minimum followers (200+) claimed but unverified** — UI says "Minimum 200 followers at pilot"; no platform OAuth, no verification | index.html §earn step 2, FAQ #1 | Eligibility gate unenforced; fraud risk | Backend Lead | Platform OAuth (YouTube/Facebook) + follower count verification + periodic re-check | NO-GO for promoter eligibility |
| B-007 | HIGH | **Click/signup/code verification absent** — objectives defined in campaigns; no verification workers, no tracking | 0001_core.sql campaigns.objective, tasks.state machine | Business pays for outcomes that cannot be verified | Backend Lead | Click tracker, signup webhook, promo-code redemption API, 10% review queue | NO-GO for campaign launch |
| B-008 | MEDIUM | **Pricing unpublished** — "Final prices are not published yet" (index.html #pricing); pilot partners get written pricing | index.html #pricing, LEAD-CAPTURE.md | Business cannot evaluate; no public pricing transparency | Product + Finance | Margin model measured; pilot partner pricing documented; public pricing page | CONDITIONAL — pilot can proceed with private pricing |
| B-009 | MEDIUM | **No CI/CD pipeline** — .github/workflows empty; no automated regression | C-003 (Team C finding) | Regression risk on every change; manual testing burden | DevOps | GitHub Actions workflow running npm test + npm run site on every push | CONDITIONAL — pilot can use manual regression |
| B-010 | MEDIUM | **RLS policies UNVERIFIED** — no policy files in repo; live.proof.mjs BANNED from execution | C-002 (Team C finding) | Database authorization unproven; data exposure risk | Security Lead | RLS policies deployed + verified against real JWTs (anon/authenticated/service_role) | BLOCKING for ANY production deployment |
| B-011 | MEDIUM | **No rate limiting** — server.mjs has no throttling; submit_lead exposed via Supabase RPC | C-007 (Team C finding) | DoS, bot flood, credential exposure risk | Backend Lead | Rate limiter on submit_lead (Railway Edge or Supabase Edge Function) | CONDITIONAL for pilot; BLOCKING for public launch |
| B-012 | MEDIUM | **No observability** — only console.log; no metrics, no error tracking | C-008 (Team C finding) | Production incidents undetectable | DevOps | /metrics endpoint + structured logging + error tracker | CONDITIONAL for pilot |
| B-013 | LOW | **Repository identity mismatch** — remote is OwoWorks, brand is Promota | C-005 (Team C finding) | Operational confusion, automation friction | DevOps | Canonical remote URL decided and documented | NON-BLOCKING |
| B-014 | LOW | **No CHANGELOG** — no version traceability | C-010 (Team C finding) | Audit/compliance gap | Release Manager | CHANGELOG.md with semantic versions | NON-BLOCKING |

---

## 9. Release Recommendation (Team A Perspective)

| Scope | Verdict | Conditions |
|---|---|---|
| **Lead-capture pilot only** (collect name, phone, platform, referral) | **CONDITIONAL GO** | 1. Duplicate phone oracle fixed (0007 — DONE) 2. Privacy policy + consent withdrawal published 3. Terms of service published 4. RLS verified (G-001) 5. Integration tests for submit_lead (G-003) |
| **Full marketplace** (campaigns + tasks + payouts + ledger) | **NO-GO** | Requires: full backend implementation, Termii integration, KYC/IDV, payout workers, click/signup/code verification, admin dashboards, CI/CD, observability, rate limiting, legal clearances |

**Team A Sign-off:** The repository demonstrates a well-designed DATABASE for a two-sided marketplace but has ZERO server-side implementation beyond static hosting and a single Supabase RPC for lead capture. All marketplace claims in STATUS.md, LEAD-CAPTURE.md, and index.html are HISTORICAL CLAIMS or PROPOSED — not OBSERVED or TESTED in running code. The only VERIFIED, TESTED, OBSERVED feature is the lead capture form with referral loop.

**Next Action:** Team A recommends aligning all public documentation (README, STATUS, LEAD-CAPTURE, index.html) to explicitly state: **"Current scope: Lead-capture pilot only. Campaigns, tasks, payouts, ledger, disputes, admin — NOT IMPLEMENTED."** This must be done before any external communication or partner onboarding.