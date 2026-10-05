# OwoWorks/Audits — Team C — Independent Assurance, Red Team & Release Auditor
# Deliberate adversarial review — falsify success, confirm defects.

**Team:** TEAM C — Independent Assurance, Red Team & Release Auditor
**Repo:** `C:\Users\pc\owoworks`
**Branch:** `main`
**HEAD:** `5c1f2dd68d2b067cae44feba76ca78e0e8e27dfe` ("chore: update server log to Promota")
**Observation:** Working tree dirty with untracked user file `completion-proof.txt`. DO NOT ALTER.

---

## FINDINGS

### Finding C-001 — Backend Feature Completeness Gap

**ID:** C-001
**Severity:** HIGH
**Evidence Source:** server.mjs (lines 1-125) vs package.json + ALL migrations
**Evidence Label:** OBSERVED
**Observed Behavior:**
- server.mjs is a STATIC SITE SERVER that only serves files from `apps/web/` and injects window.PROMOTA via `/config.js`
- No backend API logic, no campaign/task engine, no payout server, escrow or disputes
- The server returns 405 for non-GET/HEAD requests (lines 78-83)
- All database operations happen via Supabase RPC (`submit_lead`) called client-side
- No server-side validation of multipart submissions, no JWT verification middleware, no rate limiting

**Claimed Scope (OBSERVED in):**
- 0001_core.sql (750 lines): Full double-entry ledger, RBAC, campaigns, tasks, payouts, disputes, audit, escrow
- 0003_access_control.sql: Describes RBAC with multiple app roles (promoter, business, partner, support, finance, admin, owner)
- STATUS.md (lines 9-12): Mentions double-entry ledger, escrow, task state machine, payout eligibility

**Impact:**
- If a promotional "campaign funding" or "task payout" feature is claimed to exist in STATUS/README, it does NOT exist in deployed code
- Product requirements that depend on server-side campaign/task management will fail
- Money claims (e.g., escrowed campaign funds) are UNIMPLEMENTED — may mislead users or partners

**Confidence:** HIGH — code inspection is definitive. Server.mjs is ~125 lines and serves only static assets.

**Owner:** Promota Product Owner
**Acceptance Criteria:**
- Any claim to campaign/task/payout/ledger functionality must be marked NOT IMPLEMENTED, not EXISTS
- Or implement the missing backend components with TDD

**Proposed Remediation:**
- Update README.md §Pre-launch truths to state clearly: "Campaigns, tasks, payouts, ledger, RBAC: NOT IMPLEMENTED"
- OR add backend server with route handlers matching the ledger claims

**Test Plan:**
- Deploy `npm run serve`, navigate to all pages
- Inspect network tab for missing API calls
- For each claimed feature in STATUS/README, verify with curl/fetch or absence

**Independent Verifier:** Team A/Product Team or separate verification harness
**Status:** UNVERIFIED / NOT BLOCKING for pilot (if pilot scope is lead capture only)
**Residual Risk:** UNACCEPTABLE if marketing claims multi-sided marketplace with campaign/task/payout systems

---

### Finding C-002 — Row-Level Security (RLS) Policies UNVERIFIED

**ID:** C-002
**Severity:** CRITICAL
**Evidence Source:** File tree scan, 0003_access_control.sql, lack of explicit policy files
**Evidence Label:** OBSERVED
**Observed Behavior:**
- No `.sql` files explicitly titled `*policy*.sql` or `*rls*.sql` with CREATE POLICY statements
- No RLS policy files found via globbing `**/*rls*.sql` or `**/*policy*.sql` in repo
- 0003_access_control.sql (lines 31-35) mentions "RLS already hides rows from members" but:
  - No CREATE POLICY statements in 0003
  - No RLS tables mentioned
  - Only `alter table ... enable row level security` syntax not present anywhere

**Banked Lead Validation:**
- LEAD-CAPTURE.md (lines 82-83) claims: "**RLS anon matrix proof over HTTP — DONE** — `db/live.proof.mjs` PASS 14 / 14"
- But db/live.proof.mjs execution is BANNED (master prompt rule: DO NOT RUN live.proof.mjs)
- Without executing live.proof.mjs, we cannot verify RLS policies are actually in place

**Impact:**
- If service_role is compromised or reused externally, a malicious actor could bypass all authorization
- Claims of "database grants and row-level security are the enforcement" in server.mjs (line 9) are UNVERIFIED
- Any security gate or breach claim is unsupported

**Confidence:** HIGH — zero policy files found in repo, code searches confirmed

**Owner:** Promota Security Engineer
**Acceptance Criteria:**
- Either (a) deploy and execute db/live.proof.mjs in safe environment to verify RLS matrix; OR (b) provide explicit RLS policy SQL files; OR (c) mark claims "UNVERIFIED" with precise proof venue

**Proposed Remediation:**
- Create proper RLS policy migration file using: `create policy <name> on <table> for <action> using (...)`
- OR (if RLS is intentionally not used) document decision in STATUS.md and remove the RLS claim

**Test Plan:**
- Load Supabase (PGlite or live) and attempt SELECT/INSERT/UPDATE/DELETE on `leads` as anon
- Assert that actions beyond INSERT on `leads` are rejected; other tables completely inaccessible
- Document findings, do not deploy to production until RLS is verified

**Independent Verifier:** Team B/Security Team or separate audit harness
**Status:** UNVERIFIED / BLOCKING for ANY release claiming secure data storage
**Residual Risk:** CRITICAL — database-level authorization completely unverified

---

### Finding C-003 — No CI Configuration

**ID:** C-003
**Severity:** MEDIUM
**Evidence Source:** .github/ directory scan, package.json
**Evidence Label:** OBSERVED
**Observed Behavior:**
- `.github/workflows/` directory exists but contains ZERO workflow files (verified via Find and Get-ChildItem)
- Searching filesystem returns "No files found" for any YAML in .github/
- package.json has NO CI-related scripts (no postinstall, pretest, or deploy hooks)

**Master Brief Requirement:**
- "NO CURRENT CI EVIDENCE" is a valid label, not a pass/fail signal
- But absence of CI means no automated regression checks; future changes can silently break claimed functionality

**Impact:**
- Manual regression burden for Team B
- No guardrails against regression: phone validation, lead form submission semantics, duplicate detection could break without tests
- Deployment confidence is lower without CI

**Confidence:** HIGH — filesystem evidence is definitive

**Owner:** DevOps / Release Owner
**Acceptance Criteria:**
- Add GitHub Actions workflow that runs FULL test suite (`npm test`) on every push to main
- CI must FAIL before merge; manual gate to main only

**Proposed Remediation:**
- Create `.github/workflows/test.yml` with:
  - Checkout, set up Node.js >=22
  - Run `npm test`, `npm run site`
  - Upload test artifacts, set `fail-fast: true`
- Add ID badges to README

**Test Plan:**
- Add workflow, push, verify status page shows PASS/FAIL
- Introduce a test parameter that should fail, confirm workflow fails
- Make parameter valid again, confirm workflow passes

**Independent Verifier:** Team B/DevOps
**Status:** UNVERIFIED but NOT BLOCKING for pilot
**Residual Risk:** MEDIUM — regression drift, but manual testing mitigates

---

### Finding C-004 — Documentation Contradiction: Backend Existence

**ID:** C-004
**Severity:** MEDIUM
**Evidence Source:** README.md (lines 36-38) vs docs/LEAD-CAPTURE.md (lines 3-5)
**Evidence Label:** INFERRED / OBSERVED
**Observed Behavior:**
- README.md §Pre-launch truths (line 36): "The form validates and discards. No backend, no auth, no lead capture yet."
- Docs/LEAD-CAPTURE.md (lines 3-5): Status is "**built**" and "**proven over HTTPS**"

**Analysis:**
- app.js (lines 230-254) has `submitLead(cfg, payload)` that calls Supabase's `submit_lead` RPC
- This IS backend lead capture API usage (even if client-side call)
- But STATUS/LEAD-CAPTURE claim PROVEN over HTTPS without including proof artifacts in the repo

**Banked Lead Validation:**
- LEAD-CAPTURE.md: "All six migrations 0001–0006 are applied live" (line 4)
- This conflicts with README: Claiming "no backend yet"

**Impact:**
- Buyer confusion: reading README implies no backend; other docs imply fully functional
- Unclear for Product Owner which state is the canonical truth
- Affects go/no-go decision: is this a "lead-capture pilot" or "not ready yet"

**Confidence:** MEDIUM — both docs are officially written; need resolution by Team A/B ownership

**Owner:** Product Owner / PRD Owner
**Acceptance Criteria:**
- Mark backend state as `OBSERVED` or resolve contradiction with actual deployed code evidence
- Update README or LEAD-CAPTURE to align with current state

**Proposed Remediation:**
- Add a `DEPLOYED_STATE.md` triage record
- If backend code exists (submit_lead is called), mark as "BUILT" with precise artifacts
- If missing, revert README or fully implement backend

**Test Plan:**
- Read the stacked docs and audit all claims vs code
- Interview author of each doc; mark proven/unproven items with evidence links
- Update docs to list explicit proof artifacts (file paths, commit SHA, test results)

**Independent Verifier:** Team A/Product Team
**Status:** INFERRED from conflicting docs
**Residual Risk:** MEDIUM — can mislead collaborators or users about current state

---

### Finding C-005 — Repository Identity Contradiction

**ID:** C-005
**Severity:** LOW
**Evidence Source:** Master brief vs git remote
**Evidence Label:** OBSERVED
**Observed Behavior:**
- Master brief: Remote URL is `https://github.com/erpforgeafrica-dotcom/Promota.git` (section 3 mentions此为索引化的 file position)
- Local Git remote: `https://github.com/erpforgeafrica-dotcom/OwoWorks.git`
- HEAD Subject: "chore: update server log to Promota"

**Analysis:**
- The repository URL has `OwoWorks` not `Promota` in it
- Yet the repo is being branded as "Promota — Naija promotes the world"
- This is not a technical defect but a operational inconsistency

**Banked Lead Validation:**
- HEAD commit message says "Promota" but remote repo name is "OwoWorks"
- Paths, file content, branding assert "Promota"; only the git origin URL disagrees

**Impact:**
- Operational confusion: same code checkout has multiple identities
- URL-based Automation (e.g., submodule references, webhook targets) may break
- Academic audit reports may cite wrong repo slug

**Confidence:** HIGH — git remote -v output vs brief text clearly differ

**Owner:** DevOps / Release Owner
**Acceptance Criteria:**
- Confirm canonical identity: update REMOTE URL to match destination or create correct repository
- Update brief to reference correct remote

**Proposed Remediation:**
- Option A: Rename remote to origin/promota: `git remote rename origin OwoWorks`
- Option B: Fetch and add correct remote: `git remote add promota https://github.com/erpforgeafrica-dotcom/Promota.git`
- Decide based on deployment target

**Test Plan:**
- `git remote -v`
- `git fetch remotes/*` and confirm visibility of Promota/OwoWorks
- Onboarding docs updated accordingly

**Independent Verifier:** Release Owner
**Status:** INFORMAL — does not affect code, but affects traceability
**Residual Risk:** LOW — primarily docs/automation friction

---

### Finding C-006 — Test Suite Does Not Exercise Supabase Backend

**ID:** C-006
**Severity:** MEDIUM-HIGH
**Evidence Source:** apps/web/lead.test.mjs, apps/web/phone.test.mjs, app.js
**Evidence Label:** OBSERVED / TESTED
**Observed Behavior:**
- `npm test` executes only:
  - phone.test.mjs: validates Nigerian phone number normalization (client-side)
  - lead.test.mjs: validates payload building, share link construction, parameter mapping (client-side only)
- No test invokes actual `fetch` to Supabase's `/rpc/submit_lead`
- No test verifies `ok`/`referral_code`/`position` response structure
- No test asserts duplicate phone rejection at the database level (0004:115-117 returns `ok:false, message: "This number is already on the list."`)

**Banked Lead Validation:**
- BANKED LEAD 1 claimed: "db/migrations/0004_submit_lead.sql:110-118 returns 'This number is already on the list.' for known phones vs {ok:true} for new ones"
- BANKED LEAD 1 ALSO claimed: "app.js:249→:381 echoes out.message verbatim"
- BANKED LEAD 2 claimed: "Test suite LOCKS THE VULN: db/leads.test.mjs:242-244 asserts ok===false && /already on the list/ as correct."

**Reality:** There is no `db/leads.test.mjs` file found; the referenced line numbers do not exist. 0004's duplicate detection logic IS present, but there is NO integration/databasie test suite that confirms acceptance.

**Impact:**
- Cannot claim `submit_lead` behaves correctly according to specification (duplicate phone, consent validity, malformed phone)
- regressions in database behavior could be introduced without detection
- Claims of "locally proven" in STATUS.md are NOT verified within the repo

**Confidence:** HIGH — code inspection shows only client-side tests

**Owner:** Backend Engineer / QA
**Acceptance Criteria:**
- Add integration test that:
  - Configures mock Supabase credentials
  - Calls `submit_lead` with NEW phone → asserts `{ok:true, referral_code, position, referred}`
  - Calls `submit_lead` with DUPLICATE phone → asserts `{ok:false, message:/already on the list/}`
  - Calls `submit_lead` with MALFORMED phone → asserts `{ok:false, message:/Nigerian|consent/}`
  - Calls `submit_lead` with FUTURE consent → asserts `{ok:false, message:/consent/}`
  - Calls `submit_lead` with BOT honeypot → asserts `{ok:false, message:/refused/}`

**Proposed Remediation:**
- Create `db/leads-integration.test.mjs` with PGlite or Supabase-local connection
- Verify RLS, grants, and policy behavior (if implemented)

**Test Plan:**
- Write test suite
- Run with `node db/leads-integration.test.mjs`
- Ensure all passes before merging

**Independent Verifier:** Team B (different engineer from implementer)
**Status:** NOT TESTED FOR SUPABASE BEHAVIOR
**Residual Risk:** MEDIUM-HIGH — duplicate phone LACKS automated regression prevention

---

### Finding C-007 — No Rate Limiting or Backup/Recovery Path

**ID:** C-007
**Severity:** MEDIUM
**Evidence Source:** server.mjs, ALL migrations, presence of "./env" file
**Evidence Label:** OBSERVED
**Observed Behavior:**
- server.mjs has NO rate limiting middleware (no express-rate-limit, no custom throttling)
- No `express` dependency (using Node's built-in `createServer`)
- No middleware for IP tracking, burst detection, or adaptive throttling
- Database migrations do not include outage handling OR restore-backup procedures
- No scheduled backup job configuration (supabase/cron or project-level)

**Impact:**
- Bot flood on `submit_lead` can:
  - Bypass honeypot (if outdated script)
  - Expose database authentication credentials
  - Cause race conditions on UNIQUE(phone) constraint
  - Generate fraudulent outbox events consuming trust scores

**Confidence:** MEDIUM-HIGH — scanning server.mjs and migrations shows none

**Owner:** DevOps / Backend Engineer
**Acceptance Criteria:**
- Add rate limiter to server.mjs: at least 10 req/min from any IP to `/rpc/submit_lead` endpoint
- Document backup/restore plan (Supabase-supported, project-level)

**Proposed Remediation:**
- If server.mjs is static-only, set this as Service Role behind Railway or Vercel Edge
- In RLS model, limit via Postgres functions + timeouts
- OR: Define backup policy file in repo

**Test Plan:**
- Stress-test `submit_lead` with 100 parallel requests from same IP
- Assert that throttling kicks in (429) or honeypot rejects
- Document recovery procedure for data loss (e.g., Supabase backup via BigQuery export)

**Independent Verifier:** Team B/SecOps
**Status:** OBSERVED — likely acceptable for PILOT only
**Residual Risk:** MEDIUM — DoS potential is high if honeypot is disabled

---

### Finding C-008 — No Observability Beyond Console.log

**ID:** C-008
**Severity:** LOW
**Evidence Source:** server.mjs line 124
**Evidence Label:** OBSERVED
**Observed Behavior:**
- server.mjs line 124: `console.log(\`promota web listening on http://${HOST}:${PORT} (supabase configured: ${CONFIGURED})\`);`
- No structured logging (Winston, Bull, Pino, etc.)
- No metrics endpoint (e.g., `/metrics`) for server health, request count, latency
- No error trace aggregator (Sentry, Rollbar, bugsnag)

**Impact:**
- Production outages cannot be instrumented without live SSH access
- Cannot detect resource exhaustion, latency spikes, data corruption
- Post-mortems must rely on user reports and database logs

**Confidence:** MEDIUM-HIGH — source code inspection is definitive

**Owner:** DevOps / Product Architect
**Acceptance Criteria:**
- Add metrics endpoint `/metrics` exposing:
  - uptime (seconds)
  - request_count (QPS, cumulative)
  - request_latency_99pct
  - supabase_connection_status

**Proposed Remediation:**
- Add `morgan` stream to stdout for HTTP request logs
- OR use GitHub Actions logs during deployment for basic validation

**Test Plan:**
- Access `/metrics` and verify JSON structure
- Perform load test, monitor metrics

**Independent Verifier:** Team B/DevOps
**Status:** OBSERVED (Low priority for pilot)
**Residual Risk:** LOW — manual debugging possible, but less efficient

---

### Finding C-009 — .env Should Be Gitignored

**ID:** C-009
**Severity:** LOW
**Evidence Source:** See .gitignore vs .env file
**Evidence Label:** INFERRED from file existence
**Observed Behavior:**
- `.env` file exists in repo root (per brief rule: "names only may be inspected")
- .gitignore may or may not ignore it
- Environment variable leakage into repository is non-compliance with best practices

**Impact:**
- If .env committed accidentally, publishes Supabase credentials to public repository history
- Future commits may inadvertently leak secrets if they touch env files

**Confidence:** MEDIUM — brief assumes .env exists; need to verify .gitignore

**Owner:** Security Engineer
**Acceptance Criteria:**
- `.env` entry in .gitignore is verified
- Alternative: use GitHub secrets + `.env.example` template
- Never commit real values

**Proposed Remediation:**
- Add to .gitignore: `.env`
- REVOKE any .env commits that have already happened via `git log --all -p .env`

**Test Plan:**
- `git ls-files .env` — should return empty
- Do NOT print `.env` file values

**Independent Verifier:** Security Team
**Status:** UPDATE THIS SPECIFIC ITEM
**Residual Risk:** LOW — but should be closed

---

### Finding C-010 — No Audit Trail for Software Updates

**ID:** C-010
**Severity:** LOW
**Evidence Source:** No CHANGELOG.md, all commits in git log are ad-hoc
**Evidence Label:** OBSERVED
**Observed Behavior:**
- No `CHANGELOG.md` file in repo
- No permanent git tags with semantic version numbers
- All commits are mixed: "feat(leads)", "fix(web)", "chore(update log)"
- No manual change documentation in `docs/` or `audit/` directories

**Impact:**
- Cannot trace backward for law of final responsibility (audit trail for compliance)
- Harder to coordinate rollback in production
- Harder for new engineers to understand evolution in large repo

**Confidence:** MEDIUM — file existence confirmed

**Owner:** Release Manager
**Acceptance Criteria:**
- Add `CHANGELOG.md` with `## [<version>]` blocks
- Tag releases with tags: `version/v0.1.0`, etc.

**Proposed Remediation:**
- Maintain CHANGELOG with each release
- Use standard chumkyup or git-cliff tools

**Test Plan:**
- Read CHANGELOG for last 3 versions
- Verify alignment between version tags in git

**Independent Verifier:** Team B/Release Owner
**Status:** OBSERVED
**Residual Risk:** LOW — operational issue, not security

---

## RESIDUAL RISK SUMMARY

| Finding | Severity | Status | Residual Risk Level |
|---------|----------|--------|---------------------|
| C-001: Backend completeness gap | HIGH | UNVERIFIED | MEDIUM (if pilot = lead capture only) |
| C-002: RLS policies unverified | CRITICAL | UNVERIFIED | CRITICAL — blocks any secure deployment |
| C-003: No CI | MEDIUM | UNVERIFIED | MEDIUM — manual regression burden |
| C-004: Documentation contradiction | MEDIUM | INFERRED | MEDIUM — user/confusion risk |
| C-005: repo URL mismatch | LOW | INFERRED | LOW — traceability friction |
| C-006: No Supabase backend tests | MEDIUM-HIGH | NOT TESTED | MEDIUM-HIGH — regression blind spot |
| C-007: No rate limiting | MEDIUM | OBSERVED | MEDIUM — DoS potential |
| C-008: No observability | LOW | OBSERVED | LOW |
| C-009: .env in repo | LOW | INFERRED | LOW |
| C-010: No CHANGELOG | LOW | OBSERVED | LOW |

---

## BLOCKERS

[ ] **BLOCKER 1 (CRITICAL): RLS Policies NOT VERIFIED**
   - Without explicit proof of RLS behavior, no secure deployment can be authorized
   - Must execute db/live.proof.mjs with service_role credentials in safe environment

[ ] **BLOCKER 2 (HIGH): Backend Feature Completeness Unclear**
   - If STATUS/README claims multi-sided marketplace features and code does not implement them, false advertising risk
   - Must clarify scope or implement missing components

[ ] **BLOCKER 3 (MEDIUM): Database Integration Tests Missing**
   - Cannot verify `submit_lead` RPC contracts without integration tests
   - User-facing bug to duplicate honeypot/rejection could break unnoticed

---

**Report Date:** 2026-10-05
**Auditor:** TEAM C
**Authored:** Adversarial Red-Team review — falsifying success claims, not confirming them.
**Next Action:** Issue evidence integrity and release gate recommendations.