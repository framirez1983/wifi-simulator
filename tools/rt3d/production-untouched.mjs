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
// Stage 5 is a deliberate browser/UI layer, not kernel. It has its own
// contract and its own checks below; folding it into the inert-kernel slice
// would test it against rules it was never meant to satisfy.
const EXP = '//  RT3D EXPERIMENTAL BROWSER LAYER  (Stage 5)';
const kernelSrc = (src) => {
  const k = src.indexOf(KERNEL);
  const s = src.indexOf('function smoothRSSI', k);
  const e = src.indexOf(EXP, k);
  return src.slice(k, e > 0 ? e : s);
};
// The Stage-5 experimental section: from its banner up to whatever comes next
// (the Stage-6 core on this branch, smoothRSSI otherwise). Stage 5 is scoped on
// its own, because Stage 6 is a separate contract with its own checks below and
// Stage 6 legitimately reconciles the antenna model Stage 5 refused to touch.
const S6CORE = '//  UNIFIED RT3D COVERAGE FIELD CORE  (Stage 6)';
const S6UI = 'STAGE 6 BROWSER INTEGRATION';
const expSrc = (src) => {
  const a = src.indexOf(EXP);
  if (a < 0) return '';
  const s6 = src.indexOf(S6CORE, a);
  return src.slice(a, s6 > 0 ? s6 : src.indexOf('function smoothRSSI', a));
};
// The Stage-6 coverage core: physics only, up to the browser integration.
const s6CoreSrc = (src) => {
  const a = src.indexOf(S6CORE);
  if (a < 0) return '';
  const u = src.indexOf(S6UI, a);
  return src.slice(a, u > 0 ? u : src.indexOf('function smoothRSSI', a));
};
// The Stage-6.5 audit section: its own scope, so the audit instrument is never
// mistaken for part of the Stage-6 engine it exists to interrogate.
const S65AUDIT = '//  STAGE 6.5 — LEGACY vs RT3D RF TRUTH AUDIT';
const S65UI = '//  STAGE 6.5 — BROWSER PROBE SURFACE';
const s65End = (src) => src.indexOf('function smoothRSSI', src.indexOf(S65AUDIT));
// The audit CORE: physics-free instrument. It must not touch the UI at all.
const s65Src = (src) => {
  const a = src.indexOf(S65AUDIT);
  if (a < 0) return '';
  const e = src.indexOf(S65UI, a);
  return src.slice(a, e > 0 ? e : s65End(src));
};
// The audit UI: development-only panel and click handling. It is allowed to ask
// for a repaint, because a probe marker that never appears is useless, but it is
// held to every rule that could touch physics or the canonical field.
const s65UiCodeSrc = (src) => {
  const a = src.indexOf(S65UI);
  if (a < 0) return '';
  return src.slice(a, s65End(src));
};
// The Stage-6 browser integration layer, ending where the audit section begins.
const s6UiSrc = (src) => {
  const a = src.indexOf(S6UI);
  if (a < 0) return '';
  const e = src.indexOf(S65AUDIT, a);
  return src.slice(a, e > 0 ? e : src.indexOf('function smoothRSSI', a));
};
const curBlock = prodBlock(cur);
const baseBlock = prodBlock(base);
const curKernel = kernelSrc(cur);
const curExp = expSrc(cur);
const curS6Core = s6CoreSrc(cur);
// the app <script> block, for cross-section checks
const SRC = cur.match(/<script>\n([\s\S]*?)\n<\/script>/)[1];
const curS6Ui = s6UiSrc(cur);
const curS65 = s65Src(cur);
const curS65Ui = s65UiCodeSrc(cur);

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
// Everything outside both the kernel and the Stage-5 section, with comments
// and CSS removed first. This file legitimately NAMES the experimental layer in
// prose, and prose is not a call site.
const outside = cur.slice(0, cur.indexOf(KERNEL))
             + cur.slice(cur.indexOf('function smoothRSSI', cur.indexOf(KERNEL)));
const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/[^\n]*$/gm, ' ')
  .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1')
  .replace(/<style>[\s\S]*?<\/style>/g, ' ');
const outsideCode = stripComments(outside);
const callers = [...outsideCode.matchAll(/\brt3d[A-Za-z0-9_]*\s*\(/g)].map((m) => m[0]);
const uniqCallers = [...new Set(callers)];

// Exactly two hooks may exist in production, both from Stage 5, both inert
// without the flag:
//   draw2d()  -> rt3dExpActive()          the gated underlay predicate
//   start()   -> rt3dExpInit()            builds the panel, if flagged
ok('production touches RT3D only through the two gated Stage-5 hooks',
   uniqCallers.length === 2 &&
   callers.filter((c) => c.startsWith('rt3dExpActive')).length === 1 &&
   callers.filter((c) => c.startsWith('rt3dExpInit')).length === 1,
   JSON.stringify(uniqCallers));
ok('no production code calls any rt3d KERNEL function',
   !callers.some((c) => !c.startsWith('rt3dExp')),
   callers.filter((c) => !c.startsWith('rt3dExp')).slice(0, 5).join(', '));
ok('the draw2d hook is a boolean guard, not an unconditional draw',
   /if\(rt3dExpActive\(\)\s*&&\s*rt3dExpCanvas/.test(outsideCode));
ok('the experimental entry point is inert without the flag',
   /function\s+rt3dExpInit\(\)\s*\{\s*if\(!RT3D_EXP_ENABLED\)\s*return;/.test(curExp));
ok('rt3dExpActive() cannot be true without the flag',
   /function\s+rt3dExpActive\(\)\s*\{\s*return rt3dExpDisplayedEngine\(\)==='rt3d';/.test(curExp) &&
   /function\s+rt3dExpDisplayedEngine\(\)\s*\{\s*if\(!RT3D_EXP_ENABLED\)\s*return 'n\/a';/.test(curExp));

// ---- 3. the kernel defines no DOM/UI hooks and no global side effects ----
// Comments are stripped first (block comments, whole-line comments and
// trailing comments): the kernel legitimately DISCUSSES rayZAt and parameter
// "windows" in prose, and those mentions are not code. The kernel contains no
// '//' inside a string literal, so this cannot damage a value.
const code = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/[^\n]*$/gm, ' ')
  .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
// For CALL-SITE scans only, drop string literals. A call-site check must be able to
// tell a call from a mention: the Stage-6.5 snapshot store records
// `source:'runRayTrace() completion'`, and the check that the audit "never runs a
// propagation engine" failed on that label. This is deliberately NOT folded into
// code(), because the kernel checks above legitimately inspect string content.
const calls = (s) => code(s)
  .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
  .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
  .replace(/`(?:[^`\\]|\\.)*`/g, '``');
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
const bvhSrc = curKernel.slice(curKernel.indexOf('DETERMINISTIC AABB BVH'),
                              curKernel.indexOf('3D EMISSION FAN'));
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

// A duplicate function name anywhere in the kernel silently shadows an earlier
// one. That is exactly how a Stage-4 helper briefly broke the Stage-2
// compatibility plane, so the whole kernel is scanned for redefinitions.
{
  const defs = [...curKernel.matchAll(/^function\s+([A-Za-z0-9_]+)\s*\(/gm)].map((m) => m[1]);
  const seen = new Map();
  const dupes = [];
  for (const n of defs) {
    if (seen.has(n)) dupes.push(`${n} (x${seen.get(n) + 1})`);
    else seen.set(n, 1);
  }
  ok('no function is defined twice in the kernel (no silent shadowing)',
     dupes.length === 0, dupes.join(', '));
}

// ---- 6. Stage 4 specifics: a sample cloud, explicitly not a heatmap ----
ok('every fan ray launches from the AP real origin, never the receiver plane',
   /rt3dApOrigin\(ap, apFloorIndex\)/.test(curKernel) &&
   !/rt3dTraceFan[\s\S]{0,600}?rt3dReceiverPlaneZ\(\)[^;]*\)\s*,\s*dirs/.test(curKernelCode));
ok('the receiver plane is explicit absolute Z, not derived from a grid or view',
   /function\s+rt3dReceiverPlaneZForFloor\(targetFloorIndex\)\s*\{\s*return floorElevation\(targetFloorIndex\)\s*\+\s*receiverHeight\(\)/.test(curKernel));
ok('the fan reuses the existing tracer - there is no second tracer',
   /rt3dTracePath\(world, ray, \{/.test(curKernel) &&
   (curKernel.match(/function\s+rt3dTracePath\s*\(/g) || []).length === 1);
ok('the fan does not rasterise: no splat, interpolation or smoothing',
   !/rt3dTraceFan[\s\S]{0,6000}?\b(splat|interpolat|rasteriz|smoothing)\b(?![^;]*absent)(?!.*not)/i.test(curKernelCode) ||
   !/\b(splat|interpolate|smoothSamples|rasterize)\s*\(/.test(curKernelCode));
ok('the fan does not write any heatmap or production display state',
   !/\b(heatGridRssi|heatGridDisp|heatMeta|heatMode|heatRtReach|showHeat|lastRayTraceStats|coverageUpdate)\b/.test(curKernelCode));
ok('the fan adds no slab/Ceiling reflection and no volumetric voxels',
   !/\b(voxel|volumeGrid|elevationSteps|azimuthSteps)\b/.test(curKernelCode) &&
   /isWall = best\.kind==='wall'/.test(curKernelCode));
ok('antenna gain stays azimuth-only: no vertical pattern is invented',
   /antennaAzGain\(ap, azDeg\)/.test(curKernel) &&
   !/function\s+rt3dElevationGain|\belBw\b|\belOff\b/.test(curKernelCode));
ok('the receiver-plane crossing refuses rather than guesses when dz is not constant',
   /if\(!dzConst\(trace\)\)/.test(curKernel) && /dzNotConstant/.test(curKernel));
ok('the fan generator is deterministic: no randomness',
   !/function\s+rt3dFanDirections[\s\S]{0,1500}?Math\.random/.test(curKernel));

// ---- 4. the oracle still reproduces ----
try {
  const out = execFileSync('node', [path.join(HERE, 'oracle.mjs'), 'check'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28, timeout: 900000 });
  // ---- 7. Stage 6: the unified coverage field core --------------------------
// The core is PHYSICS. It must not know about rendering, and it must not grow
// into a second engine or a second antenna model.
{
  const code6 = curS6Core
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/[^\n]*$/gm, ' ')
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
  ok('the Stage-6 coverage core exists and is its own section',
     curS6Core.length > 4000 && cur.includes(S6CORE));
  ok('the coverage core touches no canvas, colour, heatmap or active floor',
     !/\b(canvas|getContext|THREE|drawImage|createImageData|imageSmoothing)\b/.test(code6) &&
     !/\bheatGrid(Rssi|Disp|Meta)\b/.test(code6) &&
     !/\brssiColor|sinrColor\b/.test(code6) &&
     !/\bactiveFloor\b/.test(code6),
     (code6.match(/\b(canvas|getContext|THREE|heatGridRssi|rssiColor|activeFloor)\b/g) || [])
       .slice(0, 5).join(', '));
  ok('the coverage core contains no interpolation, splat or IDW',
     !/\b(splat|interpolat|idw|inverseDistance|blurCell|floodFill)\w*\s*\(/.test(code6));
  ok('the coverage core builds no volumetric structure (no voxel/grid3D)',
     !/\b(voxel|volumeGrid|grid3D|octree|quadtree)\b/i.test(code6),
     (code6.match(/\b(voxel|volumeGrid|grid3D|octree|quadtree)\b/gi) || []).join(', '));
  ok('the coverage core still uses the one shared tracer, not a second one',
     /rt3dTracePath\(/.test(code6) &&
     (SRC.match(/function\s+rt3dTracePath\s*\(/g) || []).length === 1);
  ok('the coverage core uses the BVH for intersection acceleration',
     /backend:\s*opts\.backend\s*\|\|\s*rt3dBroadphaseBackend/.test(code6));
  ok('the coverage core reconciles the antenna model deliberately: antennaGain(), not a new model',
     /antennaGain\(ap, p\.x, p\.y, apz, p\.z\)/.test(code6) &&
     !/function\s+rt3dElevationGain|\belBw\b|\belOff\b/.test(code6));
  ok('the coverage core still reflects from vertical walls only',
     /isWall\s*=\s*best\.kind==='wall'/.test(SRC) &&
     !/kind==='slab'[^;]{0,80}reflect|kind==='ceiling'[^;]{0,80}reflect/.test(code6));
  ok('the coverage core solves reflection analytically, never by sampling a fan',
     /rt3dReflectCandidate/.test(code6) &&
     !/rt3dFanDirections/.test(code6),
     'a fan inside the point query would make the answer density-dependent');
  ok('the coverage core aggregates by strongest path, never by summing dBm',
     /strongest physically valid path/.test(code6) &&
     !/interfMW|Math\.pow\(10,\s*\S*\/10/.test(code6));
  ok('the Stage-6 browser integration is a separate, later section',
     curS6Ui.length > 500 && curS6Ui.indexOf(S6UI) >= 0);
  ok('the Stage-6 integration adds no normal application control outside ?rt3d=1',
     /RT3D Coverage Field \(Stage 6\)/.test(SRC) &&
     /function\s+rt3dExpRunCoverage\(\)\s*\{\s*if\(!RT3D_EXP_ENABLED\)\s*return;/.test(curS6Ui));
  ok('the Stage-5 fan tooling is retained alongside the coverage field',
     /function\s+rt3dExpStart\s*\(/.test(cur) &&
     /id="rt3dExpSource"/.test(SRC));
}

// ---- 4. the Stage-6.5 audit section is an INSTRUMENT, not an engine ----
// Its whole purpose is to interrogate two engines. If it could alter either one,
// every number it reports would be worthless: it would be measuring itself.
if (curS65) {
  const s65Code = code(curS65);
  console.log('Stage 6.5 audit isolation\n');
  ok('the Stage-6.5 audit section exists and is scoped separately',
     curS65.length > 4000 && curS65.includes('rt3dAuditProbeAt'));
  ok('the audit never writes to canonical project state',
     !/\bstate\.[A-Za-z0-9_.]*\s*=(?!=)/.test(s65Code),
     (s65Code.match(/\bstate\.[A-Za-z0-9_.]*\s*=(?!=)[^;\n]*/g) || []).slice(0, 3).join(' | '));
  ok('the audit never writes a heatmap or trace result',
     !/\b(heatGridRssi|heatGridDisp|heatMeta|heatRtReach|heatMode|heatMetric|showHeat)\s*=(?!=)/.test(s65Code),
     (s65Code.match(/\b(heatGridRssi|heatGridDisp|heatMeta|heatRtReach|heatMode|showHeat)\s*=(?!=)[^;\n]*/g) || []).slice(0, 3).join(' | '));
  ok('the audit never triggers a production engine or a repaint',
     !/(runRayTrace|paintHeat|draw2d|showToast|coverageUpdate|scheduleHeat|refresh3dHeat|computeHeatSimple)\s*\(/.test(calls(s65Code)),
     (s65Code.match(/(runRayTrace|paintHeat|draw2d|showToast|coverageUpdate|scheduleHeat|refresh3dHeat|computeHeatSimple)\s*\(/g) || []).slice(0, 3).join(' | '));
  ok('the audit does not modify any RF parameter',
     !/\b(matById|apMount|antennaGain|antennaAzGain|rssiFromAP|slabLossBetweenPoints|ceilingLossBetweenPoints|wallLossOnFloor|pillarLossOnFloor|fsplAt1m|plExp)\s*\.[A-Za-z0-9_]*\s*=/.test(s65Code));
  // The audit reads the legacy result and reports it. It must never write one.
  ok('the audit declares legacy output is not truth, in code',
     /legacyIsTruth:\s*false/.test(curS65) &&
     /Legacy output is NOT truth/.test(curS65));
  // A counterfactual that leaked into the canonical field would be the single
  // worst failure mode this section could have.
  ok('no audit variant is ever assigned to the canonical coverage field',
     !/(heatGridRssi|heatGridDisp|best\[k\]|apBest\[k\])\s*=\s*[^;]*(azOnly|noReflections|losOnly)/.test(s65Code));

  // ---- the classification chain has exactly ONE authoritative material path ---
  // The conservative policy is: a material-crossing difference may only be asserted
  // as an EXPECTED LEGACY LIMITATION when the compared path is identifiable; with
  // several live AP paths Legacy discarded per-cell AP/path identity at deposition,
  // so the result must be PHYSICALLY UNRESOLVED with the attribution limit stated.
  //
  // That policy was previously NOT PRESENT at all while an older, pre-conservative
  // material branch sat alone in the if/else chain. When the conservative gate was
  // then added, a second copy of the gate is exactly how the chain ends up with two
  // competing material branches whose wording a cell receives depends on chain
  // position rather than on policy. So the invariant is asserted on the SOURCE of
  // the classifier itself, not merely on one behavioural fixture.
  //
  // The classifier sits after the audit-core and audit-UI banners, so the scope
  // slices above do not contain it; slice its own function body instead.
  const clsSrc = (() => {
    const i = cur.indexOf('function rt3dAuditClassifyDisagreement');
    if (i < 0) return '';
    const j = cur.indexOf('\nfunction ', i + 1);
    return cur.slice(i, j < 0 ? undefined : j);
  })();
  const materialBranches = (clsSrc.match(
    /top\.term===\s*'material crossings on the direct path'/g) || []).length;
  ok('the disagreement classifier exists and is reachable', clsSrc.length > 500,
     'classifier body not found');
  ok('exactly ONE authoritative material-crossing classification branch exists',
     materialBranches === 1, 'found ' + materialBranches);
  ok('every material-crossing verdict is gated on legacyWinnerIdentifiable',
     (() => {
       if (!clsSrc) return false;
       const i = clsSrc.indexOf("top.term==='material crossings on the direct path'");
       const j = clsSrc.indexOf("top.term==='first-order reflections'", i);
       const body = clsSrc.slice(i, j < 0 ? undefined : j);
       return /if\(legacyWinnerIdentifiable\)/.test(body) &&
              /classification='PHYSICALLY UNRESOLVED'/.test(body) &&
              /attributionLimit/.test(body);
     })());
  // Ordering is the substantive part: the identifiability gate must be evaluated
  // BEFORE any EXPECTED LEGACY LIMITATION is assigned inside the material branch.
  // A branch that assigns the attribution first and gates afterwards would satisfy
  // a mere substring scan while still asserting the cause unconditionally.
  ok('the identifiability gate is evaluated BEFORE the material verdict is assigned',
     (() => {
       if (!clsSrc) return false;
       const i = clsSrc.indexOf("top.term==='material crossings on the direct path'");
       const j = clsSrc.indexOf("top.term==='first-order reflections'", i);
       const body = clsSrc.slice(i, j < 0 ? undefined : j);
       const g = body.indexOf('if(legacyWinnerIdentifiable)');
       const a = body.indexOf("classification='EXPECTED LEGACY LIMITATION'");
       const u = body.indexOf("classification='PHYSICALLY UNRESOLVED'");
       return g >= 0 && a > g && u > g;
     })(), 'the gate does not dominate both verdicts in the material branch');
  ok('the attribution limit is surfaced on every classified probe',
     /legacyWinnerIdentifiable:/.test(clsSrc) && /attributionLimit:/.test(clsSrc));

  // The probe UI: same physics prohibitions, but a repaint request is legitimate.
  const s65UiCode = code(curS65Ui);
  ok('the Stage-6.5 probe UI exists and is scoped separately', curS65Ui.length > 500);
  ok('the probe UI is inert without the flag',
     /function\s+rt3dAuditBindProbe\(\)\s*\{\s*if\(!RT3D_EXP_ENABLED\)\s*return;/.test(curS65Ui));
  ok('the probe UI never writes canonical project state',
     !/\bstate\.[A-Za-z0-9_.]*\s*=(?!=)/.test(s65UiCode),
     (s65UiCode.match(/\bstate\.[A-Za-z0-9_.]*\s*=(?!=)[^;\n]*/g) || []).slice(0, 3).join(' | '));
  ok('the probe UI never writes a heatmap or trace result',
     !/\b(heatGridRssi|heatGridDisp|heatMeta|heatRtReach|heatMode|heatMetric|showHeat)\s*=(?!=)/.test(s65UiCode),
     (s65UiCode.match(/\b(heatGridRssi|heatGridDisp|heatMeta|heatRtReach|heatMode|showHeat)\s*=(?!=)[^;\n]*/g) || []).slice(0, 3).join(' | '));
  ok('the probe UI never runs a propagation engine',
     !/(runRayTrace|computeHeatSimple|rt3dCoverageSlice|rt3dExpRunCoverage|rt3dExpStart)\s*\(/.test(calls(s65UiCode)),
     (s65UiCode.match(/(runRayTrace|computeHeatSimple|rt3dCoverageSlice|rt3dExpRunCoverage|rt3dExpStart)\s*\(/g) || []).slice(0, 3).join(' | '));
  ok('the probe UI never modifies an RF parameter',
     !/\b(matById|apMount|antennaGain|antennaAzGain|rssiFromAP|fsplAt1m|plExp)\s*\.[A-Za-z0-9_]*\s*=/.test(s65UiCode));
  ok('the probe is not persisted: it lives in module locals, not in state',
     /let\s+rt3dAuditProbePoint/.test(curS65Ui) &&
     !/rt3dAuditProbe(Point|Result)\s*=\s*state\./.test(s65UiCode));
  ok('the probe receiver Z is the canonical plane, not a free choice',
     /floorElevation\(activeFloor\)\s*\+\s*receiverHeight\(\)/.test(curS65Ui) ||
     /rt3dAuditReceiverPlaneZ/.test(curS65Ui));
}

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
