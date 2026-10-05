# Gate Evidence — live proof run + oracle-fix verification (Team D)

**Date:** 2026-10-05. **Repo HEAD at run time:** `6816ad1`. **Venue:** Supabase staging (owner-authorized, single run). No secrets, URLs, or key material in this file.

## 1. G-001 RLS proof — CLOSED (TESTED)

`node db/live.proof.mjs` → **EXIT 0, PASS 14 / FAIL 0 / UNVERIFIED 0, "LIVE API PROOF: ALL HOLD".**
Proven over HTTPS with anon + real authenticated JWTs: visitor can submit; duplicate refused; visitor cannot read/update/delete leads; visitor cannot read migration ledger; position lookup leaks no PII; admin sees row + outbox event; signed-in account cannot read leads but can read shared campaigns. Cleanup complete (test lead, outbox events, test account all removed — delete statuses 204/204/200). **RLS enforcement is now SUPPORTED by fresh evidence, not merely claimed.** (Note: this run proved the *pre-0007* function — see §2.)

## 2. GH-1 oracle fix — IMPLEMENTED locally, D-VERIFIED, NOT yet live on staging

- `db/migrations/0007_fix_submit_lead_oracle.sql` (new): forward-only, identical 11-arg signature, known phones now get the same `{ok, referral_code, position, referred}` shape (existing code/true position/live count), no second row, no second outbox event, all refusals preserved, grant re-asserted. Team B, uncommitted → verified below → committed here.
- `db/leads.test.mjs`: duplicate assertion replaced with 5 known-vs-new indistinguishability checks (shape, code recovery, no message key, no PII, single row).
- Team D fresh run: `npm test` → **EXIT 0** — phone 17/0, lead 24/0, ledger 56/0/2 UNVERIFIED, leads 41/0/1 UNVERIFIED.
- **Residual, accepted:** timing side-channel (no constant-time padding); true position/referred values are plausible-not-identical; pre-existing lane asymmetry (bad lane + known phone → success vs bad lane + new phone → constraint error) preserved for minimal diff — logged as follow-up GH-1b, LOW severity.
## 5. GH-1 applied to STAGING + oracle proven dead live (TESTED, this cycle)

- `--status` (read-only): 0001–0006 APPLIED, checksums match (no drift), only `0007_fix_submit_lead_oracle.sql` PENDING.
- Apply: `OK 0007_fix_submit_lead_oracle.sql 494ms`, ledger now 7. Advisory lock held/released cleanly.
- Throwaway TEMP check (not committed): fresh number submitted twice over HTTPS — both return status 200, identical key shape `[ok,position,referral_code,referred]`, `ok=true` both times, original code recovered, no `message` key, no phone digits in either body. Cleanup 204/204. **ORACLE_DEAD_ON_STAGING=true.**
- **GH-1 is now CLOSED end-to-end** (code + staging + live proof + cleanup). The `live.proof.mjs` duplicate step (which asserts the OLD `ok:false` refusal) is now obsolete by design — it must be updated to the new shape when next run, otherwise it will FAIL against fixed behavior.
- **Staging still runs the old function.** The oracle remains LIVE on staging until 0007 is applied there via an authorized remote migration — currently banned, needs a separate owner go.

## 3. Team A status — QUOTA-BLOCKED, not started

`promota-team-a` (gemini-3.6-flash free tier) returned quota-exceeded on dispatch; retry ETA ~2h. No Team A files exist yet. Options for owner: (a) wait ~2h and re-dispatch on the pinned model (preserves the 4-family roster exactly), or (b) run the Team A prompt package on a substitute PASS-listed model now (independence preserved — still a different family from B/C/D — roster model changes).

## 6. Team A partial delivery received (2026-10-05 ~10:13, before quota death)

`audit/business-model-audit.md`, `audit/product-completeness-matrix.csv`, `audit/product-claims-register.csv` (3 of 4 Team A files) committed as genuine Team A output on the pinned model. Quality: correctly labeled, consistent with verified evidence. **Two staleness corrections (apply to all three):**
- B-010 and claims P-004/P-005 ("RLS UNVERIFIED, proof BANNED") are SUPERSEDED by §1 above — RLS proven live 14/14 after these files were written.
- §9 pilot conditions "oracle fixed (0007 — DONE)" and "RLS verified (G-001)" are both now DONE + live-tested (§5).
- Still missing (quota-blocked, retry after reset): `route-content-inventory.csv`.

## 4. Effective release posture after this cycle (updated: GH-1 fully closed, §5)

- **G-001 CLOSED.** G-003 replaced by G-003′ (client fetch path untested) — still open. G-002 scope contradiction + G-004 CI still open. **GH-1 CLOSED end-to-end.**
- Verdict stands: **CONDITIONAL GO (lead-capture-only pilot) with blocking gates; no consequential deployment until G-002 scope alignment is published.** Full public marketplace remains NO-GO.
