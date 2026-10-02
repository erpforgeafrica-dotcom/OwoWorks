#!/usr/bin/env node
/**
 * exportIdentity — render every PNG in DESIGN_BRIEF.json from its SVG source.
 * Refuses to write an export whose dimensions do not match the brief, and
 * prints the measured dimensions of every file it writes. No silent renders.
 */
import sharp from 'sharp';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ID = join(HERE, '..', 'apps', 'web', 'assets', 'identity');
const brief = JSON.parse(readFileSync(join(ID, 'DESIGN_BRIEF.json'), 'utf8'));

let fail = 0;
for (const [out, spec] of Object.entries(brief.exports)) {
  const src = join(ID, spec.source);
  const dst = join(ID, out);
  if (!existsSync(src)) { console.log(`  FAIL  missing source ${spec.source}`); fail++; continue; }
  await sharp(src).resize(spec.width, spec.height, { fit: 'fill' }).png().toFile(dst);
  const meta = await sharp(dst).metadata();
  const ok = meta.width === spec.width && meta.height === spec.height;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${out}  measured ${meta.width}x${meta.height} (brief ${spec.width}x${spec.height})`);
  if (!ok) fail++;
}
console.log(`\n  IDENTITY EXPORT: ${fail === 0 ? 'PASS' : 'FAIL'}`);
process.exit(fail === 0 ? 0 : 1);
