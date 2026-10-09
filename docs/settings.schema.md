# Settings Schema — Promota (OwoWorks)

All runtime settings live in the `public.settings` table and are seeded by migration `0008_points_levels.sql`. Each key is a `jsonb` column with a single `value` field (e.g. `{"v":100}`). The numeric value is extracted with `(value->>'v')::int`.

| Key | Type | Default JSON | Where it is read |
|-----|------|--------------|-----------------|
| `points.default_per_task` | `jsonb` | `{"v":100}` | `points.test.mjs` (indirectly via `levels.referral_gate_from`) |
| `points.per_referral` | `jsonb` | `{"v":150}` | `points.test.mjs` |
| `points.referral_qualifies_on_first_task` | `jsonb` | `{"v":true}` | SQL function `qualify_referral` |
| `levels.referral_gate_from` | `jsonb` | `{"v":4}` | SQL function `level_for`; test `points.test.mjs` |
| `levels.cash_unlock_from` | `jsonb` | `{"v":4}` | SQL function `cash_unlocked`; test `points.test.mjs` |
| `redemption.data_min_points` | `jsonb` | `{"v":500}` | SQL function `redeem_points` |
| `redemption.cash_min_points` | `jsonb` | `{"v":10000}` | SQL function `redeem_points` |

**Usage pattern (SQL example)**

```sql
select (value->>'v')::int as v
from settings
where key = 'points.default_per_task';
```

**Notes**

* All defaults are **immutable** via migration; the owner may update them from an admin UI without a new migration.
* The schema is deliberately tiny – only the keys required by the point/level/cash logic are present.
* No other part of the codebase reads a settings key that is missing from the table, so there is **no “missing setting”** at runtime.