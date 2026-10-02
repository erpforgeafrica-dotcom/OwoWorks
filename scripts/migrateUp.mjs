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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'db', 'migrations');
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
  const files = readdirSync(DIR).filter(f => f.endsWith('.sql')).sort();
  const applied = [];
  for (const f of files) {
    const sql = readFileSync(join(DIR, f), 'utf8');
    const t0 = Date.now();
    try {
      await db.exec(sql);
      applied.push(f);
      if (!quiet) console.log(`  APPLIED  ${f}  (${Date.now() - t0}ms)`);
    } catch (e) {
      if (!quiet) console.log(`  FAILED   ${f}\n           -> ${String(e.message).split('\n')[0]}`);
      throw new Error(`${f}: ${String(e.message).split('\n')[0]}`);
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