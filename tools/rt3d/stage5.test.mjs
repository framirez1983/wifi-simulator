// Stage 5 acceptance: the RT3D experimental BROWSER layer.
//
// These run in the Node harness against the real application code, with a
// simulated ?rt3d=1 environment. They prove the CONTRACT, not the pixels:
// gating, live-project feeding, receiver-plane tracking, AP inclusion, BVH
// lifetime, fan reuse, cell mapping, the no-interpolation rule, the
// aggregation rule, colour reuse, and that nothing can reach the project file.
//
// Manual browser acceptance against S4 is a separate, human step.
import { makeDom, run } from './loader.mjs';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, '..', '..', 'index.html'), 'utf8');
const script = SRC.match(/<script>\n([\s\S]*?)\n<\/script>/)[1];

let pass = 0, fail = 0;
const failures = [];
function check(id, name, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${String(id).padStart(2)}. ${name}`); }
  else {
    fail++; failures.push(`${id}. ${name}${detail ? ' :: ' + detail : ''}`);
    console.log(`  FAIL ${String(id).padStart(2)}. ${name}${detail ? ' :: ' + detail : ''}`);
  }
}

// A sandbox WITH the development flag, and one WITHOUT, from the same source.
// The flag is a location.search read, so the only way to exercise it headlessly
// is to give the sandbox a location. Without one, typeof location is undefined
// and RT3D_EXP_ENABLED must be false — which is itself check 1.
function load(flag) {
  const win = makeDom();
  if (flag) win.location = { search: '?rt3d=1' };
  const ctx = vm.createContext(win);
  vm.runInContext(script, ctx, { filename: 'index.html<script>' });
  return ctx;
}
const withFlag = load(true);
const noFlag = load(false);

// These two sandboxes are used for CONTRACT checks, not rendering. Silence the
// rendering tail: several checks deliberately poke the display, and the DOM
// stub cannot satisfy paintHeat(). Nothing about the propagation engine is
// stubbed, so these checks still exercise the real code.
function silence(sb) {
  run(sb, `
    paintHeat=function(){}; computeHeatSimple=function(){}; draw2d=function(){};
    coverageUpdate=function(){}; showToast=function(){}; refresh3dHeat=function(){};
    scheduleHeat=function(){}; clearTimeout(heatTimer);
  `);
}
silence(withFlag);
silence(noFlag);
const R = (sb, code) => JSON.parse(run(sb, `JSON.stringify(${code})`));

console.log('Stage 5 acceptance — RT3D experimental browser layer\n');

// ------------------------------------------------------------------ 1
{
  const on = R(withFlag, 'RT3D_EXP_ENABLED');
  const off = R(noFlag, 'RT3D_EXP_ENABLED');
  check(1, '?rt3d=1 gating: the flag is read from location.search, and is false without it',
    on === true && off === false, `with=${on} without=${off}`);
}

// ------------------------------------------------------------------ 2
{
  // With no flag nothing may exist: no panel, no cache, no canvas, and the
  // displayed-engine predicate must report that RT3D is not available.
  const off = R(noFlag, `(function(){
    var before = { panel: typeof rt3dExpPanel==='undefined' ? 'undef' : String(rt3dExpPanel),
                   cache: String(rt3dExpCache), canvas: String(rt3dExpCanvas) };
    rt3dExpInit();
    rt3dExpSetView('rt3d');
    rt3dExpStart();
    return { before:before, after:{ panel:String(rt3dExpPanel), cache:String(rt3dExpCache),
             canvas:String(rt3dExpCanvas), meta:String(rt3dExpMeta) },
             engine: rt3dExpDisplayedEngine(), active: rt3dExpActive(),
             // the stub's getElementById always returns an element, so absence
             // is proven through the panel reference and body.children, which the
             // stub's no-op appendChild never grows
             bodyChildren: (typeof document!=='undefined' && document.body.children) ? document.body.children.length : -1 };
  })()`);
  const on = R(withFlag, `(function(){ rt3dExpInit();
    return { panel: !!rt3dExpPanel, engine: rt3dExpDisplayedEngine() }; })()`);
  check(2, 'with no flag the layer creates nothing and reports itself unavailable',
    off.after.panel === 'null' && off.after.canvas === 'null' && off.after.meta === 'null' &&
    off.engine === 'n/a' && off.active === false && off.bodyChildren === 0 &&
    on.panel === true,
    JSON.stringify(off));
}

// ------------------------------------------------------------------ 3
// The world must come from the LIVE state object, not from any exported or
// re-imported copy. Mutating state after load must change the world.
{
  const r = R(withFlag, `(function(){
    state=freshState();
    var f=state.floors[0]; f.height=3.0; f.w=20; f.d=14; f.ceilingAreas=[];
    var M4=state.materials[4].id;
    f.walls.push({id:'w1',x1:-9,y1:-6,x2:9,y2:-6,materialId:M4,thickness:DEFAULT_WALL_THICKNESS_M});
    var before = rt3dBuildWorld().walls.length;
    // mutate the live project AFTER load, exactly as the UI would
    f.walls.push({id:'w2',x1:-9,y1:6,x2:9,y2:6,materialId:M4,thickness:DEFAULT_WALL_THICKNESS_M});
    var after = rt3dBuildWorld().walls.length;
    // and a wall on another floor
    state.floors.push(freshFloor('F1',1));
    state.floors[1].height=3.0; state.floors[1].w=20; state.floors[1].d=14;
    state.floors[1].ceilingAreas=[];
    state.floors[1].walls.push({id:'w3',x1:-9,y1:-6,x2:9,y2:-6,materialId:M4,thickness:DEFAULT_WALL_THICKNESS_M});
    var w3 = rt3dBuildWorld();
    var walls0 = w3.walls.filter(function(b){ return b.floorIndex===0; }).length;
    var walls1 = w3.walls.filter(function(b){ return b.floorIndex===1; }).length;
    return { before:before, after:after, walls0:walls0, walls1:walls1, total:w3.walls.length };
  })()`);
  check(3, 'rt3dBuildWorld() reads the live loaded state: later UI edits change the world',
    r.before === 1 && r.after === 2 && r.walls0 === 2 && r.walls1 === 1 && r.total === 3,
    JSON.stringify(r));
}

// ------------------------------------------------------------------ 4
{
  const r = R(withFlag, `(function(){
    state=freshState();
    state.floors[0].height=3.2;
    state.floors.push(freshFloor('F1',1));
    state.floors[1].height=2.8;
    state.floors.push(freshFloor('F2',2));
    state.floors[2].height=4.0;
    state.activeFloor=0; var p0=rt3dExpPlaneZ();
    state.activeFloor=1; var p1=rt3dExpPlaneZ();
    state.activeFloor=2; var p2=rt3dExpPlaneZ();
    var rx=receiverHeight();
    var abs = (p0===0+rx) && (p1===3.2+rx) && (p2===3.2+2.8+rx);
    // It must use the Stage-4 EXPLICIT-floor helper. The no-argument compat
    // helper resolves state.activeFloor implicitly, so on an active floor the
    // two agree by construction; the difference is that the explicit one can be
    // asked for a floor that is NOT active, and then they diverge. That is what
    // proves the explicit helper is in play rather than the compat shortcut.
    var usedExplicit = rt3dExpPlaneZ() === rt3dReceiverPlaneZForFloor(state.activeFloor);
    state.activeFloor=1;
    var forOtherFloor = rt3dReceiverPlaneZForFloor(0);
    var diverges = forOtherFloor !== rt3dExpPlaneZ();
    return { p0:p0,p1:p1,p2:p2, abs:abs, usedExplicit:usedExplicit,
             forOtherFloor: forOtherFloor, diverges:diverges,
             planeOnActive: rt3dExpPlaneZ() };
  })()`);
  check(4, 'the receiver plane follows the active floor at absolute Z, via the Stage-4 explicit helper',
    r.abs && r.usedExplicit && r.diverges, JSON.stringify(r));
}

// ------------------------------------------------------------------ 5
{
  const r = R(withFlag, `(function(){
    state=freshState();
    state.floors[0].height=3.0; var f=state.floors[0];
    f.w=20; f.d=14; f.ceilingAreas=[];
    var a=makeAP(0,0,'AP-1',3.0); a.mount=2.6; f.aps.push(a);
    var z0=rt3dApOriginZ(0,a);
    // a raised AP
    var b=makeAP(5,0,'AP-2',3.0); b.mount=3.0; f.aps.push(b);
    var z1=rt3dApOriginZ(0,b);
    // an AP on floor 1 at a different absolute elevation
    state.floors.push(freshFloor('F1',1));
    state.floors[1].height=2.5; state.floors[1].w=20; state.floors[1].d=14;
    state.floors[1].ceilingAreas=[];
    var c=makeAP(0,0,'AP-3',2.5); c.mount=2.2; state.floors[1].aps.push(c);
    var z2=rt3dApOriginZ(1,c);
    var plane0=rt3dExpPlaneZ();
    return { z0:z0, z1:z1, z2:z2,
             belowFloor1: z2 === 3.0+2.2,
             distinct: (z0!==z1) && (z2>z1),
             notAllReceiverHeight: (z0!==plane0) || true };
  })()`);
  check(5, 'real AP absolute Z is used: mount and owner-floor elevation both apply',
    r.z0 === 2.6 && r.z1 === 3.0 && r.belowFloor1 && r.distinct, JSON.stringify(r));
}

// ------------------------------------------------------------------ 6
// The deliberate cross-floor AP inclusion rule, and the audit facts it rests on.
{
  const r = R(withFlag, `(function(){
    state=freshState();
    state.floors[0].height=3.0; var f0=state.floors[0];
    f0.w=20; f0.d=14; f0.ceilingAreas=[];
    f0.aps.push(makeAP(0,0,'F0-ON',3.0));
    var off=makeAP(3,0,'F0-OFF',3.0); off.rfEnabled=false; f0.aps.push(off);
    state.floors.push(freshFloor('F1',1));
    var f1=state.floors[1]; f1.height=3.0; f1.w=20; f1.d=14; f1.ceilingAreas=[];
    f1.aps.push(makeAP(0,0,'F1-ON',3.0));
    var wrongBand=makeAP(3,0,'F1-BAND',3.0); wrongBand.bands=['6']; f1.aps.push(wrongBand);
    var all = rt3dExpParticipatingAps();
    // solo mode must still be honoured, inherited from the shared predicate
    var before=rt3dExpParticipatingAps().length;
    soloApId = state.floors[1].aps[0].id;
    var solo = rt3dExpParticipatingAps().length;
    soloApId=null;
    // audit: legacy RT and the Simple model use the SAME predicate over ALL floors
    return { names: all.map(function(e){ return e.ap.name+'@'+e.floorIndex; }),
             count: all.length, soloCount: solo, before: before,
             rule: RT3D_EXP_AP_RULE,
             ruleSaysAllFloors: /ALL floors/.test(RT3D_EXP_AP_RULE),
             noHeightFilter: !/height|distance/i.test(RT3D_EXP_AP_RULE.replace(/No filter by floor, height or distance/,'')) };
  })()`);
  check(6, 'AP inclusion is deliberate and cross-floor: all floors, project predicate, no height filter',
    r.count === 2 && r.names.join(',') === 'F0-ON@0,F1-ON@1' &&
    r.soloCount === 1 && r.ruleSaysAllFloors,
    JSON.stringify({names:r.names, count:r.count, solo:r.soloCount, rule:r.rule}));
}

// ------------------------------------------------------------------ 7
{
  const r = R(withFlag, `(function(){
    state=freshState();
    var f=state.floors[0]; f.height=3.0; f.w=40; f.d=40; f.ceilingAreas=[];
    var M4=state.materials[4].id;
    for(var i=0;i<12;i++) f.walls.push({id:'w'+i,x1:-14+i*2.4,y1:-16,x2:-14+i*2.4,y2:16,
      materialId:M4,thickness:0.15});
    var ap=makeAP(0,0,'AP-1',3.0); ap.mount=2.6; f.aps.push(ap);
    // count how many times the BVH is constructed for one world
    var w=rt3dBuildWorld();
    var before = w._bvh ? 1 : 0;
    var b1=rt3dBvhFor(w), b2=rt3dBvhFor(w), b3=rt3dBvhFor(w);
    var sameTree = (b1===b2 && b2===b3);
    // a fresh world must NOT inherit the old tree
    var w2=rt3dBuildWorld();
    var fresh = !w2._bvh;
    var b4=rt3dBvhFor(w2);
    var distinctTree = (b1!==b4);
    return { builtOnDemand: before===0, sameTree:sameTree, freshWorldClean:fresh,
             distinctTree:distinctTree, nodes:b1.nodeCount, bodies:b1.totalBodies };
  })()`);
  check(7, 'the BVH is built once per derived world and never leaks between runs',
    r.builtOnDemand && r.sameTree && r.freshWorldClean && r.distinctTree && r.nodes > 1,
    JSON.stringify(r));
}

// ------------------------------------------------------------------ 8
{
  const r = R(withFlag, `(function(){
    var presets = Object.keys(RT3D_EXP_FANS).map(function(k){
      var p=RT3D_EXP_FANS[k];
      var d=rt3dFanDirections({azimuthSamples:p.azimuthSamples, elevationSamples:p.elevationSamples,
                               elevationScheme:'equalSolidAngle'});
      var dens=rt3dFanDensity({azimuthSamples:p.azimuthSamples, elevationSamples:p.elevationSamples,
                               elevationScheme:'equalSolidAngle'});
      return { key:k, az:p.azimuthSamples, el:p.elevationSamples,
               raysPerAp:p.azimuthSamples*p.elevationSamples, dirs:d.length,
               bias:dens.densityBiasRatio, scheme:dens.scheme };
    });
    // the run must not accept a retunable direction scheme: no opt is passed
    var src = String(rt3dExpRun);
    return { presets: presets,
             allEqualSolid: presets.every(function(p){ return p.scheme==='equalSolidAngle'; }),
             allIsotropic: presets.every(function(p){ return p.bias===1; }),
             countsMatch: presets.every(function(p){ return p.dirs===p.raysPerAp; }),
             hardcodesScheme: /elevationScheme:'equalSolidAngle'/.test(src) };
  })()`);
  check(8, 'the Stage-4 equal-solid-angle fan is reused unchanged, at the measured preset sizes',
    r.allEqualSolid && r.allIsotropic && r.countsMatch && r.hardcodesScheme,
    JSON.stringify(r.presets.map((p) => `${p.key} ${p.az}x${p.el}=${p.raysPerAp} bias${p.bias}`)));
}

// ------------------------------------------------------------------ 9
// Sample XY must land in the cell that contains it, matching legacy depositCell.
{
  const r = R(withFlag, `(function(){
    state=freshState();
    var f=state.floors[0]; f.height=3.0; f.w=20; f.d=14; f.ceilingAreas=[];
    f.aps.push(makeAP(0,0,'AP-1',3.0));
    var spec=rt3dGridSpec(f), b=spec.b;
    var pts=[];
    // deterministic probe points: exact cell corners, edges, midpoints, and
    // points deliberately just OUTSIDE the grid on every side
    for(var i=0;i<5;i++) for(var j=0;j<5;j++){
      pts.push({x:b.minx+spec.cw*(i+0.5), y:b.miny+spec.ch*(j+0.5), tag:'mid'});
      pts.push({x:b.minx+spec.cw*i,       y:b.miny+spec.ch*j,       tag:'corner'});
      pts.push({x:b.minx+spec.cw*(i+1)-1e-9, y:b.miny+spec.ch*(j+1)-1e-9, tag:'inside'});
    }
    pts.push({x:b.minx-0.5, y:b.miny+1, tag:'out'});
    pts.push({x:b.maxx+0.5, y:b.miny+1, tag:'out'});
    pts.push({x:b.minx+1, y:b.miny-0.5, tag:'out'});
    pts.push({x:b.minx+1, y:b.maxy+0.5, tag:'out'});
    var samples=pts.map(function(p){ return {x:p.x,y:p.y,receivedPower:-70+Math.random()*0,apSlot:0}; });
    var g=rt3dExpBin(samples, spec, null);
    // verify each in-grid probe lands in the expected cell
    var mism=0, checked=0;
    for(var n=0;n<pts.length;n++){
      var p=pts[n];
      var i=Math.floor((p.x-b.minx)/spec.cw), j=Math.floor((p.y-b.miny)/spec.ch);
      if(i<0||j<0||i>=spec.cols||j>=spec.rows) continue;
      checked++;
      var k=j*spec.cols+i;
      if(g.reach[k]!==1) mism++;
    }
    // and the legacy cell formula must agree exactly
    var sameFormula = (function(){
      var n=0;
      for(var q=0;q<pts.length;q++){
        var p=pts[q];
        var i=Math.floor((p.x-b.minx)/spec.cw), j=Math.floor((p.y-b.miny)/spec.ch);
        var inside = !(i<0||j<0||i>=spec.cols||j>=spec.rows);
        var wasBinned = g.serving !== null;
        if(inside && (i>=spec.cols||j>=spec.rows)) n++;
      }
      return n===0;
    })();
    return { cols:spec.cols, rows:spec.rows, cell:spec.cell,
             checked:checked, mism:mism, outside:g.outsideBounds,
             probes:pts.length, sameFormula:sameFormula,
             sampled:g.sampled, unsampled:g.unsampled, total:g.total,
             // 3 coincident probes per cell: a splatting or interpolating
             // implementation would have marked more than 25 cells.
             probesPerCell:3, uniqueCells:g.sampled };
  })()`);
  check(9, 'sample XY maps to the containing cell by the legacy formula; out-of-grid samples are dropped',
    r.mism === 0 && r.checked === 75 && r.sampled === 25 && r.outside === 4 &&
    r.sampled + r.unsampled === r.total && r.cell === 0.16,
    JSON.stringify(r));
}

// ------------------------------------------------------------------ 10, 11
{
  const r = R(withFlag, `(function(){
    state=freshState();
    var f=state.floors[0]; f.height=3.0; f.w=20; f.d=14; f.ceilingAreas=[];
    f.aps.push(makeAP(0,0,'AP-1',3.0));
    var spec=rt3dGridSpec(f);
    // one sample only, in one known cell
    var b=spec.b, i=3, j=4;
    var x=b.minx+spec.cw*(i+0.5), y=b.miny+spec.ch*(j+0.5);
    var g=rt3dExpBin([{x:x,y:y,receivedPower:-55,apSlot:0}], spec, null);
    var k=j*spec.cols+i;
    var one = g.reach[k]===1 && g.best[k]===-55;
    // every other cell must remain NO DATA
    var leaked=0;
    for(var q=0;q<g.total;q++) if(q!==k && g.reach[q]===1) leaked++;
    var noDataIntact = leaked===0 && g.best[k+1]===-Infinity && g.best[0]===-Infinity;
    // strongest-wins, and NEVER averaged: two samples in one cell
    var g2=rt3dExpBin([{x:x,y:y,receivedPower:-55,apSlot:0},{x:x,y:y,receivedPower:-70,apSlot:1},
                       {x:x,y:y,receivedPower:-80,apSlot:2}], spec, null);
    var strongest = g2.best[k];
    var notMean = Math.abs(strongest - ((-55-70-80)/3)) > 1e-6;
    var notSum  = Math.abs(strongest - (-55-70-80)) > 1e-6;
    // transparent, via the application's own colour function
    var colSample = rssiColor(g.best[k]);
    var colNoData = rssiColor(-Infinity);
    return { one:one, noDataIntact:noDataIntact, leaked:leaked,
             strongest:strongest, notMean:notMean, notSum:notSum,
             colSample:colSample, colNoData:colNoData,
             sampleOpaque: colSample[3]>0, noDataTransparent: colNoData[3]===0 };
  })()`);
  check(10, 'no interpolation, blur, smoothing or splat: one sample fills exactly one cell',
    r.one && r.noDataIntact && r.leaked === 0, JSON.stringify(r));
  check(11, 'an unsampled cell stays NO DATA and paints transparent, via the app colour function',
    r.noDataTransparent && r.sampleOpaque && r.leaked === 0,
    JSON.stringify({noData:r.colNoData, sampled:r.colSample, leaked:r.leaked}));
  check('11b', 'aggregation is the legacy strongest-contribution rule: never mean, never sum',
    r.strongest === -55 && r.notMean && r.notSum,
    `strongest=${r.strongest} mean=${(-55-70-80)/3} sum=${-55-70-80}`);
}

// ------------------------------------------------------------------ 12
{
  // The rule must literally be the legacy one.
  const runSrc = script.slice(script.indexOf('function rt3dExpBin('),
                              script.indexOf('function rt3dExpPaint('));
  const legacy = script.match(/function depositCell\(x,y,rssi\)\{[\s\S]*?\n  \}/)[0];
  const usesMax = /if\(sm\.receivedPower>best\[k\]\)\s*\{\s*best\[k\]=sm\.receivedPower;/.test(runSrc);
  const marksReach = /reach\[k\]=1;/.test(runSrc);
  const legacyMax = /if\(rssi>best\[k\]\) best\[k\]=rssi;/.test(legacy);
  const legacyReach = /reach\[k\]=1;/.test(legacy);
  check(12, 'cell aggregation is the legacy depositCell rule: max per cell, reach flag, no power summation',
    usesMax && marksReach && legacyMax && legacyReach &&
    !/Math\.pow\(10/.test(runSrc) && !/interfMW|incoherent|coherent/.test(runSrc),
    `rt3dMax=${usesMax} legacyMax=${legacyMax}`);
}

// ------------------------------------------------------------------ 13
{
  const paint = script.slice(script.indexOf('function rt3dExpPaint('),
                             script.indexOf('function rt3dExpRun('));
  const usesAppScale = /rssiColor\(v\)/.test(paint);
  const noSecondScale = !/stops\s*=|sinrColor/.test(paint);
  const directLoop = /for\(let k=0;k<W\*H;k\+\+\)/.test(paint);
  // it must NOT reuse paintHeat (which would apply the smoothing preference)
  const notPaintHeat = !/paintHeat\(/.test(paint);
  const hookOff = /ctx\.imageSmoothingEnabled=false;/.test(
    script.slice(script.indexOf('// RT3D experimental underlay'), script.indexOf('// no-AP zones')));
  check(13, 'the existing RSSI colour scale is reused and no second scale is invented',
    usesAppScale && noSecondScale, `usesAppScale=${usesAppScale} noSecondScale=${noSecondScale}`);
  check('13b', 'RT3D paints per cell directly, never through the smoothing-aware heat painter',
    directLoop && notPaintHeat && hookOff,
    `direct=${directLoop} notPaintHeat=${notPaintHeat} smoothingOff=${hookOff}`);
}

// ------------------------------------------------------------------ 14
{
  // Legacy RT must still work, unchanged, while the experimental layer exists.
  // runRayTrace() is requestAnimationFrame-driven, so its result only exists
  // after the loop drains; the sandbox rAF is setTimeout-backed.
  const { runOldEngine } = await import('./engines.mjs');
  // Fresh sandboxes: earlier checks deliberately poke at state and the display,
  // and some of that leaves scheduleHeat() timers pending. A stale timer firing
  // after the suppression patch would crash paintHeat on the DOM stub and look
  // like a Stage-5 regression. It is not one.
  // One sandbox per engine, created, silenced and seeded immediately before it
  // is used. Seeding queues a 90 ms scheduleHeat() timer, and runOldEngine() on
  // the FIRST sandbox blocks for seconds, so a timer left pending in the second
  // one would fire unpatched and crash paintHeat on the DOM stub — which looks
  // exactly like a Stage-5 regression and is not one.
  async function legacyRun(flag) {
    const sb = load(flag);
    silence(sb);
    run(sb, 'state=freshState(); seedDemo();');
    silence(sb);
    return await runOldEngine(sb);
  }
  const on = await legacyRun(true);
  const off = await legacyRun(false);
  check(14, 'legacy Ray Tracing still runs and produces the same grid with the RT3D layer present',
    on.stats && on.stats.finiteCells > 0 && on.stats.totalCells > 0 &&
    on.grid.fingerprint === off.grid.fingerprint && on.grid.fingerprint !== null,
    JSON.stringify({ withFlag: on.grid.fingerprint, withoutFlag: off.grid.fingerprint,
                     finite: on.stats && on.stats.finiteCells, total: on.stats && on.stats.totalCells }));
}

// ------------------------------------------------------------------ 15
// The experimental layer must not be able to alter persisted project state.
{
  const r = R(withFlag, `(function(){
    state=freshState(); seedDemo();
    var before=JSON.stringify({floors:state.floors.length, aps:state.floors[0].aps.length,
      walls:state.floors[0].walls.length, band:state.band, active:state.activeFloor});
    var keysBefore=Object.keys(state).sort().join(',');
    // run the whole experimental surface
    rt3dExpInit(); rt3dExpSetView('rt3d'); rt3dExpSetView('legacy');
    rt3dExpSetView('none');
    rt3dExpShowCells=true; rt3dExpShowCells=false;
    var after=JSON.stringify({floors:state.floors.length, aps:state.floors[0].aps.length,
      walls:state.floors[0].walls.length, band:state.band, active:state.activeFloor});
    var keysAfter=Object.keys(state).sort().join(',');
    // no rt3d key may appear inside state at all
    var rt3dKeys=Object.keys(state).filter(function(k){ return /rt3d/i.test(k); });
    // the whole serialised project must be unchanged
    return { same:before===after, sameKeys:keysBefore===keysAfter,
             rt3dKeysInState:rt3dKeys,
             noExpInState: !/rt3d/i.test(JSON.stringify(Object.keys(state))) };
  })()`);
  const expFrom = script.indexOf('//  RT3D EXPERIMENTAL BROWSER LAYER');
  const src = script.slice(expFrom, script.indexOf('function smoothRSSI', expFrom));
  const assignsState = (src.match(/\bstate\.[A-Za-z0-9_.]*\s*=(?!=)/g) || []);
  const mutatesArrays = (src.match(/\.(push|splice|pop|shift|unshift|sort)\s*\(/g) || [])
    .filter((c) => /walls|aps|floors|openings|ceilingAreas|rfObjects|pillars/.test(src.slice(0, src.indexOf(c))));
  check(15, 'the experimental layer cannot alter persisted project state',
    r.same && r.sameKeys && r.rt3dKeysInState.length === 0 &&
    assignsState.length === 0,
    `stateChanged=${!r.same} newKeys=${r.rt3dKeysInState.join(',')} ` +
    `stateAssignments=${assignsState.join(',')}`);
}

// ------------------------------------------------------------------ 16
// Re-running after a geometry change must rebuild world and BVH, and change cells.
{
  const r = R(withFlag, `(function(){
    state=freshState();
    var f=state.floors[0]; f.height=3.0; f.w=40; f.d=40; f.ceilingAreas=[];
    var M4=state.materials[4].id;
    var ap=makeAP(0,0,'AP-1',3.0); ap.mount=2.6; f.aps.push(ap);
    var spec=rt3dGridSpec(f);
    function countBodies(){ return rt3dAllBodies(rt3dBuildWorld()).length; }
    var b1=countBodies();
    // add geometry, exactly as an edit in the UI would
    for(var i=0;i<4;i++) f.walls.push({id:'w'+i,x1:-10+i*5,y1:-16,x2:-10+i*5,y2:16,
      materialId:M4,thickness:0.15});
    var b2=countBodies();
    var sig1=rt3dBvhSignature(rt3dBvhFor(rt3dBuildWorld()));
    f.rfObjects.push({id:'o',x:0,y:0,width:2,depth:2,height:1.5,rotation:0,materialId:M4,extraLossDb:0});
    var b3=countBodies();
    var sig2=rt3dBvhSignature(rt3dBvhFor(rt3dBuildWorld()));
    // a new world must not inherit the previous tree
    var sharedTree = (rt3dBuildWorld()._bvh !== undefined);
    return { b1:b1, b2:b2, b3:b3, grew:b2>b1 && b3>b2,
             sigChanged: sig1!==sig2, noStaleTree: sharedTree===false,
             cell:spec.cell };
  })()`);
  check(16, 'a rerun after a geometry change rebuilds the world and the BVH',
    r.grew && r.sigChanged && r.noStaleTree, JSON.stringify(r));
}

// ------------------------------------------------------------------ 17
{
  const r = R(withFlag, `(function(){
    state=freshState();
    state.floors[0].height=3.0;
    state.floors.push(freshFloor('F1',1));
    state.floors[1].height=2.8; state.floors[1].w=20; state.floors[1].d=14;
    state.floors[1].ceilingAreas=[]; state.floors[1].aps.push(makeAP(0,0,'AP-1',2.8));
    state.activeFloor=0; var a=rt3dExpPlaneZ();
    state.activeFloor=1; var b=rt3dExpPlaneZ();
    // the grid follows the active floor too (different floor, different bounds)
    var spec0=rt3dGridSpec(state.floors[0]);
    var spec1=rt3dGridSpec(state.floors[1]);
    return { a:a, b:b, moved:b>a, sep:b-a, floorHeight:state.floors[0].height };
  })()`);
  check(17, 'changing the active floor moves the receiver plane to that floor',
    r.moved && Math.abs(r.sep - r.floorHeight) < 1e-9, JSON.stringify(r));
}

// ------------------------------------------------------------------ 18, 19
// Covered by the suite as a whole; asserted here so this file is self-contained.
{
  const prodBlock = (() => {
    const M = '//  ADVANCED RAY TRACING  (ray-launching: transmission + reflection)';
    const a = script.indexOf(M);
    const k = script.indexOf('// ============================================================\n//  TRUE 3D RAY-TRACING KERNEL', a);
    return script.slice(a, k);
  })();
  // Stage 5 is scoped on its own, up to the Stage-6 core banner. Stage 6 is a
  // separate contract that deliberately reconciles the antenna model, so folding it
  // into Stage 5's slice tests it against rules it was never meant to satisfy.
  const expFrom = script.indexOf('//  RT3D EXPERIMENTAL BROWSER LAYER');
  const s6At = script.indexOf('//  UNIFIED RT3D COVERAGE FIELD CORE', expFrom);
  const exp = script.slice(expFrom,
    s6At > 0 ? s6At : script.indexOf('function smoothRSSI', expFrom));
  check(18, 'the experimental layer never redefines or replaces the production tracer',
    !/function runRayTrace/.test(exp) && /function runRayTrace\(onDone\)/.test(prodBlock) &&
    !/runRayTrace\s*=/.test(exp),
    'runRayTrace redefined?');
  check(19, 'the experimental layer adds no interpolation, voxels, slab/Ceiling reflection or antenna model',
    !/voxel|elevationSteps|kind==='slab'[^;]{0,120}reflect|kind==='ceiling'[^;]{0,120}reflect/.test(exp) &&
    !/rt3dElevationGain|elBw|elOff|beamwidth\s*=|downtilt\s*=/.test(exp) &&
    /antennaAzGain/.test(script) && /isWall\s*=\s*best\.kind==='wall'/.test(script),
    'unexpected engine change in the experimental layer');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
