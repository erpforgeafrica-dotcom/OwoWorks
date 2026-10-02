import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(HERE, 'app.js'), 'utf8');

// Extract the functions under test from the browser file (no DOM needed).
const grab = (name) => {
  const i = src.indexOf(`function ${name}`);
  if (i === -1) throw new Error('missing ' + name);
  let depth = 0, started = false;
  for (let j = src.indexOf('{', i); j < src.length; j++) {
    if (src[j] === '{') { depth++; started = true; }
    else if (src[j] === '}') { depth--; if (started && depth === 0) return src.slice(i, j + 1); }
  }
  throw new Error('unbalanced ' + name);
};
// Include the MSISDN_PREFIXES constant, which lives between the two functions.
const constStart = src.indexOf('const MSISDN_PREFIXES');
const constEnd = src.indexOf(';', constStart) + 1;
if (constStart === -1) throw new Error('missing MSISDN_PREFIXES');
const constDecl = src.slice(constStart, constEnd);

const code = [constDecl, grab('validMsisdn'), grab('normalisePhone')].join('\n');
const normalisePhone = new Function(code + '\nreturn normalisePhone;')();

let pass = 0, fail = 0;
const t = (input, expected, label) => {
  const got = normalisePhone(input);
  if (got === expected) { pass++; console.log(`  PASS  ${label}  ${JSON.stringify(input)} -> ${got}`); }
  else { fail++; console.log(`  FAIL  ${label}  ${JSON.stringify(input)} -> got ${got}, want ${expected}`); }
};

// Regression: the exact bug found in audit. 12-digit input previously passed.
t('234803000000', null, '12-digit +234 rejected (regression)');
t('+234803000000', null, '12-digit spaced +234 rejected (regression)');

t('08030000000', '08030000000', 'national MTN-style');
t('+2348030000000', '08030000000', 'international');
t('2348030000000', '08030000000', 'international no plus');
t('+234 803 000 0000', '08030000000', 'international spaced');
t('0803 000 0000', '08030000000', 'national spaced');
t('07030000000', '07030000000', 'national 070');
t('08130000000', '08130000000', 'national 0813');
t('09030000000', '09030000000', 'national 0903');

t('0803000000', null, '10-digit national rejected');
t('080300000000', null, '12-digit national rejected');
t('23480300000000', null, '14-digit rejected');
t('abcdefghijk', null, 'letters rejected');
t('', null, 'empty rejected');
t('00000000000', null, 'all-zero rejected');
t('+2340803000000', null, '234 + national form rejected');

console.log(`\n  PASS ${pass}   FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
