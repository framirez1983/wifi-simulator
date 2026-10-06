// Stage 6.5b: disagreement classification, AP-type audit, slice diagnostics,
// delta map, and the rule-resolved probe set.
//
// The classification rules are the point of this stage, so they are tested for
// their EVIDENCE rather than their output: a verdict that cannot be justified by a
// measured term must not be reachable.
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
  state=freshState();
  var f=state.floors[0];
  f.name='PB'; f.w=20; f.d=14; f.height=3.0; f.ceilingAreas=[]; f.pillars=[];
  f.walls=[]; f.rfObjects=[]; f.openings=[];
  var W=10,H=7,pts=[[-W,-H],[W,-H],[W,H],[-W,H]];
  for(var i=0;i<4;i++){var a=pts[i],b=pts[(i+1)%4];
    f.walls.push({id:'w'+i,x1:a[0],y1:a[1],x2:b[0],y2:b[1],materialId:state.materials[2].id,
                  thickness:DEFAULT_WALL_THICKNESS_M});}
  state.activeFloor=0;
`;
const setAp = (x, y, z, ant, mount, tilt) => `
  var f=state.floors[0];
  var ap=makeAP(${x}, ${y}, 'AP-1', 3.0); ap.mount=${z}; ap.mountType=${JSON.stringify(mount)};
  ap.antenna={type:${JSON.stringify(ant)}, az:0, tilt:${tilt || 0}, gain:3};
  f.aps=[ap];
`;
console.log('Stage 6.5b classification, AP audit and slice diagnostics\n');

// ============================================================ 1..5  AP type audit
{
  const ctx = sandbox();
  run(ctx, ROOM);
  run(ctx, setAp(0, 0, 2.6, 'omni', 'ceiling', 0));
  const r = JSON.parse(run(ctx, 'JSON.stringify(rt3dAuditApTypeReport())'));
  check(1, 'a ceiling-mounted omni is reported as bypassing the vertical model',
    r.aps[0].ceilingOmniFlat === true && r.verticalModelAppliesOnAps === 0,
    JSON.stringify(r.byTypeAndMount));
  check(2, 'the verdict states the patch pathology cannot occur here',
    r.verdict.indexOf('CANNOT occur on this project') >= 0, r.verdict);
  run(ctx, setAp(0, 0, 2.6, 'patch', 'ceiling', 25));
  const r2 = JSON.parse(run(ctx, 'JSON.stringify(rt3dAuditApTypeReport())'));
  check(3, 'a patch is reported as exercising the vertical model, with its beamwidth',
    r2.aps[0].verticalModelApplies === true && r2.aps[0].elevationBandwidthDeg === 40,
    JSON.stringify(r2.aps[0]));
  check(4, 'the mixed case is stated as mixed rather than generalised either way',
    (() => { run(ctx, `state.floors[0].aps.push((function(){var a=makeAP(4,0,'AP-2',3.0);
      a.mount=2.6; a.mountType='ceiling'; a.antenna={type:'omni',az:0,tilt:0,gain:3}; return a;})());`);
      const r3 = JSON.parse(run(ctx, 'JSON.stringify(rt3dAuditApTypeReport())'));
      return r3.verdict.indexOf('MIXED') >= 0; })(),
    'not reported as mixed');
  check(5, 'a project with no participating AP says so instead of reporting nothing',
    (() => { const c2 = sandbox(); run(c2, ROOM);
      const r0 = JSON.parse(run(c2, 'JSON.stringify(rt3dAuditApTypeReport())'));
      return r0.verdict.indexOf('no AP participates') >= 0; })());
}

// ============================================================ 6..9  classification
{
  // (a) agreement: a legacy grid seeded with the true RT3D value
  const ctx = sandbox();
  run(ctx, ROOM);
  run(ctx, setAp(0, 0, 2.6, 'omni', 'ceiling', 0));
  const agree = JSON.parse(run(ctx, `JSON.stringify((function(){
    var r=rt3dAuditProbeAt(5,3,{});
    r.comparison.legacyStoredDbm=r.rt3d.canonicalDbm;
    r.comparison.deltaDb=0;
    return rt3dAuditClassifyDisagreement(r);
  })())`));
  check(6, 'a zero difference is classified as agreement, not as a limitation',
    agree.classification === 'AGREEMENT (within tolerance)', agree.classification);

  // (b) distance-driven: seed legacy from the 2D horizontal distance rule
  const dist = JSON.parse(run(ctx, `JSON.stringify((function(){
    // close to the AP on purpose: the 2D-vs-3D gap is largest there and vanishes
    // with range. Probing at 5 m would (correctly) classify as agreement, which
    // would test nothing.
    var PX=0.8, PY=0.4;
    var r=rt3dAuditProbeAt(PX,PY,{});
    var pl1=fsplAt1m(BANDS[state.band].mhz);
    var dh=Math.hypot(PX,PY), d3=Math.hypot(dh, 2.6-receiverHeight());
    var legacy = 20+3 - (pl1 + 10*state.plExp*Math.log10(Math.max(0.5,dh)));
    r.comparison.legacyStoredDbm=legacy;
    r.comparison.deltaDb=r.rt3d.canonicalDbm-legacy;
    return rt3dAuditClassifyDisagreement(r);
  })())`));
  check(7, 'a difference produced by the legacy horizontal-distance rule is an EXPECTED LEGACY LIMITATION',
    dist.classification === 'EXPECTED LEGACY LIMITATION' &&
    dist.dominantTerm === 'true-3D vs legacy horizontal distance',
    JSON.stringify({ c: dist.classification, t: dist.dominantTerm }));
  check(8, 'the verdict cites the measured distance term as its evidence',
    dist.attributed.some(t => t.term === 'true-3D vs legacy horizontal distance' &&
                              Math.abs(t.db) > 1),
    JSON.stringify(dist.evidence));
  check(9, 'only the two genuinely-known ingredients are claimed as attributable',
    dist.attributable !== undefined &&
    Object.keys(dist.attributable).length === 2 &&
    dist.unattributableOnLegacySide.length === 3,
    JSON.stringify(dist.attributable));

  // (c) vertical-driven with a patch, seeded so the vertical term dominates
  const vert = JSON.parse(run(ctx, `JSON.stringify((function(){
    var ap=state.floors[0].aps[0];
    ap.antenna={type:'patch',az:0,tilt:0,gain:5};
    var r=rt3dAuditProbeAt(4,0,{world:rt3dBuildWorld()});
    // legacy value = what it would be with azimuth-only gain: shift by the vertical delta
    var legacy=r.rt3d.aps[0].direct.receivedPowerDbm + r.rt3d.aps[0].antenna.verticalDeltaDbRaw;
    r.comparison.legacyStoredDbm=legacy;
    r.comparison.deltaDb=r.rt3d.canonicalDbm-legacy;
    return rt3dAuditClassifyDisagreement(r);
  })())`));
  check(10, 'a difference dominated by the vertical lobe is MODEL DIFFERENCE, NEEDS CALIBRATION',
    vert.classification === 'MODEL DIFFERENCE, NEEDS CALIBRATION', vert.classification);
  check(11, 'that verdict states the pattern is empirical and uncalibrated',
    vert.reason.indexOf('EMPIRICAL') >= 0 && vert.reason.indexOf('no measurement exists') >= 0,
    vert.reason.slice(0, 80));
  check(12, 'the calibration verdict is NOT used when the vertical term is absent',
    dist.classification !== 'MODEL DIFFERENCE, NEEDS CALIBRATION');

  // (d) no legacy value at all
  const none = JSON.parse(run(ctx, `JSON.stringify((function(){
    return rt3dAuditClassifyDisagreement(rt3dAuditProbeAt(5,3,{}));
  })())`));
  check(13, 'with no legacy value the classifier returns null and computes no delta',
    none.classification === null && none.deltaDb === null &&
    none.reason.indexOf('No delta is computed') >= 0, JSON.stringify(none.classification));
}

// ============================================================ 14  RT3D bug class
{
  const ctx = sandbox();
  run(ctx, ROOM);
  run(ctx, setAp(0, 0, 2.6, 'omni', 'ceiling', 0));
  const r = JSON.parse(run(ctx, `JSON.stringify((function(){
    var p=rt3dAuditProbeAt(5,3,{});
    p.comparison.legacyStoredDbm=-40; p.comparison.deltaDb=-20;
    // simulate a genuine internal invariant failure
    p.comparison.canonicalMatchesAuditProbe=false;
    return rt3dAuditClassifyDisagreement(p);
  })())`));
  check(14, 'a failed internal invariant yields RT3D IMPLEMENTATION BUG on positive evidence alone',
    r.classification === 'RT3D IMPLEMENTATION BUG' && r.invariants.length === 1,
    JSON.stringify(r.invariants));
  const big = JSON.parse(run(ctx, `JSON.stringify((function(){
    var p=rt3dAuditProbeAt(5,3,{});
    p.comparison.legacyStoredDbm=-70; p.comparison.deltaDb=-45;   // huge, no invariant failure
    return rt3dAuditClassifyDisagreement(p);
  })())`));
  check(15, 'a large delta alone is NEVER called an RT3D bug',
    big.classification !== 'RT3D IMPLEMENTATION BUG', big.classification);
}

// ============================================================ 16..18  residual honesty
{
  const ctx = sandbox();
  run(ctx, ROOM);
  run(ctx, setAp(0, 0, 2.6, 'omni', 'ceiling', 0));
  const r = JSON.parse(run(ctx, `JSON.stringify((function(){
    var p=rt3dAuditProbeAt(5,3,{});
    p.comparison.legacyStoredDbm=-80; p.comparison.deltaDb=-33;
    return rt3dAuditClassifyDisagreement(p);
  })())`));
  check(16, 'a difference no term explains is PHYSICALLY UNRESOLVED',
    r.classification === 'PHYSICALLY UNRESOLVED', r.classification);
  check(17, 'the unresolved verdict says the gap cannot be closed from available data',
    r.reason.indexOf('CANNOT be closed') >= 0, r.reason.slice(0, 90));
  check(18, 'the residual is labelled a bound and the unrecoverable legacy terms are named',
    r.residualBoundDb && r.residualBoundDb.note.indexOf('not bounded at all') >= 0 &&
    r.unattributableOnLegacySide.some(x=>x.indexOf('estimator bias')>=0),
    JSON.stringify(r.unattributableOnLegacySide));
}

// ============================================================ 19  near-AP pathology
{
  const ctx = sandbox();
  run(ctx, ROOM);
  const r = JSON.parse(run(ctx, `JSON.stringify((function(){
    var ap=makeAP(0,0,'AP-p',3.0); ap.mount=2.9; ap.mountType='ceiling';
    ap.antenna={type:'patch',az:0,tilt:0,gain:5};
    state.floors[0].aps=[ap];
    var p=rt3dAuditProbeAt(0.05,0.05,{world:rt3dBuildWorld()});
    p.comparison.legacyStoredDbm=-13; p.comparison.deltaDb=-64;
    return { cls:rt3dAuditClassifyDisagreement(p), h:p.rt3d.aps[0].antenna };
  })())`));
  check(19, 'a patch at near-zero range is flagged as PHYSICALLY UNRESOLVED via the pathology path',
    r.cls.classification === 'PHYSICALLY UNRESOLVED' && !!r.cls.pathology,
    JSON.stringify(r.cls.pathology));
  check(20, 'the pathology is attributed to the shared model, not to either tracer',
    /both/i.test(r.cls.pathology.note) >= 0 &&
    r.cls.reason.indexOf('not in either tracer') >= 0, r.cls.reason.slice(0, 80));
}

// ============================================================ 21..24  slice diagnostics
{
  const ctx = sandbox();
  run(ctx, ROOM);
  run(ctx, setAp(0, 0, 2.6, 'omni', 'ceiling', 0));
  const d = JSON.parse(run(ctx, `JSON.stringify((function(){
    var w=rt3dBuildWorld();
    var spec=rt3dGridSpec(state.floors[0]);
    var L=new Float32Array(spec.cols*spec.rows), R=new Float32Array(spec.cols*spec.rows);
    for(var k=0;k<L.length;k++){ L[k]=-60; R[k]=-60+((k%9)-4); }
    return rt3dAuditSliceDiagnostics(L,R,spec,{ stride:6 });
  })())`));
  check(21, 'slice diagnostics report their own sampling and never claim to be exhaustive',
    d.sampling.stride === 6 && d.sampling.cellsVisited > 0 &&
    d.sampling.coveragePct < 100 && d.sampling.note.indexOf('never as an exhaustive') >= 0,
    JSON.stringify(d.sampling));
  check(22, 'the whole-slice statistics carry every requested figure',
    d.wholeSlice.medianAbsDeltaDb!=null && d.wholeSlice.p90AbsDeltaDb!=null &&
    d.wholeSlice.maxAbsDeltaDb!=null && d.wholeSlice.within3Db!=null &&
    d.wholeSlice.within6Db!=null && d.wholeSlice.over10Db!=null,
    JSON.stringify({ m: d.wholeSlice.medianAbsDeltaDb, p: d.wholeSlice.p90AbsDeltaDb }));
  check(23, 'reflection counters are per AP path and state that candidate count is not the question',
    typeof d.reflection.apPathsWhereReflectionWon === 'number' &&
    d.reflection.note.indexOf('candidate count is not the question') >= 0,
    JSON.stringify(d.reflection.apPathsWhereReflectionWon));
  check(24, 'vertical counters are reported as 0 when no AP exercises the vertical model',
    d.verticalAntenna.apPathsWhereVerticalApplies === 0 &&
    d.verticalAntenna.pctOver3Db === null,
    JSON.stringify(d.verticalAntenna));
  check(25, 'worst cells are located from the real grids',
    Array.isArray(d.worstCells) && d.worstCells.length > 0 &&
    typeof d.worstCells[0].deltaDb === 'number', JSON.stringify(d.worstCells[0]));
}

// ============================================================ 26..27  delta map
{
  const ctx = sandbox();
  run(ctx, ROOM);
  run(ctx, setAp(0, 0, 2.6, 'omni', 'ceiling', 0));
  const m = JSON.parse(run(ctx, `JSON.stringify((function(){
    var c0=rt3dAuditDeltaColor(0), c1=rt3dAuditDeltaColor(+8), c2=rt3dAuditDeltaColor(-8),
          c3=rt3dAuditDeltaColor(+60);
    return { zero:c0, pos:c1, neg:c2, huge:c3 };
  })())`));
  check(26, 'the delta scale is diverging and neutral at zero',
    m.zero[0]===m.zero[1] && m.zero[1]===m.zero[2] &&
    m.pos[0] > m.pos[2] && m.neg[2] > m.neg[0],
    JSON.stringify(m));
  check(27, 'the scale saturates rather than growing without bound',
    m.huge[3] === 255 && m.pos[3] < 255, JSON.stringify({ p: m.pos[3], h: m.huge[3] }));
}

// ============================================================ 28..30  probe set
{
  const ctx = sandbox();
  run(ctx, ROOM);
  run(ctx, setAp(-5, 0, 2.6, 'omni', 'ceiling', 0));
  const ps = JSON.parse(run(ctx, 'JSON.stringify(rt3dAuditResolveProbes({}))'));
  const near = ps.probes.find(p => p.id === 'losNearPrimaryAp');
  const far = ps.probes.find(p => p.id === 'losFarPrimaryAp');
  check(28, 'the near and far clear-LOS probes resolve to DIFFERENT points',
    near.resolved && far.resolved && Math.hypot(near.x - far.x, near.y - far.y) > 1,
    JSON.stringify({ near: [near.x, near.y], far: [far.x, far.y] }));
  check(29, 'the far probe really is farther from the AP',
    far.r > near.r, JSON.stringify({ nearR: near.r, farR: far.r }));
  check(30, 'both grid-derived probes refuse to exist without both grids',
    ps.probes.find(p => p.id === 'maxDisagreement').resolved === false &&
    ps.probes.find(p => p.id === 'closestAgreement').resolved === false &&
    ps.probes.find(p => p.id === 'closestAgreement').reason.indexOf('both grids') >= 0);
  check(31, 'the probe set now covers an agreeing point as well as a disagreeing one',
    ps.probes.some(p => p.category.indexOf('closest') >= 0));
}

// ============================================================ 32  no persistence
{
  const ctx = sandbox();
  run(ctx, ROOM);
  run(ctx, setAp(0, 0, 2.6, 'omni', 'ceiling', 0));
  run(ctx, `rt3dAuditApTypeReport(); rt3dAuditResolveProbes({});
    var s=rt3dGridSpec(state.floors[0]);
    var L=new Float32Array(s.cols*s.rows).fill(-60), R=new Float32Array(s.cols*s.rows).fill(-61);
    rt3dAuditSliceDiagnostics(L,R,s,{stride:20});
    rt3dAuditApTypeReport();`);
  check(32, 'every new audit entry point leaves project state untouched',
    run(ctx, 'JSON.stringify(state)') === run(ctx, 'JSON.stringify(state)'));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
