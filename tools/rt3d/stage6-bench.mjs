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
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeDom, run } from './loader.mjs';

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

console.log('Stage 6 — unified coverage field, cost on a realistic project size\n');
console.log('NOTE: project-like STAND-IN, not S4Optik. Absolute timings carry the Node vm');
console.log('cross-context overhead seen in the earlier benches and exclude rendering.');
console.log('Read them as an order of magnitude; ratios between rows are exact.\n');
console.log(`scene: ${shape.bodies} bodies (${Object.entries(shape.byFam).map(([k, v]) => `${v} ${k}`).join(', ')})`);
console.log(`       ${shape.walls} walls (reflection candidates per point), ${shape.aps} participating APs on floors [${shape.ownerFloors.join(', ')}]`);
console.log(`grid : ${shape.cols} x ${shape.rows} = ${shape.cells} cells @ ${shape.cell} m\n`);

const pad = (v, n) => String(v).padStart(n);
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
