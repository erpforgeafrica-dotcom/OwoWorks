/**
 * migrations.mjs — one source of truth for migration ordering.
 *
 * The SAME ordering function feeds both engines, so "green locally" and
 * "green on Supabase" can never disagree about what runs:
 *   - local  (PGlite): local/ stubs first, then real migrations
 *   - remote (Supabase): real migrations only (Supabase already owns auth + roles)
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const MIGRATIONS_DIR = join(ROOT, 'db', 'migrations');
export const LOCAL_DIR = join(MIGRATIONS_DIR, 'local');

/** Files that must never reach a hosted project. */
const LOCAL_ONLY_SKIP = [/auth_stub/i, /local_only/i];

export function isProductionSafe(name) {
  return !LOCAL_ONLY_SKIP.some(re => re.test(name));
}

export function orderedMigrations({ includeLocal = false } = {}) {
  const real = readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql') && isProductionSafe(f))
    .sort();

  if (!includeLocal) return real.map(f => ({ file: f, sql: read(join(MIGRATIONS_DIR, f)) }));

  const local = readdirSync(LOCAL_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort()
    .map(f => ({ file: `local/${f}`, sql: read(join(LOCAL_DIR, f)) }));

  return [...local, ...real.map(f => ({ file: f, sql: read(join(MIGRATIONS_DIR, f)) }))];
}

function read(p) { return readFileSync(p, 'utf8'); }

export function checksum(sql) {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n').trim()).digest('hex').slice(0, 16);
}