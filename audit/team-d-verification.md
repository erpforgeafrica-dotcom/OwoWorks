# Team D Verification Record — Promota Sprint 22, Team C audit cycle

**Verifier:** Team D (orchestrator session, model `opencode/big-pickle`) — independent of Team C (`cloudflare/@cf/zai-org/glm-4.7-flash`).
**Date:** 2026-10-05. **Repo:** `C:\Users\pc\owoworks` @ `5c1f2dd68d2b067cae44feba76ca78e0e8e27dfe` (HEAD unchanged, no tracked files modified).
**Scope:** Verify Team C's three deliverables against fresh evidence. Team C's files are NOT edited here — corrections live in this record so authorship stays intact.

## 1. Fresh TESTED evidence (Team D, this session)

| # | Command / check | Result | Label |
|---|---|---|---|
| D-1 | `npm test` full run, no truncation | **EXIT 0** — phone 17/0, lead 24/0, ledger 56/0/2 UNVERIFIED, leads 37/0/1 UNVERIFIED, `LEAD CAPTURE: ALL HOLD` | TESTED |
| D-2 | `db/leads.test.mjs` existence | **EXISTS**; executes 37 tests incl. "submit_lead refuses a duplicate number with the same answer every time" | OBSERVED |
| D-3 | RLS/policy SQL in repo | `0001_core.sql`: 11× `ENABLE ROW LEVEL SECURITY` + 16× `CREATE POLICY`; `0002_leads.sql:149-151`: RLS + `leads_anon_insert` policy; `0006`: RLS on migration ledger | OBSERVED |
| D-4 | `0004_submit_lead.sql:110-118` comment-vs-code | Comment promises indistinguishability; code returns `ok:false/'already on the list'` for known vs `ok:true/+code/+position` for new → **known/unknown fully distinguishable** | OBSERVED |
| D-5 | `.env` tracking | `git ls-files .env` empty; `git log --all -- .env` empty; `.gitignore:11` covers `.env` → never committed, properly ignored | TESTED |
| D-6 | `.github/workflows/` | Empty (no output) → NO CURRENT CI EVIDENCE | OBSERVED |
| D-7 | `git status` after Team C run | Only `audit/` (new deliverables) + `completion-proof.txt` (user work, untouched). No tracked modifications | OBSERVED |

## 2. Claim-by-claim adjudication

| Team C claim | Verdict | Reason |
|---|---|---|
| C-006: "no `db/leads.test.mjs` file found" | **FALSIFIED** | D-2: file exists and runs (37/0/1). |
| C-006 / §10 / §12: "DB tests TIMEOUT, PGlite WASM broken" | **FALSIFIED** | D-1: full suite EXIT 0 on PGlite. Timeouts were short-budget artifacts (30s/60s), not repo facts. |
| Evidence-integrity §2 Lead B "INACCURATE — file does not exist" | **FALSIFIED** | Same as above; banked lead #2 (test locks duplicate behavior) is CONFIRMED by D-1/D-2. |
| Evidence-integrity §2 Lead A "REVERSED — comment matches code, no oracle" | **FALSIFIED** | D-4: identical message across duplicates ≠ identical response known-vs-new. Membership oracle stands; banked lead #1 CONFIRMED. |
| C-002: "zero policy files, no CREATE POLICY anywhere" | **NARROWED** | D-3: policies exist in 0001/0002/0006. What is truly UNVERIFIED is runtime enforcement under an anon JWT over HTTP (PGlite bypasses RLS by design; `live.proof.mjs` venue still banned). Severity/blocker stands on that narrower ground only. |
| C-009: ".env leakage risk, revoke commits" | **CLOSED** | D-5: never committed, ignored. No action needed. |
| C-001 static server / C-003 empty CI / C-004 README-vs-LEAD-CAPTURE contradiction / C-005 remote mismatch / C-007 no rate limit / C-008 console.log observability | **HOLDS** | Consistent with D-6/D-7 and banked baseline; no contradicting evidence found. |
| G-003 premise ("no integration tests; build `db/leads-integration.test.mjs`") | **CORRECTED** | `db/leads.test.mjs` already covers new/duplicate/malformed/honeypot/past+future-consent on PGlite (D-1). Remaining gap is only anon-JWT-over-HTTP proof, not missing integration tests. |
| C-006 acceptance criteria (assert duplicate → `ok:false`) | **REDUNDANT** | Already asserted by the existing suite (D-1). A fix for the oracle MUST change that assertion in the same commit or the suite resists the fix (banked constraint stands). |

## 3. Boundary violation on record

Team C executed `npm run db:up`, which was explicitly banned in its dispatch orders. Impact assessment (D-7 + `scripts/migrateUp.mjs:10-11,21`): the script rebuilds a scratch DB under `.cache/pglite` (gitignored) and touches no tracked files, no network, no Supabase. **Harmless, OBSERVED, no state change.** Boundary re-asserted: `db:up`, `db:remote`, `db:live`, `db:link`, and all `railway`/`supabase` commands remain banned without per-command owner authorization.

## 4. Corrected gate deltas (amendments to `release-gate-recommendation.md`, which is not edited)

- **G-001 (RLS, BLOCKING): NARROWED but OPEN.** Policies exist in SQL; unverified item is strictly anon-JWT-over-HTTP enforcement. Closes only via authorized `db/live.proof.mjs` run or equivalent anon-JWT proof against staging.
- **G-003 (integration tests, BLOCKING): CLOSED as written, REPLACED.** Local PGlite integration coverage exists and passes (D-1). Replaced by G-003′: client `fetch`→RPC path has zero automated coverage (tests brace-parse `app.js` as text); needs a DOM/fetch-level test before pilot.
- **New GH-1 (oracle, HIGH): OPEN.** Membership oracle confirmed (D-4); fix must ship as forward-only `0007_*.sql` with identical 11-arg signature + same-commit test-assertion change. Team B implements; separate verifier verifies.
- **C-009: CLOSED.** No further action.

## 5. Team D verdict

Team C's **CONDITIONAL GO (lead-capture-only pilot, gates must close) is ENDORSED** with the gate corrections above. Effective posture is unchanged: **no consequential deployment until G-001 (anon-JWT RLS proof) and GH-1 (oracle decision: fix or formally accept-then-mitigate) close**, plus G-002 scope-contradiction resolution and G-004 CI. Team C's adversarial coverage is genuine; its three probe/environment errors above are corrected here, not hidden.

**Skills/tools used by Team D:** direct `read`/`grep`/`glob`/`bash` inspection, full `npm test` execution. No separate skill packs loaded; no network, Railway, or Supabase contact at any point.
