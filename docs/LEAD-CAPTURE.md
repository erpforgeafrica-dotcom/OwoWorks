# LEAD-CAPTURE.md — the backend that grows the list

**Status:** built, locally proven (56 + 37 + 41 DB tests green) and **proven over HTTPS against the
live Supabase project**. Migrations `0001`–`0007` are all applied live (0007 fixes membership oracle). The client calls the
single public action `submit_lead` and no longer has a demo fallback.
**Rule:** every claim below names its proof. Unprovable items are UNVERIFIED with a venue.

**Recent updates (2026-10-07):**
- Oracle fix `0007_fix_submit_lead_oracle.sql` applied: duplicate phone returns identical success shape `{ok, referral_code, position, referred}` — no membership leak.
- RLS anon matrix verified 14/0/0 on staging (2026-10-05) — `db/live.proof.mjs` PASS.
- `db/leads.test.mjs` expanded to 41 tests covering indistinguishability checks.

## 1. What the best do (verified, 2026-10-02)

| System | Stars | Mechanic adopted | Source |
|---|---|---|---|
| Dub (dubinc/dub) | 24K, TypeScript, AGPLv3 | Referral attribution with reversal on fraud; UTM capture on intake; partner programs single-level with void propagation | https://github.com/dubinc/dub |
| Formbricks (formbricks/formbricks) | 12.8K, TypeScript, AGPLv3 | Conversion-optimized capture; link surveys; privacy-first, self-hostable | https://github.com/formbricks/formbricks |
| ClickBank CDR (from prior forensics) | — | Self-fraud gate: time + uniqueness + instrument diversity before value flows | support.clickbank.com |
| Swagbucks IDV (from prior forensics) | — | Constraints disclosed at setup, never discovered at payout | help.swagbucks.com |

License honesty: both codebases are AGPLv3. **Patterns adopted, zero code copied.**
Our code is original; the table above is the attribution.

## 2. Architecture (what was built)

```
visitor (?ref=, ?utm_*) → validated form → honeypot + consent timestamp
  → POST /rest/v1/rpc/submit_lead   (one public action, anon)
  → SECURITY DEFINER function: validate → insert → assign code → emit outbox
  → returns ONLY { referral_code, position, referred } — no personal data
  → success screen: personal ?ref= link + share intents + queue position
  → (later) SMS worker consumes outbox → Termii OTP → verified_at
```

- **No SDK, no dependency.** Plain `fetch` to PostgREST. The publishable key is public by
  design; RLS and grants are the enforcement. Keys live in `config.js` (gitignored, generated
  from `config.example.js`, publishable key only). If it is absent the form says it is not
  connected — there is no demo-success path; the live build fails loudly, it never pretends.
- **One public write action, not a writable table.** The website calls `submit_lead`. `anon`
  holds **no** table privileges on `leads` — verified in `db/leads.test.mjs`. This replaces the
  earlier design where the client inserted directly and asked for the row back; returning a row
  needs SELECT, which the public must never have.
- **One identity per lead:** `UNIQUE(phone)` — the ClickBank uniqueness lesson.
- **Phone numbers are normalised at the door.** `normalise_nigerian_phone` accepts
  `0803 000 0000`, `08030000000`, `+234 803 000 0000`, `2348030000000` (spaces/dots/dashes) and
  stores one canonical form. A real defect in the first version of this helper was caught by
  `db/leads.test.mjs` before anything shipped (see `0005_fix_phone_normaliser.sql`).
- **Abuse controls in a trigger (fire for every role) AND in RLS (access layer):**
  honeypot empty, consent within the last 30 minutes and never future, phone shape.
- **Referral codes:** 8 chars, unambiguous 31-character alphabet, DB-assigned from
  `gen_random_uuid()`, collision-retried. An earlier version could emit a 7-character code; a
  regression test now generates 40 codes and asserts every one is exactly 8 valid characters.
- **PII-free RPCs:** `preview_referral` (masked name only), `lead_position` (numbers only),
  `submit_lead` (returns the caller's own code + queue number only).

## 3. The growth loop (why this compounds)

Every captured lead becomes a distributor: personal link → WhatsApp/X/Facebook intents with
honest copy → invitee lands with `?ref=` → banner names the inviter (masked) → position counter
("You are #N in line") rewards sharing immediately, before any payout.

The anti-gaming design, stated plainly:

| Attack | Defence | Proven where |
|---|---|---|
| Same phone, many signups | `UNIQUE(phone)` → friendly "already on the list" | `db/leads.test.mjs` |
| Bot form fills | honeypot + consent freshness, trigger + RLS | `db/leads.test.mjs` |
| Fake/invented ref codes | unknown code refused; malformed shape refused | `db/leads.test.mjs` |
| Self-referral farming | no self-referral + unique phone | `db/leads.test.mjs` |
| **Referral-farming for cash** | **Impossible by design: referrals pay ZERO. Queue priority only; cash flows only from verified work** | `docs/BRAND.md` + `0001_core.sql` payout guards |
| Attribution disputes | code + timestamp + UTM stored per lead; outbox event per capture | `db/leads.test.mjs` |

This is where we break from GoJelly (₦300–₦3,000 cash per referral — the shape the SEC
prosecutes as "monetary rewards for referrals"). Our referral moves you up the queue and
nothing else. Growth without a pyramid vector.

Honest bounds: the loop multiplies *reach*, not *conversion*. K-factor = invites sent ×
signup rate; both are measured from the outbox + leads table weekly once live. No projections
are stated anywhere in this repo because there is no traffic yet.

## 4. What is NOT done (no pretending)

| Item | State | Needs |
|---|---|---|
| Apply `0004`–`0007` to live | **DONE** — ledger records all seven; re-probe shows `anon[----]` | — |
| RLS anon matrix proof over HTTP | **DONE** — `db/live.proof.mjs` PASS 14 / 0 / 0 (staging 2026-10-05) | — |
| Remove demo fallback + wire `config.js` | **DONE** — client calls `submit_lead`; `config.js` generated | — |
| Oracle fix (membership leak) | **DONE** — `0007` applied, duplicate returns identical shape | — |
| SMS double opt-in (Termii) | designed (outbox `lead.captured` is the handoff); no key, no worker | Termii API key + worker |
| Admin view of leads | 0% — service_role reads via dashboard/SQL only | admin UI track |

## 5. Known issue closed

The migration ledger `public.owoworks_schema_migrations` was created by
`migrateRemote --status` inside the API-exposed `public` schema and inherited default grants
(`anon[siud]` on the live project). `0006_secure_migration_ledger.sql` revokes every public
privilege and enables RLS; it is now **applied live** and a re-probe shows `anon[----]`. The
`migrateRemote` runner was also fixed so `--status` is genuinely read-only and the advisory lock
is taken before the ledger is read. Moving the ledger to a schema that is not exposed over the
API remains a follow-up.

## 6. Go-live checklist (in order, each gated)

1. ~~Apply `0004`–`0006` live~~ **DONE** (`node scripts/migrateRemote.mjs`; `--status` shows six).
2. ~~Prove the RLS matrix over HTTP~~ **DONE** (`node db/live.proof.mjs` — 14/14).
3. Deploy `apps/web/` + `config.js` → submit a real lead → confirm row + outbox event → delete
   the test row. (The client switch and demo-fallback removal are done; deploy is the remainder.)
4. Termii sender ID + OTP worker → `verified_at` flows.
5. THEN remove `noindex` per SEO-D1. Never before 1–4.
