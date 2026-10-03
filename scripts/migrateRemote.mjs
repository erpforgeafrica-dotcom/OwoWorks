#!/usr/bin/env node
/**
 * migrateRemote — apply migrations to the REAL Supabase project.
 *
 * Safety properties, all enforced in code:
 *  1. Connects over the session pooler (port 5432) because DDL needs real TCP.
 *  2. Takes a PostgreSQL advisory lock BEFORE reading or writing the ledger, so
 *     two deploys can never race and apply the same file twice.
 *  3. Records every applied file in a ledger table with a content checksum.
 *  4. Refuses to re-apply a file whose contents changed since it ran
 *     (that is drift, and silently skipping it would hide the problem).
 *  5. Each migration runs inside its own transaction: a failure rolls back
 *     cleanly instead of leaving half a schema behind.
 *  6. Local-only files (auth stubs) are physically excluded upstream.
 *  7. --status is genuinely read-only: it creates nothing, not even the ledger.
 *
 * Usage:
 *   node scripts/migrateRemote.mjs            # apply pending, then report
 *   node scripts/migrateRemote.mjs --status   # report only, change nothing
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { orderedMigrations, checksum } from './migrations.mjs';

const ROOT = process.cwd();
const statusOnly = process.argv.includes('--status');

const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter(l => l && !l.startsWith('#'))
    .map(l => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')];
    })
);

const LOCK_KEY = 918273645; // arbitrary, fixed, project-specific
const LEDGER_TABLE = 'public.owoworks_schema_migrations';
const LEDGER = `
  create table if not exists ${LEDGER_TABLE} (
    filename   text primary key,
    checksum   text        not null,
    applied_at timestamptz not null default now(),
    duration_ms integer    not null
  );`;

const client = new pg.Client({
  connectionString: env.DIRECT_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
  max: 1
});

await client.connect();
console.log(`Connected to ${env.SUPABASE_URL}`);

const steps = orderedMigrations({ includeLocal: false });

/** Read the ledger without creating it. Returns [] when it does not exist yet. */
async function readLedger() {
  const { rows: present } = await client.query(
    `select to_regclass($1) is not null as there`, [LEDGER_TABLE]);
  if (!present[0].there) return [];
  const { rows } = await client.query(
    `select filename, checksum, applied_at, duration_ms from ${LEDGER_TABLE} order by filename`);
  return rows;
}

/** Print the plan. Returns the list of files whose body changed since they ran. */
function printPlan(done) {
  const doneMap = new Map(done.map(r => [r.filename, r]));
  console.log(`\nPending plan (${steps.length} production migration(s)):\n`);
  const drift = [];
  for (const { file, sql } of steps) {
    const prior = doneMap.get(file);
    if (!prior) {
      console.log(`  PENDING   ${file}`);
    } else if (prior.checksum !== checksum(sql)) {
      console.log(`  CHANGED   ${file}  (applied ${prior.applied_at.toISOString().slice(0, 19)}Z with a different body)`);
      drift.push(file);
    } else {
      console.log(`  APPLIED   ${file}  (${prior.duration_ms}ms on ${prior.applied_at.toISOString().slice(0, 19)}Z)`);
    }
  }
  return drift;
}

if (statusOnly) {
  const drift = printPlan(await readLedger());
  if (drift.length) {
    console.error(`\nSTOP. These files changed after they were applied: ${drift.join(', ')}`);
    console.error('Write a NEW migration instead of editing an applied one.');
    await client.end();
    process.exit(1);
  }
  console.log('\n--status only. Nothing was changed.');
  await client.end();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Apply mode. The lock is taken FIRST so the ledger read below cannot race
// with another deploy, and the ledger is only created here — never in --status.
// ---------------------------------------------------------------------------
await client.query(`select pg_advisory_lock(${LOCK_KEY})`);
try {
  await client.query(LEDGER);

  const doneMap = new Map((await readLedger()).map(r => [r.filename, r]));
  console.log(`\nPending plan (${steps.length} production migration(s)):\n`);
  const drift = [];
  const pending = [];
  for (const step of steps) {
    const prior = doneMap.get(step.file);
    if (!prior) {
      console.log(`  PENDING   ${step.file}`);
      pending.push(step);
    } else if (prior.checksum !== checksum(step.sql)) {
      console.log(`  CHANGED   ${step.file}`);
      drift.push(step.file);
    } else {
      console.log(`  APPLIED   ${step.file}  (${prior.duration_ms}ms on ${prior.applied_at.toISOString().slice(0, 19)}Z)`);
    }
  }

  if (drift.length) {
    console.error(`\nSTOP. These files changed after they were applied: ${drift.join(', ')}`);
    console.error('Write a NEW migration instead of editing an applied one.');
    process.exitCode = 1;
  } else if (pending.length === 0) {
    console.log('\nNothing to apply. Database is already current.');
  } else {
    console.log('\nAdvisory lock held. Applying...\n');
    for (const { file, sql } of pending) {
      const t0 = Date.now();
      try {
        await client.query('begin');
        await client.query(sql);
        const ms = Date.now() - t0;
        await client.query(
          `insert into ${LEDGER_TABLE}(filename, checksum, duration_ms) values ($1,$2,$3)`,
          [file, checksum(sql), ms]
        );
        await client.query('commit');
        console.log(`  OK  ${file}  ${ms}ms`);
      } catch (e) {
        await client.query('rollback').catch(() => {});
        console.error(`  FAIL  ${file}\n        ${String(e.message).split('\n')[0]}`);
        process.exitCode = 1;
        break;
      }
    }
    const { rows: final } = await client.query(`select count(*)::int as n from ${LEDGER_TABLE}`);
    console.log(`\nLedger now records ${final[0].n} migration(s).`);
  }
} finally {
  await client.query(`select pg_advisory_unlock(${LOCK_KEY})`).catch(() => {});
  await client.end();
}
process.exit(process.exitCode || 0);