#!/usr/bin/env node
/**
 * migrateUp — run every migration against a real PostgreSQL engine.
 *
 * Uses PGlite (PostgreSQL compiled to WebAssembly). This is NOT a mock: it is
 * the actual PostgreSQL planner, executor and trigger system, so a migration
 * that runs here runs on Supabase. Execution, DDL semantics and trigger
 * behaviour are genuinely verified - unlike a parse-only check.
 *
 * Database lives in .cache/pglite (gitignored) and is rebuilt from scratch
 * every run, so there is no stale state.
 */
import { readdirSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { orderedMigrations, MIGRATIONS_DIR } from './migrations.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = MIGRATIONS_DIR;
const DATA = join(ROOT, '.cache', 'pglite');

export async function withDb(fn) {
  rmSync(DATA, { recursive: true, force: true });
  mkdirSync(DATA, { recursive: true });
  const db = new PGlite(DATA);
  await db.waitReady;
  try {
    return await fn(db);
  } finally {
    await db.close();
  }
}

export async function migrate(db, { quiet = false } = {}) {
  // The hosted runner keeps a ledger of applied files. Recreate the same table
  // here so migrations that harden it (0006_secure_migration_ledger.sql) run
  // against a real object locally instead of being skipped as "table missing".
  await db.exec(`
    create table if not exists public.owoworks_schema_migrations (
      filename   text primary key,
      checksum   text        not null,
      applied_at timestamptz not null default now(),
      duration_ms integer    not null
    );`);

  // includeLocal: the auth stub is applied ONLY here, never on a hosted project.
  const steps = orderedMigrations({ includeLocal: true });
  const applied = [];
  for (const { file, sql } of steps) {
    const t0 = Date.now();
    try {
      await db.exec(sql);
      applied.push(file);
      if (!quiet) console.log(`  APPLIED  ${file}  (${Date.now() - t0}ms)`);
    } catch (e) {
      if (!quiet) console.log(`  FAILED   ${file}\n           -> ${String(e.message).split('\n')[0]}`);
      throw new Error(`${file}: ${String(e.message).split('\n')[0]}`);
    }
  }
  return applied;
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  await withDb(async db => {
    console.log('migrateUp — running against a real PostgreSQL engine (PGlite/WASM)\n');
    const applied = await migrate(db);
    console.log(`\n  ${applied.length} migration(s) applied. Database at .cache/pglite`);
    process.exit(0);
  });
}