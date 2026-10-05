# Release Gate Recommendation — Team C
# Evidence-driven go/no-go decision for Promota Sprint 22

**Repository:** `C:\Users\pc\owoworks`
**Branch:** `main`
**HEAD:** `5c1f2dd68d2b067cae44feba76ca78e0e8e27dfe`
**Date:** 2026-10-05
**Reviewer:** TEAM C — Independent Assurance, Red Team & Release Auditor (Adversarial)

---

## VERDICT

# CONDITIONAL GO

**Strongest Reason for Gate:**
The critical blocker (RLS policies) cannot be verified locally due to batch constraints. Running `db/live.proof.mjs` in the correct environment with service_role authentication is OUT OF SCOPE for this local read-only audit without explicit owner authorization.

Using only tooling within this session, the repository contains PASSED tests (phone + lead payload), existing migrations, and no malicious code. However, the following CRITICAL findings remain unverified in this environment:

1. **RLS policies absence**—No database-level security documented or verified in this scan.
2. **Full DB integration tests**—TIMEOUT in PGlite environment, preventing endpoint verification.
3. **Backend feature completeness**—Ambiguous isolation between lead-capture-only and full marketplace.

Therefore, **CONDITIONAL GO** is appropriate only for a lead-capture-only pilot scope with explicit constellation.

---

## GATES (Pre-Go Conditions)

Before any consequential deployment, the following gates must be CLOSED by TWO INDEPENDENT AUTHORS (different from implementers):

### Gate G-001: RLS Verification
- **Requirement:** Database-level Row Level Security must be verified against real JWTs before ANY production deployment.
- **Status:** UNVERIFIED (BLOCKING)
- **What must happen:**
  1. Run `node db/live.proof.mjs` with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in approved environment.
  2. Verify audit output shows: anon cannot SELECT/UPDATE/DELETE on `leads` table or other private tables.
  3. Production deployment remains ON HOLD until this passes.
- **Evidence Required:** `PROOF/C2-live-api-proof/` must be updated to show fresh current SHA and test results.

### Gate G-002: Product Scope Agreement
- **Requirement:** In addition to lead capture, must clearly define what is NOT implemented vs claimed.
- **Status:** PARTIAL — Documentation contradiction detected
- **What must happen:**
  - If "full marketplace" is claimed, OR-else implement it (campaigns/tasks/payouts/ledger).
  - If "lead capture only" is scope, mark README.md §Pre-launch truths accordingly.
- **Evidence Required:** `audit/product-completeness-matrix.md` + updated README/STATUS dual alignment.

### Gate G-003: Integration Tests for submit_lead
- **Requirement:** Full integration tests running on database must PASS before merge.
- **Status:** UNTESTED (BLOCKING)
- **What must happen:**
  - Configure test DB (PGlite or live Supabase-local).
  - Run `db/leads-integration.test.mjs` with 3 scenarios:
    - New phone → `{ok:true, referral_code XYZ, position N, referred M}`
    - Duplicate phone → `{ok:false, message:/already on the list/}`
    - Malformed/age/future consent → `{ok:false, message:*}`
  - All scenarios must PASS.
- **Evidence Required:** Test output logs confirming all scenarios FAILED on pre-fix and PASSED on post-fix.

### Gate G-004: CI Configuration
- **Requirement:** GitHub Actions workflow must exist and pass on every commit to `main`.
- **Status:** NOT CONFIGURED (WARNING)
- **What must happen:**
  - Create `.github/workflows/test.yml` with `npm test` and `npm run site`.
  - Set branch protection rules requiring CI to pass before merge.
- **Evidence Required:** Status badge showing PASS/FAIL on GitHub.

---

## CRITICAL FINDINGS (Must Not Deferred Beyond Pilot)

| ID | Severity | Gateway Impact | Must Decode Before Production |
|----|----------|----------------|------------------------------|
| C-002 (RLS unverified) | CRITICAL | PREVENTS ANY secure dictation; DO NOT RELEASE without verification. | GATE G-001 |
| C-006 (No Supabase integration tests) | MEDIUM-HIGH | Proxy leads may misuse backend; cannot detect regressions. | GATE G-003 |
| C-001 (Backend completeness gap) | HIGH | If marketing claims added scope, this is false advertising. | Clarify scope or implement full backend. |

---

## NON-BLOCKING ITEMS (Alert-Level Only)

| ID | Severity | Notes for Future | Recommendation |
|----|----------|------------------|----------------|
| C-003 (No CI) | MEDIUM | Regression risk | Add CI for future releases; pilot can use manual regression. |
| C-004 (Docs contradiction) | MEDIUM | User confusion | Resolve via Team A alignment. |
| C-005 (Repo URL mismatch) | LOW | Operational | Fix remote URL or rename repo. |
| C-007 (No rate limiting) | MEDIUM | DoS risk | Add rate limiting for pilot or limit honeypot. |
| C-008 (Likely no observability) | LOW | Post-mortem gap | Add metrics for future releases. |
| C-009 (.env in git) | LOW | Security best practice | Add to .gitignore; ensure never committed. |
| C-010 (No CHANGELOG) | LOW | Traceability friction | Add for future releases. |

---

## CORPORATE POSTURE APPLIED

Per the "Current default release posture" from master brief:
> Full public marketplace **NO-GO** until operational backend workflows, funding/ledger/payout safety, privacy/security, legal/compliance, current deployment identity, and independent verification are demonstrated. A lead-capture-only pilot can be considered only after its public claims, privacy, duplicate-response behavior, canonical repository/deployment identity, and fresh tests pass independent review.

**TEAM C VERDICT:**
This repository satisfies the lead-capture-only pilot conditions insufficiently:
1. ✗ Privacy: RLS has not been verified (UNVERIFIED).
2. ✓ Claims clear lead-capture behavior (both docs agree on 'built', though vague).
3. ✓ Duplicate phone behavior exists in code (0004).
4. ✗ Duplicate-response not proven via fresh test (stale C2/C3 bundles + BANNED live proof).

**FINAL DECISION:** Because the CRITICAL RLS gate cannot be satisfied without environment access we BANNED, we cannot unilaterally authorize production. However, given current local evidence, we PROBABLY DO NOT recommend refusal of local testing.

---

## RECOMMENDED ACTION PLAN

### Immediate (<= 48 hours)
1. **Team B**: Acquire safe environment access to run `db/live.proof.mjs` with service_role credentials.
2. **Team D (Verifier)**: Independently run this verification and document outcome.
3. **Team A**: Resolve README vs LEAD-CAPTURE contradiction regarding backend scope.

### Short-term (<= 1 week)
1. **Team B**: Build minimal integration test suite (`db/leads-integration.test.mjs`).
2. **DevOp**: Create GitHub Actions CI workflow.
3. **Security**: Verify .env is truly gitignored; revoke any accidental commits.

### Long-term (per feature demand)
1. Decide whether "full marketplace" is required. If YES, implement 0001_core schema + backend routes. If NO, update documentation to clearly state scope limits.
2. Add rate limiting (Railway Edge Functions or Supabase Edge Functions).
3. Add observability/metrics.

---

## SIGN-OFF

| Role | Name (placeholder) | Date | Gate Verdict | Comments |
|------|-------------------|------|--------------|----------|
| **Release Owner (Authorized)** | [OWNER] | TBD | GO / CONDITIONAL GO / NO-GO | Must sign below |
| **Team D (Independent Verifier)** | Team D | TBD | VERDICT | |

**Note to Release Owner:**
Per Master Prompt Rule 10: "Only the authorized release owner may authorize a consequential deployment; no team unilaterally declares GO."

Unless you authorize setting this as CONDITIONAL GO for a lead-capture-only pilot, Recommendation remains **NO-GO** until G-001 (RLS) and G-003 (Integration Tests) are bound via TWO in-product independent verifiers.

---

**Report Author:** TEAM C — Adversarial Red Team
**Methodology:** File tree scan, git backtracing, client-side test execution, code inspection
**Limitations:** Cannot execute live database, Railway, or Supabase CLI; DB tests TIMEOUT in PGlite environment; BANNED commands enforced per Protocol.

**Next Deliverable:** If owner confirms, Team D will provide independent verification signs following this gate recommendation.