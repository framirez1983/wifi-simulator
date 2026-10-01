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

// ---- 4. Stage 2 specifics: still a parallel engine, still no heatmap ----
// The Stage-2 path tracer exists beside the production engine. It must not
// publish a result anywhere, and it must not be reachable from the UI.
ok('Stage-2 tracer writes no heatmap / no production display state',
   !/\b(heatGridRssi|heatGridDisp|heatMeta|heatMode|heatRtReach|showHeat|lastRayTraceStats)\b/.test(curKernelCode),
   (curKernelCode.match(/\b(heatGridRssi|heatGridDisp|heatMeta|heatMode|heatRtReach|showHeat|lastRayTraceStats)\b/g) || []).join(', '));
ok('Stage-2 tracer calls no production tracer',
   !/\brunRayTrace\b|\bmarchRay\b/.test(curKernelCode));
ok('Stage-2 tracer has no UI affordance (no element id, class or event wiring)',
   !/\b(getElementById|querySelector|onclick|addEventListener|tbtn|btn[A-Z])\b/.test(curKernelCode));
ok('Stage-2 tracer produces no volumetric fan (no azimuth x elevation emitter)',
   !/\b(fanElevation|elevationSteps|azimuthSteps|emissionFan|voxel)\b/.test(curKernelCode));
ok('Stage-2 reflects from vertical walls only (no slab/Ceiling reflection)',
   // a reflection may only be raised for a wall body
   !/best\.kind\s*!==\s*'wall'|kind==='slab'[^;]{0,80}reflect|kind==='ceiling'[^;]{0,80}reflect/.test(curKernelCode) &&
   /isWall\s*=\s*best\.kind==='wall'/.test(curKernelCode));
ok('Stage-2 keeps the compatibility launch isolated to rt3dReceiverPlaneZ',
   (curKernel.match(/rt3dReceiverPlaneZ\(\)/g) || []).length >= 1 &&
   !/rt3dTracePath[\s\S]{0,200}?rt3dReceiverPlaneZ/.test(curKernelCode));

// ---- 5. Stage 3 specifics: acceleration only -------------------------
ok('the linear oracle broadphase is retained (not replaced by the BVH)',
   /function\s+rt3dQueryLinear\s*\(/.test(curKernel) &&
   /function\s+rt3dNearestLinear\s*\(/.test(curKernel) &&
   /function\s+rt3dQuery\(list, aabb, out/.test(curKernel));
ok('rt3dQuery remains the narrow selectable seam',
   /rt3dQuery\(list, aabb, out, opts\)/.test(curKernel) &&
   /opts && opts\.bvh\) return rt3dQueryBvhAabb/.test(curKernel));
ok('the BVH is built with a deterministic median split and a fixed leaf size',
   /RT3D_BVH_LEAF_SIZE = \d+/.test(curKernel) &&   // a literal, not a tuned value
   /const mid=count>>1/.test(curKernel) &&          // median split
   /if\(ey>ex\) axis=1/.test(curKernel) &&          // longest axis, fixed tie order
   /a\.ord-b\.ord/.test(curKernel));                // equal centroids -> ordinal
// Scoped to the Stage-3 section: Date.now() legitimately appears in the
// Stage-1 performance microbenchmark as a timer fallback, which is not a
// determinism concern. The BVH itself must have neither.
const bvhSrc = curKernel.slice(curKernel.indexOf('DETERMINISTIC AABB BVH'));
ok('the BVH introduces no randomness or hash-order dependence',
   !/\bMath\.random\b/.test(bvhSrc) &&
   !/\bDate\.now\b/.test(bvhSrc) &&
   !/\bperformance\.now\b/.test(bvhSrc));
ok('the BVH never decides physics: it only proposes bodies to rt3dBodyEvent',
   /rt3dBodyEvent\(ray, body, horizon\)/.test(curKernel) &&
   !/rt3dFootprintHoldsAt[\s\S]{0,40}rt3dNearestBvh/.test(curKernelCode));
ok('the BVH reuses the existing rt3dRayAabbWindow for node rejection',
   /rt3dRayAabbWindow\(ray, n\.aabb\)/.test(curKernel) &&
   !/function\s+rt3dBvhSlabClip|function\s+rt3dBvhRayBox/.test(curKernel));
ok('the derived world/BVH is never persisted as project state',
   !/state\.[A-Za-z0-9_.]*(bvh|accel|accelerat)/i.test(curKernelCode) &&
   !/localStorage[^\n]*bvh/i.test(curKernel));
ok('the BVH is derived runtime state, cached on the derived world only',
   /if\(!world\._bvh\) world\._bvh=rt3dBuildBvh\(world\)/.test(curKernel));
ok('all five physical families go through the one tree',
   /RT3D_FAMILIES = \['wall','pillar','rfObject','slab','ceiling'\]/.test(curKernel) &&
   /function\s+rt3dAllBodies\s*\(world\)/.test(curKernel));
ok('every tie resolves through the canonical family/ordinal order',
   /function\s+rt3dBodyLess\s*\(a, b\)/.test(curKernel) &&
   /function\s+rt3dEventBetter\s*\(e, best\)/.test(curKernel));

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
