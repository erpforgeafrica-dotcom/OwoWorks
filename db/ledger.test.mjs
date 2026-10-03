#!/usr/bin/env node
/**
 * ledger.test.mjs — adversarial invariant tests.
 *
 * These tests DELIBERATELY bypass the application layer and write straight to
 * the database. A defence that has never been fired is a hypothesis. Every
 * numbered test below asserts that POSTGRES ITSELF refuses a bad write.
 *
 * Isolation: every case runs in its own transaction. accepts() commits,
 * rejects() rolls back, so a refused write can never pollute a later sweep.
 *
 * SCOPE, stated honestly:
 *   - PROVEN here: CHECK constraints, BEFORE/CONSTRAINT triggers, state
 *     machines, unique idempotency indexes, global conservation sweeps.
 *     Triggers fire for every database role, so these hold on Supabase too.
 *   - UNVERIFIED here, MUST be proven on Supabase staging with real
 *     anon/authenticated JWTs: RLS policies. PGlite runs as superuser and
 *     superusers bypass RLS by design, so no local test can fire them.
 *
 * Runs against a real PostgreSQL engine (PGlite/WASM).
 */
import { withDb, migrate } from '../scripts/migrateUp.mjs';

let pass = 0, fail = 0, unverifiedCount = 0;
const results = [];

function check(label, ok, detail) {
  // Print immediately: if the suite crashes mid-run, progress is not lost.
  const line = ok ? `  PASS  ${label}` : `  FAIL  ${label}${detail ? `\n          -> ${detail}` : ''}`;
  results.push(line);
  console.log(line);
  if (ok) pass++; else fail++;
}

function unverified(label, reason) {
  unverifiedCount++;
  results.push(`  UNVERIFIED  ${label}\n          -> ${reason}`);
}

async function rejects(db, label, sql, expectFragment) {
  await db.exec('begin');
  let err = null;
  try { await db.exec(sql); await db.exec('commit'); }
  catch (e) { err = e; try { await db.exec('rollback'); } catch { /* already clean */ } }
  if (!err) { check(label, false, 'database ACCEPTED a write it must refuse'); return; }
  const msg = String(err.message || err);
  const ok = !expectFragment || msg.toLowerCase().includes(expectFragment.toLowerCase());
  check(label, ok, ok ? '' : `rejected, but not for the expected reason (wanted "${expectFragment}")\n          got: ${msg.split('\n')[0]}`);
}

async function accepts(db, label, sql) {
  await db.exec('begin');
  try { await db.exec(sql); await db.exec('commit'); check(label, true); return true; }
  catch (e) {
    try { await db.exec('rollback'); } catch { /* already clean */ }
    check(label, false, String(e.message || e).split('\n')[0]);
    return false;
  }
}

const UID_A = '11111111-1111-4111-8111-111111111111';
const UID_B = '22222222-2222-4222-8222-222222222222';
const UID_C = '99999999-9999-4999-8999-999999999999';

await withDb(async db => {
  await migrate(db, { quiet: true });

  // seed users: A = verified promoter (t2, phone + age verified),
  // B = business, C = unverified promoter (t0, nothing verified).
  await db.exec(`
    insert into auth.users(id, email) values
      ('${UID_A}', 'promoter@amplo.test'),
      ('${UID_B}', 'business@amplo.test'),
      ('${UID_C}', 'newbie@amplo.test');
    insert into profiles(id, role, state, display_name, phone_e164, phone_verified_at, kyc_tier, age_verified_at)
    values ('${UID_A}', 'promoter', 'active', 'Ada', '08030000000', now(), 't2', now()),
           ('${UID_B}', 'business', 'active', 'Biz', '08040000000', now(), 't1', now()),
           ('${UID_C}', 'promoter', 'active', 'New', '08050000000', null, 't0', null);
  `);

  /* ---------------------------------------------------------- 1. BALANCE */
  await accepts(db, 'balanced two-posting entry commits',
    `insert into ledger_entries(id, idempotency_key, kind, currency)
     values ('a1111111-1111-4111-8111-111111111111','idem-balanced-1','escrow_fund','NGN');
     insert into postings(entry_id, account_id, direction, amount_minor, currency)
     select 'a1111111-1111-4111-8111-111111111111', id, 'D', 50000, 'NGN' from accounts where code = 'PLATFORM_CASH_NGN';
     insert into postings(entry_id, account_id, direction, amount_minor, currency)
     select 'a1111111-1111-4111-8111-111111111111', id, 'C', 50000, 'NGN' from accounts where code = 'PROMOTER_PAYABLE_NGN';`);

  await rejects(db, 'UNBALANCED entry is refused at COMMIT (one-sided)',
    `insert into ledger_entries(id, idempotency_key, kind, currency)
     values ('a2222222-2222-4222-8222-222222222222','idem-unbalanced','payout','NGN');
     insert into postings(entry_id, account_id, direction, amount_minor, currency)
     select 'a2222222-2222-4222-8222-222222222222', id, 'D', 999, 'NGN' from accounts where code = 'PLATFORM_CASH_NGN';`,
    'unbalanced');

  await rejects(db, 'UNBALANCED entry is refused (mismatched amounts)',
    `insert into ledger_entries(id, idempotency_key, kind, currency)
     values ('a3333333-3333-4333-8333-333333333333','idem-unbalanced-2','payout','NGN');
     insert into postings(entry_id, account_id, direction, amount_minor, currency)
     select 'a3333333-3333-4333-8333-333333333333', id, 'D', 1000, 'NGN' from accounts where code = 'PLATFORM_CASH_NGN';
     insert into postings(entry_id, account_id, direction, amount_minor, currency)
     select 'a3333333-3333-4333-8333-333333333333', id, 'C', 999, 'NGN' from accounts where code = 'PROMOTER_PAYABLE_NGN';`,
    'unbalanced');

  // A single posting with amount > 0 can never sum to zero, so the balance
  // invariant refuses it. A dedicated minimum-two trigger was removed as
  // provably redundant (see migration note) rather than kept as decoration.
  await rejects(db, 'entry with a SINGLE posting is refused by the balance rule',
    `insert into ledger_entries(id, idempotency_key, kind, currency)
     values ('a4444444-4444-4444-8444-444444444444','idem-single','payout','NGN');
     insert into postings(entry_id, account_id, direction, amount_minor, currency)
     select 'a4444444-4444-4444-8444-444444444444', id, 'D', 1000, 'NGN' from accounts where code = 'PLATFORM_CASH_NGN';`,
    'unbalanced');

  await rejects(db, 'zero-amount posting is refused',
    `insert into ledger_entries(id, idempotency_key, kind, currency)
     values ('a5555555-5555-4555-8555-555555555555','idem-zero','payout','NGN');
     insert into postings(entry_id, account_id, direction, amount_minor, currency)
     select 'a5555555-5555-4555-8555-555555555555', id, 'D', 0, 'NGN' from accounts where code = 'PLATFORM_CASH_NGN';`,
    'amount_minor');

  await rejects(db, 'negative amount is refused (a negative debit IS a credit)',
    `insert into postings(entry_id, account_id, direction, amount_minor, currency)
     select 'a1111111-1111-4111-8111-111111111111', id, 'D', -100, 'NGN' from accounts where code = 'PLATFORM_CASH_NGN';`,
    'amount_minor');

  await rejects(db, 'mixed-currency entry is refused',
    `insert into ledger_entries(id, idempotency_key, kind, currency)
     values ('a6666666-6666-4666-8666-666666666666','idem-fx','payout','NGN');
     insert into postings(entry_id, account_id, direction, amount_minor, currency)
     select 'a6666666-6666-4666-8666-666666666666', id, 'D', 1000, 'NGN' from accounts where code = 'PLATFORM_CASH_NGN';
     insert into postings(entry_id, account_id, direction, amount_minor, currency)
     select 'a6666666-6666-4666-8666-666666666666', id, 'C', 1000, 'USD' from accounts where code = 'PLATFORM_CASH_USD';`,
    'mixes currencies');

  /* ------------------------------------------------------ 2. IMMUTABILITY */
  await rejects(db, 'UPDATE on a posting is refused',
    `update postings set amount_minor = 1 where entry_id = 'a1111111-1111-4111-8111-111111111111';`,
    'immutable');

  await rejects(db, 'DELETE on a posting is refused',
    `delete from postings where entry_id = 'a1111111-1111-4111-8111-111111111111';`,
    'immutable');

  await accepts(db, 'audit row can be written (append path)',
    `insert into audit_log(actor_id, actor_role, action, target_type, target_id)
     values ('${UID_B}', 'admin', 'test.seed', 'profile', '${UID_A}');`);

  await rejects(db, 'UPDATE on audit_log is refused',
    `update audit_log set action = 'tampered' where action = 'test.seed';`,
    'append-only');

  await rejects(db, 'DELETE on audit_log is refused',
    `delete from audit_log where action = 'test.seed';`,
    'append-only');

  /* -------------------------------------------------------- 3. IDEMPOTENCY */
  await rejects(db, 'duplicate ledger idempotency_key is refused',
    `insert into ledger_entries(id, idempotency_key, kind, currency)
     values ('a7777777-7777-4777-8777-777777777777','idem-balanced-1','escrow_fund','NGN');`,
    'duplicate key');

  await rejects(db, 'duplicate payout idempotency_key is refused',
    `insert into payouts(promoter_id, kind, amount_minor, currency, idempotency_key)
     values ('${UID_A}','data',5000,'NGN','pay-dup-1');
     insert into payouts(promoter_id, kind, amount_minor, currency, idempotency_key)
     values ('${UID_A}','data',5000,'NGN','pay-dup-1');`,
    'duplicate key');

  /* --------------------------------------------------- 4. CAMPAIGN GUARDS */
  const CID = '33333333-3333-4333-8333-333333333333';
  await accepts(db, 'campaign created with a sane split',
    `insert into campaigns(id, owner_id, title, platform, objective, budget_minor,
                           price_per_outcome_minor, promoter_share_bp, fraud_reserve_bp, margin_floor_bp)
     values ('${CID}','${UID_B}','Test','youtube','click',1000000,500,4500,500,4000);`);

  await rejects(db, 'split that breaches the margin floor is refused',
    `insert into campaigns(owner_id, title, platform, objective, budget_minor,
                           price_per_outcome_minor, promoter_share_bp, fraud_reserve_bp, margin_floor_bp)
     values ('${UID_B}','Bad','youtube','click',1000,100,9600,500,4000);`,
    'margin');

  await rejects(db, 'share + reserve exceeding 100% is refused',
    `insert into campaigns(owner_id, title, platform, objective, budget_minor,
                           price_per_outcome_minor, promoter_share_bp, fraud_reserve_bp, margin_floor_bp)
     values ('${UID_B}','Bad2','youtube','click',1000,100,9000,2000,0);`,
    'share');

  await rejects(db, 'hold period outside 48-72h is refused',
    `insert into campaigns(owner_id, title, platform, objective, budget_minor,
                           price_per_outcome_minor, hold_hours)
     values ('${UID_B}','Bad3','youtube','click',1000,100,1);`);

  await rejects(db, 'negative budget is refused',
    `insert into campaigns(owner_id, title, platform, objective, budget_minor, price_per_outcome_minor)
     values ('${UID_B}','Neg','youtube','click',-5,100);`);

  /* ------------------------------------------- 5. ESCROW BEFORE GOING LIVE */
  const CID2 = '44444444-4444-4444-8444-444444444444';
  await rejects(db, 'unfunded campaign cannot go LIVE',
    `insert into campaigns(id, owner_id, title, platform, objective, budget_minor,
                           price_per_outcome_minor, promoter_share_bp, fraud_reserve_bp,
                           margin_floor_bp, state)
     values ('${CID2}','${UID_B}','Unfunded','youtube','click',100000,100,4500,500,4000,'live');`,
    'cannot go live');

  await accepts(db, 'escrow funding writes a balanced entry to the campaign account',
    `insert into campaigns(id, owner_id, title, platform, objective, budget_minor,
                           price_per_outcome_minor, promoter_share_bp, fraud_reserve_bp,
                           margin_floor_bp)
     values ('${CID2}','${UID_B}','Funded','youtube','click',100000,100,4500,500,4000);
     insert into accounts(code, name, type, scope, scope_id, currency)
     values ('ESCROW','Campaign escrow','ASSET','campaign','${CID2}','NGN');
     insert into ledger_entries(id, idempotency_key, kind, currency, campaign_id)
     values ('a9999999-9999-4999-8999-999999999999','idem-escrow-1','escrow_fund','NGN','${CID2}');
     insert into postings(entry_id, account_id, direction, amount_minor, currency)
     select 'a9999999-9999-4999-8999-999999999999', id, 'D', 100000, 'NGN'
       from accounts where scope = 'campaign' and scope_id = '${CID2}';
     insert into postings(entry_id, account_id, direction, amount_minor, currency)
     select 'a9999999-9999-4999-8999-999999999999', id, 'C', 100000, 'NGN' from accounts where code = 'PLATFORM_CASH_NGN';`);

  const CID3 = '12121212-1212-4121-8121-121212121212';
  await accepts(db, 'partial escrow is recorded but does not unlock launch',
    `insert into campaigns(id, owner_id, title, platform, objective, budget_minor,
                           price_per_outcome_minor, promoter_share_bp, fraud_reserve_bp,
                           margin_floor_bp)
     values ('${CID3}','${UID_B}','Partial','youtube','click',100000,100,4500,500,4000);
     insert into accounts(code, name, type, scope, scope_id, currency)
     values ('ESCROW','Campaign escrow','ASSET','campaign','${CID3}','NGN');
     insert into ledger_entries(id, idempotency_key, kind, currency, campaign_id)
     values ('a1010101-0101-4101-8101-101010101010','idem-escrow-2','escrow_fund','NGN','${CID3}');
     insert into postings(entry_id, account_id, direction, amount_minor, currency)
     select 'a1010101-0101-4101-8101-101010101010', id, 'D', 50000, 'NGN'
       from accounts where scope = 'campaign' and scope_id = '${CID3}';
     insert into postings(entry_id, account_id, direction, amount_minor, currency)
     select 'a1010101-0101-4101-8101-101010101010', id, 'C', 50000, 'NGN' from accounts where code = 'PLATFORM_CASH_NGN';`);

  await rejects(db, 'half-funded campaign cannot go LIVE',
    `update campaigns set state = 'live' where id = '${CID3}';`,
    'cannot go live');

  await accepts(db, 'fully funded campaign goes LIVE',
    `update campaigns set state = 'live' where id = '${CID2}';`);

  await accepts(db, 'live campaign auto-pauses at 90% of budget',
    `update campaigns set spent_minor = 95000 where id = '${CID2}';`);
  {
    const r = await db.query(`select state from campaigns where id = '${CID2}'`);
    check('auto-pause actually moved the campaign to paused', r.rows[0].state === 'paused',
      `state is ${r.rows[0].state}`);
  }

  await rejects(db, 'spend above escrow is refused even when paused',
    `update campaigns set spent_minor = 100001 where id = '${CID2}';`,
    'exceeds escrowed credit');

  /* ------------------------------------------------ 6. TASK STATE MACHINE */
  const TID = '55555555-5555-4555-8555-555555555555';
  await accepts(db, 'task created in draft',
    `insert into tasks(id, campaign_id, caption, tracked_link, reward_minor, assigned_to, assigned_at)
     values ('${TID}','${CID}','post this','https://t.example/x',500,'${UID_A}',now());`);

  await accepts(db, 'draft -> assigned is legal',
    `update tasks set state = 'assigned' where id = '${TID}';`);

  await rejects(db, 'assigned -> paid (skipping review) is refused',
    `update tasks set state = 'paid' where id = '${TID}';`,
    'illegal task transition');

  const TIDB = '0b0b0b0b-0b0b-40b0-80b0-0b0b0b0b0b0b';
  await accepts(db, 'second task created for transition coverage',
    `insert into tasks(id, campaign_id, caption, tracked_link, reward_minor, assigned_to, assigned_at)
     values ('${TIDB}','${CID}','post that','https://t.example/z',500,'${UID_A}',now());`);
  await rejects(db, 'draft -> approved is refused',
    `update tasks set state = 'approved' where id = '${TIDB}';`,
    'illegal task transition');

  await accepts(db, 'assigned -> submitted -> checking -> approved is legal',
    `update tasks set state = 'submitted', submitted_at = now() where id = '${TID}';
     update tasks set state = 'checking' where id = '${TID}';
     update tasks set state = 'approved', hold_until = now() + interval '72 hours' where id = '${TID}';`);

  await rejects(db, 'approved -> submitted (regression) is refused',
    `update tasks set state = 'submitted' where id = '${TID}';`,
    'illegal task transition');

  /* --------------------------------------------- 7. AUTO-APPROVE (24h rule) */
  const T2 = '66666666-6666-4666-8666-666666666666';
  await accepts(db, 'stale submitted task is auto-approved past its deadline',
    `insert into tasks(id, campaign_id, caption, tracked_link, reward_minor, assigned_to,
                       assigned_at, state, submitted_at, auto_approve_at)
     values ('${T2}','${CID}','stale','https://t.example/y',500,'${UID_A}',now(),'assigned',now(),now() - interval '25 hours');
     update tasks set state = 'submitted' where id = '${T2}';
     select auto_approve_stale_tasks();`);
  {
    const r = await db.query(`select state from tasks where id = '${T2}'`);
    check('auto-approve actually moved the task to approved', r.rows[0].state === 'approved',
      `state is ${r.rows[0].state}`);
  }
  {
    const r = await db.query(`select count(*)::int as n from outbox where topic = 'task.auto_approved'`);
    check('auto-approve emits an outbox event', r.rows[0].n >= 1, `found ${r.rows[0].n}`);
  }

  /* ------------------------------------------------- 8. PAYOUT ELIGIBILITY */
  await accepts(db, 'verified promoter can take a data reward',
    `insert into payouts(promoter_id, kind, amount_minor, currency, idempotency_key)
     values ('${UID_A}','data',5000,'NGN','pay-data-a');`);

  await accepts(db, 'verified promoter can take a cash payout',
    `insert into payouts(promoter_id, kind, amount_minor, currency, idempotency_key)
     values ('${UID_A}','cash',100000,'NGN','pay-cash-a');`);

  await rejects(db, 'unverified promoter cannot take cash (KYC tier 2 required)',
    `insert into payouts(promoter_id, kind, amount_minor, currency, idempotency_key)
     values ('${UID_C}','cash',100000,'NGN','pay-cash-c');`,
    'KYC tier 2');

  await rejects(db, 'unverified promoter cannot take data (verified phone required)',
    `insert into payouts(promoter_id, kind, amount_minor, currency, idempotency_key)
     values ('${UID_C}','data',5000,'NGN','pay-data-c');`,
    'verified phone');

  /* ------------------------------------------------ 9. ROLES AND SUSPENSION */
  await rejects(db, 'direct UPDATE of a role is refused (must use assign_role)',
    `update profiles set role = 'owner' where id = '${UID_A}';`,
    'assign_role');

  await rejects(db, 'assign_role without the grant is refused',
    `select assign_role('${UID_A}', 'support');`,
    'role.assign');
  unverified('assign_role success path with a real grant',
    'needs an authenticated session with role.assign; PGlite has no JWTs. Prove on Supabase staging.');

  await rejects(db, 'suspended state without a timestamp is refused',
    `update profiles set state = 'suspended' where id = '${UID_A}';`);

  await accepts(db, 'justified suspension (state + timestamp + reason) is recorded',
    `update profiles set state = 'suspended', suspended_at = now(),
       suspension_reason = 'test suspension' where id = '${UID_C}';`);

  /* ------------------------------------------------------- 10. DISPUTES */
  const D1 = '77777777-7777-4777-8777-777777777777';
  await accepts(db, 'promoter can raise a dispute on their task',
    `insert into disputes(id, task_id, raised_by, reason)
     values ('${D1}','${TID}','${UID_A}','proof rejected without explanation');`);

  await rejects(db, 'open -> upheld (skipping review) is refused',
    `update disputes set state = 'upheld', resolved_by = '${UID_B}' where id = '${D1}';`,
    'illegal dispute transition');

  await accepts(db, 'open -> under_review -> upheld with a named reviewer is legal',
    `update disputes set state = 'under_review' where id = '${D1}';
     update disputes set state = 'upheld', resolved_by = '${UID_B}', resolved_at = now(),
       resolution = 'proof re-checked, reward released' where id = '${D1}';`);

  const D2 = '88888888-8888-4888-8888-888888888888';
  await accepts(db, 'second dispute opened for reviewer coverage',
    `insert into disputes(id, task_id, raised_by, reason)
     values ('${D2}','${TID}','${UID_A}','second look requested');`);
  await rejects(db, 'a decision without a named reviewer is refused',
    `update disputes set state = 'under_review' where id = '${D2}';
     update disputes set state = 'rejected', resolution = 'anonymous decision' where id = '${D2}';`,
    'named reviewer');

  /* ------------------------------------------------- 11. SETTINGS GUARDS */
  await rejects(db, 'negative money setting is refused',
    `update settings set value = '{"v":-5}'::jsonb where key = 'payout.min_cash_minor';`);

  await rejects(db, 'basis-points setting above 10000 is refused',
    `update settings set value = '{"v":99999}'::jsonb where key = 'margin.floor_bp';`,
    null);
  unverified('settings write-gating (settings.write permission)',
    'RLS is bypassed by the PGlite superuser by design. Prove with anon/authenticated JWTs on Supabase staging.');

  /* --------------------------------------- 12. GLOBAL CONSERVATION SWEEPS */
  {
    const r = await db.query(`
      select e.id
        from ledger_entries e
        join postings p on p.entry_id = e.id
       group by e.id
      having sum(case when p.direction = 'D' then p.amount_minor else -p.amount_minor end) <> 0`);
    check('global sweep: no unbalanced entry survives', r.rows.length === 0,
      `${r.rows.length} unbalanced`);
  }
  {
    const r = await db.query(`
      select e.id from ledger_entries e
       where (select count(*) from postings p where p.entry_id = e.id) = 0`);
    check('global sweep: every entry carries postings (single postings are refused by balance)', r.rows.length === 0,
      `${r.rows.length} empty entries`);
  }

  /* ------------------------------------------------- 13. OUTBOX CLAIM */
  await accepts(db, 'outbox rows are claimable with SKIP LOCKED',
    `insert into outbox(topic, payload) values ('payout.requested', '{"a":1}');
     select count(*) from claim_outbox_batch(10);`);

  /* ------------------------------------------- 14. REVERSAL, NOT MUTATION */
  await accepts(db, 'a reversal entry is the sanctioned way to correct',
    `insert into ledger_entries(id, idempotency_key, kind, currency, reference)
     values ('a8888888-8888-4888-8888-888888888888','idem-reversal-1','reversal','NGN','a1111111-1111-4111-8111-111111111111');
     insert into postings(entry_id, account_id, direction, amount_minor, currency)
     select 'a8888888-8888-4888-8888-888888888888', id, 'C', 50000, 'NGN' from accounts where code = 'PLATFORM_CASH_NGN';
     insert into postings(entry_id, account_id, direction, amount_minor, currency)
     select 'a8888888-8888-4888-8888-888888888888', id, 'D', 50000, 'NGN' from accounts where code = 'PROMOTER_PAYABLE_NGN';`);
});

for (const l of results.filter(r => r.startsWith('  UNVERIFIED'))) console.log(l);
console.log(`\n  PASS ${pass}   FAIL ${fail}   UNVERIFIED ${unverifiedCount}`);
console.log(`  LEDGER INVARIANTS: ${fail === 0 ? 'ALL HOLD' : 'BREACHED'}`);
if (unverifiedCount > 0) {
  console.log('  NOTE: UNVERIFIED items are not passes. Each names its proof venue (Supabase staging).');
}
process.exit(fail === 0 ? 0 : 1);