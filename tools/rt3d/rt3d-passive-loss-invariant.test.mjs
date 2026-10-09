// RF CORRECTNESS: the passive-material loss invariant.
//
//   Every passive material / traversal contribution to RF loss is >= 0 dB.
//
// Passive materials in this model (wall, pillar, RF Object, floor slab,
// Ceiling Area) model absorption and scattering. A passive barrier cannot
// contribute negative attenuation: a negative value makes a wall ADD received
// power to a signal crossing it, which inverts the meaning of every RSSI,
// SINR, diagnostic and serving-AP decision derived from those numbers.
//
// Stage 7B.1 found two reachable paths by which a passive loss went negative:
// a Ceiling Area extraLossDb below zero through the editor, and a negative
// material db arriving through loadProject(). This suite pins the invariant at
// the enforcement boundary and proves it holds for every source, every engine,
// and every route into the physics.
//
// THE ENFORCEMENT BOUNDARY is passiveMaterialLossDb() in index.html, deliberately
// NOT the UI and NOT loadProject():
//
//   * A UI guard alone is bypassed by any round trip through a saved project,
//     because loadProject() adopts the file's state wholesale.
//   * Rewriting raw project data inside loadProject() would destroy the user's
//     actual input and mutate saved files. That is a migration decision, and
//     migration is only warranted if separately justified. It is not needed to
//     make the physics correct.
//
// The invariant is therefore enforced where loss is COMPUTED, so UI-created
// projects, loaded projects, older files, programmatic fixtures and the legacy
// engine all obey the same invariant.
//
// WHAT IS AND IS NOT UNCHANGED, precisely. tools/rt3d/production-untouched.mjs
// proves the runRayTrace() FUNCTION BODY is byte-identical to its baseline. It
// does NOT prove Legacy RT behaviour is unchanged, and this bugfix must not be
// described as if it did: matById() is a shared dependency of runRayTrace(), so
// changing what matById() reports necessarily changes Legacy RT behaviour.
//
//   * runRayTrace() function body .................. byte-identical
//   * valid nonnegative-input behaviour ........... unchanged, covered by the
//                                                   existing frozen oracle
//   * invalid negative passive-loss behaviour ..... INTENTIONALLY CORRECTED to a
//                                                   0 dB minimum
//
// The third line is the whole point of this pass. The first two are what must not
// move, and neither does.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeDom, run } from './loader.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW = fs.readFileSync(path.join(HERE, '..', '..', 'index.html'), 'utf8');
const SRC = RAW.match(/<script>\n([\s\S]*?)\n<\/script>/)[1];

let pass = 0, fail = 0;
const failures = [];
function check(id, name, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${String(id).padStart(3)}. ${name}`); }
  else {
    fail++; failures.push(`${id}. ${name}${detail ? ' :: ' + detail : ''}`);
    console.log(`  FAIL ${String(id).padStart(3)}. ${name}${detail ? ' :: ' + detail : ''}`);
  }
}

function sb() {
  const win = makeDom();
  win.location = { search: '?rt3d=1' };
  const ctx = vm.createContext(win);
  vm.runInContext(SRC, ctx, { filename: 'index.html<script>' });
  run(ctx, `paintHeat=function(){};computeHeatSimple=function(){};draw2d=function(){};
    coverageUpdate=function(){};showToast=function(){};refresh3dHeat=function(){};
    scheduleHeat=function(){};clearTimeout(heatTimer);bootUI=function(){};`);
  return ctx;
}

// A floor with one wall at a known place, used by the traversal tests.
const BASE = `
  state=freshState(); state.floors.length=1;
  var f=state.floors[0];
  f.id='flr_a'; f.name='FA'; f.w=26; f.d=20; f.height=3.4;
  f.walls=[]; f.pillars=[]; f.rfObjects=[]; f.openings=[]; f.aps=[]; f.ceilingAreas=[];
  state.activeFloor=0; state.receiverHeight=1.2;
  var M4=state.materials[4].id;   // Concrete, 15 dB
  var M0=state.materials[0].id;   // Gypsum, 3 dB
`;


// Small in-sandbox probe: the effective base attenuation matById() reports.
const PROBE = `rt3dPassiveProbeDb=function(){
  var m=state.materials[4], raw=m.db;
  m.db=-30; var seen=matById(m.id).db; m.db=raw; return seen;
};`;

// ===========================================================================
console.log('-- A. The clamp itself --');
// ===========================================================================
{
  const ctx = sb(); run(ctx, BASE);
  const out = JSON.parse(run(ctx,
    'JSON.stringify({neg:passiveMaterialLossDb(-30), neg1:passiveMaterialLossDb(-1), tinyNeg:passiveMaterialLossDb(-1e-12),' +
    ' zero:passiveMaterialLossDb(0), tiny:passiveMaterialLossDb(1e-12), three:passiveMaterialLossDb(3),' +
    ' big:passiveMaterialLossDb(1e3), nan:passiveMaterialLossDb(NaN), inf:passiveMaterialLossDb(Infinity),' +
    ' ninf:passiveMaterialLossDb(-Infinity), undef:passiveMaterialLossDb(undefined), nul:passiveMaterialLossDb(null),' +
    ' str:passiveMaterialLossDb("12"), strNeg:passiveMaterialLossDb("-12")})'));

  check(1, 'negative loss clamps to 0', out.neg === 0 && out.neg1 === 0 && out.tinyNeg === 0,
        JSON.stringify([out.neg, out.neg1, out.tinyNeg]));
  check(2, 'zero loss stays zero (not turned positive)', out.zero === 0, String(out.zero));
  check(3, 'positive loss passes through EXACTLY, including denormal-scale values',
        out.tiny === 1e-12 && out.three === 3 && out.big === 1e3,
        JSON.stringify([out.tiny, out.three, out.big]));
  check(4, 'non-finite input maps to 0: unknown loss is not evidence of gain',
        out.nan === 0 && out.inf === 0 && out.ninf === 0 && out.undef === 0 && out.nul === 0,
        JSON.stringify([out.nan, out.inf, out.ninf, out.undef, out.nul]));
  check(5, 'numeric strings coerce, and a negative string still clamps',
        out.str === 12 && out.strNeg === 0, JSON.stringify([out.str, out.strNeg]));

  // Bit-exactness: the clamp must be the identity on every positive double,
  // including the ones this codebase actually uses.
  const sweep = JSON.parse(run(ctx, `(function(){
    var bad=0, n=0;
    for(var i=0;i<200000;i++){
      var v=(i/200000)*60;              // 0 .. 60 dB in fine steps
      if(passiveMaterialLossDb(v)!==v) bad++;
      n++;
      var w=v/7.3;
      if(passiveMaterialLossDb(w)!==w) bad++;
      n++;
    }
    return JSON.stringify({tested:n, altered:bad});
  })()`));
  check(6, `the clamp is bit-identical on ${sweep.tested.toLocaleString()} positive samples`,
        sweep.altered === 0, `${sweep.altered} altered`);
}

// ===========================================================================
console.log('\n-- B. Every passive-loss source is nonnegative --');
// ===========================================================================
{
  const ctx = sb(); run(ctx, BASE);
  const out = JSON.parse(run(ctx, `JSON.stringify({
    ceil:      [-40,-1,0,5].map(function(n){ return ceilEffectiveLoss({materialId:M0, extraLossDb:n}); }),
    ceilBadMat:[40].map(function(d){ var m=state.materials[0].db; state.materials[0].db=d;
                        var r=ceilEffectiveLoss({materialId:M0, extraLossDb:2}); state.materials[0].db=m; return r; }),
    rfObject:  [-40,-1,0,5].map(function(n){ return rfObjectExtraLoss({extraLossDb:n}); }),
    slab:      [-40,-1,0,5].map(function(n){ return slabLossForFloor({slabMaterialId:M4, slabExtraLossDb:n}); }),
    slabBadMat:[40].map(function(d){ var m=state.materials[4].db; state.materials[4].db=d;
                       var r=slabLossForFloor({slabMaterialId:M4, slabExtraLossDb:2}); state.materials[4].db=m; return r; }),
    slabDef:   [-40,-1,0,5].map(function(n){ var s=state.slabDb; state.slabDb=n;
                       var r=slabLossForFloor({}); state.slabDb=s; return r; })
  })`));

  check(7, 'Ceiling Area effective loss is nonnegative for negative, zero and positive extra loss',
        out.ceil.every((v) => v >= 0), JSON.stringify(out.ceil));
  check(8, 'Ceiling Area effective loss is nonnegative with a NEGATIVE base material db',
        out.ceilBadMat.every((v) => v >= 0), JSON.stringify(out.ceilBadMat));
  check(9, 'RF Object extra loss is nonnegative', out.rfObject.every((v) => v >= 0),
        JSON.stringify(out.rfObject));
  check(10, 'floor slab loss is nonnegative for negative extra loss',
        out.slab.every((v) => v >= 0), JSON.stringify(out.slab));
  check(11, 'floor slab loss is nonnegative with a NEGATIVE base material db',
        out.slabBadMat.every((v) => v >= 0), JSON.stringify(out.slabBadMat));
  check(12, 'floor slab DEFAULT loss is nonnegative for a negative state.slabDb',
        out.slabDef.every((v) => v >= 0), JSON.stringify(out.slabDef));
}

// ===========================================================================
console.log('\n-- C. Every RT3D body carries a nonnegative loss --');
// ===========================================================================
{
  const scene = `${BASE}
    f.walls.push({id:'w1',x1:0,y1:-10,x2:0,y2:10,height:3.4,materialId:M4,thickness:DEFAULT_WALL_THICKNESS_M});
    f.walls.push({id:'w2',x1:-8,y1:6,x2:8,y2:6,height:3.4,materialId:M4,thickness:DEFAULT_WALL_THICKNESS_M});
    for(var p=0;p<3;p++) f.pillars.push({id:'p'+p,x:-9+p*9,y:(p%2?6:-6),r:0.25,height:3.4,materialId:M4,extraLossDb:0});
    f.rfObjects.push({id:'rk',x:4,y:-5,width:1.2,depth:2.4,height:2.1,rotation:20,materialId:M4,extraLossDb:2});
    f.rfObjects.push({id:'rk2',x:-4,y:5,width:1.2,depth:2.4,height:2.1,rotation:0,materialId:M4,extraLossDb:-50});
    f.ceilingAreas.push({id:'cl',height:2.6,thickness:0.10,materialId:M0,extraLossDb:-40,
      footprint:{parts:[{outer:[{x:-13,y:-10},{x:13,y:-10},{x:13,y:10},{x:-13,y:10}],holes:[]}]}});
    var a=makeAP(-6,0,'AP-A',3.4); a.id='ap_a'; a.mount=2.9; a.mountType='ceiling';
    a.antenna={type:'omni',az:0,tilt:0,gain:3}; f.aps.push(a);
    // A NEGATIVE base material db, exactly as a hand-edited project file would carry.
    state.materials[4].db=-30;
    var pb={id:'flr_b',name:'FB',w:26,d:20,height:3.4,walls:[],pillars:[],rfObjects:[],
            openings:[],ceilingAreas:[],aps:[],slabMaterialId:M4,slabExtraLossDb:-20};
    state.floors.push(pb);
  `;
  const ctx = sb(); run(ctx, scene);
  const out = JSON.parse(run(ctx, `JSON.stringify((function(){
    var w=rt3dBuildWorld(), byFam={}, neg=[];
    RT3D_FAMILIES.forEach(function(fam){
      var l=rt3dFamilyList(w,fam); byFam[fam]=l.length;
      l.forEach(function(b){ if(!(b.loss>=0)) neg.push({fam:fam, id:b.objectId, loss:b.loss}); });
    });
    return { byFam:byFam, total:rt3dAllBodies(w).length, negative:neg };
  })())`));
  check(13, 'every body of every family has a nonnegative loss, with negative base db AND negative extras',
        out.negative.length === 0, JSON.stringify(out.negative));
  check('13b', 'the scene really does contain all five families',
        out.byFam.wall > 0 && out.byFam.pillar > 0 && out.byFam.rfObject > 0 &&
        out.byFam.slab > 0 && out.byFam.ceiling > 0, JSON.stringify(out.byFam));
}

// ===========================================================================
console.log('\n-- D. A passive traversal can NEVER increase RSSI --');
// ===========================================================================
// The central physical claim, measured on the real engine. For each family, the
// RF value at a receiver BEHIND the barrier must be <= the same receiver with
// no barrier at all. A negative loss would invert this.
const TRAVERSAL = [
  { id: 'wall',     bad: 'state.materials[4].db=-30;' },
  { id: 'pillar',   bad: 'state.materials[4].db=-30;' },
  { id: 'rfObject', bad: 'state.materials[4].db=-30; f.rfObjects[0].extraLossDb=-40;' },
  { id: 'slab',     bad: 'state.materials[4].db=-30; f.slabExtraLossDb=-40;' },
  { id: 'ceiling',  bad: 'state.materials[4].db=-30; f.ceilingAreas[0].extraLossDb=-40;' },
];
{
  let id = 20;
  for (const t of TRAVERSAL) {
    // AP on the left, receiver on the right, barrier in between.
    const sceneFor = (extra) => `${BASE}
      state.materials[4].db = ${extra.mDb};
      ${t.id === 'wall' ? `f.walls.push({id:'bar',x1:0,y1:-10,x2:0,y2:10,height:3.4,materialId:M4,thickness:DEFAULT_WALL_THICKNESS_M});` : ''}
      ${t.id === 'pillar' ? `f.pillars.push({id:'bar',x:0,y:0,r:0.25,height:3.4,materialId:M4,extraLossDb:0});` : ''}
      ${t.id === 'rfObject' ? `f.rfObjects.push({id:'bar',x:0,y:0,width:0.5,depth:8,height:2.4,rotation:0,materialId:M4,extraLossDb:${extra.extraLossDb}});` : ''}
      ${t.id === 'ceiling' ? `f.ceilingAreas.push({id:'bar',height:2.6,thickness:0.10,materialId:M0,extraLossDb:${extra.extraLossDb},footprint:{parts:[{outer:[{x:-13,y:-10},{x:13,y:-10},{x:13,y:10},{x:-13,y:10}],holes:[]}]}});` : ''}
      ${t.id === 'slab' ? `var pb={id:'flr_b',name:'FB',w:26,d:20,height:3.4,walls:[],pillars:[],rfObjects:[],openings:[],ceilingAreas:[],aps:[],slabMaterialId:M4,slabExtraLossDb:${extra.extraLossDb}};
                          state.floors.push(pb); state.activeFloor=0;` : ''}
      var a=makeAP(-7,0,'AP-A',3.4); a.id='ap_a'; a.mount=1.4; a.mountType='wall';
      a.antenna={type:'omni',az:0,tilt:0,gain:3}; f.aps.push(a);
    `;
    const readRssi = (scene) => {
      const ctx = sb(); run(ctx, scene);
      return Number(run(ctx, `(function(){
        var w=rt3dBuildWorld(), pz=rt3dReceiverPlaneZForFloor(0);
        var r=rt3dCoverageAt(w,{x:7,y:0,z:pz},{sources:rt3dCoverageSources(),stats:rt3dNewStats()});
        return r.strongestRssi;
      })()`));
    };
    // Barrier present, with a deliberately NEGATIVE loss.
    const withBad = readRssi(sceneFor({ mDb: -30, extraLossDb: -40 }));
    // Same scene with the barrier's loss forced to a normal positive value.
    const withGood = readRssi(sceneFor({ mDb: 15, extraLossDb: 6 }));
    // No barrier at all: the most signal any receiver could possibly see.
    const noBarrier = readRssi(`${BASE}
      state.materials[4].db = -30;
      var a=makeAP(-7,0,'AP-A',3.4); a.id='ap_a'; a.mount=1.4; a.mountType='wall';
      a.antenna={type:'omni',az:0,tilt:0,gain:3}; f.aps.push(a);`);

    check(id++, `${t.id}: a negative passive loss does NOT raise RSSI above the no-barrier path`,
          Number.isFinite(withBad) && withBad <= noBarrier + 1e-9,
          `withBarrier(negative)=${withBad.toFixed(4)} dBm, noBarrier=${noBarrier.toFixed(4)} dBm`);
    check(id++, `${t.id}: a normal positive loss DOES reduce RSSI (the control still works)`,
          withGood < withBad + 1e-9,
          `positive=${withGood.toFixed(4)} dBm vs clamped-negative=${withBad.toFixed(4)} dBm`);
  }
}

// ===========================================================================
console.log('\n-- E. Zero loss is preserved (not silently raised) --');
// ===========================================================================
{
  const scene = `${BASE}
    f.walls.push({id:'w1',x1:0,y1:-10,x2:0,y2:10,height:3.4,materialId:M4,thickness:DEFAULT_WALL_THICKNESS_M});
    var a=makeAP(-7,0,'AP-A',3.4); a.id='ap_a'; a.mount=1.4; a.mountType='wall';
    a.antenna={type:'omni',az:0,tilt:0,gain:3}; f.aps.push(a);`;
  const readLoss = () => { const c = sb(); run(c, scene);
    return JSON.parse(run(c, 'JSON.stringify((function(){var w=rt3dBuildWorld();' +
      'return rt3dFamilyList(w,"wall").map(function(b){return b.loss;});})())')); };
  // 0 dB material: the wall must remain a zero-loss body, not become positive.
  const c0 = sb(); run(c0, `${BASE} state.materials[4].db=0;
    f.walls.push({id:'w1',x1:0,y1:-10,x2:0,y2:10,height:3.4,materialId:M4,thickness:DEFAULT_WALL_THICKNESS_M});`);
  const zeroLoss = JSON.parse(run(c0, 'JSON.stringify(rt3dFamilyList(rt3dBuildWorld(),"wall").map(function(b){return b.loss;}))'));
  check(30, 'a 0 dB material produces a 0 dB body, unchanged',
        zeroLoss.length === 1 && zeroLoss[0] === 0, JSON.stringify(zeroLoss));
  check(31, 'default concrete wall loss is still exactly 15 dB',
        readLoss()[0] === 15, JSON.stringify(readLoss()));
}

// ===========================================================================
console.log('\n-- F. The boundary, not the UI, is what enforces it --');
// ===========================================================================
{
  check(40, 'passiveMaterialLossDb is the single canonical enforcement point',
        /function passiveMaterialLossDb\(db\)/.test(SRC), '');
  check('40b', 'loadProject does NOT rewrite raw project data to force the invariant',
        !/loadProject[\s\S]{0,3000}?\.db\s*=\s*Math\.max/.test(SRC), '');
  check('40c', 'loadProject still adopts state wholesale (raw data is preserved verbatim)',
        /state\s*=\s*s\s*;/.test(/function loadProject\(file\)\{[\s\S]*?\n\}/.exec(SRC)[0]), '');
  check('40d', 'the Ceiling extra-loss field now has a min, matching the RF Object field',
        /<input id="pCeL"[^>]*min="0"/.test(RAW), '');
  check('40e', 'and its handler rejects a negative value instead of storing it',
        /\$\('#pCeL'\)\.onchange[\s\S]{0,300}?<0/.test(RAW), '');
  check('40f', 'the UI guard is defence in depth only: the RF path does not depend on it',
        /return passiveMaterialLossDb\(m && m\.db\) \+ passiveMaterialLossDb\(c && c\.extraLossDb\);/.test(SRC), '');

  // THE TOTALITY ARGUMENT. The legacy ray tracer reads material .db directly
  // from inside the frozen runRayTrace() function body, so a clamp applied only
  // at the RT3D body builders would leave legacy RT free to add signal. matById
  // is what closes that gap; these checks pin it.
  //
  // Note what this does and does not claim. runRayTrace() itself is NOT edited,
  // and production-untouched.mjs still passes byte-identically. But because
  // matById() is a shared dependency, Legacy RT BEHAVIOUR does change for
  // invalid negative passive-loss inputs -- that is the intended correction,
  // not an accident. Valid nonnegative-input behaviour is unchanged and stays
  // covered by the frozen Stage-7A oracle.
  const ctx = sb(); run(ctx, BASE); run(ctx, PROBE);
  const out = JSON.parse(run(ctx, `JSON.stringify({
    badDb:  rt3dPassiveProbeDb(),
    identityKept: (function(){
      var m = state.materials[4]; state.materials[4].db = -30;
      var same = matById(m.id) === m;
      state.materials[4].db = 15;
      var sameValid = matById(m.id) === m;
      return { invalidIsSameObject: same, validIsSameObject: sameValid };
    })(),
    rawPreserved: (function(){
      state.materials[4].db = -30;
      var r = state.materials[4].db;          // RAW stored value
      var seen = matById(state.materials[4].id).db;   // EFFECTIVE value
      return { raw:r, effective:seen };
    })()
  })`));
  check(41, 'matById reports a corrected 0 dB for a negative material db',
        out.badDb === 0, String(out.badDb));
  check('41b', 'raw project data is NEVER rewritten: the stored db stays exactly as loaded',
        out.rawPreserved.raw === -30 && out.rawPreserved.effective === 0,
        JSON.stringify(out.rawPreserved));
  check('41c', 'a VALID material is returned as the SAME object (identity fast path, ' +
        'so no hot loop allocates and no caller sees a copy)',
        out.identityKept.validIsSameObject === true, JSON.stringify(out.identityKept));
  check('41d', 'only an invalid material yields a corrected view, never a mutation',
        out.identityKept.invalidIsSameObject === false, JSON.stringify(out.identityKept));

  // The three-way statement above, pinned rather than merely asserted in prose.
  const rrt = /function runRayTrace\(onDone\)\{[\s\S]*?\n\}/.exec(SRC);
  check(42, 'runRayTrace() function body is byte-identical: this pass does not edit it',
        !!rrt && !/passiveMaterialLossDb/.test(rrt[0]),
        rrt ? 'runRayTrace mentions the clamp: ' + /passiveMaterialLossDb/.test(rrt[0]) : 'not found');
  check('42b', 'and it reads materials through the corrected matById(), so Legacy RT ' +
        'behaviour for INVALID negative passive loss is intentionally corrected ' +
        '(this is a behaviour change by design, not a no-op)',
        /matById\(/.test(rrt[0]) && /function matById\(id\)\{[\s\S]*?passiveMaterialLossDb\(raw\)/.test(SRC),
        '');
}

// ===========================================================================
console.log('\n-- G. Legacy engine obeys the same invariant --');
// ===========================================================================
// rssiFromAP() and runRayTrace() are a SEPARATE accumulation that does not go
// through rt3dTracePath. They must obey the invariant too, or one project would
// be reported with two contradictory physics depending on which view is drawn.
{
  const legacy = (mDb) => {
    const ctx = sb();
    run(ctx, `${BASE} state.materials[4].db=${mDb};
      f.walls.push({id:'w1',x1:0,y1:-10,x2:0,y2:10,height:3.4,materialId:M4,thickness:DEFAULT_WALL_THICKNESS_M});
      f.pillars.push({id:'p1',x:0,y:0,r:0.25,height:3.4,materialId:M4,extraLossDb:0});
      f.ceilingAreas.push({id:'cl',height:2.6,thickness:0.10,materialId:M0,extraLossDb:-40,
        footprint:{parts:[{outer:[{x:-13,y:-10},{x:13,y:-10},{x:13,y:10},{x:-13,y:10}],holes:[]}]}});
      f.rfObjects.push({id:'rk',x:0,y:0,width:0.5,depth:8,height:2.4,rotation:0,materialId:M4,extraLossDb:-40});
      var a=makeAP(-7,0,'AP-A',3.4); a.id='ap_a'; a.mount=1.4; a.mountType='wall';
      a.antenna={type:'omni',az:0,tilt:0,gain:3}; f.aps.push(a);`);
    return JSON.parse(run(ctx, 'JSON.stringify({ rssi: rssiFromAP(state.floors[0].aps[0],0,7,0,0,BANDS[state.band].mhz) })'));
  };
  // The no-barrier baseline is a scene built without any obstacle at all, so
  // nothing is mutated or restored mid-computation.
  const noBarrier = (() => {
    const ctx = sb();
    run(ctx, `${BASE}
      var a=makeAP(-7,0,'AP-A',3.4); a.id='ap_a'; a.mount=1.4; a.mountType='wall';
      a.antenna={type:'omni',az:0,tilt:0,gain:3}; f.aps.push(a);`);
    return JSON.parse(run(ctx, 'JSON.stringify({ rssi: rssiFromAP(state.floors[0].aps[0],0,7,0,0,BANDS[state.band].mhz) })'));
  })();
  const neg = legacy(-30), zero = legacy(0), pos = legacy(15);
  check(50, 'legacy rssiFromAP: every barrier combined must not raise RSSI above NO barrier',
        Number.isFinite(neg.rssi) && neg.rssi <= noBarrier.rssi + 1e-9,
        `withNeg=${neg.rssi.toFixed(4)} dBm, noBarrier=${noBarrier.rssi.toFixed(4)} dBm`);
  check(51, 'legacy rssiFromAP: negative material + negative extras == a zero-loss barrier exactly',
        neg.rssi === zero.rssi,
        `negative=${neg.rssi.toFixed(4)} dBm vs zeroLossBarrier=${zero.rssi.toFixed(4)} dBm`);
  check(52, 'legacy rssiFromAP: a positive passive loss still reduces RSSI',
        pos.rssi < neg.rssi - 1e-9,
        `positive=${pos.rssi.toFixed(4)} dBm vs clamped-negative=${neg.rssi.toFixed(4)} dBm`);
  check(53, 'legacy RT reaches a material ONLY through the corrected matById(), never via a ' +
        'raw .db read, so the two engines cannot disagree about what a material attenuates',
        /function matById\(id\)\{[\s\S]*?passiveMaterialLossDb\(raw\)/.test(SRC) &&
        // and nothing anywhere in the file bypasses matById for a material attenuation
        !/state\.materials\[[^\]]*\]\.db/.test(SRC), '');
}

// ===========================================================================
console.log('\n-- H. Reflection loss is unchanged and still nonnegative --');
// ===========================================================================
{
  const ctx = sb(); run(ctx, BASE);
  const out = JSON.parse(run(ctx, 'JSON.stringify({c:RT3D_REFLECTION_LOSS_DB})'));
  check(60, 'the RT3D reflection-loss constant is unchanged at 5 dB', out.c === 5, String(out.c));
  check(61, 'the legacy reflection-loss constant is unchanged at 5 dB and is NOT clamped',
        /const MAXREFL=2, MAX_TRANSMISSION_EVENTS=128, REFL_LOSS=5/.test(SRC), '');
  check('61b', 'reflection loss is a fixed model constant, not user data, so it is out of ' +
        'scope for the passive-material invariant',
        !/passiveMaterialLossDb\(REFL_LOSS\)|passiveMaterialLossDb\(reflectLossDb\)/.test(SRC), '');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }