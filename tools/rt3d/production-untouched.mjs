// Proof that the production engine is untouched.
//
// 1. The recorded oracle must still reproduce exactly (old engine AND kernel).
// 2. The production RF section of index.html must be byte-identical to the
//    approved baseline commit, so runRayTrace() cannot have changed.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const BASELINE = '78876a2';

let fail = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log('  ok   ' + name);
  else { fail++; console.log('  FAIL ' + name + (detail ? ' :: ' + detail : '')); }
};

// ---- 1. the production RF block, from the RT banner up to the new kernel ----
const MARKER = '//  ADVANCED RAY TRACING  (ray-launching: transmission + reflection)';
// the kernel banner, INCLUDING its opening rule line, so the split point is
// exactly where the kernel section starts
const KERNEL = '// ============================================================\n' +
               '//  TRUE 3D RAY-TRACING KERNEL  (Stage 1: parallel engine)';

const cur = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const base = execFileSync('git', ['show', `${BASELINE}:index.html`], { cwd: ROOT, maxBuffer: 1 << 28 }).toString();

// The production RF block runs from the RT banner to whatever immediately
// follows runRayTrace(): the new kernel on the branch, smoothRSSI on the
// baseline. Anything else in the file is out of scope for this comparison.
const prodBlock = (src) => {
  const a = src.indexOf(MARKER);
  if (a < 0) throw new Error('RT banner not found');
  const k = src.indexOf(KERNEL, a);
  const s = src.indexOf('function smoothRSSI', a);
  const end = k > a ? k : s;
  if (end < 0) throw new Error('end of RT block not found');
  return src.slice(a, end);
};
const kernelSrc = (src) => {
  const k = src.indexOf(KERNEL);
  const s = src.indexOf('function smoothRSSI', k);
  return src.slice(k, s);
};
const curBlock = prodBlock(cur);
const baseBlock = prodBlock(base);
const curKernel = kernelSrc(cur);

console.log('Production engine isolation\n');
ok('production RT block is byte-identical to baseline ' + BASELINE,
   curBlock === baseBlock,
   curBlock === baseBlock ? '' : `baseline ${baseBlock.length} bytes vs current ${curBlock.length} bytes`);

ok('production block is non-empty and contains runRayTrace',
   curBlock.length > 5000 && curBlock.includes('function runRayTrace(onDone)'));
ok('production block contains no rt3d code',
   !curBlock.includes('rt3d'));
ok('the new kernel exists and is a separate section',
   cur.includes(KERNEL));

// ---- 2. the kernel is inert: nothing outside it calls it ----
const outside = cur.slice(0, cur.indexOf(KERNEL)) + cur.slice(cur.indexOf('function smoothRSSI', cur.indexOf(KERNEL)));
const callers = [...outside.matchAll(/\brt3d[A-Za-z0-9_]*\s*\(/g)].map((m) => m[0]);
ok('no production code calls any rt3d* function', callers.length === 0,
   callers.slice(0, 5).join(', '));

// ---- 3. the kernel defines no DOM/UI hooks and no global side effects ----
// Comments are stripped first (block comments, whole-line comments and
// trailing comments): the kernel legitimately DISCUSSES rayZAt and parameter
// "windows" in prose, and those mentions are not code. The kernel contains no
// '//' inside a string literal, so this cannot damage a value.
const code = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/[^\n]*$/gm, ' ')
  .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
const curKernelCode = code(curKernel);
ok('kernel touches no DOM API',
   !/\b(document|window|localStorage|querySelector|addEventListener)\b/.test(curKernelCode),
   (curKernelCode.match(/\b(document|window|localStorage|querySelector|addEventListener)\b/g) || []).slice(0, 5).join(', '));
ok('kernel calls no UI/trace entry point',
   !/(runRayTrace|paintHeat|draw2d|showToast|coverageUpdate|scheduleHeat)\s*\(/.test(curKernelCode));
ok('kernel never writes to the canonical project state',
   !/\bstate\.[A-Za-z0-9_.]*\s*=[^=]/.test(curKernelCode));
ok('kernel has no constant-Z ray assumption (no rayZAt call)',
   !/rayZAt\s*\(/.test(curKernelCode));
ok('kernel never mutates the world it derives from',
   !/rt3dBuildWorld[\s\S]{0,400}?\.(x1|x2|y1|y2|height|width|depth|rotation)\s*=[^=]/.test(curKernelCode));

// ---- 4. the oracle still reproduces ----
try {
  const out = execFileSync('node', [path.join(HERE, 'oracle.mjs'), 'check'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28, timeout: 900000 });
  ok('oracle reproduces exactly for all fixtures', out.includes('oracle stable'), out.trim().split('\n').pop());
  const m = out.match(/rays=(\d+)\/(\d+) branch=(\d+)\/(\d+)/g) || [];
  const mism = [...out.matchAll(/(\w[\w-]*)\s+old\.fp=(\w+) new\.fp=(\w+)/g)]
    .filter((x) => x[2] !== x[3]);
  ok('every fixture: old and new grid fingerprints identical', mism.length === 0,
     mism.map((x) => x[1]).join(', '));
  ok('fixture count is 9', (out.match(/old\.fp=/g) || []).length === 9);
} catch (e) {
  ok('oracle reproduces exactly for all fixtures', false, String(e.stdout || e).slice(-400));
}

console.log(fail === 0 ? '\nproduction engine verified untouched' : `\n${fail} check(s) failed`);
process.exit(fail === 0 ? 0 : 1);
