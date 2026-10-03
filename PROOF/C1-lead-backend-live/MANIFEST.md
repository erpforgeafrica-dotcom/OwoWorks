# PROOF — C1: lead backend on live Supabase

**Captured:** 2026-10-03 (UTC). **Machine:** `C:\Users\pc\owoworks`. **Branch:** `main`.
**Rule:** every claim below is backed by a file in this folder or a named command. Items that
could not be proven locally are listed as UNVERIFIED with the venue where they will be proven.
Nothing here is asserted from memory.

## What this task did

1. Connected the repo to a live Supabase project and proved the connection by authentication.
2. Applied migrations `0001`–`0003` to the live database.
3. Rebuilt the public sign-up write path as a single controlled action, `submit_lead`.
4. Added regression tests for the exact defects found during the work.
5. Probed the live database for schema and for public API exposure.

## Evidence files

| File | Command that produced it |
|---|---|
| `01-local-migrations.txt` | `node scripts/migrateUp.mjs` |
| `02-db-tests.txt` | `node db/ledger.test.mjs` + `node db/leads.test.mjs` |
| `03-live-migrations-status.txt` | `node scripts/migrateRemote.mjs --status` |
| `04-live-inventory.txt` | `node scripts/dbProbe.mjs` |
| `05-git-state.txt` | `git status --short`, `git log --oneline -5` |

## Proven (local engine — PGlite/WASM, a real PostgreSQL build)

| Claim | Result |
|---|---|
| All seven migrations execute cleanly | `01` — 7 APPLIED |
| Core ledger invariants hold | `02` — `PASS 56 FAIL 0 UNVERIFIED 2` — LEDGER INVARIANTS: ALL HOLD |
| Lead-capture + `submit_lead` hold | `02` — `PASS 37 FAIL 0 UNVERIFIED 1` — LEAD CAPTURE: ALL HOLD |
| Referral codes always 8 chars, valid alphabet, unique | `02` — regression tests included |
| Phone normaliser accepts every spelling, rebuilds local form | `02` — regression test |
| `anon` holds **no** table privileges on `leads` | `02` — `anon cannot touch the leads table at all` |
| `anon` cannot run the deletion function or assign roles | `02` — privilege tests |
| `anon` **can** call `submit_lead` | `02` — privilege test |
| `anon` cannot touch the migration ledger; RLS on it | `02` — regression tests for `0006` |

## Proven (live Supabase project `ykyvmgdruterzrmltquz`)

| Claim | Evidence |
|---|---|
| Credentials authenticate against live PostgreSQL | connection used throughout `03` and `04` |
| `0001`–`0003` applied live, with timings | `03` — `APPLIED … 1364ms / 712ms / 1624ms` |
| All 16 application tables, triggers, policies and indexes exist live | `04` |
| `leads` is not readable by a signed-out visitor | `04` — `leads anon[-i--]` (insert only, no select) |

## UNVERIFIED — with the venue where each will be proven

| Item | Why not proven here | Venue |
|---|---|---|
| RLS policy behaviour over HTTP with real JWTs | PGlite runs as superuser and bypasses RLS by design; policies cannot fire locally | Supabase HTTP API with anon/authenticated JWTs |
| End-to-end browser → live DB sign-up | client `config.js` not yet created; remote is behind the local schema | live site + `db/live.proof.mjs` (to be written) |
| SMS double opt-in | no Termii key, no worker | later track |

## ⚠ CRITICAL FINDING — live security hole, created during this task

`node scripts/migrateRemote.mjs --status` was documented as "changes nothing". It does not: it
creates the ledger table before checking status. The ledger was therefore created inside
`public`, which Supabase exposes through the public API, and it inherited the default grants.

Live result from `04-live-inventory.txt`:

```
owoworks_schema_migrations   anon[siud]  auth[siud]   <-- reachable via the public API
legend: s=select i=insert u=update d=delete   (anon = signed-out visitor)
```

**Any anonymous visitor can read, insert, update and delete the migration ledger.** No personal
data is in that table, so this is not a data breach; it is a tamper surface. Remediation is
prepared as `db/migrations/0006_secure_migration_ledger.sql` and is **not yet applied**.

## Second finding — the public write path

The current client writes to the table and asks the database to return the new row
(`Prefer: return=representation`). Returning a row requires SELECT permission, which `anon`
does not have — so that request fails against the live database today. `0004_submit_lead.sql`
replaces it with one callable action that returns only the caller's own invite code and queue
position. `0004`–`0006` are **local only; not applied to the live database.**
