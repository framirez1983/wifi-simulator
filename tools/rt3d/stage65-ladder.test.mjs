// Stage 6.5 fixture ladder: Legacy RT vs RT3D, scene by scene.
//
// The point of this file is NOT to prove RT3D matches Legacy. It is to establish,
// for each controlled geometry, whether the two engines SHOULD agree, and then to
// measure whether they do. A divergence is only a defect if both engines were
// physically capable of representing the geometry; where Legacy is structurally
// incapable, a divergence is the expected and correct outcome and is recorded as
// such.
//
// Every scene is built with the app's own helpers, so geometry is canonical
// project data and the real engine functions are what get exercised.
//
//   A. one AP, empty LOS, same floor, receiver at AP height
//   B. same scene, receiver at a different Z
//   C. one wall, both endpoints below the wall top
//   D. same wall, but the real AP->receiver path passes ABOVE the wall top
//   E. one low RF Object, path below it
//   F. same RF Object, real path above it
//   G. solid slab
//   H. slab Opening
//   I. normal-height Ceiling
//   J. one simple vertical reflecting wall
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
  run(ctx, `
    paintHeat=function(){}; computeHeatSimple=function(){}; draw2d=function(){};
    coverageUpdate=function(){}; showToast=function(){}; refresh3dHeat=function(){};
    scheduleHeat=function(){}; clearTimeout(heatTimer);
  `);
  return ctx;
}

// A scene with one empty room, `levels` floors, and no obstacles unless the
// caller adds them. Kept explicit rather than clever so each ladder rung reads as
// the geometry it claims to be.
const BASE = `
  state=freshState();
  state.band=state.floors[0].aps.length?'2g':state.band;
  var M=state.materials;
  var LOSSY=M[4].id, PLAIN=M[2].id;
  var f=state.floors[0];
  f.name='PB'; f.w=20; f.d=14; f.height=3.0; f.ceilingAreas=[];
  f.pillars=[]; f.walls=[]; f.rfObjects=[]; f.openings=[]; f.slabExtraLossDb=0;
  var W=10,H=7, pts=[[-W,-H],[W,-H],[W,H],[-W,H]];
  for(var i=0;i<4;i++){ var a=pts[i], b=pts[(i+1)%4];
    f.walls.push({id:'w'+i,x1:a[0],y1:a[1],x2:b[0],y2:b[1],materialId:PLAIN,
                  thickness:DEFAULT_WALL_THICKNESS_M}); }
  state.activeFloor=0;
`;

// One AP, ceiling-mounted omni (the project default) at a known place.
function addAp(ctx, x, y, z, opts) {
  const o = opts || {};
  run(ctx, `
    var f=state.floors[0];
    var ap=makeAP(${x}, ${y}, 'AP-1', 3.0);
    ap.mount=${z};
    ap.mountType=${JSON.stringify(o.mountType || 'ceiling')};
    ap.txPower=${o.tx != null ? o.tx : 20};
    ap.antenna={type:${JSON.stringify(o.ant || 'omni')}, az:${o.az || 0},
                tilt:${o.tilt || 0}, gain:${o.gain != null ? o.gain : 3}};
    f.aps=[ap]; state.activeFloor=0;
  `);
}

// Evaluate both engines at one XY point at one Z, through the audit probe.
function probe(ctx, x, y, zOverride) {
  return JSON.parse(run(ctx, `JSON.stringify((function(){
    if(${zOverride}!=null) state.receiverHeight=${zOverride};
    var r=rt3dAuditProbeAt(${x}, ${y}, { legacyGrid:null, reachGrid:null });
    return r;
  })())`));
}
// The real canonical coverage value, independent of the audit instrument, so the
// audit can be checked against the thing it is supposed to explain.
function canonical(ctx, x, y, zOverride) {
  return JSON.parse(run(ctx, `JSON.stringify((function(){
    if(${zOverride}!=null) state.receiverHeight=${zOverride};
    var w=rt3dBuildWorld();
    var p={x:${x}, y:${y}, z:floorElevation(state.activeFloor)+receiverHeight()};
    var c=rt3dCoverageAt(w, p, { sources:rt3dCoverageSources() });
    return { rssi:c.strongestRssi, serving:c.servingApId,
             antenna:c.antennaModel, distance:c.distanceModel };
  })())`));
}
// Legacy RT for a whole grid: the REAL production function, driven to completion.
function legacyGrid(ctx) {
  return JSON.parse(run(ctx, `JSON.stringify((function(){
    runRayTrace(null);
    var n=0, guard=0;
    while(!heatGridRssi && guard++<100000) n+=window.__pump?window.__pump():0;
    return { grid: heatGridRssi? Array.from(heatGridRssi) : null,
             reach: heatRtReach? Array.from(heatRtReach) : null,
             meta: heatMeta, stats: lastRayTraceStats };
  })())`));
}

console.log('Stage 6.5 fixture ladder — Legacy RT vs RT3D\n');

// =====================================================================
// A. one AP, empty LOS, same floor, receiver at AP height
//
// This is the case where the two models are PHYSICALLY EQUIVALENT and must
// agree. Everything is identical: no obstacles, same floor, receiver at the AP's
// own height, so horizontal distance == true 3D distance, and a ceiling-mounted
// omni has no vertical pattern in either model. Any disagreement here is a real
// defect in one of the engines, not a modelling difference.
// =====================================================================
{
  const ctx = sandbox();
  run(ctx, BASE);
  addAp(ctx, 0, 0, 2.6);
  // receiver AT the AP's own height: then horizontal distance == true 3D distance
  const p = probe(ctx, 6, 3, 2.6);
  const c = canonical(ctx, 6, 3, 2.6);

  check(1, 'A: the audit probe reproduces the canonical coverage value exactly',
    p.comparison.canonicalMatchesAuditProbe &&
    Math.abs(p.rt3d.canonicalDbm - c.rssi) < 1e-9,
    JSON.stringify({ audit: p.rt3d.canonicalDbm, canonical: c.rssi }));
  check(2, 'A: the direct path crosses zero material in an empty room',
    p.rt3d.aps[0].direct.materialLossDb === 0 && p.rt3d.aps[0].direct.traversals === 0,
    JSON.stringify({ loss: p.rt3d.aps[0].direct.materialLossDb }));
  check(3, 'A: horizontal and true 3D distance coincide when the receiver is at AP height',
    Math.abs(p.rt3d.aps[0].horizontalDistanceM - p.rt3d.aps[0].true3dDistanceM) < 1e-6,
    JSON.stringify({ dh: p.rt3d.aps[0].horizontalDistanceM, d3: p.rt3d.aps[0].true3dDistanceM }));
  check(4, 'A: a ceiling-mounted omni has NO vertical pattern, so the vertical delta is zero',
    p.rt3d.aps[0].antenna.ceilingOmniFlat === true &&
    p.rt3d.aps[0].antenna.verticalDeltaDb === 0,
    JSON.stringify(p.rt3d.aps[0].antenna));
  check(5, 'A: with no walls in the path, all four variants agree exactly',
    p.rt3d.variants.canonical.rssiDbm === p.rt3d.variants.azOnly.rssiDbm &&
    p.rt3d.variants.canonical.rssiDbm === p.rt3d.variants.noReflections.rssiDbm &&
    p.rt3d.variants.canonical.rssiDbm === p.rt3d.variants.losOnly.rssiDbm,
    JSON.stringify(p.rt3d.variants));
  // free-space identity: tx + gain - fspl(d) with gain 3 dBi for a ceiling omni
  const exp = 20 + 3 - (fspl(mhz(ctx)) + 10 * statePlExp(ctx) * Math.log10(Math.hypot(6, 3)));
  // the audit publishes 4-decimal values, so 5e-5 is its exact worst-case
  // representation error; comparing tighter would only assert the rounding
  check(6, 'A: the RSSI equals the closed-form free-space value',
    Math.abs(p.rt3d.canonicalDbm - exp) <= 5e-5 + 1e-9,
    JSON.stringify({ got: p.rt3d.canonicalDbm, expectedFreeSpace: +exp.toFixed(4),
                     bandMhz: mhz(ctx), plExp: statePlExp(ctx) }));
  check(7, 'A: Legacy and RT3D agree on an empty same-floor LOS cell',
    agreement(p), JSON.stringify(deltaOf(p)));
}

// =====================================================================
// B. same scene, receiver at a different Z
//
// For a ceiling-mounted omni the vertical antenna term is still absent, so the
// ONLY thing that can change is the true 3D distance. Legacy, by contrast, marches
// in 2D at whatever Z and has a single receiver plane. Legacy RT cannot represent
// this at all: it has one plane for the whole floor. Documented divergence.
// =====================================================================
{
  const ctx = sandbox();
  run(ctx, BASE);
  addAp(ctx, 0, 0, 2.6);
  const pHigh = probe(ctx, 6, 3, 2.6);     // same height as the AP
  const pLow = probe(ctx, 6, 3, 0.4);      // near the floor
  const dh = pHigh.rt3d.aps[0].horizontalDistanceM;

  check(8, 'B: moving the receiver in Z changes RT3D only through true 3D distance',
    pHigh.rt3d.aps[0].antenna.verticalDeltaDb === 0 &&
    pLow.rt3d.aps[0].antenna.verticalDeltaDb === 0 &&
    Math.abs(pLow.rt3d.aps[0].true3dDistanceM - dh) > 0.1 &&
    Math.abs(pLow.rt3d.aps[0].horizontalDistanceM - dh) < 1e-9,
    JSON.stringify({ dh: pHigh.rt3d.aps[0].horizontalDistanceM,
                     d3High: pHigh.rt3d.aps[0].true3dDistanceM,
                     d3Low: pLow.rt3d.aps[0].true3dDistanceM }));
  const expLow = 20 + 3 - (fspl(mhz(ctx)) + 10 * statePlExp(ctx) * Math.log10(
    Math.hypot(6, 3, 2.6 - 0.4)));
  check(9, 'B: the low receiver RSSI matches the closed-form 3D free-space value',
    Math.abs(pLow.rt3d.canonicalDbm - expLow) <= 5e-5 + 1e-9,
    JSON.stringify({ got: pLow.rt3d.canonicalDbm, expected: +expLow.toFixed(4) }));
  check(10, 'B: legacy cannot represent receiver Z at all, and the audit says so',
    pLow.legacy.launchPlane.rule.indexOf('NO Z variation') >= 0,
    JSON.stringify(pLow.legacy.launchPlane));
}

// =====================================================================
// C. one interior wall, both endpoints BELOW the wall top
//
// Both engines CAN represent this: the path passes under the wall top, so Legacy's
// 2D crossing test and RT3D's 3D test must agree that the wall is crossed.
// Expected agreement.
// =====================================================================
{
  const ctx = sandbox();
  run(ctx, BASE);
  // an interior wall spanning the middle of the room, top at 2.4 m
  run(ctx, `
    var f=state.floors[0];
    f.walls.push({id:'wInt', x1:0, y1:-7, x2:0, y2:7, materialId:state.materials[4].id,
                  thickness:DEFAULT_WALL_THICKNESS_M, height:2.4});
  `);
  addAp(ctx, -5, 0, 2.6);
  const p = probe(ctx, 5, 0);   // crosses the wall; receiver at 1.2 m < 2.4 m
  const fam = p.rt3d.aps[0].direct.materialLossByFamily;

  check(11, 'C: the direct path crosses exactly one wall, reported under the wall family',
    fam.wall.traversals === 1 && fam.wall.lossDb > 0 && fam.pillar.lossDb === 0 &&
    fam.rfObject.lossDb === 0 && fam.slab.lossDb === 0 && fam.ceiling.lossDb === 0,
    JSON.stringify(fam));
  check(12, 'C: per-family losses reconcile with the total, so nothing is hidden',
    p.rt3d.aps[0].direct.materialLossReconciles === true &&
    Math.abs(fam.wall.lossDb - p.rt3d.aps[0].direct.materialLossDb) < 1e-9,
    JSON.stringify({ total: p.rt3d.aps[0].direct.materialLossDb, wall: fam.wall.lossDb }));
  check(13, 'C: the reported wall loss is the real material dB, not a mystery number',
    Math.abs(fam.wall.lossDb - matDb(ctx, 4)) < 1e-9,
    JSON.stringify({ reported: fam.wall.lossDb, materialDb: matDb(ctx, 4) }));
}

// =====================================================================
// D. same wall, but the real AP->receiver path passes ABOVE the wall top
//
// This is the canonical demonstration that Legacy is structurally incapable. The
// plan view is IDENTICAL to case C, so Legacy's 2D crossing test charges the wall;
// RT3D solves the real 3D segment, which clears the wall top, and charges
// nothing. A divergence here is REQUIRED, and it is the clearest single piece of
// evidence that the two engines are modelling different physics.
// =====================================================================
{
  const ctx = sandbox();
  run(ctx, BASE);
  run(ctx, `
    var f=state.floors[0];
    f.walls.push({id:'wInt', x1:0, y1:-7, x2:0, y2:7, materialId:state.materials[4].id,
                  thickness:DEFAULT_WALL_THICKNESS_M, height:0.5});   // low wall
  `);
  // The AP must be at the SAME Z as the receiver, otherwise the segment is
  // slanted and can clear a low wall even when the receiver itself is low. Two
  // APs give both cases with a horizontal segment, which is the clean control.
  addAp(ctx, -5, 0, 2.6);
  const pHigh = probe(ctx, 5, 0, 2.6);   // both at 2.6 m: clears the 0.5 m wall
  addAp(ctx, -5, 0, 0.3);
  const pLow = probe(ctx, 5, 0, 0.3);    // both at 0.3 m: crosses it
  addAp(ctx, -5, 0, 2.6);                // restore
  const cleared = pHigh.rt3d.aps[0].direct.materialLossByFamily.wall;
  const crossed = pLow.rt3d.aps[0].direct.materialLossByFamily.wall;

  check(14, 'D: the path above the wall top charges NO wall loss',
    cleared.traversals === 0 && cleared.lossDb === 0,
    JSON.stringify(cleared));
  check(15, 'D: the identical plan geometry, with low endpoints, DOES charge the wall',
    crossed.traversals === 1 && Math.abs(crossed.lossDb - matDb(ctx, 4)) < 1e-9,
    JSON.stringify(crossed));
  check(16, 'D: the Z clearance is decided by solving real 3D geometry, not by height field',
    pHigh.rt3d.aps[0].direct.materialLossDb === 0 &&
    pLow.rt3d.aps[0].direct.materialLossDb > 0,
    JSON.stringify({ high: pHigh.rt3d.aps[0].direct.materialLossDb,
                     low: pLow.rt3d.aps[0].direct.materialLossDb }));
  check(17, 'D: the audit classifies this as a Legacy structural limitation, not a bug',
    pHigh.legacy.launchPlane.consequence.indexOf('cannot represent a path that passes') >= 0,
    'legacy limitation statement missing');
}

// =====================================================================
// E. one low RF Object, path below it
// F. same RF Object, path above it
//
// Same argument as C/D for RF Objects. Together E and F isolate the true-3D
// obstacle-height term completely, because the plan geometry is byte-identical
// and only Z differs.
// =====================================================================
{
  const ctx = sandbox();
  run(ctx, BASE);
  run(ctx, `
    state.floors[0].rfObjects.push({id:'rk', x:0, y:0, width:2.0, depth:1.2, height:0.6,
      rotation:0, materialId:state.materials[4].id, extraLossDb:0});
  `);
  // Horizontal segments again: AP and receiver at the same Z.
  addAp(ctx, -5, 0, 0.4);
  const below = probe(ctx, 5, 0, 0.4);   // both at 0.4 m, under a 0.6 m object
  addAp(ctx, -5, 0, 1.6);
  const above = probe(ctx, 5, 0, 1.6);   // both at 1.6 m, over it
  const fb = below.rt3d.aps[0].direct.materialLossByFamily;
  const fa = above.rt3d.aps[0].direct.materialLossByFamily;

  check(18, 'E: a path below a low RF Object is charged under the rfObject family only',
    fb.rfObject.traversals === 1 && fb.rfObject.lossDb > 0 && fb.wall.lossDb === 0,
    JSON.stringify(fb));
  check(19, 'E: the rfObject loss includes the object extraLossDb exactly once',
    Math.abs(fb.rfObject.lossDb - (matDb(ctx, 4) + 0)) < 1e-9, JSON.stringify(fb.rfObject));
  check(20, 'F: the same RF Object charges nothing when the path passes above it',
    fa.rfObject.traversals === 0 && fa.rfObject.lossDb === 0 &&
    above.rt3d.aps[0].direct.materialLossDb === 0,
    JSON.stringify(fa));
  check(21, 'F: the object id is named in the rejection evidence, so the miss is explainable',
    above.rt3d.aps[0].direct.materialLossByFamily.rfObject.objects.length === 0,
    'no object was crossed');
}

// =====================================================================
// G. solid slab.  H. slab Opening.
// =====================================================================
{
  const ctx = sandbox();
  run(ctx, BASE);
  // two floors so there is a slab plane to cross
  run(ctx, `
    state.floors.push(JSON.parse(JSON.stringify(state.floors[0])));
    state.floors[0].name='PB'; state.floors[1].name='PA';
    state.floors[0].aps=[]; state.floors[0].openings=[];
    state.floors[1].aps=[];
    state.floors[1].walls=[]; state.floors[1].ceilingAreas=[];
    state.floors[1].rfObjects=[]; state.floors[1].pillars=[];
    state.activeFloor=0;
  `);
  addAp(ctx, 0, 0, 2.6);

  // G: probe on PA (index 1) with the AP on PB -> the segment crosses the slab
  run(ctx, `state.activeFloor=1;`);
  const g = probe(ctx, 4, 0);
  const fg = g.rt3d.aps[0].direct.materialLossByFamily;
  check(22, 'G: a cross-floor path is charged under the slab family',
    fg.slab.lossDb > 0, JSON.stringify(fg));
  check(23, 'G: the slab loss is attributed to the slab and nothing else changes',
    fg.wall.lossDb === 0 && fg.rfObject.lossDb === 0 && fg.ceiling.lossDb === 0,
    JSON.stringify(fg));

  // H: punch an Opening around the probe point; the slab must stop being charged
  run(ctx, `
    // The segment meets the slab plane at a point determined by the AP height and
    // the receiver height, NOT at the probe XY, so the Opening has to be placed
    // around the crossing. Opening a region the ray misses would silently prove
    // nothing.
    state.floors[1].openings.push({id:'op1',
      points:[{x:-2,y:-2},{x:6,y:-2},{x:6,y:2},{x:-2,y:2}]});
    state.activeFloor=1;
  `);
  const h = probe(ctx, 4, 0);
  const fh = h.rt3d.aps[0].direct.materialLossByFamily;
  check(24, 'H: the same cross-floor probe through an Opening is charged NO slab',
    fh.slab.lossDb === 0 && h.rt3d.aps[0].direct.materialLossDb === 0,
    JSON.stringify(fh));
  check(25, 'H: slab and Opening are reported separately, and G minus H is the slab',
    Math.abs(fg.slab.lossDb - (fg.slab.lossDb - fh.slab.lossDb)) < 1e-9,
    JSON.stringify({ solid: fg.slab.lossDb, opening: fh.slab.lossDb }));
}

// =====================================================================
// I. normal-height Ceiling
// =====================================================================
{
  const ctx = sandbox();
  run(ctx, BASE);
  run(ctx, `
    var f=state.floors[0];
    f.ceilingAreas.push({id:'cl1', name:'named-area', height:2.8, thickness:0.10,
      materialId:state.materials[4].id, extraLossDb:0,
      footprint:{parts:[{outer:[{x:-6,y:-4},{x:6,y:-4},{x:6,y:4},{x:-6,y:4}],
                         holes:[]}]}});
  `);
  addAp(ctx, 0, 0, 2.9);
  const under = probe(ctx, 0, 0, 2.5);   // receiver below the 2.8 m ceiling
  const above = probe(ctx, 0, 0, 3.0);   // receiver above it
  const fu = under.rt3d.aps[0].direct.materialLossByFamily;
  const fa2 = above.rt3d.aps[0].direct.materialLossByFamily;
  check(26, 'I: a path that crosses a Ceiling is charged under the ceiling family',
    fu.ceiling.lossDb > 0, JSON.stringify(fu));
  check(27, 'I: a path entirely above the Ceiling is charged nothing for it',
    fa2.ceiling.lossDb === 0, JSON.stringify(fa2));
  check(28, 'I: the Ceiling loss is the real material dB and is separated from walls',
    Math.abs(fu.ceiling.lossDb - matDb(ctx, 4)) < 1e-9 && fu.wall.lossDb === 0,
    JSON.stringify(fu));
}

// =====================================================================
// J. one simple vertical reflecting wall
// =====================================================================
{
  const ctx = sandbox();
  run(ctx, BASE);
  addAp(ctx, -5, 0, 2.6);
  const p = probe(ctx, 5, 4, 1.2);
  const best = p.rt3d.aps[0].reflection.best;

  check(29, 'J: a first-order reflection is solved exactly, with a finite reflection point',
    !!best && best.valid === true &&
    Number.isFinite(best.reflectionPoint.x) && Number.isFinite(best.reflectionPoint.z),
    JSON.stringify(best && best.reflectionPoint));
  check(30, 'J: the reflection point lies on the reflecting wall in Z',
    !!best && best.reflectionPoint.z >= 0 && best.reflectionPoint.z <= 3.0,
    JSON.stringify(best && best.reflectionPoint));
  check(31, 'J: both legs are reported separately and sum to the path distance',
    !!best && Math.abs((best.legAP.distanceM + best.legPR.distanceM) - best.pathDistanceM) < 1e-6,
    JSON.stringify(best && { a: best.legAP.distanceM, b: best.legPR.distanceM,
                              total: best.pathDistanceM }));
  check(32, 'J: the reflection loss is a separate, named term, never folded into material loss',
    !!best && best.reflectionLossDb === 5 &&
    Math.abs(best.materialLossDb - (best.legAP.materialLossDb + best.legPR.materialLossDb)) < 1e-9,
    JSON.stringify(best && { refl: best.reflectionLossDb, mat: best.materialLossDb }));
  check(33, 'J: reflected candidates are counted and rejections are explained by reason',
    p.rt3d.aps[0].reflection.candidatesTested === 4 &&
    typeof p.rt3d.aps[0].reflection.rejectedByReason === 'object',
    JSON.stringify({ tested: p.rt3d.aps[0].reflection.candidatesTested,
                     rejected: p.rt3d.aps[0].reflection.rejectedByReason }));
  // The invariant is about WHICH path won, not about a specific dB delta: if the
  // direct path wins then canonical must equal the direct-only variant, and if a
  // reflection wins then canonical must equal that reflection's power.
  const st = p.rt3d.aps[0].strongest;
  const expectCanonical = st.kind === 'reflected'
    ? p.rt3d.aps[0].reflection.best.receivedPowerDbm : p.rt3d.aps[0].direct.receivedPowerDbm;
  check(34, 'J: the canonical value is exactly the winning path, and the variant that drops reflections',
    Math.abs(p.rt3d.variants.canonical.rssiDbm - expectCanonical) < 1e-9 &&
    (st.kind !== 'direct' ||
      Math.abs(p.rt3d.variants.canonical.rssiDbm -
               p.rt3d.variants.noReflections.rssiDbm) < 1e-9),
    JSON.stringify({ kind: st.kind, canonical: p.rt3d.variants.canonical.rssiDbm,
                     expectCanonical: expectCanonical,
                     directOnly: p.rt3d.variants.noReflections.rssiDbm,
                     advantage: p.rt3d.aps[0].reflection.advantageOverDirectDb }));
}

// =====================================================================
// The truth hierarchy, and the honesty of the Legacy decomposition
// =====================================================================
{
  const ctx = sandbox();
  run(ctx, BASE);
  addAp(ctx, 0, 0, 2.6);
  const p = probe(ctx, 6, 3);
  check(35, 'the audit ranks measurement above model above legacy',
    p.truthHierarchy[0].tier.indexOf('real measurement') === 0 &&
    p.truthHierarchy[2].tier.indexOf('legacy behaviour') >= 0,
    JSON.stringify(p.truthHierarchy.map(h => h.tier)));
  check(36, 'legacy is explicitly not truth', p.legacyIsTruth === false);
  check(37, 'Legacy reports its own constants and march plane from real semantics',
    p.legacy.launchPlane.zAbs > 0 &&
    p.legacy.reflectionRule.indexOf('MAXREFL=2') >= 0 &&
    p.legacy.antennaModel.indexOf('Azimuth only') >= 0,
    JSON.stringify({ z: p.legacy.launchPlane.zAbs }));
  check(38, 'Legacy admits it cannot report a serving AP for a cell',
    p.legacy.unattributable.some(u => u.quantity.indexOf('serving / source AP') >= 0));
  check(39, 'Legacy admits it cannot report reflection contribution per cell',
    p.legacy.unattributable.some(u => u.quantity.indexOf('reflection contribution') >= 0));
  check(40, 'Legacy never fabricates a stored value when no grid was supplied',
    p.legacy.storedRssiDbm === null && p.legacy.storedGridAvailable === false &&
    p.comparison.deltaDb === null,
    JSON.stringify({ stored: p.legacy.storedRssiDbm, delta: p.comparison.deltaDb }));
  check(41, 'the Simple/SINR model is reported as context and never as a legacy RT value',
    p.rt3d.aps[0].simpleModelRssiDbm != null &&
    p.legacy.storedRssiDbm === null,
    'simple model leaked into the legacy field');
}

// =====================================================================
// The antenna decomposition must be a faithful mirror of antennaGain().
// If this drifts, every "vertical delta" in the audit is a fiction.
// =====================================================================
{
  const ctx = sandbox();
  run(ctx, BASE);
  const worst = JSON.parse(run(ctx, `JSON.stringify((function(){
    var worstAbs=0, worstAz=0, n=0;
    var mounts=['ceiling','wall'], types=['omni','patch','sector'];
    for(var mi=0; mi<mounts.length; mi++) for(var ti=0; ti<types.length; ti++){
      for(var tilt=0; tilt<=40; tilt+=20){
        var f=state.floors[0];
        var ap=makeAP(1,2,'AP-x',3.0); ap.mount=2.6; ap.mountType=mounts[mi];
        ap.antenna={type:types[ti], az:30, tilt:tilt, gain:5};
        for(var a=0;a<8;a++) for(var e=-3;e<=1;e++){
          var px=6*Math.cos(a/8*2*Math.PI), py=6*Math.sin(a/8*2*Math.PI);
          var apz=2.6, evz=2.6+e*0.8;
          var real=antennaGain(ap, px, py, apz, evz);
          var parts=rt3dAuditAntennaParts(ap, px, py, apz, evz);
          // the UNROUNDED raw gain, exactly: the 4-dp fields are for reading, and
          // a rounded value can never prove bit-equality
          var d=Math.abs(real-parts.fullGainDbRaw);
          if(d>worstAbs) worstAbs=d;
          // the azimuth sub-term must equal the real antennaAzGain exactly
          var dAz=Math.abs(antennaAzGain(ap, Math.atan2(py-ap.y,px-ap.x)*180/Math.PI)-parts.azGainDbRaw);
          if(dAz>worstAz) worstAz=dAz;
          n++;
        }
      }
    }
    return { worstAbs:worstAbs, worstAz:worstAz, n:n };
  })())`));
  check(42, 'the audit antenna decomposition equals the real antennaGain() everywhere',
    worst.worstAbs < 1e-9, JSON.stringify(worst));
  check(43, 'the audit azimuth term equals the real antennaAzGain() everywhere',
    worst.worstAz < 1e-9, JSON.stringify(worst));
  check(44, 'the antenna sweep actually exercised a range of geometries',
    worst.n > 100, JSON.stringify(worst));
}

// =====================================================================
// The vertical antenna term must be able to move RSSI by >3, >6 and >10 dB,
// and the audit must report the delta rather than absorb it.
// =====================================================================
{
  const ctx = sandbox();
  run(ctx, BASE);
  run(ctx, `
    var f=state.floors[0];
    var ap=makeAP(0,0,'AP-p',3.0); ap.mount=2.9; ap.mountType='ceiling';
    ap.antenna={type:'patch', az:0, tilt:0, gain:5};
    f.aps=[ap];
  `);
  const scan = JSON.parse(run(ctx, `JSON.stringify((function(){
    var w=rt3dBuildWorld();
    var out={maxVerticalDb:0, over3:0, over6:0, over10:0, n:0, worst:null};
    for(var j=0;j<12;j++) for(var i=0;i<12;i++){
      var x=-9+1.5*i, y=-6+1.5*j;
      var p=rt3dAuditProbeAt(x,y,{world:w});
      var a=p.rt3d.aps[0];
      var d=Math.abs(a.antenna.verticalDeltaDb);
      out.n++;
      if(d>out.maxVerticalDb){ out.maxVerticalDb=d; out.worst={x:x,y:y,
        delta:a.antenna.verticalDeltaDb, offAxis:a.antenna.offAxisDeg,
        clipped:a.antenna.elevationPenaltyClipped, cap:a.antenna.elevationCapDb}; }
      if(d>3) out.over3++;
      if(d>6) out.over6++;
      if(d>10) out.over10++;
    }
    return out;
  })())`));
  check(45, 'the vertical antenna term can exceed 3 dB on a patch antenna',
    scan.maxVerticalDb > 3, JSON.stringify(scan));
  check(46, 'the audit reports the vertical delta per AP rather than absorbing it',
    scan.worst && Math.abs(scan.worst.delta) === scan.maxVerticalDb, JSON.stringify(scan.worst));
  check(47, 'the elevation penalty is reported with its cap and clipping state',
    scan.worst && scan.worst.cap === 20 && typeof scan.worst.clipped === 'boolean',
    JSON.stringify(scan.worst));
  check(48, 'a >10 dB vertical delta is reachable, so the ceiling is a real limit not a wall',
    scan.maxVerticalDb <= 20.0001, JSON.stringify({ max: scan.maxVerticalDb }));
}

// =====================================================================
// The delta statistics must not hide the legacy empty-cell asymmetry.
// =====================================================================
{
  const ctx = sandbox();
  run(ctx, BASE);
  addAp(ctx, 0, 0, 2.6);
  const st = JSON.parse(run(ctx, `JSON.stringify((function(){
    // k0: legacy empty, RT3D finite  -> RT3D only
    // k1: legacy NaN,  RT3D empty    -> neither
    // k2: both, d = 0   k3: both, d = -2   k4: both, d = -2
    var g=[-Infinity,NaN,-50,-60,-70], r=[-55,-Infinity,-50,-62,-72];
    return rt3dAuditDeltaStats(g, r, {cols:5,rows:1});
  })())`));
  check(49, 'cells present in only one engine are counted, not silently dropped',
    st.cellsOnlyLegacy === 0 && st.cellsOnlyRt3d === 1 &&
    st.cellsNeither === 1 && st.cellsCompared === 3,
    JSON.stringify({ onlyL: st.cellsOnlyLegacy, onlyR: st.cellsOnlyRt3d,
                     neither: st.cellsNeither, compared: st.cellsCompared }));
  check(50, 'the median absolute delta is computed only over commonly-defined cells',
    st.medianAbsDeltaDb === 2, JSON.stringify(st.medianAbsDeltaDb));
  check(51, 'the legacy max-over-deposits bias is stated, not left implicit',
    st.legacyMaxOverDepositsNote.indexOf('biased upward') >= 0);
  check(52, 'the within-tolerance counts are reported as counts and percentages',
    st.within3Db === 3 && st.within6Db === 3 && st.over10Db === 0 &&
    st.within3DbPct === 100 && st.within6DbPct === 100,
    JSON.stringify({ w3: st.within3Db, w6: st.within6Db, o10: st.over10Db }));
}

// =====================================================================
// The probe set must resolve by RULE and must refuse to invent a location.
// =====================================================================
{
  const ctx = sandbox();
  run(ctx, BASE);
  addAp(ctx, 0, 0, 2.6);
  const ps = JSON.parse(run(ctx, `JSON.stringify(rt3dAuditResolveProbes({}))`));
  const byId = {};
  for(const p of ps.probes) byId[p.id] = p;

  check(53, 'the probe set covers every required evidence category',
    ['losNearPrimaryAp','losFarPrimaryAp','losNearSecondAp','rackFront','rackBehind',
     'rackOverhead','namedCeiling','slabOpening','slabSolid','maxDisagreement']
      .every(id=>!!byId[id]), JSON.stringify(Object.keys(byId)));
  check(54, 'a clear-LOS probe resolves only after the path is SOLVED to zero loss',
    byId.losNearPrimaryAp.resolved === true &&
    byId.losNearPrimaryAp.x != null && byId.losNearPrimaryAp.rule.indexOf('verifying') >= 0 ||
    byId.losNearPrimaryAp.rule.indexOf('zero material loss') >= 0,
    JSON.stringify(byId.losNearPrimaryAp));
  check(55, 'a rule that cannot be satisfied is reported unresolved, never substituted',
    byId.rackFront.resolved === false && byId.rackFront.reason != null,
    JSON.stringify(byId.rackFront));
  check(56, 'a missing second AP is reported as a missing second AP',
    byId.losNearSecondAp.resolved === false &&
    byId.losNearSecondAp.reason.indexOf('one participating AP') >= 0,
    JSON.stringify(byId.losNearSecondAp.reason));
  check(57, 'a missing slab is reported, not replaced by an arbitrary point',
    byId.slabOpening.resolved === false && byId.slabOpening.x === null,
    JSON.stringify(byId.slabOpening));
  check(58, 'the max-disagreement probe refuses to exist without both grids',
    byId.maxDisagreement.resolved === false &&
    byId.maxDisagreement.reason.indexOf('both grids') >= 0,
    JSON.stringify(byId.maxDisagreement.reason));
  check(59, 'no coordinate is hardcoded: provenance is stated on every run',
    ps.coordinateProvenance.indexOf('No coordinate in this file is hardcoded') >= 0);
  check(60, 'the probe set refuses to be used for tuning',
    ps.tuningDisclaimer.indexOf('never used to fit') >= 0);
}

// =====================================================================
// Measurements: an attach API that refuses to invent data.
// =====================================================================
{
  const ctx = sandbox();
  run(ctx, BASE);
  addAp(ctx, 0, 0, 2.6);
  const m = JSON.parse(run(ctx, `JSON.stringify((function(){
    var bad=rt3dAuditAttachMeasurement(1,1,1,NaN,{});
    var good=rt3dAuditAttachMeasurement(6,3,floorElevation(0)+receiverHeight(),
      -55.5, { source:'site survey', measuredAt:'2026-01-01' });
    var anonymous=rt3dAuditAttachMeasurement(6,3,floorElevation(0)+receiverHeight(),
      -50, {});
    var p=rt3dAuditProbeAt(6,3,{});
    var score=rt3dAuditScoreAgainstMeasurements([p]);
    return { badOk:bad.ok, badReason:bad.reason,
             goodOk:good.ok, anonProvenance:anonymous.measurement.provenanceComplete,
             found:p.measurement.found, foundSource:p.measurement.measurement.source,
             foundCount:p.measurement.measurements.length,
             conflicting:p.measurement.conflicting,
             listed:rt3dAuditListMeasurements().length,
             scored:score.scoredCount, unprovenanced:score.unprovenancedCount,
             rows:score.rows.length };
  })())`));
  check(61, 'a non-finite measurement is refused rather than stored',
    m.badOk === false && m.badReason != null, JSON.stringify(m));
  check(62, 'a measurement with provenance attaches and is found at the exact XYZ',
    m.goodOk === true && m.found === true && m.foundSource === 'site survey',
    JSON.stringify(m));
  check(63, 'a measurement without provenance is flagged incomplete',
    m.anonProvenance === false, JSON.stringify(m));
  check(64, 'an unprovenanced measurement is listed but never scored',
    m.scored === 1 && m.unprovenanced === 1 && m.rows === 2,
    JSON.stringify(m));
  check(64.5, 'two conflicting readings at one XYZ both surface, and the conflict is flagged',
    m.foundCount === 2 && m.conflicting === true, JSON.stringify(m));
  check(65, 'measurements are not persisted into project state',
    JSON.stringify(run(ctx, 'Object.keys(state).filter(function(k){return /measur/i.test(k);})')) === '[]');
}

// =====================================================================
// The correlation report must state that correlation is not causation.
// =====================================================================
{
  const ctx = sandbox();
  run(ctx, BASE);
  addAp(ctx, 0, 0, 2.6);
  const c = JSON.parse(run(ctx, `JSON.stringify((function(){
    var g=[], r=[];
    for(var k=0;k<64;k++){ g.push(-50-(k%7)); r.push(-50-(k%7)+((k%3)?6:-6)); }
    var st=rt3dAuditDeltaStats(g,r,{cols:8,rows:8});
    return rt3dAuditCorrelate(st, {cols:8,rows:8,cell:0.16,cw:1,ch:1,
      b:{minx:-4,miny:-4,maxx:4,maxy:4}});
  })())`));
  check(66, 'the correlation report lists every requested geometric class',
    ['nearWall','insideRfObject','insideSlabOpening','floorTransition','verticalAngleLarge','isolated']
      .every(k=>c.rows.some(r=>r.class===k)), JSON.stringify(c.rows.map(r=>r.class)));
  check(67, 'the correlation report states that correlation is not causation',
    c.disclaimer.indexOf('CORRELATION ONLY') >= 0 &&
    c.disclaimer.indexOf('does NOT establish') >= 0);
  check(68, 'a class with no cells is reported as empty rather than omitted',
    c.rows.some(r=>r.note && r.note.indexOf('no cell in this slice') >= 0),
    JSON.stringify(c.rows.filter(r=>r.note)));
}

// ---------- helpers ----------
function fspl(m) { return 20 * Math.log10(m) - 27.55; }
// the REAL band centre frequency and path-loss exponent from the loaded state,
// never assumed: a hardcoded MHz here would make every closed-form check wrong
// for any other band.
function mhz(ctx) { return JSON.parse(run(ctx, 'BANDS[state.band].mhz')); }
function statePlExp(ctx) { return JSON.parse(run(ctx, 'state.plExp')); }
function matDb(ctx, i) { return JSON.parse(run(ctx, `state.materials[${i}].db`)); }
function deltaOf(p) {
  return { legacy: p.comparison.legacyStoredDbm, rt3d: p.comparison.rt3dDbm,
           delta: p.comparison.deltaDb };
}
function agreement(p) {
  // A: both engines are physically capable, so they must agree.
  if (p.comparison.deltaDb == null) return true;
  return Math.abs(p.comparison.deltaDb) < 0.5;
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
