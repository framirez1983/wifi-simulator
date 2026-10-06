// Stage 6.5e: the geometry-only Ceiling rule, and the rack-clearance geometry.
//
// Both exist because a previous result was the wrong KIND of evidence:
//   * the slab Opening rule read `outer` instead of canonical `points`, so a valid
//     Opening was reported as unusable;
//   * the Ceiling rule required a NAME, so on a project with unnamed Ceiling Areas
//     the audit would have concluded "no Ceiling Area" when Ceilings plainly existed.
//     An unnamed Ceiling still attenuates RF, so it must still be findable.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeDom, run } from './loader.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, '..', '..', 'index.html'), 'utf8')
  .match(/<script>\n([\s\S]*?)\n<\/script>/)[1];

let pass = 0, fail = 0;
const failures = [];
function check(id, name, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${String(id).padStart(3)}. ${name}`); }
  else {
    fail++; failures.push(`${id}. ${name}${detail ? ' :: ' + detail : ''}`);
    console.log(`  FAIL ${String(id).padStart(3)}. ${name}${detail ? ' :: ' + detail : ''}`);
  }
}
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
const ROOM = `
  state=freshState(); state.floors.length=1;
  var f=state.floors[0];
  f.name='PB'; f.w=16; f.d=10; f.height=3.2; f.ceilingAreas=[]; f.pillars=[];
  f.walls=[]; f.rfObjects=[]; f.openings=[];
  var W=8,H=5,pts=[[-W,-H],[W,-H],[W,H],[-W,H]];
  for(var i=0;i<4;i++){var a=pts[i],b=pts[(i+1)%4];
    f.walls.push({id:'w'+i,x1:a[0],y1:a[1],x2:b[0],y2:b[1],materialId:state.materials[2].id,
                  thickness:DEFAULT_WALL_THICKNESS_M});}
  var ap=makeAP(-5,0,'AP-PB',3.2); ap.mount=2.6; ap.mountType='ceiling';
  ap.antenna={type:'omni',az:0,tilt:0,gain:3}; f.aps=[ap];
  state.activeFloor=0;
`;
// A valid Ceiling Area carrying NO name: the exact shape that previously produced
// the false conclusion "this project has no Ceiling Area".
const UNNAMED_CEILING = `
  state.floors[0].ceilingAreas.push({id:'cl1', height:2.9, thickness:0.10,
    materialId:state.materials[2].id, extraLossDb:0,
    footprint:{parts:[{outer:[{x:-5,y:-3},{x:5,y:-3},{x:5,y:3},{x:-5,y:3}],holes:[]}]}});
`;
const RACK = `
  state.floors[0].rfObjects.push({id:'rk',x:0,y:0,width:1.2,depth:1.0,height:1.1,
    rotation:0, materialId:state.materials[4].id, extraLossDb:2});
`;
console.log('Stage 6.5e geometry-only Ceiling rule and rack clearance\n');

// ============ 1..6  geometry-only Ceiling ====================================
{
  const ctx = sandbox();
  run(ctx, ROOM);
  run(ctx, UNNAMED_CEILING);
  const ps = JSON.parse(run(ctx, 'JSON.stringify(rt3dAuditResolveProbes({}))'));
  const named = ps.probes.find(p => p.id === 'namedCeiling');
  const geo = ps.probes.find(p => p.id === 'ceilingGeometry');

  check(1, 'the named rule still refuses an unnamed Ceiling', named.resolved === false,
    String(named.resolved));
  check(2, 'the geometry-only rule RESOLVES the same unnamed Ceiling',
    geo.resolved === true, JSON.stringify(geo.reason));
  check(3, 'the two rules are reported as separate probes, never merged',
    ps.probes.filter(p => p.id === 'namedCeiling' || p.id === 'ceilingGeometry').length === 2);
  check(4, 'the geometry-only probe carries the ring and ceiling Z it used',
    geo.ringPoints === 4 && Math.abs(geo.ceilingAbsZ - 2.9) < 1e-6,
    JSON.stringify({ r: geo.ringPoints, z: geo.ceilingAbsZ }));
  check(5, 'the divergence is classified as a resolver/NAME limitation, not a missing Ceiling',
    /resolver\/name limitation/.test(geo.nameLimitation || '') &&
    /does have a Ceiling/.test(geo.nameLimitation || ''), String(geo.nameLimitation));
  check(6, 'a NAMED Ceiling resolves under BOTH rules, and no limitation is claimed',
    (() => {
      run(ctx, "state.floors[0].ceilingAreas[0].name='Cuarto Oscuro';");
      const p2 = JSON.parse(run(ctx, 'JSON.stringify(rt3dAuditResolveProbes({}))'));
      const n2 = p2.probes.find(p => p.id === 'namedCeiling');
      const g2 = p2.probes.find(p => p.id === 'ceilingGeometry');
      return n2.resolved === true && g2.resolved === true &&
             (g2.nameLimitation === null || g2.nameLimitation === undefined);
    })(), 'a named Ceiling was not reachable by both rules');
}

// ============ 7..10  the geometry rule refuses honestly ======================
{
  const ctx = sandbox();
  run(ctx, ROOM);
  const ps = JSON.parse(run(ctx, 'JSON.stringify(rt3dAuditResolveProbes({}))'));
  const geo = ps.probes.find(p => p.id === 'ceilingGeometry');
  check(7, 'with no Ceiling at all the geometry rule refuses and says so',
    geo.resolved === false && /no Ceiling Area/.test(geo.reason), String(geo.reason));
  check(8, 'an unusable footprint is refused with the real reason',
    (() => {
      run(ctx, `state.floors[0].ceilingAreas.push({id:'bad',height:2.9,thickness:0.1,
        materialId:state.materials[2].id,extraLossDb:0, footprint:{parts:[{outer:[],holes:[]}]}});`);
      const p2 = JSON.parse(run(ctx, 'JSON.stringify(rt3dAuditResolveProbes({}))'));
      const g2 = p2.probes.find(p => p.id === 'ceilingGeometry');
      return g2.resolved === false && /usable (canonical plan|ring)/.test(String(g2.reason));
    })());
  check(9, 'a Ceiling entirely BELOW the receiver plane is refused, not probed',
    (() => {
      run(ctx, `state.floors[0].ceilingAreas=[];
        state.floors[0].ceilingAreas.push({id:'low',height:0.4,thickness:0.1,
          materialId:state.materials[2].id,extraLossDb:0,
          footprint:{parts:[{outer:[{x:-5,y:-3},{x:5,y:-3},{x:5,y:3},{x:-5,y:3}],holes:[]}]}});`);
      const g = JSON.parse(run(ctx, 'JSON.stringify(rt3dAuditCeilingGeometryProbe())'));
      return g.resolved === false && /at or below the receiver plane/.test(String(g.reason));
    })(), 'a Ceiling below the receiver was still probed');
  check(10, 'no Ceiling Area is renamed or mutated by any of this',
    run(ctx, 'JSON.stringify(state.floors[0].ceilingAreas.map(function(c){return c.name===undefined?"undefined":c.name;}))')
      === JSON.stringify(['undefined']));
}

// ============ 11..16  rack clearance ========================================
{
  const ctx = sandbox();
  run(ctx, ROOM);
  run(ctx, RACK);
  const clear = JSON.parse(run(ctx, `JSON.stringify(rt3dAuditRackClearance(
    rt3dBuildWorld(), {x:4, y:0, z:floorElevation(0)+receiverHeight()},
    { sources: rt3dCoverageSources() }))`));
  const p = clear.paths[0];
  check(11, 'AP Z and receiver Z are both reported',
    Number.isFinite(p.apZ) && Number.isFinite(p.receiverZ) &&
    p.apZ > p.receiverZ, JSON.stringify({ apZ: p.apZ, rxZ: p.receiverZ }));
  check(12, 'the RF Object Z interval is reported in absolute metres',
    p.rfObjectZIntervalAbsM[0] === 0 &&
    Math.abs(p.rfObjectZIntervalAbsM[1] - 1.1) < 1e-6,
    JSON.stringify(p.rfObjectZIntervalAbsM));
  check(13, 'the path Z over the rack footprint is computed, not assumed',
    Array.isArray(p.pathZRangeOverFootprintM) &&
    p.pathZRangeOverFootprintM.length === 2, JSON.stringify(p.pathZRangeOverFootprintM));
  check(14, 'a path that stays above the rack Z interval is reported as clearing it',
    p.footprintCrossedInPlan === true && p.clearsAboveRfObject === true &&
    p.pathEntersRfObjectZInterval === false,
    JSON.stringify({ crossed: p.footprintCrossedInPlan, clears: p.clearsAboveRfObject }));
  check(15, 'RT3D charged NOTHING for a rack the path clears',
    p.rt3dRfObjectLossChargedDb === 0 && p.kernelProducedEvent === false,
    JSON.stringify({ dB: p.rt3dRfObjectLossChargedDb, ev: p.kernelProducedEvent }));
  // The analytic checker is ADVISORY and is a recorded defect (see
  // tools/rt3d/rackclear-fuzz.mjs: 6/400 cases where brute force sided with the
  // kernel). The kernel's own event on the exact bounded segment is the authority.
  check(16, 'the kernel is the authority, and the analytic check is flagged advisory',
    p.geometryAgreesWithKernel === false &&
    p.rt3dBodyEvent.producedEvent === false &&
    p.analyticChecker.knownWrong === true,
    JSON.stringify({ agree: p.geometryAgreesWithKernel, ev: p.rt3dBodyEvent }));
}
{
  // the same rack, with a receiver low enough that the path MUST cross it
  const ctx = sandbox();
  run(ctx, ROOM);
  // a TALL rack: with a 1.1 m rack even a floor-level receiver clears it, because
  // the path is still ~1.2 m up where it crosses. The rack has to be tall enough to
  // be entered before this test can mean anything.
  run(ctx, `state.floors[0].rfObjects.push({id:'rkTall',x:0,y:0,width:1.2,depth:1.0,
    height:2.0, rotation:0, materialId:state.materials[4].id, extraLossDb:2});`);
  const clear = JSON.parse(run(ctx, `JSON.stringify(rt3dAuditRackClearance(
    rt3dBuildWorld(), {x:4, y:0, z:0.3}, { sources: rt3dCoverageSources() }))`));
  const tall = clear.paths.find(p => p.rackId === 'rkTall');
  const p = tall || clear.paths[0];
  check(17, 'a low receiver that enters the rack Z interval is detected',
    p.footprintCrossedInPlan === true && p.pathEntersRfObjectZInterval === true &&
    p.clearsAboveRfObject === false,
    JSON.stringify({ enters: p.pathEntersRfObjectZInterval }));
  check(18, 'and RT3D charges the rack material for it',
    p.rt3dRfObjectLossChargedDb > 0 && p.kernelProducedEvent === true,
    JSON.stringify({ dB: p.rt3dRfObjectLossChargedDb }));
  check(19, 'the charged loss equals material plus the object extra loss',
    (() => {
      const mat = JSON.parse(run(ctx, 'JSON.stringify(state.materials[4].db)'));
      return Math.abs(p.rt3dRfObjectLossChargedDb - (mat + 2)) < 1e-6;
    })(), JSON.stringify(p.rt3dRfObjectLossChargedDb));
  check(20, 'the verdict text states the physical expectation',
    /physically expected/.test(p.verdict), p.verdict);
}
{
  // geometry the kernel and the analytic solution must disagree about is REPORTED
  const ctx = sandbox();
  run(ctx, ROOM);
  run(ctx, RACK);
  const r = JSON.parse(run(ctx, `JSON.stringify(rt3dAuditRackClearance(
    rt3dBuildWorld(), {x:-20, y:0, z:1.2}, { sources: rt3dCoverageSources() }))`));
  check(21, 'a probe far from the rack reports that the footprint is not crossed',
    r.paths[0].footprintCrossedInPlan === false &&
    /does not pass over this rack footprint/.test(r.paths[0].verdict),
    r.paths[0].verdict);
  check(22, 'no kernel event is reported where the footprint is not crossed',
    r.paths[0].rt3dBodyEvent.producedEvent === false &&
    r.paths[0].directCandidateTraversals.length === 0,
    JSON.stringify(r.paths[0].rt3dBodyEvent));
  check(22.5, 'the full per-path evidence the audit needs is present on every path',
    (() => {
      const q = r.paths[0];
      return q.rt3dBodyEvent && Array.isArray(q.directCandidateTraversals) &&
             q.directSegmentOriginXYZ && q.directSegmentTargetXYZ &&
             q.analyticChecker && Number.isFinite(q.rt3dRfObjectLossChargedDb);
    })(), 'a required evidence field is missing');
}

// ============ 23..26  classification is never driven by dB magnitude =========
{
  const ctx = sandbox();
  run(ctx, ROOM);
  run(ctx, RACK);
  const huge = JSON.parse(run(ctx, `JSON.stringify((function(){
    var p=rt3dAuditProbeAt(4,0,{world:rt3dBuildWorld()});
    p.comparison.legacyStoredDbm=-40; p.comparison.deltaDb=-120;  // enormous
    return rt3dAuditClassifyDisagreement(p);
  })())`));
  check(23, 'an enormous difference is NOT called an RT3D implementation bug',
    huge.classification !== 'RT3D IMPLEMENTATION BUG', huge.classification);
  check(24, 'an enormous unexplained difference is PHYSICALLY UNRESOLVED',
    huge.classification === 'PHYSICALLY UNRESOLVED', huge.classification);
  const inv = JSON.parse(run(ctx, `JSON.stringify((function(){
    var p=rt3dAuditProbeAt(4,0,{world:rt3dBuildWorld()});
    p.comparison.legacyStoredDbm=-40; p.comparison.deltaDb=-0.2;   // tiny
    p.comparison.canonicalMatchesAuditProbe=false;                 // but invariant fails
    return rt3dAuditClassifyDisagreement(p);
  })())`));
  check(25, 'a TINY difference with a failed invariant IS an RT3D implementation bug',
    inv.classification === 'RT3D IMPLEMENTATION BUG', inv.classification);
  check(26, 'the bug verdict cites the invariant, not the magnitude',
    /invariant/.test(String(inv.evidence)) || /invariant/.test(String(inv.reason)) ||
    /canonical coverage value/.test(String(inv.evidence)),
    JSON.stringify(inv.evidence));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { failures.forEach(f => console.log('  - ' + f)); process.exit(1); }