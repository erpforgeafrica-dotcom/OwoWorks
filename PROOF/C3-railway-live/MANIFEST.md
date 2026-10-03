# PROOF / C3 — Railway live deployment

**Task:** ship the OwoWorks web surface to a public HTTPS URL and prove it works.
**Date:** 2026-10-03
**Result:** `node scripts/verifyLive.mjs` — **PASS 19 / FAIL 0 — DEPLOY VERIFY: ALL HOLD.**

## Target

| Field | Value |
|---|---|
| Account | `Engr.emmamickado@gmail.com` (live `railway whoami`) |
| Workspace | `m1ckad0's Projects` |
| Project | `owoworks` — `60ac6fc7-c53d-4150-b419-5ca790e35a96` |
| Service | `web` — `75a3deec-7806-4b91-85d8-e72a4b60853a` |
| Environment | `production` |
| Deployment | `9d2bde40-4c49-4239-9042-c33965a1b266` (status SUCCESS) |
| Public URL | https://web-production-045b1.up.railway.app |

## What was proven (all over the public network)

- Home page, `/styles.css`, `/theme-boot.js`, `/assets/identity/favicon.svg` all return 200.
- `/healthz` returns `{ ok: true, config: true }`.
- `/config.js` is injected at runtime, is a valid publishable-only config, and matches the
  live Supabase project `ykyvmgdruterzrmltquz`.
- Security headers present: strict CSP, `nosniff`, `x-frame-options: DENY`, `referrer-policy`.
- A real visitor sign-up through the deployed config lands in the database (confirmed by
  admin), returns an 8-char invite code with no phone, and the row is cleaned up (204).
- A visitor cannot read the sign-up list.

## Files

| File | Meaning |
|---|---|
| `01-deploy-verify.txt` | Raw output of `node scripts/verifyLive.mjs` |
| `02-railway-status.json` | `railway status --json` (project/service/deployment) |
| `03-deploy-metadata.json` | IDs, account, URL, verification timestamp |
| `04-artifact-hashes.txt` | SHA-256 of the shipped artifacts |

## Reproduce

```powershell
Set-Location C:\Users\pc\owoworks
node scripts/verifyLive.mjs https://web-production-045b1.up.railway.app
```

## Notes / carry-over

- `railway.json` (Config-as-Code) is deprecated by Railway in favour of Infrastructure-as-Code
  (`.railway/railway.ts`); existing files keep working until 2026-12-01.
- The deploy builds from `Dockerfile` with **no npm install** (Node built-ins only), so the
  image stays minimal and the build cannot fail on dependency resolution.
