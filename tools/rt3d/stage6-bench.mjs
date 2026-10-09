// Stage 6 performance: cost of the unified coverage field on a realistic project.
//
// The brief asks for the cost to be MEASURED before any optimisation, and for no
// optimisation to be added here. So this harness measures and reports, and the
// numbers are the input to whatever comes next.
//
// The work is essentially:
//
//     grid cells x participating APs x (1 direct + up to 2 legs per valid
//     first-order reflection candidate)
//
// Nothing is cached, no adaptive grid, no quadtree, no workers, no GPU, no
// voxel octree, no path cache and no spatial interpolation. The existing BVH is
// used for physical intersection acceleration and nothing else.
//
//   node tools/rt3d/stage6-bench.mjs
//
// Stage 7A.2 EXTENSION — profiling baseline. This file now measures WHERE RT3D
// spends its time. It optimises nothing, changes no RF formula, no candidate
// selection, no reflection semantics, no BVH semantics and no resolution.
//
// MEASUREMENT INTEGRITY. Two rules govern everything below:
//
//   1. TIMINGS COME FROM AN UNINSTRUMENTED PASS. Operation counts come from a
//      second, instrumented pass. Wrapping a hot function costs two clock reads
//      per call, which is significant at millions of calls and would otherwise
//      be silently charged to whichever component we happened to be measuring.
//      So cost and volume are measured separately and never mixed.
//
//   2. THE INSTRUMENTATION IS A SANDBOX MONKEY-PATCH, NOT A CODE CHANGE. Wrappers
//      are installed by reassigning globals inside the loaded application scope.
//      index.html is byte-for-byte untouched by this stage. Wrapping a function
//      changes neither its result nor the order in which things are evaluated;
//      each wrapper calls straight through to the original.
//
// BVH counters (nodesVisited, leavesVisited, candidatesTested, prunedNodes,
// totalBodies) are NOT re-implemented here: the engine already maintains them in
// rt3dNewStats(), so they are read, not counted a second time.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeDom, run } from './loader.mjs';
import { workerEnv, manualTick, runProtocol, SNAPSHOT_FN } from './worker-harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, '..', '..', 'index.html'), 'utf8')
  .match(/<script>\n([\s\S]*?)\n<\/script>/)[1];

function sandbox() {
  const win = makeDom();
  win.location = { search: '?rt3d=1' };
  const ctx = vm.createContext(win);
  vm.runInContext(SRC, ctx, { filename: 'index.html<script>' });
  run(ctx, `paintHeat=function(){};computeHeatSimple=function(){};draw2d=function(){};
    coverageUpdate=function(){};showToast=function(){};refresh3dHeat=function(){};
    scheduleHeat=function(){};clearTimeout(heatTimer);`);
  return ctx;
}

// A two-floor open-plan office with the ingredients a real project has. This is
// a STAND-IN, not S4Optik: absolute timings carry the Node vm cross-context
// overhead seen in the earlier benches and exclude rendering. Read them as an
// order of magnitude; the RATIOS between rows are exact.
const PROJECT = `
  state=freshState();
  var M4=state.materials[4].id, M2=state.materials[2].id, M0=state.materials[0].id;
  var f0=state.floors[0];
  f0.name='PB'; f0.height=3.2; f0.w=26; f0.d=17; f0.ceilingAreas=[];
  var W=13,H=8.5, pts=[[-W,-H],[W,-H],[W,H],[-W,H]];
  for(var i=0;i<4;i++){ var a=pts[i], b=pts[(i+1)%4];
    f0.walls.push({id:'w'+i,x1:a[0],y1:a[1],x2:b[0],y2:b[1],materialId:M4,
                   thickness:DEFAULT_WALL_THICKNESS_M}); }
  f0.walls.push({id:'g1',x1:0,y1:-8.5,x2:0,y2:-1.2,materialId:M0,thickness:DEFAULT_WALL_THICKNESS_M});
  f0.walls.push({id:'g2',x1:0,y1:2.6,x2:0,y2:8.5,materialId:M2,thickness:DEFAULT_WALL_THICKNESS_M});
  f0.walls.push({id:'c1',x1:-13,y1:0,x2:-5.5,y2:0,materialId:M4,thickness:DEFAULT_WALL_THICKNESS_M});
  for(var p=0;p<6;p++) f0.pillars.push({id:'p'+p,x:-10+p*4,y:(p%2?4.4:-4.4),diameter:0.5,materialId:M4});
  for(var r=0;r<9;r++) f0.rfObjects.push({id:'rk'+r,
    x:-11+(r%5)*5.2, y:(r<5?6.2:-6.2), width:1.0, depth:2.2,
    height:(r%3===0?0.9:(r%3===1?2.0:0.6)), rotation:(r%2?90:0),
    materialId:M4, extraLossDb:2});
  var o=[{x:-13,y:-8.5},{x:13,y:-8.5},{x:13,y:8.5},{x:-13,y:8.5}];
  var hA=[{x:-3,y:-3},{x:3,y:-3},{x:3,y:3},{x:-3,y:3}];
  f0.ceilingAreas.push({id:'cl1',height:3.05,thickness:0.10,materialId:M2,extraLossDb:0,
    footprint:{parts:[{outer:o,holes:[hA]}]}});
  [[-9,-5.5],[-9,5.5],[3,-5.5],[3,5.5],[10,-5]].forEach(function(c,i){
    var ap=makeAP(c[0],c[1],'AP-PB-'+(i+1),3.2); ap.mount=2.6; f0.aps.push(ap); });

  state.floors.push(freshFloor('PA',1));
  var f1=state.floors[1];
  f1.name='PA'; f1.height=2.9; f1.w=26; f1.d=17; f1.ceilingAreas=[];
  f1.slabMaterialId=M4;
  f1.openings.push({id:'st1',points:[{x:-4,y:-4},{x:4,y:-4},{x:4,y:4},{x:-4,y:4}]});
  f1.openings.push({id:'st2',points:[{x:5.5,y:4.5},{x:10.5,y:4.5},{x:10.5,y:7.5},{x:5.5,y:7.5}]});
  f1.walls.push({id:'w1',x1:-13,y1:-8.5,x2:-13,y2:8.5,materialId:M4,thickness:DEFAULT_WALL_THICKNESS_M});
  for(var q=0;q<4;q++) f1.pillars.push({id:'q'+q,x:-8+q*5.5,y:(q%2?3:-3),diameter:0.5,materialId:M4});
  for(var s2=0;s2<5;s2++) f1.rfObjects.push({id:'rr'+s2,x:-9+s2*4.6,y:(s2%2?5.5:-5.5),
    width:1.0,depth:2.0,height:2.0,rotation:0,materialId:M4,extraLossDb:2});
  [[-7,0],[7,0],[0,-6]].forEach(function(c,i){
    var ap=makeAP(c[0],c[1],'AP-PA-'+(i+1),2.9); ap.mount=2.5; f1.aps.push(ap); });
  state.activeFloor=0;`;

// The Stage-6 baseline below runs a 20,825-cell grid with reflections, which on
// this host takes roughly half an hour. It is preserved verbatim as the reference
// point, but is opt-in so the Stage-7A.2 profiling sections can be run quickly.
//   node tools/rt3d/stage6-bench.mjs --with-stage6
const WITH_STAGE6 = process.argv.includes('--with-stage6');

const sb = sandbox();
run(sb, PROJECT);

const shape = JSON.parse(run(sb, `JSON.stringify((function(){
  var w=rt3dBuildWorld(), aps=rt3dCoverageSources();
  var spec=rt3dGridSpec(state.floors[0]);
  var byFam={}; RT3D_FAMILIES.forEach(function(k){ byFam[k]=rt3dFamilyList(w,k).length; });
  return { bodies: rt3dAllBodies(w).length, byFam: byFam,
           aps: aps.length,
           ownerFloors: [...new Set(aps.map(function(a){return a.floorIndex;}))].sort(),
           cols: spec.cols, rows: spec.rows, cells: spec.cols*spec.rows, cell: spec.cell,
           walls: w.walls.length };
})())`));

const pad = (v, n) => String(v).padStart(n);

if (!WITH_STAGE6) {
  console.log('(Stage-6 reference section skipped; pass --with-stage6 to run it. It takes');
  console.log(' ~30 min here: 20,825 cells x 8 APs x first-order reflections.)\n');
} else {
console.log('Stage 6 — unified coverage field, cost on a realistic project size\n');
console.log('NOTE: project-like STAND-IN, not S4Optik. Absolute timings carry the Node vm');
console.log('cross-context overhead seen in the earlier benches and exclude rendering.');
console.log('Read them as an order of magnitude; ratios between rows are exact.\n');
console.log(`scene: ${shape.bodies} bodies (${Object.entries(shape.byFam).map(([k, v]) => `${v} ${k}`).join(', ')})`);
console.log(`       ${shape.walls} walls (reflection candidates per point), ${shape.aps} participating APs on floors [${shape.ownerFloors.join(', ')}]`);
console.log(`grid : ${shape.cols} x ${shape.rows} = ${shape.cells} cells @ ${shape.cell} m\n`);

const rows = [];
for (const cfg of [
  { floor: 0, name: 'PB', reflections: false, note: 'direct only' },
  { floor: 0, name: 'PB', reflections: true, note: 'direct + first-order reflection' },
  { floor: 1, name: 'PA', reflections: true, note: 'direct + first-order reflection' },
]) {
  const r = JSON.parse(run(sb, `JSON.stringify((function(){
    state.activeFloor=${cfg.floor};
    var fl=state.floors[state.activeFloor];
    var t0=performance.now();
    var world=rt3dBuildWorld();
    var tb=performance.now();
    var bvh=rt3dBvhFor(world);
    var buildMs=performance.now()-tb;
    var spec=rt3dGridSpec(fl);
    var planeZ=rt3dReceiverPlaneZForFloor(state.activeFloor);
    var slice=rt3dCoverageSlice(world, spec, planeZ, { reflections:${cfg.reflections} });
    var total=performance.now()-t0;
    var d=slice.diagnostics;
    return { floor:'${cfg.name}', cells:slice.totalCells, evaluated:slice.evaluatedCells,
             noSignal:slice.noSignalCells, aps:d.participatingAps,
             direct:d.directPathsTested, reflected:d.validReflectedPaths,
             buildMs:+buildMs.toFixed(2), sliceMs:d.totalMs, totalMs:+total.toFixed(2),
             perSec:d.cellsPerSec, bodies:d.worldBodies, bvh:bvh.nodeCount,
             planeZ:planeZ };
  })())`));
  r.note = cfg.note;
  rows.push(r);
}

console.log('floor  mode                            cells   eval   noSig  APs     direct   refl    build  sliceMs  total  cells/s');
for (const r of rows) {
  console.log(
    `${pad(r.floor, 6)}  ${pad(r.note, 31)} ${pad(r.cells, 7)} ${pad(r.evaluated, 7)} ` +
    `${pad(r.noSignal, 7)} ${pad(r.aps, 4)} ${pad(r.direct, 9)} ${pad(r.reflected, 7)} ` +
    `${pad(r.buildMs, 7)} ${pad(r.sliceMs, 8)} ${pad(r.totalMs, 7)} ${pad(r.perSec, 9)}`);
}

console.log('\nWhat the numbers mean');
console.log('* direct = cells x participating APs: the irreducible cost of solving every');
console.log('  cell. This is the price of "no interpolation", and it is exact.');
console.log('* refl = VALID first-order reflection candidates, i.e. those that passed the');
console.log('  same-side, finite-extent and finite-height tests. The wall-count row above');
console.log('  shows how many candidates are *tested*; only a few survive per point.');
console.log('* build is constant and negligible: the BVH is built once per run.');
console.log('* A slower figure is not automatically a bug: it is an evidence-based input to a');
console.log('  future optimisation stage. Nothing is optimised here on purpose.');

// vertical column evidence on the same project
const col = JSON.parse(run(sb, `JSON.stringify((function(){
  state.activeFloor=0;
  var world=rt3dBuildWorld();
  var zs=[0.5,1.2,2.0,2.8,4.2];
  var c=rt3dCoverageColumn(world, -9, 5.5, zs, {});
  return c.samples.map(function(s){ return { z:s.z, rssi:s.strongestRssi, step:s.stepDb,
           directLoss:(s.aps[0]||{}).directLoss, refl:(s.aps[0]||{}).reflectedValid,
           jump:s.discreteJump }; });
})())`));
console.log('\nVertical column through a PB AP position (x=-9, y=5.5)');
console.log('  z(m)   strongest      step     directMaterialLoss  validRefl  discrete');
for (const s of col) {
  console.log(`  ${pad(s.z.toFixed(2), 5)}  ${pad(Number.isFinite(s.rssi) ? s.rssi.toFixed(2) : 'no signal', 11)}  ` +
    `${pad(s.step === null ? '-' : s.step, 8)}  ${pad(s.directLoss === undefined ? '-' : s.directLoss, 18)}  ` +
    `${pad(s.refl, 9)}  ${s.jump ? 'YES' : ''}`);
}
console.log('\nThe column changes where physics changes and nowhere else. That is the');
console.log('evidence that this is one 3D field, not a stack of independent 2D maps.');
}


// ============================================================================
//  STAGE 7A.2 — PROFILING BASELINE (measurement only; no optimisation)
//
//  Appended to stage6-bench.mjs so the Stage-6 baseline above stays intact and
//  comparable. Nothing here changes a result.
// ============================================================================

// ---------------------------------------------------------------------------
// Instrumented pass. Installed INSIDE the loaded application scope by
// reassigning globals, so index.html is never edited. Every wrapper calls
// through to the original, so results and evaluation order are unchanged.
// ---------------------------------------------------------------------------
const INSTRUMENT = `
  window.__P = { counts:{}, ms:{}, nesting:{} };
  (function(){
    var P = window.__P;
    function count(name){ P.counts[name]=(P.counts[name]||0)+1; }
    function wrap(name){
      var orig = globalThis[name];
      if(typeof orig !== 'function'){ P.counts[name+':MISSING']=1; return; }
      P.nesting[name]=true;
      globalThis[name] = function(){
        count(name);
        return orig.apply(this, arguments);
      };
      globalThis[name].__rt3dOriginal = orig;
    }
    // Coverage orchestration
    ['rt3dBuildWorld','rt3dBvhFor','rt3dCoverageSlice','rt3dCoverageAt',
     'rt3dGridSpec','rt3dReceiverPlaneZForFloor','rt3dCoverageSources',
     'rt3dCoverageColumn'].forEach(wrap);
    // Per-point physics
    ['rt3dSegment','rt3dTracePath','rt3dCandidateEvents','rt3dBodyEvent',
     'rt3dReflectCandidate','antennaGain','rt3dAuditLossBreakdown',
     'rt3dNearestEvent','rt3dNearestBvh','rt3dNearestLinear',
     'rt3dCandidateBodies','rt3dQueryBvhAabb','rt3dQuery','rt3dBvhFor',
     'rt3dRay','rt3dApOrigin','rt3dApPoint'].forEach(wrap);
    return Object.keys(P.counts).length;
  })();
  'instrumented'
`;

// Deep, value-free fingerprint of a completed slice, used ONLY to prove that
// instrumentation did not change any output.
const FINGERPRINT = `
  function __benchFingerprint(slice, world){
    var best=slice.best, ap=slice.apBest, val=slice.valid;
    // A cheap order-sensitive checksum over the typed arrays. Not a substitute
    // for the frozen oracle; it is a local canary for THIS harness.
    var h=2166136261>>>0;
    for(var i=0;i<best.length;i++){
      var v=best[i];
      h ^= (v===-Infinity?0x7ff00000:(v*8192)|0); h=Math.imul(h,16777619)>>>0;
    }
    for(var j=0;j<ap.length;j++){ h^=ap[j]&0xffff; h=Math.imul(h,16777619)>>>0; }
    for(var k=0;k<val.length;k++){ h^=val[k]; h=Math.imul(h,16777619)>>>0; }
    return { h:h>>>0, evaluated:slice.evaluatedCells, valid:slice.validCells,
             noSignal:slice.noSignalCells, complete:slice.complete,
             bodies:rt3dAllBodies(world).length };
  }
  'ok'
`;

// The Stage-6 section above already defines `pad`; reuse it rather than
// redeclaring it.
const padL = (v, n) => String(v).padEnd(n);
const ms = (v) => (v === null || v === undefined ? '—' : (+v).toFixed(2));
const k = (v) => (v === null || v === undefined ? '—' : v.toLocaleString());
const fixed = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—');

// Median of n samples, which is the robust statistic for a VM-bound benchmark.
function median(xs) {
  const s = xs.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ===========================================================================
//  SECTION 1 — COLD WORKER BOOTSTRAP vs WARM RF COMPUTE
//
//  The Worker evaluates the whole ~837 KB application script on every worker
//  instance. That cost must never be confused with RF compute, so they are
//  measured in separate, clearly-labelled sections.
// ===========================================================================
console.log('\n' + '='.repeat(78));
console.log('  STAGE 7A.2 PROFILING BASELINE — measurement only');
console.log('='.repeat(78));

console.log('\n--- 1. COLD WORKER BOOTSTRAP (script evaluation, NOT RF compute) ---');
const appBytes = SRC.length;
const coldSamples = [];
const warmBootSamples = [];
{
  // Cold: a brand-new worker environment, which must evaluate the app script.
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    workerEnv();
    coldSamples.push(performance.now() - t0);
  }
  // Warm: reuse ONE worker environment and time a trivial engine call, to show
  // what a warm worker costs per dispatch as opposed to per boot.
  const w = workerEnv();
  w.run('state=freshState();');            // the engine needs a project, as start() would do
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    w.run('rt3dBuildWorld()');
    warmBootSamples.push(performance.now() - t0);
  }
}
console.log(`  canonical application script : ${k(appBytes)} bytes`);
console.log(`  cold worker boot  (5 fresh)  : median ${ms(median(coldSamples))} ms   ` +
            `[${coldSamples.map((v) => v.toFixed(0)).join(', ')}]`);
console.log(`  warm worker, 1 world build   : median ${ms(median(warmBootSamples))} ms   ` +
            `[${warmBootSamples.map((v) => v.toFixed(2)).join(', ')}]`);
console.log('  NOTE: cold boot is paid ONCE per worker instance and is not RF work.');
console.log('        It is reported here purely so it is never mistaken for compute.');

// ===========================================================================
//  SECTION 2 — WARM RUN_SLICE JOBS THROUGH ONE WORKER
// ===========================================================================
console.log('\n--- 2. WARM RUN_SLICE JOBS THROUGH A SINGLE WORKER (same scene) ---');
const WARM_SCENE = `
  state=freshState(); state.floors.length=1;
  var f=state.floors[0];
  f.id='bench_a'; f.name='BENCH'; f.w=30; f.d=20; f.height=3.4;
  f.walls=[]; f.pillars=[]; f.rfObjects=[]; f.ceilingAreas=[]; f.openings=[]; f.aps=[];
  var M4=state.materials[4].id;
  var W=15,H=10, pts=[[-W,-H],[W,-H],[W,H],[-W,H]];
  for(var i=0;i<4;i++){ var a=pts[i], b=pts[(i+1)%4];
    f.walls.push({id:'w'+i,x1:a[0],y1:a[1],x2:b[0],y2:b[1],materialId:M4,
      thickness:DEFAULT_WALL_THICKNESS_M}); }
  [[-10,-6],[-10,6],[0,-7],[0,7],[10,-6],[10,6]].forEach(function(c,i){
    var ap=makeAP(c[0],c[1],'AP-'+(i+1),3.4); ap.id='ap_'+(i+1); ap.mount=2.6; f.aps.push(ap); });
  state.activeFloor=0; state.receiverHeight=1.2;
`;
{
  const w = workerEnv();
  w.run(WARM_SCENE);
  w.run(SNAPSHOT_FN);
  const snapshot = JSON.parse(w.run('JSON.stringify(__rt3dWorkerSnapshot())'));
  // a fixed, moderate grid so warm-job cost is clearly compute, not boot
  snapshot.spec = { cols: 32, rows: 24, cell: 0.5,
                    b: { minx: -8, miny: -6, maxx: 8, maxy: 6 },
                    cw: 0.5, ch: 0.5, raySpacing: 0.5 };

  const JOBS = 3;
  const jobMs = [], transferMs = [], serializeMs = [];
  let lastPayload = null;
  for (let j = 0; j < JOBS; j++) {
    const tick = manualTick();
    const t0 = performance.now();
    const { messages } = runProtocol(w, snapshot, { jobId: j + 1, tick });
    tick.flushAll();
    jobMs.push(performance.now() - t0);
    const done = messages.find((m) => m.type === 'COMPLETE');
    if (!done) throw new Error('warm job ' + j + ' produced no COMPLETE');
    lastPayload = done;
    // What the main thread actually pays to receive this result.
    const t1 = performance.now();
    const json = JSON.stringify({
      best: Array.from(done.grid.best),
      apBest: Array.from(done.grid.apBest),
      valid: Array.from(done.grid.valid),
    });
    serializeMs.push(performance.now() - t1);
    const t2 = performance.now();
    structuredClone({ best: done.grid.best, apBest: done.grid.apBest, valid: done.grid.valid });
    transferMs.push(performance.now() - t2);
    void json;
  }
  const cells = snapshot.spec.cols * snapshot.spec.rows;
  console.log(`  grid            : ${snapshot.spec.cols} x ${snapshot.spec.rows} = ${k(cells)} cells`);
  console.log(`  bodies          : ${lastPayload.diagnostics.worldBodies}`);
  console.log(`  APs (participating): ${lastPayload.diagnostics.participatingAps}`);
  console.log(`  warm job, median: ${ms(median(jobMs))} ms   [${jobMs.map((v) => v.toFixed(0)).join(', ')}]`);
  console.log(`  cold boot, median: ${ms(median(coldSamples))} ms  -> boot is ` +
              `${(median(coldSamples) / median(jobMs)).toFixed(2)}x one warm job`);
  console.log(`  result serialize (to arrays): median ${ms(median(serializeMs))} ms`);
  console.log(`  result structuredClone       : median ${ms(median(transferMs))} ms`);
  console.log(`  transferable buffers         : 3 (Float32 best, Int16 apBest, Uint8 valid)`);
  console.log('  NOTE: transfer is measured WITHOUT the transfer list, i.e. it is the');
  console.log('        cost a non-transferable clone would pay. With the transfer list the');
  console.log('        buffers move instead of being copied.');
}

// ===========================================================================
//  SECTION 3 — SCENES
// ===========================================================================
const BASE_SCENE = `
  state=freshState(); state.floors.length=1;
  var f=state.floors[0];
  f.id='flr_a'; f.name='FA'; f.w=40; f.d=28; f.height=3.4;
  f.walls=[]; f.pillars=[]; f.rfObjects=[]; f.ceilingAreas=[]; f.openings=[]; f.aps=[];
  state.activeFloor=0; state.receiverHeight=1.2;
`;
const ap = (id, x, y, floor, mount) => `
  var _a=makeAP(${x},${y},'${id.toUpperCase()}',state.floors[${floor}].height);
  _a.id='${id}'; _a.mount=${mount}; f${floor === 0 ? '' : 'loor' + floor}.aps.push(_a);`;

const SCENES = {
  A_emptyLos: { title: 'A. empty LOS — no bodies at all', scene: `${BASE_SCENE}${ap('ap_1', 0, 0, 0, 2.6)}` },
  B_walls: { title: 'B. walls only (a closed box + one internal partition)',
    scene: `${BASE_SCENE}
      var M4=state.materials[4].id, W=20,H=14, pts=[[-W,-H],[W,-H],[W,H],[-W,H]];
      for(var i=0;i<4;i++){ var a=pts[i], b=pts[(i+1)%4];
        f.walls.push({id:'w'+i,x1:a[0],y1:a[1],x2:b[0],y2:b[1],materialId:M4,
          thickness:DEFAULT_WALL_THICKNESS_M}); }
      f.walls.push({id:'wp',x1:0,y1:-14,x2:0,y2:14,materialId:M4,
        thickness:DEFAULT_WALL_THICKNESS_M});
      ${ap('ap_1', -8, 0, 0, 2.6)}` },
  C_rfObjects: { title: 'C. rotated RF Objects / racks',
    scene: `${BASE_SCENE}
      var M4=state.materials[4].id;
      for(var r=0;r<24;r++) f.rfObjects.push({id:'rk'+r,
        x:-18+(r%8)*5, y:(r<8?-8:8), width:1.2, depth:2.4, height:2.1,
        rotation:(r%3)*30, materialId:M4, extraLossDb:2});
      ${ap('ap_1', 0, 0, 0, 2.6)}` },
  D_slabOpening: { title: 'D. multi-floor slab + Opening',
    scene: `${BASE_SCENE}
      var M4=state.materials[4].id;
      var pa=JSON.parse(JSON.stringify(f));
      pa.id='flr_b'; pa.name='FB'; pa.walls=[]; pa.rfObjects=[]; pa.ceilingAreas=[];
      pa.openings=[{id:'op1',points:[{x:-8,y:-8},{x:8,y:-8},{x:8,y:8},{x:-8,y:8}]}];
      pa.slabMaterialId=M4; pa.aps=[];
      state.floors.push(pa); state.activeFloor=1;
      ${ap('ap_1', 0, 0, 0, 2.6)}` },
  E_ceilings: { title: 'E. Ceiling Areas (with holes)',
    scene: `${BASE_SCENE}
      var M2=state.materials[2].id;
      var o=[{x:-20,y:-14},{x:20,y:-14},{x:20,y:14},{x:-20,y:14}];
      for(var c=0;c<4;c++) f.ceilingAreas.push({id:'cl'+c,height:3.2,thickness:0.12,
        materialId:M2, extraLossDb:0,
        footprint:{parts:[{outer:o,holes:[[{x:-4,y:-4},{x:4,y:-4},{x:4,y:4},{x:-4,y:4}]]}]}});
      ${ap('ap_1', 0, 0, 0, 3.0)}` },
  F_reflections: { title: 'F. reflection-heavy — many walls, many APs',
    scene: `${BASE_SCENE}
      var M4=state.materials[4].id;
      var W=20,H=14, pts=[[-W,-H],[W,-H],[W,H],[-W,H]];
      for(var i=0;i<4;i++){ var a=pts[i], b=pts[(i+1)%4];
        f.walls.push({id:'o'+i,x1:a[0],y1:a[1],x2:b[0],y2:b[1],materialId:M4,
          thickness:DEFAULT_WALL_THICKNESS_M}); }
      for(var g=1;g<=8;g++) f.walls.push({id:'v'+g,x1:-20+g*4.4,y1:-14,x2:-20+g*4.4,y2:14,
        materialId:M4, thickness:DEFAULT_WALL_THICKNESS_M});
      [[-16,-9],[-16,9],[-8,-9],[-8,9],[0,-9],[0,9],[8,-9],[8,9]].forEach(function(c,i){
        var a2=makeAP(c[0],c[1],'AP-'+(i+1),3.4); a2.id='ap_'+(i+1); a2.mount=2.6; f.aps.push(a2); });` },
  G_warehouse: { title: 'G. mixed warehouse-like synthetic scene',
    scene: `${BASE_SCENE}
      var M4=state.materials[4].id, M2=state.materials[2].id;
      var W=20,H=14, pts=[[-W,-H],[W,-H],[W,H],[-W,H]];
      for(var i=0;i<4;i++){ var a=pts[i], b=pts[(i+1)%4];
        f.walls.push({id:'w'+i,x1:a[0],y1:a[1],x2:b[0],y2:b[1],materialId:M4,
          thickness:DEFAULT_WALL_THICKNESS_M}); }
      // racking aisles
      for(var r=0;r<6;r++) f.rfObjects.push({id:'rk'+r,x:-16+r*6.4,y:(r%2?7:-7),
        width:1.1,depth:5.0,height:2.2,rotation:(r%2?0:90),materialId:M4,extraLossDb:2});
      for(var p=0;p<8;p++) f.pillars.push({id:'p'+p,x:-17+p*4.8,y:(p%2?10:-10),
        r:0.28,height:3.4,materialId:M4,extraLossDb:0});
      f.walls.push({id:'gl',x1:0,y1:-14,x2:0,y2:-3,materialId:M2,thickness:DEFAULT_WALL_THICKNESS_M});
      var o2=[{x:-20,y:-14},{x:20,y:-14},{x:20,y:14},{x:-20,y:14}];
      f.ceilingAreas.push({id:'cl1',height:3.3,thickness:0.12,materialId:M2,extraLossDb:0,
        footprint:{parts:[{outer:o2,holes:[[{x:-6,y:-6},{x:6,y:-6},{x:6,y:6},{x:-6,y:6}]]}]}});
      [[-14,-10],[-14,10],[-5,-10],[5,10],[14,-10],[14,10]].forEach(function(c,i){
        var a2=makeAP(c[0],c[1],'AP-'+(i+1),3.4); a2.id='ap_'+(i+1); a2.mount=2.6; f.aps.push(a2); });
      var pb=JSON.parse(JSON.stringify(f));
      pb.id='flr_b'; pb.name='FB'; pb.walls=[]; pb.rfObjects=[]; pb.ceilingAreas=[];
      pb.pillars=[]; pb.aps=[]; pb.slabMaterialId=M4;
      pb.openings=[{id:'op1',points:[{x:-9,y:-9},{x:9,y:-9},{x:9,y:9},{x:-9,y:9}]}];
      state.floors.push(pb);` },
};

// GRID SIZES ARE DELIBERATELY SMALL. A Node vm cross-context call costs far more
// than a same-context browser call, so absolute milliseconds here are not
// comparable to the browser. What matters for this stage is the RATIO between
// rows and the operation COUNTS, which are call-count exact and host
// independent. The 20,825-cell grid of the Stage-6 reference section would take
// tens of minutes per row under instrumentation.
const GRIDS = {
  tiny:   { cols: 12, rows: 8,   cell: 0.5 },   // 96 cells
  small:  { cols: 24, rows: 16,  cell: 0.5 },   // 384
  medium: { cols: 48, rows: 32,  cell: 0.5 },   // 1,536
  large:  { cols: 96, rows: 64,  cell: 0.5 },   // 6,144
};
function gridSpecFor(g) {
  const half = { cols: g.cols / 2, rows: g.rows / 2 };
  return { cols: g.cols, rows: g.rows, cell: g.cell,
           cw: g.cell, ch: g.cell, raySpacing: g.cell,
           b: { minx: -half.cols * g.cell / 2, miny: -half.rows * g.cell / 2,
                maxx: half.cols * g.cell / 2, maxy: half.rows * g.cell / 2 } };
}

// One scene, one grid: run the uninstrumented timing pass and the instrumented
// count pass in SEPARATE sandboxes, and verify the outputs match.
function measure(scene, gridName, opts = {}) {
  const spec = gridSpecFor(GRIDS[gridName]);
  const repeat = opts.repeat || 1;

  // ---- pass 1: UNINSTRUMENTED timing ----
  const sb1 = sandbox();
  run(sb1, FINGERPRINT);
  run(sb1, scene);
  const timed = JSON.parse(run(sb1, `JSON.stringify((function(){
    var spec=${JSON.stringify(spec)};
    var fi=state.activeFloor;
    var planeZ=rt3dReceiverPlaneZForFloor(fi);
    var tWorld=performance.now();
    var world=rt3dBuildWorld();
    var msWorld=performance.now()-tWorld;
    var tBvh=performance.now();
    var bvh=rt3dBvhFor(world);
    var msBvh=performance.now()-tBvh;
    var tCol=performance.now();
    var col=rt3dCoverageColumn(world,0,0,[0.5,1.2,2.0,2.8,4.2].filter(function(z){
      return z<floorElevation(fi)+(state.floors[fi].height||3)+0.5; }),{});
    var msCol=performance.now()-tCol;
    var st=rt3dNewStats();
    // JIT warmup, then REPEAT timed evaluations in this same sandbox and take the
    // median. A single sample in a fresh vm context is dominated by V8 compiling
    // the kernel, which bends the scaling curves for reasons that have nothing to
    // do with the engine.
    var reps=${repeat};
    var slice=null, times=[];
    // q === 0 is the warmup and is always discarded; q in 1..reps are timed.
    for(var q=0;q<=reps;q++){
      var tq=performance.now();
      slice=rt3dCoverageSlice(world,spec,planeZ,{stats:st,reflections:${opts.reflections !== false}});
      var dq=performance.now()-tq;
      if(q>0) times.push(dq);
    }
    times.sort(function(a,b){ return a-b; });
    var msSlice = times.length ? times[times.length>>1] : 0;
    var st2=st;
    var fp=__benchFingerprint(slice,world);
    var d=slice.diagnostics;
    return { worldMs:+msWorld.toFixed(2), bvhMs:+msBvh.toFixed(2), colMs:+msCol.toFixed(2),
             sliceMs:+msSlice.toFixed(2), fingerprint:fp,
             cells:slice.totalCells, evaluated:slice.evaluatedCells,
             valid:slice.validCells, noSignal:slice.noSignalCells,
             aps:d.participatingAps, direct:d.directPathsTested,
             reflected:d.validReflectedPaths, bodies:d.worldBodies,
             bvhNodes:bvh?bvh.nodeCount:0, bvhCandidates:d.bvhCandidatesTested,
             samples:times.length,
             bvhNodesVisited:st2.nodesVisited, bvhLeavesVisited:st2.leavesVisited,
             bvhPruned:st2.prunedNodes, planeZ:planeZ,
             byFam:RT3D_FAMILIES.reduce(function(a,f){ a[f]=rt3dFamilyList(world,f).length; return a; },{}) };
  })())`));

  // ---- pass 2: INSTRUMENTED counts ----
  const sb2 = sandbox();
  run(sb2, scene);
  run(sb2, FINGERPRINT);
  run(sb2, INSTRUMENT);
  const counted = JSON.parse(run(sb2, `JSON.stringify((function(){
    var spec=${JSON.stringify(spec)};
    var fi=state.activeFloor;
    var planeZ=rt3dReceiverPlaneZForFloor(fi);
    var world=rt3dBuildWorld();
    var bvh=rt3dBvhFor(world);
    var st=rt3dNewStats();
    var slice=rt3dCoverageSlice(world,spec,planeZ,{stats:st,
      reflections:${opts.reflections !== false}});
    var fp=__benchFingerprint(slice,world);
    var counts=window.__P.counts;
    var want=['rt3dCoverageAt','rt3dSegment','rt3dBodyEvent','rt3dReflectCandidate',
              'antennaGain','rt3dNearestEvent','rt3dNearestBvh','rt3dNearestLinear',
              'rt3dCandidateBodies','rt3dCandidateEvents','rt3dTracePath',
              'rt3dAuditLossBreakdown','rt3dBvhFor','rt3dBuildWorld','rt3dRay',
              'rt3dApOrigin'];
    var out={}; want.forEach(function(k2){ out[k2]=counts[k2]||0; });
    out._missing=Object.keys(counts).filter(function(k2){ return /:MISSING$/.test(k2); });
    return { counts:out, fingerprint:fp,
             stats:{ nodesVisited:st.nodesVisited, leavesVisited:st.leavesVisited,
                     candidatesTested:st.candidatesTested,
                     prunedNodes:st.prunedNodes, totalBodies:st.totalBodies } };
  })())`));

  return { spec, timed, counted,
           preserved: JSON.stringify(timed.fingerprint) === JSON.stringify(counted.fingerprint) };
}

console.log('\n--- 3. PER-SCENE COST AND VOLUME (medium grid, 48 x 32 = 1,536 cells) ---');
console.log('    timings from an UNINSTRUMENTED pass; counts from a separate instrumented pass\n');

const sceneRows = [];
for (const [id, def] of Object.entries(SCENES)) {
  const r = measure(def.scene, 'medium');
  sceneRows.push({ id, title: def.title, ...r });
  const t = r.timed, c = r.counted.counts;
  console.log(`  ${def.title}`);
  console.log(`      bodies ${pad(k(t.bodies), 4)}  (${Object.entries(t.byFam).filter(([, v]) => v).map(([kk, v]) => v + ' ' + kk).join(', ') || 'none'})` +
              `   APs ${pad(t.aps, 2)}   cells ${k(t.evaluated)}`);
  console.log(`      TIMING  world ${pad(ms(t.worldMs), 7)} ms   bvh ${pad(ms(t.bvhMs), 7)} ms   ` +
              `column ${pad(ms(t.colMs), 6)} ms   slice ${pad(ms(t.sliceMs), 8)} ms`);
  console.log(`      COUNTS  CoverageAt ${k(c.rt3dCoverageAt)}   Segment ${k(c.rt3dSegment)}   ` +
              `BodyEvent ${k(c.rt3dBodyEvent)}   ReflectCandidate ${k(c.rt3dReflectCandidate)}`);
  console.log(`              antennaGain ${k(c.antennaGain)}   BvhQuery ${k(c.rt3dBvhQuery)}   ` +
              `CandidateEvents ${k(c.rt3dCandidateEvents)}   TracePath ${k(c.rt3dTracePath)}`);
  console.log(`              bvh nodesVisited ${k(t.bvhNodesVisited)}   leavesVisited ${k(t.bvhLeavesVisited)}   ` +
              `pruned ${k(t.bvhPruned)}   candidatesTested ${k(t.bvhCandidates)}`);
  console.log(`              rt3dAuditLossBreakdown ${k(c.rt3dAuditLossBreakdown)} (0 = the coverage path does NOT call the audit helper; see section 5)`);
  // Derived unit costs. Absolute ms are noisy in this harness, but a cost per
  // counted operation is a ratio measured by the same clock in the same sandbox,
  // so it is far more stable and is what the ranking rests on.
  const be = c.rt3dBodyEvent, sg = c.rt3dSegment;
  console.log(`              DERIVED   ms/BodyEvent ${fixed(be ? t.sliceMs / be : null, 5)}` +
              `   ms/Segment ${fixed(sg ? t.sliceMs / sg : null, 5)}` +
              `   BodyEvent/Segment ${fixed(sg ? be / sg : null, 1)}`);
  console.log(`              output preserved by instrumentation: ${r.preserved ? 'YES' : 'NO  <-- PROBLEM'}`);
}

// ===========================================================================
//  SECTION 4 — SCALING
// ===========================================================================
console.log('\n--- 4a. SCALING WITH CELLS (scene G warehouse) ---');
console.log('    grid          cells     slice ms   ms/cell   us/cell   CoverageAt   Segment');
for (const g of Object.keys(GRIDS)) {
  const r = measure(SCENES.G_warehouse.scene, g);
  const t = r.timed;
  const cells = t.evaluated;
  console.log(`    ${padL(g, 12)} ${pad(k(cells), 8)} ${pad(ms(t.sliceMs), 10)} ` +
              `${pad(fixed(t.sliceMs / cells, 3), 9)} ${pad(fixed(t.sliceMs * 1000 / cells, 2), 9)} ` +
              `${pad(k(r.counted.counts.rt3dCoverageAt), 12)} ${pad(k(r.counted.counts.rt3dSegment), 8)}`);
}

console.log('\n--- 4b. SCALING WITH APs (scene A empty LOS, reflections OFF) ---');
console.log('    APs     bodies    cells    slice ms   CoverageAt  Segment   ms/CoverageAt(us)');
console.log('    The 1-AP row is also the HARNESS FLOOR: an empty world, one AP, one wall-less');
console.log('    direct segment per cell. Everything above that row is attributable physics.');
for (const n of [1, 2, 4, 8, 16]) {
  const scene = `${BASE_SCENE}${Array.from({ length: n }, (_, i) =>
    ap('ap_' + (i + 1), -18 + (i % 8) * 5, -12 + Math.floor(i / 8) * 6, 0, 2.6)).join('\n')}`;
  const r = measure(scene, 'small', { reflections: false, repeat: 5 });
  const t = r.timed, c = r.counted.counts;
  console.log(`    ${pad(n, 4)} ${pad(k(t.bodies), 8)} ${pad(k(t.evaluated), 8)} ${pad(ms(t.sliceMs), 10)} ` +
              `${pad(k(c.rt3dCoverageAt), 11)} ${pad(k(c.rt3dSegment), 8)} ` +
              `${pad(fixed(t.sliceMs * 1000 / Math.max(1, c.rt3dCoverageAt), 2), 20)}`);
}

console.log('\n--- 4c. SCALING WITH WALLS / REFLECTION OPPORTUNITIES (1 AP, small grid) ---');
console.log('    walls    bodies   reflConsidered   reflValid   Segment   BodyEvent   slice ms');
for (const nw of [1, 4, 8, 16, 32]) {
  const scene = `${BASE_SCENE}
    var M4=state.materials[4].id;
    var W=20,H=14, pts=[[-W,-H],[W,-H],[W,H],[-W,H]];
    for(var i=0;i<4;i++){ var a=pts[i], b=pts[(i+1)%4];
      f.walls.push({id:'o'+i,x1:a[0],y1:a[1],x2:b[0],y2:b[1],materialId:M4,
        thickness:DEFAULT_WALL_THICKNESS_M}); }
    for(var g=1;g<=${nw};g++) f.walls.push({id:'v'+g,x1:-20+g*(40/${nw}),y1:-14,
      x2:-20+g*(40/${nw}),y2:14,materialId:M4, thickness:DEFAULT_WALL_THICKNESS_M});
    ${ap('ap_1', 0, 0, 0, 2.6)}`;
  const r = measure(scene, 'small');
  const t = r.timed, c = r.counted.counts;
  console.log(`    ${pad(t.byFam.wall, 6)} ${pad(k(t.bodies), 8)} ${pad(k(c.rt3dReflectCandidate), 16)} ` +
              `${pad(k(t.reflected), 11)} ${pad(k(c.rt3dSegment), 8)} ${pad(k(c.rt3dBodyEvent), 11)} ` +
              `${pad(ms(t.sliceMs), 9)}`);
}

console.log('\n    RATIOS ARE THE TRUSTWORTHY TIMING EVIDENCE, ABSOLUTE ms ARE NOT.');
console.log('    A Node vm cross-context harness adds a large fixed cost per call, so a single');
console.log('    absolute millisecond figure here is NOT comparable to the browser. What IS');
console.log('    trustworthy is the ratio between two rows measured by the same harness on');
console.log('    the same scene -- which is why reflections ON vs OFF, and the wall sweep, are');
console.log('    the load-bearing timing evidence. Operation counts are exact and host');
console.log('    independent, and are what the candidate ranking is built on.');

console.log('\n--- 4d. REFLECTIONS ON vs OFF (scene G warehouse, medium grid) ---');
for (const refl of [false, true]) {
  const r = measure(SCENES.G_warehouse.scene, 'medium', { reflections: refl });
  const t = r.timed, c = r.counted.counts;
  console.log(`    reflections ${padL(refl ? 'ON ' : 'OFF', 3)}  slice ${pad(ms(t.sliceMs), 8)} ms   ` +
              `Segment ${pad(k(c.rt3dSegment), 9)}   ReflectCandidate ${pad(k(c.rt3dReflectCandidate), 9)}   ` +
              `validRefl ${pad(k(t.reflected), 7)}   ` +
              `ms/Segment ${fixed(t.sliceMs / Math.max(1, c.rt3dSegment), 4)}`);
}

// ===========================================================================
//  SECTION 5 — NESTING / DOUBLE-COUNTING WARNING
// ===========================================================================
console.log('\n--- 5. NESTING (why the per-component ms must NOT be summed) ---');
console.log('    Call containment, outermost to innermost:');
console.log('      rt3dCoverageSlice');
console.log('        rt3dCoverageAt                      (per grid cell, per AP)');
console.log('          rt3dSegment                        (direct path: 1 per AP per cell)');
console.log('            rt3dTracePath');
console.log('              rt3dCandidateEvents');
console.log('                rt3dBodyEvent                (per candidate body)');
console.log('                  rt3dBvhQuery / rt3dNearest(BVH traversal)');
console.log('          rt3dReflectCandidate               (per WALL per AP per cell)');
console.log('            rt3dSegment  x2 legs              (AP->R and R->receiver)');
console.log('              rt3dTracePath -> ... -> rt3dBodyEvent');
console.log('          antennaGain                        (per AP per cell)');
console.log('          material-loss aggregation          (INSIDE rt3dTracePath, not a separate');
console.log('                                                call: rt3dAuditLossBreakdown belongs to');
console.log('                                                the Stage-6.5 AUDIT path only, so its');
console.log('                                                count is legitimately 0 here)');
console.log('\n    Consequences for this report:');
console.log('      * Segment time INCLUDES BodyEvent, TracePath and BVH time.');
console.log('      * ReflectCandidate time INCLUDES two Segments per valid candidate.');
console.log('      * CoverageAt time INCLUDES Segment + ReflectCandidate + antennaGain +');
console.log('        material aggregation.');
console.log('      => elapsed times are therefore reported as INCLUSIVE, and the counts are');
console.log('         the primary basis for ranking. Adding the inclusive times would');
console.log('         multiply the real cost by roughly the nesting depth (~5x).');
console.log('    No exclusive (self-time) attribution is claimed here; it would require');
console.log('    subtracting inclusive times, which is only meaningful for a proper');
console.log('    sampling profiler, not for wrappers.');

// ===========================================================================
//  SECTION 6 — BROWSER-REPORT MECHANISM
// ===========================================================================
console.log('\n--- 6. BROWSER MEASUREMENT PATH ---');
const reportFns = [...new Set((SRC.match(/function rt3dAuditReport[A-Za-z]*/g) || [])
  .map((s2) => s2.replace('function ', '')))];
const perfKeys = SRC.match(/rt3d\.perf\.[a-zA-Z]+/g) || [];
console.log('    The existing DOWNLOADABLE RT3D audit report is already built from these');
console.log('    section functions, so a performance section can be appended to the SAME');
console.log(`    document: ${reportFns.join(', ')}`);
console.log('    The counters it can already print, with no new RF computation:');
console.log('      bvhCandidatesTested, bvhNodes, bvhNodesVisited, worldBodies,');
console.log('      cellsEvaluated, directPathsTested, validReflectedPaths, validCandidates,');
console.log('      totalMs / phases, per-AP reflection candidate counts.');
console.log(`    existing rt3d.perf.* i18n keys: ${perfKeys.length ? perfKeys.join(', ') : 'none (would be added es/en/sv)'}`);
console.log('    Rejected alternative: a separate on-screen performance panel. It would');
console.log('    duplicate the report surface for no extra evidence.');
console.log('    => A compact performance section can be appended to the EXISTING report');
console.log('       with no new RF computation and no new UI surface. Not implemented in');
console.log('       this pass (measurement-only stage).');

// ---------------------------------------------------------------------------
//  DERIVED SUMMARY — the measured correlate used for ranking. This is an
//  observation across the scenes measured, not a variance decomposition.
// ---------------------------------------------------------------------------
{
  const withBe = sceneRows.filter((r) => r.counted.counts.rt3dBodyEvent > 0);
  const costs = withBe.map((r) => r.timed.sliceMs / r.counted.counts.rt3dBodyEvent);
  const counts = withBe.map((r) => r.counted.counts.rt3dBodyEvent);
  const lo = Math.min(...costs), hi = Math.max(...costs);
  const cLo = Math.min(...counts), cHi = Math.max(...counts);
  console.log('\n--- 7. DERIVED SUMMARY: slice time vs counted operations ---');
  console.log(`    scenes with a traversal          : ${withBe.length} of ${sceneRows.length}`);
  console.log(`    BodyEvent count range            : ${k(cLo)} … ${k(cHi)}  (${(cHi / cLo).toFixed(0)}x spread)`);
  console.log(`    ms per BodyEvent range           : ${fixed(lo, 5)} … ${fixed(hi, 5)} ms  ` +
              `(${(hi / lo).toFixed(2)}x spread)`);
  console.log(`    => across these scenes, elapsed slice time moved with the BodyEvent COUNT`);
  console.log(`       over a ${(cHi / cLo).toFixed(0)}x range of that count, while the unit cost varied`);
  console.log(`       ${(hi / lo).toFixed(1)}x. On that evidence the BodyEvent count is the`);
  console.log('       dominant measured correlate of runtime across these scenes.');
  console.log('');
  console.log('    WHAT THIS SUMMARY DOES NOT CLAIM. No formal variance decomposition was');
  console.log('    performed: the scenes are not a controlled factorial design, they differ in');
  console.log('    body count, wall count, AP count and layout at the same time, and only seven');
  console.log('    of them were measured. The statement above is a correlation observed over');
  console.log('    these scenes, not an attribution of a share of runtime to any component, and');
  console.log('    it is not a claim that BodyEvent volume is the ONLY contributor.');
  console.log('    No asymptotic exponent is claimed anywhere in this harness. The wall sweep');
  console.log('    (section 4c) shows superlinear growth in the MEASURED scenes; it does not');
  console.log('    establish an exponent, and none should be inferred from it.');
}

console.log('\n' + '='.repeat(78));
console.log('  Stage 7A.2 profiling baseline complete — nothing was optimised.');
console.log('='.repeat(78));