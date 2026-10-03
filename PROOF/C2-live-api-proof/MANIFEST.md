# Proof C2 — live public API behaviour

**Task:** verify the OwoWorks sign-up API against the real Supabase project over
HTTPS, using the same publishable key the website ships, and prove the public
cannot read, edit or delete what they submit.

**Why this proof had to exist:** the local test runner is PGlite running as a
database superuser. A superuser bypasses row-level security by design, so no
local run can prove an RLS policy. Only a real request over the network to the
hosted project proves the public boundary. That is what this bundle records.

**Project:** `https://ykyvmgdruterzrmltquz.supabase.co`
**Captured (UTC):** see `07-git-state.txt`
**Commit at capture:** `df1a48b` (working tree — changes uncommitted; hashes in
`08-artifact-hashes.txt` identify the exact files proven)

## Result

`LIVE API PROOF: ALL HOLD` — **PASS 14, FAIL 0, UNVERIFIED 0**

| # | Proof | Outcome |
|---|-------|---------|
| 1 | A visitor can submit a sign-up via `POST /rest/v1/rpc/submit_lead` | PASS |
| 2 | The response carries an 8-char invite code and no personal data | PASS |
| 3 | A duplicate sign-up is refused, never duplicated | PASS |
| 4 | A visitor cannot read the sign-up list (no leak) | PASS |
| 5 | A visitor cannot update the sign-up list | PASS |
| 6 | A visitor cannot delete the sign-up list | PASS |
| 7 | A visitor cannot read the migration ledger | PASS |
| 8 | Queue-position lookup works and returns no PII | PASS |
| 9 | The admin (secret key) can see the stored row, so the write really landed | PASS |
| 10 | A notification event (`lead.captured`) was queued | PASS |
| 11 | A real signed-in account can obtain a session | PASS |
| 12 | A signed-in account still cannot read the sign-up list | PASS |
| 13 | A signed-in account can read shared campaign data | PASS |
| 14 | Cleanup: test lead, outbox event and test account all removed | PASS |

## What each file is

| File | Content |
|------|---------|
| `01-live-api-proof.txt` | Raw output of `node db/live.proof.mjs` (exit 0) |
| `02-phone-tests.txt` | `apps/web/phone.test.mjs` — 17 PASS / 0 FAIL |
| `03-client-tests.txt` | `apps/web/lead.test.mjs` — 24 PASS / 0 FAIL |
| `04-ledger-tests.txt` | `db/ledger.test.mjs` — 56 PASS / 0 FAIL / 2 UNVERIFIED |
| `05-leads-tests.txt` | `db/leads.test.mjs` — 37 PASS / 0 FAIL / 1 UNVERIFIED |
| `06-site-check.txt` | `scripts/checkSite.mjs` — 17 PASS / 0 FAIL |
| `07-git-state.txt` | Commit, branch and working-tree status at capture |
| `08-artifact-hashes.txt` | SHA-256 of the files this proof covers |

## How to reproduce

```
node db/live.proof.mjs                 # network proof, creates + deletes its own test data
npm test                               # phone + client + ledger + leads (locally, PGlite)
npm run site                           # static site invariants
```

## Honest boundaries

- The two ledger UNVERIFIED items and the one lead UNVERIFIED item are policy
  behaviour that needs real JWTs; they are covered here over HTTP and now pass,
  or are named with their venue. They are not reported as passes.
- Test data uses an `@example.invalid` address and a random unused Nigerian
  number; the script deletes every row and account it creates in a `finally`
  block. Cleanup status is printed and was 204/204/200 in this run.
- This proof covers the lead-capture boundary only. The authenticated admin
  backend, roles UI and PII-safe lead admin do not exist yet and are not claimed.
