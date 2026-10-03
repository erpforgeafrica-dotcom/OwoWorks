#!/usr/bin/env node
/**
 * dbProbe — connect to the real Supabase project and report what is there.
 *
 * READ-ONLY. It never creates, alters or drops anything. Its job is to tell us
 * the truth about the live database before we write a single migration:
 *   - server version, region, current role
 *   - every schema, table, column, index, function, policy
 *   - anything that already exists in the public schema (so we never collide)
 *
 * Usage: node scripts/dbProbe.mjs
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { ROOT } from './migrations.mjs';

const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter(l => l && !l.startsWith('#'))
    .map(l => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')];
    })
);

const client = new pg.Client({
  connectionString: env.DIRECT_URL,   // session mode: real TCP, needed for DDL
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
  max: 1
});

const q = async (label, sql, params) => {
  const t0 = Date.now();
  const r = await client.query(sql, params);
  console.log(`\n== ${label}  (${Date.now() - t0}ms, ${r.rowCount} rows)`);
  return r.rows;
};

await client.connect();
console.log('Connected to the live database.');

const [ver] = await q('server', `
  select current_database()  as database,
         current_user        as db_user,
         current_setting('server_version') as version,
         inet_server_addr()::text         as server_ip,
         (select count(*) from pg_stat_activity) as connections_open`);
console.log('  ', JSON.stringify(ver, null, 2).replace(/\n/g, '\n   '));

const schemas = await q('schemas', `
  select schema_name, schema_owner
  from information_schema.schemata
  where schema_name not in ('pg_catalog','information_schema','pg_toast')
    and schema_name not like 'pg_temp%' and schema_name not like 'pg_%'
  order by schema_name`);
for (const s of schemas) console.log(`   ${s.schema_name}  (owner ${s.schema_owner})`);

const tables = await q('tables + row estimates', `
  select table_schema, table_name,
         (select count(*) from information_schema.columns c
           where c.table_schema = t.table_schema and c.table_name = t.table_name) as columns,
         (select reltuples::bigint from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = t.table_schema and c.relname = t.table_name) as approx_rows,
         coalesce((select bool_or(relrowsecurity)
                     from pg_class c
                     join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = t.table_schema and c.relname = t.table_name), false) as rls_on
  from information_schema.tables t
  where table_type = 'BASE TABLE'
    and table_schema not in ('pg_catalog','information_schema')
  order by table_schema, table_name`);
for (const t of tables) {
  console.log(`   ${String(t.table_schema + '.' + t.table_name).padEnd(42)} cols=${String(t.columns).padStart(3)}  rows~${String(t.approx_rows).padStart(8)}  rls=${t.rls_on}`);
}

const fns = await q('functions (public + auth)', `
  select n.nspname as schema, p.proname as name,
         pg_get_function_identity_arguments(p.oid) as args,
         p.prosecdef as security_definer,
         has_function_privilege('anon', p.oid, 'EXECUTE') as anon_may_execute
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public','auth')
  order by n.nspname, p.proname`);
for (const f of fns) {
  console.log(`   ${(f.schema + '.' + f.name + '(' + f.args + ')').padEnd(52)} definer=${f.security_definer} anon_exec=${f.anon_may_execute}`);
}

const pols = await q('row level security policies', `
  select schemaname, tablename, policyname, cmd, roles::text, qual, with_check
  from pg_policies
  where schemaname not in ('pg_catalog','information_schema')
  order by schemaname, tablename, policyname`);
for (const p of pols) console.log(`   ${p.schemaname}.${p.tablename}  ${p.policyname}  [${p.cmd}] roles={${p.roles}}`);

if (pols.length === 0) console.log('   (none)');

const hooks = await q('our triggers / functions', `
  select c.relname as table_name, t.tgname as trigger_name
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and not t.tgisinternal
  order by c.relname, t.tgname`);
for (const h of hooks) console.log(`   ${h.table_name}  ->  ${h.trigger_name}`);

const idx = await q('indexes', `
  select schemaname, tablename, indexname
  from pg_indexes
  where schemaname not in ('pg_catalog','information_schema')
  order by schemaname, tablename, indexname`);
for (const i of idx) console.log(`   ${i.schemaname}.${i.tablename}  ${i.indexname}`);

const grants = await q('PUBLIC API EXPOSURE (anon / authenticated on public tables)', `
  select c.relname as table_name,
         has_table_privilege('anon', c.oid, 'SELECT')         as anon_select,
         has_table_privilege('anon', c.oid, 'INSERT')         as anon_insert,
         has_table_privilege('anon', c.oid, 'UPDATE')         as anon_update,
         has_table_privilege('anon', c.oid, 'DELETE')         as anon_delete,
         has_table_privilege('authenticated', c.oid, 'SELECT') as auth_select,
         has_table_privilege('authenticated', c.oid, 'INSERT') as auth_insert,
         has_table_privilege('authenticated', c.oid, 'UPDATE') as auth_update,
         has_table_privilege('authenticated', c.oid, 'DELETE') as auth_delete
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
  order by c.relname`);

const flags = (s, i, u, d) => `${s ? 's' : '-'}${i ? 'i' : '-'}${u ? 'u' : '-'}${d ? 'd' : '-'}`;
let exposed = 0;
for (const g of grants) {
  const anonTouches = g.anon_select || g.anon_insert || g.anon_update || g.anon_delete;
  const authTouches = g.auth_select || g.auth_insert || g.auth_update || g.auth_delete;
  if (anonTouches || authTouches) exposed++;
  const mark = anonTouches || authTouches ? '  <-- reachable via the public API' : '';
  console.log(`   ${String(g.table_name).padEnd(34)} anon[${flags(g.anon_select, g.anon_insert, g.anon_update, g.anon_delete)}]  auth[${flags(g.auth_select, g.auth_insert, g.auth_update, g.auth_delete)}]${mark}`);
}
console.log('   legend: s=select i=insert u=update d=delete   (anon = signed-out visitor)');
console.log(`   -> ${exposed} of ${grants.length} public table(s) are reachable by a visitor.`);

await client.end();
console.log('\nProbe complete. Nothing was created, altered or dropped.');