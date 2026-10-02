# LEAD-CAPTURE.md — the backend that grows the list

**Status:** built, locally proven, NOT live (no Supabase project connected).
**Rule:** every claim below names its proof. Unprovable items are UNVERIFIED with a venue.

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
  → POST /rest/v1/leads (anon key, RLS append-only)
  → DB assigns referral_code, resolves referred_by, emits outbox event
  → success screen: personal ?ref= link + share intents + queue position
  → (later) SMS worker consumes outbox → Termii OTP → verified_at
```

- **No SDK, no dependency.** Plain `fetch` to PostgREST. The anon key is public by
  design; RLS is the enforcement. Keys live in `config.js` (gitignored, created at
  deploy from `config.example.js`). Without it the page runs in demo mode and says so.
- **One identity per lead:** `UNIQUE(phone_e164)` — the ClickBank uniqueness lesson.
- **Abuse controls in a trigger (fire for every role) AND in RLS (access layer):**
  honeypot empty, consent within the last 30 minutes and never future, phone shape.
- **Referral codes:** 8 chars, unambiguous alphabet, DB-assigned, collision-retried.
- **PII-free RPCs:** `preview_referral` (masked name only), `lead_position` (numbers only).
  Phone numbers are never enumerable: anon has no SELECT at all.

## 3. The growth loop (why this compounds)

Every captured lead becomes a distributor: personal link → WhatsApp/X/Facebook intents
with honest copy → invitee lands with `?ref=` → banner names the inviter (masked) →
position counter ("You are #N in line") rewards sharing immediately, before any payout.

The anti-gaming design, stated plainly:

| Attack | Defence | Proven where |
|---|---|---|
| Same phone, many signups | `UNIQUE(phone_e164)` → 409 → friendly "already on the list" | `db/leads.test.mjs` |
| Bot form fills | honeypot + consent freshness, trigger + RLS | `db/leads.test.mjs` |
| Fake/invented ref codes | unknown code refused; malformed shape refused | `db/leads.test.mjs` |
| Self-referral farming | `leads_no_self_referral` + unique phone | `db/leads.test.mjs` |
| **Referral-farming for cash** | **Impossible by design: referrals pay ZERO. Queue priority only; cash flows only from verified work** (DB-ledger payouts require released tasks) | `docs/BRAND.md` trust line + `0001_core.sql` payout guards |
| Attribution disputes | code + timestamp + UTM stored per lead; outbox event per capture | `db/leads.test.mjs` |

This is where we break from GoJelly (₦300–₦3,000 cash per referral — the shape the SEC
prosecutes as "monetary rewards for referrals"). Our referral moves you up the queue and
nothing else. Growth without a pyramid vector.

Honest bounds: the loop multiplies *reach*, not *conversion*. K-factor = invites sent ×
signup rate; both are measured from the outbox + leads table weekly once live. No
projections are stated anywhere in this repo because there is no traffic yet.

## 4. What is NOT built (no pretending)

| Item | State | Needs |
|---|---|---|
| Live Supabase project + tables | migration written, executes on PGlite; never applied to Supabase | `pc-sabisubase.txt` (searched 6 locations 2026-10-02 — **file does not exist**) or equivalent access |
| RLS anon matrix proof | UNVERIFIED locally by design | staging + anon/authenticated JWTs |
| SMS double opt-in (Termii) | designed (outbox `lead.captured` is the handoff); no key, no worker, no Edge Function | Termii API key + Supabase access |
| Queue-position display | RPC written + client wired; untested against live PostgREST | live project |
| Admin view of leads | 0% — service_role reads via dashboard/SQL only for now | admin UI track |

## 5. Go-live checklist (in order, each gated)

1. Create Supabase project → run `db/migrations/0000–0002` → verify with `db/leads.test.mjs` pointed at staging.
2. Prove RLS matrix: anon insert 201, anon select 0 rows, anon update 403, duplicate 409, bad code 400.
3. Deploy `apps/web/` + `config.js` (from `config.example.js`) → submit a real lead → confirm row + outbox event → delete the test row.
4. Termii sender ID + OTP worker → `verified_at` flows.
5. THEN remove `noindex` per SEO-D1. Never before 1–4.
