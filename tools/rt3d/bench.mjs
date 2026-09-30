// Stage 1C — performance of the PURE intersection primitives.
//
// Two measurements, because they answer different questions:
//
//  (A) NATIVE — the pure 3D math layer is extracted from index.html and run
//      in this realm, so the numbers are ordinary V8 timings. The math layer
//      has no dependency on the app, so this is exact, not a re-implementation.
//
//  (B) IN-SANDBOX — the full primitives are benchmarked inside the Node vm
//      that evaluates index.html. Every call there is a cross-context global
//      lookup, which inflates ALL timings by a large constant, so only the
//      RELATIVE costs and the scaling with body count are meaningful. The
//      absolute figures are reported for completeness and are NOT comparable
//      to browser performance.
//
// The app never calls any of this.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadApp, run, blankState, readAppScript } from './loader.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');

// ---------------------------------------------------------------- (A)
function extractFns(names) {
  const src = readAppScript();
  const out = [];
  for (const name of names) {
    const re = new RegExp('^function ' + name + '\\(', 'm');
    const m = re.exec(src);
    if (!m) throw new Error('function not found: ' + name);
    let i = src.indexOf('{', m.index), depth = 0, end = -1;
    for (let k = i; k < src.length; k++) {
      const c = src[k];
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { end = k + 1; break; } }
    }
    out.push(src.slice(m.index, end));
  }
  return out;
}

const MATH_FNS = ['rt3dV', 'rt3dAdd', 'rt3dSub', 'rt3dScale', 'rt3dDot', 'rt3dLenSq',
  'rt3dLen', 'rt3dUnit', 'rt3dPointAlongRay', 'rt3dReflect', 'rt3dNegate', 'rt3dEquals',
  'rt3dClipAxis'];
const mathSrc = 'const RT3D_EPS = 1e-9;\n' + extractFns(MATH_FNS).join('\n') + '\nreturn {rt3dV,rt3dAdd,rt3dSub,rt3dScale,rt3dDot,rt3dLenSq,rt3dLen,rt3dUnit,rt3dPointAlongRay,rt3dReflect,rt3dClipAxis};';
// eslint-disable-next-line no-new-func
const M = new Function(mathSrc)();

function timeit(fn, N) {
  fn(1);
  const t0 = performance.now();
  let acc = 0;
  for (let i = 0; i < N; i++) acc += fn(i) ? 1 : 0;
  const t1 = performance.now();
  return { ns: ((t1 - t0) * 1e6) / N, acc };
}

console.log('Stage 1C — pure intersection primitive performance');
console.log('(the app never calls any of this)\n');

console.log('(A) NATIVE — pure 3D math layer, this realm, real V8 timings');
console.log('    ' + process.version + ' on ' + process.platform + '/' + process.arch + '\n');
{
  const N = 2_000_000;
  const base = timeit(() => true, N);
  const rows = [
    ['baseline (empty call)', base.ns],
    ['rt3dV (allocate)', timeit((i) => M.rt3dV(i, 1, 2).x > 0, N).ns],
    ['rt3dDot', timeit((i) => M.rt3dDot({ x: i, y: 1, z: 2 }, { x: 1, y: 2, z: 3 }) > 0, N).ns],
    ['rt3dUnit (normalize)', timeit((i) => M.rt3dUnit({ x: i, y: 1, z: 2 }) !== null, N).ns],
    ['rt3dAdd + rt3dSub', timeit((i) => M.rt3dSub(M.rt3dAdd({ x: i, y: 1, z: 2 }, { x: 1, y: 1, z: 1 }), { x: 1, y: 1, z: 1 }).x > 0, N).ns],
    ['rt3dPointAlongRay  P(t)', timeit((i) => M.rt3dPointAlongRay({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, i).x === i, N).ns],
    ['rt3dReflect', timeit((i) => M.rt3dReflect({ x: 1, y: 1, z: -0.25 }, { x: -1, y: 0, z: 0 }).z < 0, N).ns],
    ['rt3dClipAxis (3D slab)', timeit((i) => M.rt3dClipAxis(0, 0.5, 0, 1, [0, Infinity]) !== null, N).ns],
  ];
  for (const [k, v] of rows) {
    console.log(`    ${k.padEnd(26)} ${v.toFixed(1).padStart(8)} ns`);
  }
  // a full axis-aligned box test = 3 slab clips + bookkeeping
  const box = (i) => {
    const o = { x: 0, y: 0, z: 0 }, d = { x: 0.577, y: 0.577, z: 0.577 };
    let w = M.rt3dClipAxis(o.x, d.x, -1, 1, [0, Infinity]);
    if (!w) return false;
    w = M.rt3dClipAxis(o.y, d.y, -1, 1, w); if (!w) return false;
    w = M.rt3dClipAxis(o.z, d.z, -1, 1, w); return !!w && i >= 0;
  };
  console.log(`    ${'full 3-axis box clip'.padEnd(26)} ${timeit(box, N).ns.toFixed(1).padStart(8)} ns`);
  console.log('');
}

// ---------------------------------------------------------------- (B)
const sb = loadApp();
blankState(sb);
const V = (s) => JSON.parse(run(sb, `JSON.stringify(${s})`));

function world(nWalls, nPillars, nObjects, nSlabs, nCeilings) {
  return V(`(function(){
    state=freshState();
    var f=state.floors[0];
    f.height=3.0; f.w=80; f.d=60; f.ceilingAreas=[];
    f.aps.push(makeAP(-3,-3,'AP-1',3.0));
    var M=state.materials[4].id;
    for(var i=0;i<${nWalls};i++){
      var x=-38+(i%20)*3.8, y=-28+Math.floor(i/20)*3.4;
      f.walls.push({id:'w'+i,x1:x,y1:y,x2:x+2.4,y2:y,materialId:M,thickness:0.15});
    }
    for(var i=0;i<${nPillars};i++)
      f.pillars.push({id:'p'+i,x:-37+(i%20)*3.8,y:-27+Math.floor(i/20)*3.4,diameter:0.6,materialId:M});
    for(var i=0;i<${nObjects};i++)
      f.rfObjects.push({id:'o'+i,x:-37+(i%20)*3.8,y:-27+Math.floor(i/20)*3.4,
        width:1.2,depth:0.9,height:2.0,rotation:(i*7)%90,materialId:M,extraLossDb:1});
    for(var i=0;i<${nCeilings};i++){ var cx=-35+i*7;
      f.ceilingAreas.push({id:'c'+i,height:2.8,thickness:0.10,materialId:M,extraLossDb:0,
        footprint:{parts:[{outer:[{x:cx,y:-5},{x:cx+5,y:-5},{x:cx+5,y:5},{x:cx,y:5}],holes:[]}]}}); }
    for(var i=0;i<${nSlabs};i++){ state.floors.push(freshFloor('F'+i,i+1));
      state.floors[i+1].height=3.0; state.floors[i+1].w=80; state.floors[i+1].d=60; }
    var w=rt3dBuildWorld();
    return {sig:rt3dWorldSignature(w),
            bodies:w.walls.length+w.pillars.length+w.rfObjects.length+w.slabs.length+w.ceilings.length};
  })()`);
}

console.log('(B) IN-SANDBOX — full primitives (absolute values inflated by vm');
console.log('    cross-context call overhead; compare RELATIVE costs only.\n');
for (const [label, counts] of [
  ['small   ', [20, 10, 10, 0, 2]],
  ['medium  ', [100, 40, 40, 2, 5]],
  ['large   ', [500, 200, 200, 5, 20]],
]) {
  const w = world(...counts);
  const b = JSON.parse(run(sb, 'JSON.stringify(rt3dBenchmark(rt3dBuildWorld(), 20000))'));
  console.log(`  ${label} ${w.sig}  (${w.bodies} bodies)`);
  for (const k of ['wallSurfaceHit', 'wallVolumeHit', 'pillarHit', 'rfObjectHit', 'slabHit', 'ceilingHit', 'broadphaseScan']) {
    if (b[k]) console.log(`     ${k.padEnd(16)} ${String(b[k].nsPerCall).padStart(9)} ns/call`);
  }
  console.log('');
}

console.log('  Broadphase scaling — the O(N) an accelerator must remove:');
for (const n of [100, 400, 1600, 6400]) {
  world(n, 0, 0, 0, 0);
  const ns = JSON.parse(run(sb, `JSON.stringify((function(){
    var world=rt3dBuildWorld(), N=20000, out=[];
    var q={minx:0,miny:0,minz:0,maxx:5,maxy:5,maxz:3};
    rt3dQuery(world.walls,q,out);
    var t0=performance.now();
    for(var i=0;i<N;i++){ rt3dQuery(world.walls,q,out); }
    var t1=performance.now();
    return {bodies:world.walls.length, nsPerQuery:+(((t1-t0)*1e6)/N).toFixed(1)};
  })())`));
  console.log(`     ${String(ns.bodies).padStart(5)} bodies -> ${String(ns.nsPerQuery).padStart(9)} ns/query`);
}
console.log('\n  => linear in body count, as expected. rt3dQuery() is the single');
console.log('     seam where a uniform grid, BVH or spatial hash replaces the scan;');
console.log('     no primitive or contract depends on the scan being linear.');
void fs;
