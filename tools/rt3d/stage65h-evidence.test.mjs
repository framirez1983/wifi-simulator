// Stage 6.5h: the three corrected evidence rules, conservative classification, and
// the AP-audit wording.
//
// Each of these exists because a rule OVERSTATED what it proved:
//   * a receiver XY inside an Opening says nothing about the PATH;
//   * a receiver above a rack says nothing about the segment;
//   * a known Legacy limitation existing somewhere in the scene does not explain a
//     specific cell's delta when Legacy discarded which path produced it.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeDom, run, attachCore, installFakeWorker } from './loader.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, '..', '..', 'index.html'), 'utf8')
  .match(/<script>\n([\s\S]*?)\n<\/script>/)[1];

let pass = 0, fail = 0;
const failures = [];
function check(id, name, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${String(id).padStart(2)}. ${name}`); }
  else {
    fail++; failures.push(`${id}. ${name}${detail ? ' :: ' + detail : ''}`);
    console.log(`  FAIL ${String(id).padStart(2)}. ${name}${detail ? ' :: ' + detail : ''}`);
  }
}
function sandbox() {
  const win = makeDom();
  win.location = { search: '?rt3d=1' };
  const ctx = vm.createContext(win);
  vm.runInContext(SRC, ctx, { filename: 'index.html<script>' });
  // Stage 7A.1: the coverage run executes in a Dedicated Worker. See the note in
  // stage65c-cache.test.mjs.
  attachCore(ctx);
  installFakeWorker(ctx, { appSource: SRC });
  run(ctx, `paintHeat=function(){};computeHeatSimple=function(){};draw2d=function(){};
    coverageUpdate=function(){};showToast=function(){};refresh3dHeat=function(){};
    scheduleHeat=function(){};clearTimeout(heatTimer);`);
  return ctx;
}
// Two floors: an AP low on PB, a receiver high on PA, a slab with a hole, and a
// Ceiling on PB with a hole. Enough for every corrected rule to be exercised.
const SCENE = `
  // Analytic fixture, solved rather than searched:
  //   PB elevation 0, PA elevation H=3.2, slab at Z=3.2 owned by PA with PA's openings
  //   AP on PA at (0,0) mount 2.6 -> AP Z = 5.8  (ABOVE the slab)
  //   receiver on PB at receiverHeight 1.2        (BELOW the slab)
  //   t = (3.2-5.8)/(1.2-5.8) = 0.565217
  //   RX=3.54 -> crossing (2.00, 0)  inside the Opening  x in [0,6]
  //   RX=-6   -> crossing (-3.39, 0) inside solid slab
  state=freshState(); state.floors.length=1;
  var pb=state.floors[0];
  pb.id='flr_pb'; pb.name='PB'; pb.w=24; pb.d=18; pb.height=3.2;
  pb.pillars=[]; pb.walls=[]; pb.rfObjects=[]; pb.ceilingAreas=[]; pb.openings=[]; pb.aps=[];
  var pa=JSON.parse(JSON.stringify(pb));
  pa.id='flr_pa'; pa.name='PA'; pa.walls=[]; pa.pillars=[]; pa.rfObjects=[]; pa.aps=[];
  pa.openings=[{id:'op1', points:[{x:0,y:-5},{x:6,y:-5},{x:6,y:5},{x:0,y:5}]}];
  // a Ceiling on PB with a hole, straddled by the PB AP and a PA receiver
  pb.ceilingAreas.push({id:'cl1', height:2.6, thickness:0.10,
    materialId:state.materials[4].id, extraLossDb:0,
    footprint:{parts:[{outer:[{x:-8,y:-6},{x:8,y:-6},{x:8,y:6},{x:-8,y:6}],
                       holes:[[{x:-2,y:-2},{x:2,y:-2},{x:2,y:2},{x:-2,y:2}]]}]}});
  var apLow=makeAP(0,0,'AP-PB',3.2); apLow.mount=2.4; apLow.mountType='ceiling';
  apLow.antenna={type:'omni',az:0,tilt:0,gain:3}; pb.aps=[apLow];
  var apUp=makeAP(0,0,'AP-PA',3.2); apUp.mount=2.6; apUp.mountType='ceiling';
  apUp.antenna={type:'omni',az:0,tilt:0,gain:3}; pa.aps=[apUp];
  state.floors.push(pa);
  state.activeFloor=1;
  state.receiverHeight=1.2;
`;
console.log('Stage 6.5h corrected evidence rules\n');

// ============ 1..5  path-qualified slab probes ==============================
{
  const ctx = sandbox();
  run(ctx, SCENE);
  const op = JSON.parse(run(ctx, 'JSON.stringify(rt3dAuditSlabOpeningProbe({floorIndex:0}))'));
  check(1, 'a slab-Opening path probe resolves', op.resolved === true, String(op.reason));
  check(2, 'it reports the EXACT slab-plane crossing XYZ',
    op.planeCrossingXYZ && Number.isFinite(op.planeCrossingXYZ.x) &&
    Math.abs(op.planeCrossingXYZ.z - 3.2) < 1e-6,
    JSON.stringify(op.planeCrossingXYZ));
  check(3, 'the crossing point is inside the canonical Opening polygon',
    /INSIDE the canonical Opening/.test(op.footprintVerdict), op.footprintVerdict);
  check(4, 'and the kernel asserts slab traversal 0',
    op.kernelTraversalCount === 0 && op.expectationMet === true,
    JSON.stringify({ n: op.kernelTraversalCount, ok: op.expectationMet }));
  check(5, 'the AP and receiver are on OPPOSITE sides of the slab plane',
    (op.apXYZ.z - 3.2) * (op.receiverXYZ.z - 3.2) < 0,
    JSON.stringify({ ap: op.apXYZ.z, rx: op.receiverXYZ.z }));
  check(5.5, 'and it is labelled a per-path probe, not a serving-RSSI claim',
    /not necessarily the serving AP/i.test(op.caveat), op.caveat);

  const solid = JSON.parse(run(ctx, 'JSON.stringify(rt3dAuditSlabSolidProbe({floorIndex:0}))'));
  check(6, 'a SOLID slab path probe resolves', solid.resolved === true, String(solid.reason));
  check(7, 'its crossing point is inside solid material (outside every Opening)',
    /inside SOLID slab/.test(solid.footprintVerdict), solid.footprintVerdict);
  check(8, 'and the kernel asserts slab traversal 1 with the effective slab loss',
    solid.kernelTraversalCount === 1 &&
    Math.abs(solid.kernelLossDb - solid.effectiveBarrierLossDb) < 1e-6 &&
    solid.expectationMet === true,
    JSON.stringify({ n: solid.kernelTraversalCount, loss: solid.kernelLossDb,
                     eff: solid.effectiveBarrierLossDb }));
}

// ============ 9..12  path-qualified Ceiling probes ==========================
{
  const ctx = sandbox();
  run(ctx, SCENE);
  const cc = JSON.parse(run(ctx, 'JSON.stringify(rt3dAuditCeilingCrossingProbe({floorIndex:0}))'));
  check(9, 'a Ceiling-crossing path probe resolves', cc.resolved === true, String(cc.reason));
  check(10, 'the crossing is inside SOLID Ceiling footprint, no hole',
    /inside SOLID Ceiling footprint/.test(cc.footprintVerdict), cc.footprintVerdict);
  check(11, 'AP and receiver straddle the Ceiling material interval',
    (cc.apXYZ.z - cc.barrierZIntervalAbsM[1]) * (cc.receiverXYZ.z - cc.barrierZIntervalAbsM[1]) < 0 ||
    (cc.apXYZ.z - cc.barrierZIntervalAbsM[0]) * (cc.receiverXYZ.z - cc.barrierZIntervalAbsM[0]) < 0,
    JSON.stringify({ ap: cc.apXYZ.z, band: cc.barrierZIntervalAbsM, rx: cc.receiverXYZ.z }));
  check(12, 'and the kernel asserts one Ceiling traversal at the effective loss',
    cc.kernelTraversalCount === 1 &&
    Math.abs(cc.kernelLossDb - cc.effectiveBarrierLossDb) < 1e-6 && cc.expectationMet === true,
    JSON.stringify({ n: cc.kernelTraversalCount, loss: cc.kernelLossDb }));
  const hb = JSON.parse(run(ctx, 'JSON.stringify(rt3dAuditCeilingHoleBypassProbe({floorIndex:0}))'));
  check(12.5, 'a Ceiling HOLE-bypass control is offered and asserts traversal 0',
    hb.resolved === true && hb.kernelTraversalCount === 0 && hb.expectationMet === true,
    JSON.stringify({ r: hb.resolved, n: hb.kernelTraversalCount, why: hb.reason }));
}

// ============ 13..16  conservative classification ===========================
{
  const ctx = sandbox();
  run(ctx, SCENE);
  // two live AP paths => the legacy winner is unrecoverable
  const multi = JSON.parse(run(ctx, `JSON.stringify((function(){
    var p=rt3dAuditProbeAt(0,0,{world:rt3dBuildWorld()});
    p.comparison.legacyStoredDbm=-60; p.comparison.deltaDb=-20;
    p.comparison.rt3dDbm=p.rt3d.canonicalDbm;
    return rt3dAuditClassifyDisagreement(p);
  })())`));
  check(13, 'with several live APs the legacy winner is reported unrecoverable',
    multi.legacyWinnerIdentifiable === false &&
    /NO difference here can be causally attributed/.test(multi.attributionLimit),
    JSON.stringify({ ok: multi.legacyWinnerIdentifiable, limit: multi.attributionLimit }));
  check(14, 'a material-crossing delta is NOT called an expected Legacy limitation '
          +'just because that limitation exists in the scene',
    multi.classification !== 'EXPECTED LEGACY LIMITATION' ||
    multi.dominantTerm !== 'material crossings on the direct path',
    JSON.stringify({ c: multi.classification, t: multi.dominantTerm }));
  const mat = JSON.parse(run(ctx, `JSON.stringify((function(){
    state.floors[0].walls.push({id:'wMid',x1:0,y1:-8,x2:0,y2:8,height:6.0,
      materialId:state.materials[4].id, thickness:DEFAULT_WALL_THICKNESS_M});
    state.floors[0].aps=[]; state.floors[1].aps=[];
    [-8,-5].forEach(function(x,i){ var a=makeAP(x,0,'AP-'+i,3.2); a.mount=2.6;
      a.mountType='ceiling'; a.antenna={type:'omni',az:0,tilt:0,gain:3};
      state.floors[1].aps.push(a); });
    state.activeFloor=1;
    var p=rt3dAuditProbeAt(6,0,{world:rt3dBuildWorld()});
    p.comparison.legacyStoredDbm=-40; p.comparison.deltaDb=-25;
    return rt3dAuditClassifyDisagreement(p);
  })())`));
  check(15, 'a material-dominated delta with ambiguous attribution is PHYSICALLY UNRESOLVED',
    mat.dominantTerm === 'material crossings on the direct path' &&
    mat.legacyWinnerIdentifiable === false &&
    mat.classification === 'PHYSICALLY UNRESOLVED' &&
    /recorded as evidence, not asserted as the cause/.test(mat.reason.replace(/\s+/g,' ')),
    JSON.stringify({ c: mat.classification, t: mat.dominantTerm, id: mat.legacyWinnerIdentifiable, r: mat.reason }));
  check(15.5, 'and the reason says why the known limitation cannot be tied to the result',
    /NO difference here can be causally attributed/.test(mat.reason) &&
    /recorded as EVIDENCE only/.test(mat.reason) &&
    /not asserted as the cause/.test(mat.reason), mat.reason.slice(0, 160));
  // a single live AP makes the distance term attributable
  const single = JSON.parse(run(ctx, `JSON.stringify((function(){
    var pa=state.floors[1]; pa.aps=[pa.aps[0]]; state.floors[0].aps=[];
    var w=rt3dBuildWorld();
    var p=rt3dAuditProbeAt(6,0,{world:w});
    var pl1=fsplAt1m(BANDS[state.band].mhz);
    var o=rt3dApOrigin(state.floors[1].aps[0],1);
    var dh=Math.hypot(6-o.x,0-o.y);
    var legacy=20+3-(pl1+10*state.plExp*Math.log10(Math.max(0.5,dh)));
    p.comparison.legacyStoredDbm=legacy;
    p.comparison.deltaDb=p.rt3d.canonicalDbm-legacy;
    return rt3dAuditClassifyDisagreement(p);
  })())`));
  check(16, 'with a single live AP the compared path IS the one Legacy deposited',
    single.legacyWinnerIdentifiable === true &&
    single.classification === 'EXPECTED LEGACY LIMITATION',
    JSON.stringify({ ok: single.legacyWinnerIdentifiable, c: single.classification }));
}

// ============ 17..18  AP audit wording =====================================
{
  const ctx = sandbox();
  run(ctx, `
    ${SCENE}
    // ONLY wall-mounted omnis: the S4 shape (omni/wall + omni/ceiling)
    state.floors[0].aps=[]; state.floors[1].aps=[];
    [[0,0],[6,0]].forEach(function(c,i){
      var a=makeAP(c[0],c[1],'AP-WALL'+(i+1),3.2); a.mount=2.6; a.mountType='wall';
      a.antenna={type:'omni',az:0,tilt:0,gain:3}; state.floors[1].aps.push(a);
    });
  `);
  const r = JSON.parse(run(ctx, 'JSON.stringify(rt3dAuditApTypeReport())'));
  check(17, 'wall-mounted omni APs are named as such, never as directional',
    /wall-mounted OMNI APs using the vertical model/i.test(r.verdict) &&
    !/DIRECTIONAL/.test(r.verdict), r.verdict);
  check(17.5, 'and the patch pathology is explicitly NOT carried over',
    /not\s+be carried over from a patch study/.test(r.verdict.replace(/\s+/g,' ')), r.verdict);
  const row = r.aps.find(a => a.mountType === 'wall');
  check(18, 'the per-AP consequence text matches the wall-omni wording',
    /WALL-MOUNTED OMNI/.test(row.consequence), row.consequence);
  const c2 = sandbox();
  run(c2, SCENE);
  run(c2, `var a=makeAP(0,0,'AP-P',3.2); a.mount=2.9; a.mountType='ceiling';
            a.antenna={type:'patch',az:0,tilt:0,gain:5}; state.floors[0].aps=[a];`);
  const r2 = JSON.parse(run(c2, 'JSON.stringify(rt3dAuditApTypeReport())'));
  check(18.5, 'a patch IS still described as directional with the pathology',
    /DIRECTIONAL \(patch\/sector\)/.test(r2.verdict), r2.verdict);
}

// ============ 19  rack clearance is a capability proof ======================
{
  const ctx = sandbox();
  run(ctx, SCENE);
  run(ctx, `state.floors[0].rfObjects.push({id:'rk',x:0,y:0,width:2,depth:2,height:0.6,
    rotation:0, materialId:state.materials[4].id, extraLossDb:0});`);
  const rec = JSON.parse(run(ctx, `JSON.stringify((function(){
    var ps=rt3dAuditResolveProbes({ spec: rt3dGridSpec(state.floors[0]) });
    var p=ps.probes.find(function(x){return x.id==='rackOverhead';});
    return p.resolved ? rt3dAuditProbeRecord(p) : null;
  })())`));
  const html = rec ? run(ctx, 'rt3dAuditProbeTableHtml(rt3dAuditProbeRecord('
    + 'rt3dAuditResolveProbes({ spec: rt3dGridSpec(state.floors[0]) })'
    + '.probes.find(function(x){return x.id===\'rackOverhead\';})))') : 'UNRESOLVED';
  check(19.0, 'the above-rack probe resolves on this scene', rec !== null, 'rack probe did not resolve');
  check(19, 'the rack block is labelled a GEOMETRY CAPABILITY PROOF',
    /GEOMETRY CAPABILITY PROOF/.test(html), 'capability label missing');
  check(19.5, 'and states it is NOT evidence for the cell delta',
    /NOT\s+evidence for this cell/i.test(html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ')),
    'the caveat is missing');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { failures.forEach(f => console.log('  - ' + f)); process.exit(1); }