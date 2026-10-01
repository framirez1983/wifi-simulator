// Stage 5 performance and coverage on a realistic project size.
//
// S4Optik is not available to this harness, so this builds a PROJECT-LIKE
// multi-floor scene with the same ingredients S4 exercises — a real shell, a
// glass partition, pillars, racks at realistic heights, a normal-height
// Ceiling with holes, a slab with Openings, and APs on two floors — and runs
// the REAL rt3dExpRun() through it.
//
// Treat the absolute numbers as an ORDER OF MAGNITUDE, not as S4 timings:
// they carry the Node vm cross-context overhead noted in the earlier benches,
// they exclude rendering, and the scene is a stand-in. What they do establish
// is which presets are usable at all, and whether coverage is so sparse that
// the picture says nothing.
//
//   node tools/rt3d/stage5-bench.mjs
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeDom, run } from './loader.mjs';
import { runOldEngine } from './engines.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, '..', '..', 'index.html'), 'utf8')
  .match(/<script>\n([\s\S]*?)\n<\/script>/)[1];

function sandbox() {
  const win = makeDom();
  win.location = { search: '?rt3d=1' };
  const ctx = vm.createContext(win);
  vm.runInContext(SRC, ctx, { filename: 'index.html<script>' });
  run(ctx, `
    paintHeat=function(){}; computeHeatSimple=function(){}; draw2d=function(){};
    coverageUpdate=function(){}; showToast=function(){}; refresh3dHeat=function(){};
    scheduleHeat=function(){}; clearTimeout(heatTimer);
  `);
  return ctx;
}

// A two-floor open-plan office with a service core. Deliberately includes the
// things the S4 manual test is meant to exercise.
const PROJECT = `
  state=freshState();
  var M4=state.materials[4].id, M2=state.materials[2].id,
      M0=state.materials[0].id, M1=state.materials[1].id;
  var f0=state.floors[0];
  f0.name='PB'; f0.height=3.2; f0.w=26; f0.d=17; f0.ceilingAreas=[];
  var W=13,H=8.5, pts=[[-W,-H],[W,-H],[W,H],[-W,H]];
  for(var i=0;i<4;i++){ var a=pts[i], b=pts[(i+1)%4];
    f0.walls.push({id:'w'+i,x1:a[0],y1:a[1],x2:b[0],y2:b[1],materialId:M4,
                   thickness:DEFAULT_WALL_THICKNESS_M}); }
  // a glass partition splitting the floor, with a door gap
  f0.walls.push({id:'g1',x1:0,y1:-8.5,x2:0,y2:-1.2,materialId:M0,thickness:DEFAULT_WALL_THICKNESS_M});
  f0.walls.push({id:'g2',x1:0,y1:2.6,x2:0,y2:8.5,materialId:M2,thickness:DEFAULT_WALL_THICKNESS_M});
  f0.walls.push({id:'c1',x1:-13,y1:0,x2:-5.5,y2:0,materialId:M4,thickness:DEFAULT_WALL_THICKNESS_M});
  for(var p=0;p<6;p++) f0.pillars.push({id:'p'+p,x:-10+p*4,y:(p%2?4.4:-4.4),diameter:0.5,materialId:M4});
  // racks: some 2.0 m tall, some 0.9 m benches, plus a low 0.6 m unit
  for(var r=0;r<9;r++) f0.rfObjects.push({id:'rk'+r,
    x:-11+(r%5)*5.2, y:(r<5? 6.2:-6.2), width:1.0, depth:2.2,
    height:(r%3===0?0.9:(r%3===1?2.0:0.6)), rotation:(r%2?90:0),
    materialId:M4, extraLossDb:2});
  var clRingA=[{x:-3,y:-3},{x:3,y:-3},{x:3,y:3},{x:-3,y:3}];
  var clRingB=[{x:6,y:4},{x:11,y:4},{x:11,y:7},{x:6,y:7}];
  var clOuter=[{x:-13,y:-8.5},{x:13,y:-8.5},{x:13,y:8.5},{x:-13,y:8.5}];
  f0.ceilingAreas.push({id:'cl1',height:3.05,thickness:0.10,materialId:M2,extraLossDb:0,
    footprint:{parts:[{outer:clOuter, holes:[clRingA, clRingB]}]}});
  [[-9,-5.5],[-9,5.5],[3,-5.5],[3,5.5],[10,-5]].forEach(function(c,i){
    var ap=makeAP(c[0],c[1],'AP-PB-'+(i+1),3.2); ap.mount=2.6; f0.aps.push(ap);
  });
  f0.aps[2].antenna={type:'patch',az:90,tilt:8,gain:4};

  state.floors.push(freshFloor('PA',1));
  var f1=state.floors[1];
  f1.name='PA'; f1.height=2.9; f1.w=26; f1.d=17; f1.ceilingAreas=[];
  f1.slabMaterialId=M4;
  f1.openings.push({id:'st1',points:[{x:-4,y:-4},{x:4,y:-4},{x:4,y:4},{x:-4,y:4}]});
  f1.openings.push({id:'st2',points:[{x:5.5,y:4.5},{x:10.5,y:4.5},{x:10.5,y:7.5},{x:5.5,y:7.5}]});
  f1.walls.push({id:'w1',x1:-13,y1:-8.5,x2:-13,y2:8.5,materialId:M4,thickness:DEFAULT_WALL_THICKNESS_M});
  for(var q=0;q<4;q++) f1.pillars.push({id:'q'+q,x:-8+q*5.5,y:(q%2?3:-3),diameter:0.5,materialId:M4});
  for(var s=0;s<5;s++) f1.rfObjects.push({id:'rr'+s,x:-9+s*4.6,y:(s%2?5.5:-5.5),
    width:1.0,depth:2.0,height:2.0,rotation:0,materialId:M4,extraLossDb:2});
  [[-7,0],[7,0],[0,-6]].forEach(function(c,i){
    var ap=makeAP(c[0],c[1],'AP-PA-'+(i+1),2.9); ap.mount=2.5; f1.aps.push(ap);
  });
  state.activeFloor=0;`;

async function runPreset(sb, floor, preset) {
  run(sb, `state.activeFloor=${floor};`);
  const t0 = Date.now();
  const res = await run(sb, `new Promise(function(res){
    rt3dExpRun(${JSON.stringify(preset)}, { onDone: res });
    setTimeout(function(){ res(null); }, 600000);
  })`);
  return { res, wallMs: Date.now() - t0 };
}

const sb = sandbox();
run(sb, PROJECT);
const shape = JSON.parse(run(sb, `JSON.stringify((function(){
  var w=rt3dBuildWorld(), aps=rt3dExpParticipatingAps();
  var spec=rt3dGridSpec(state.floors[0]);
  return { bodies: rt3dAllBodies(w).length,
           byFamily: RT3D_FAMILIES.reduce(function(o,k){ o[k]=rt3dFamilyList(w,k).length; return o; }, {}),
           aps: aps.length, ownerFloors: aps.map(function(a){return a.floorIndex;}),
           cols: spec.cols, rows: spec.rows, cells: spec.cols*spec.rows, cell: spec.cell };
})())`));

console.log('Stage 5 — experimental RT3D on a realistic project size\n');
console.log('NOTE: this is a PROJECT-LIKE stand-in for S4Optik, not S4 itself. Absolute');
console.log('timings carry the Node vm cross-context overhead seen in earlier benches');
console.log('and exclude rendering. Read them as an order of magnitude.\n');
console.log(`scene: ${shape.bodies} bodies  (${RT3DFAM(shape.byFamily)})`);
console.log(`       ${shape.aps} participating APs on floors [${[...new Set(shape.ownerFloors)].join(', ')}]`);
console.log(`grid : ${shape.cols} x ${shape.rows} = ${shape.cells} cells @ ${shape.cell} m (active floor)\n`);

const rows = [];
for (const floor of [0, 1]) {
  for (const preset of ['low', 'medium', 'high']) {
    const { res, wallMs } = await runPreset(sb, floor, preset);
    if (!res) { console.error(`TIMEOUT ${preset} floor${floor}`); process.exitCode = 1; continue; }
    rows.push({
      floor: floor === 0 ? 'PB' : 'PA',
      fan: `${res.fan.azimuthSamples}x${res.fan.elevationSamples}`,
      perAp: res.raysPerAp,
      aps: res.apCount,
      emitted: res.emittedRays,
      reached: res.samples.length,
      direct: res.directSamples,
      refl: res.reflectedSamples,
      cells: res.sampledCells,
      unsampled: res.unsampledCells,
      cov: res.coveragePct,
      bodies: res.worldBodies,
      bvh: res.bvhNodes,
      build: res.buildMs,
      trace: res.traceMs,
      bin: res.binMs,
      total: res.totalMs,
      wall: wallMs,
      plane: res.receiverPlaneZ,
    });
  }
}

const pad = (v, n) => String(v).padStart(n);
console.log('floor  fan      rays/AP  APs   emitted  reached  direct  refl  sampled   unsampled  cover%  bodies  BVH  build  trace  total');
for (const r of rows) {
  console.log(
    `${pad(r.floor, 5)}  ${pad(r.fan, 7)}  ${pad(r.perAp, 8)}  ${pad(r.aps, 3)}  ${pad(r.emitted, 8)}  ` +
    `${pad(r.reached, 8)}  ${pad(r.direct, 7)}  ${pad(r.refl, 5)}  ${pad(r.cells, 8)}  ${pad(r.unsampled, 10)}  ` +
    `${pad(r.cov.toFixed(2), 7)}  ${pad(r.bodies, 7)}  ${pad(r.bvh, 4)}  ${pad(r.build, 6)}  ` +
    `${pad(r.trace, 6)}  ${pad(r.total, 6)}`);
}

console.log('\nreceiver plane Z per floor: ' +
  rows.filter((r) => r.fan === '36x19').map((r) => `${r.floor}=${r.plane} m`).join('  '));

// legacy comparison on the same scene and floor
run(sb, 'state.activeFloor=0;');
const legacy = await runOldEngine(sb);
console.log(`\nlegacy Ray Tracing on PB: ${legacy.stats.initialRays} rays, ` +
  `${legacy.stats.processedBranches} branches, ${legacy.stats.elapsedMs.toFixed(0)} ms, ` +
  `${legacy.stats.finiteCells}/${legacy.stats.totalCells} finite cells @ ${legacy.stats.gridCellM} m`);
console.log('  (legacy fills every cell it can march to; RT3D fills only cells a ray actually crossed,');
console.log('   so a much lower RT3D coverage percentage is EXPECTED and is the honest result)');

function RT3DFAM(by) {
  return Object.entries(by).map(([k, v]) => `${v} ${k}`).join(', ');
}
