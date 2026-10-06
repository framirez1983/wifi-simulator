// Stage 6.5c: the comparison-snapshot cache contract, driven through the REAL
// browser integration path (the same functions the page calls, in the same order).
//
// This suite exists because the first delta map failed on the real S4/PB run in
// exactly the sequence it was designed for. Every check below is one of the
// contract's own requirements, exercised end to end rather than in isolation.
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

// A two-floor project with an RF Object, so the ladder probes have something to
// find. Nothing about the audit depends on this scene; it just has to be a real
// project the real engines can process.
const SCENE = `
  state=freshState();
  state.floors.length=1;
  var f=state.floors[0];
  f.name='PB'; f.w=6; f.d=4; f.height=3.0; f.ceilingAreas=[]; f.pillars=[];
  f.walls=[]; f.rfObjects=[]; f.openings=[];
  var W=3,H=2,pts=[[-W,-H],[W,-H],[W,H],[-W,H]];
  for(var i=0;i<4;i++){var a=pts[i],b=pts[(i+1)%4];
    f.walls.push({id:'w'+i,x1:a[0],y1:a[1],x2:b[0],y2:b[1],materialId:state.materials[2].id,
                  thickness:DEFAULT_WALL_THICKNESS_M});}
  f.rfObjects.push({id:'rk',x:1,y:0,width:1,depth:1,height:1,rotation:0,
                    materialId:state.materials[4].id,extraLossDb:0});
  var ap=makeAP(-2,0,'AP-PB',3.0); ap.mount=2.6; ap.mountType='ceiling';
  ap.antenna={type:'omni',az:0,tilt:0,gain:3}; f.aps=[ap];
  var pa=JSON.parse(JSON.stringify(f));
  pa.id='flr_pa'; pa.name='PA'; pa.aps=[];
  var ap2=makeAP(2,0,'AP-PA',3.0); ap2.mount=2.6; ap2.mountType='ceiling';
  ap2.antenna={type:'omni',az:0,tilt:0,gain:3};
  pa.aps=[ap2];
  state.floors.push(pa);
  state.activeFloor=0;
`;

function sandbox() {
  const win = makeDom();
  win.location = { search: '?rt3d=1' };
  win.FileReader = class { readAsText(f) { this.result = f.__text; setTimeout(() => this.onload && this.onload(), 0); } };
  win.Image = class { set src(v) { if (this.onload) this.onload(); } };
  // the page's own drawing entry points, recorded rather than performed
  const ctx = vm.createContext(win);
  vm.runInContext(SRC, ctx, { filename: 'index.html<script>' });
  run(ctx, `
    paintHeat=function(){}; computeHeatSimple=function(){}; draw2d=function(){};
    coverageUpdate=function(){}; showToast=function(){}; refresh3dHeat=function(){};
    scheduleHeat=function(){}; build3d=function(){}; bootUI=function(){};
    clearTimeout(heatTimer);
    // a controllable animation-frame pump so the real runners can be driven
    window.__q=[];
    window.requestAnimationFrame=function(cb){ window.__q.push(cb); return window.__q.length; };
    window.cancelAnimationFrame=function(){};
    window.__step=function(n){
      var c=0; while(window.__q.length && c<(n||1)){ var q=window.__q.shift(); q(0); c++; }
      return c;
    };
  `);
  return ctx;
}
// Drive the REAL runRayTrace() (which uses a 35 ms real-time budget per frame) and
// the REAL coverage runner to completion.
// doneExpr is the completion test for THIS run. It must not be shared: after the
// Legacy run heatGridRssi is already non-null, so a generic "is there a grid"
// predicate reports done before the coverage run has executed a single frame.
async function finish(ctx, doneExpr, maxFrames) {
  for (let i = 0; i < (maxFrames || 400000); i++) {
    if (run(ctx, doneExpr)) return true;
    await new Promise(r => setImmediate(r));
    run(ctx, 'window.__step(1)');
  }
  return false;
}
const LEGACY_DONE = '!!(heatGridRssi && lastRayTraceStats)';
// Floor-aware: rt3dExpLastCoverageBest is a single global, so after PB it is
// already set and a global predicate reports PA's run as finished before it has
// executed a frame.
const rt3dDoneExpr = (id) => `!!(rt3dAuditRt3dByFloor[${JSON.stringify(id)}] && rt3dAuditRt3dByFloor[${JSON.stringify(id)}].grid.length)`;
const noQueue = '!window.__q.length';
const retain = (ctx) => JSON.parse(run(ctx, 'JSON.stringify(rt3dAuditRetainedFloors())'));
const pair = (ctx) => JSON.parse(run(ctx, 'JSON.stringify(rt3dAuditComparisonPair(floor().id))'));
const gate = (ctx) => JSON.parse(run(ctx, 'JSON.stringify(!!rt3dAuditBuildDeltaMap())'));

console.log('Stage 6.5c comparison-snapshot cache contract\n');

// ============ 1..4  PB: Legacy -> RT3D -> delta map  (the reported failure) ======
{
  const ctx = sandbox();
  run(ctx, SCENE);
  run(ctx, 'rt3dAuditClearRetained(); rt3dExpInit();');
  // 1. complete Legacy through the real experimental wrapper
  run(ctx, 'rt3dExpRunLegacy();');
  const legacyDone = await finish(ctx, LEGACY_DONE);
  check(1, 'the real Legacy run completes and is retained per floor',
    legacyDone && pair(ctx).legacy !== null,
    JSON.stringify(pair(ctx).legacy && pair(ctx).legacy.floorId));
  check(2, 'the retained Legacy snapshot is an independent copy, not the live array',
    pair(ctx).legacy && pair(ctx).legacy.grid != null &&
    String(run(ctx, 'String(rt3dAuditLegacyByFloor[floor().id].grid === heatGridRssi)')).trim() === 'false',
    'the store may be aliasing the live grid');
  // 2. complete RT3D coverage, which switches the displayed view to RT3D
  run(ctx, 'rt3dExpRunCoverage();');
  const rt3dDone = await finish(ctx, rt3dDoneExpr(run(ctx,'floor().id')), 400000);
  check(3, 'the real Stage-6 coverage run completes and is retained per floor',
    rt3dDone && pair(ctx).rt3d !== null, JSON.stringify(retain(ctx)));
  check(4, 'after switching the displayed view to RT3D, BOTH snapshots are still available',
    pair(ctx).ready === true, JSON.stringify(pair(ctx)));
  check(5, 'the delta map now builds: PB Legacy -> PB RT3D -> delta map',
    gate(ctx) === true, 'gate refused even though both runs completed');
  check(6, 'the delta map used real grids, not the displayed engine',
    (() => {
      const s = JSON.parse(run(ctx, `JSON.stringify((function(){
        var p=rt3dAuditComparisonPair(floor().id);
        var spec={cols:p.legacy.cols, rows:p.legacy.rows, cell:0.16, cw:1, ch:1,
                  b:{minx:0,miny:0,maxx:p.legacy.cols,maxy:p.legacy.rows}};
        return rt3dAuditDeltaStats(p.legacy.grid, p.rt3d.grid, spec);
      })())`));
      return s.cellsCompared > 0;
    })(), 'the delta statistics compared zero cells');
}

// ============ 29..31  the store must survive losing the DISPLAY artifacts ======
{
  const ctx = sandbox();
  run(ctx, SCENE);
  run(ctx, 'rt3dAuditClearRetained(); rt3dExpInit();');
  run(ctx, 'rt3dExpRunLegacy();');
  await finish(ctx, LEGACY_DONE);
  run(ctx, 'rt3dExpRunCoverage();');
  await finish(ctx, rt3dDoneExpr(run(ctx, 'floor().id')));

  // --- the store must survive losing the DISPLAY artifacts -------------------
  // This is the check the first suite was missing, and its absence is why a mutation
  // reinstating the original display-state gate passed every test. In the real browser
  // the coverage switch destroys heatRtReach and heatGridRssi (the application clears
  // both when showHeat goes false); the harness stubs the function that does it, so
  // nothing was destroying them here and the defect was invisible. So the destruction
  // is performed EXPLICITLY, which is stronger than relying on a stubbed side effect.
  // It lives in this block rather than one of its own: a fresh sandbox would cost
  // another full Legacy + coverage run, and the suite was over the runner's step
  // timeout.
  const sig = run(ctx, `JSON.stringify((function(){
    var p=rt3dAuditComparisonPair(floor().id);
    return [p.legacy.grid.join(','), p.rt3d.grid.join(',')];
  })())`);
  run(ctx, 'heatRtReach=null; heatGridRssi=null; heatGridDisp=null; heatCanvas=null; heatMeta=null;');
  check(29, 'the retained pair survives heatRtReach, heatGridRssi and heatMeta being cleared',
    run(ctx, `JSON.stringify((function(){
      var p=rt3dAuditComparisonPair(floor().id);
      return [p.legacy && p.legacy.grid.join(','), p.rt3d && p.rt3d.grid.join(',')];
    })())`) === sig, 'a retained grid changed when the display artifacts were cleared');
  check(30, 'the delta map still builds with no live heat artifacts at all',
    gate(ctx) === true, 'the gate still depended on cleared display state');
  check(31, 'the delta statistics come from the retained pair, not the display',
    (() => {
      const st = JSON.parse(run(ctx, `JSON.stringify((function(){
        var p=rt3dAuditComparisonPair(floor().id);
        var spec={cols:p.legacy.cols,rows:p.legacy.rows,cell:0.16,cw:1,ch:1,
                  b:{minx:0,miny:0,maxx:p.legacy.cols,maxy:p.legacy.rows}};
        return rt3dAuditDeltaStats(p.legacy.grid, p.rt3d.grid, spec);
      })())`));
      return st.cellsCompared > 0;
    })());
}

// ============ 7..9  running RT3D must not destroy the Legacy snapshot ===========
{
  const ctx = sandbox();
  run(ctx, SCENE);
  run(ctx, 'rt3dAuditClearRetained(); rt3dExpInit();');
  run(ctx, 'rt3dExpRunLegacy();');
  await finish(ctx, LEGACY_DONE);
  const before = run(ctx, 'rt3dAuditLegacyByFloor[floor().id].grid.join(",")');
  run(ctx, 'rt3dExpRunCoverage();');
  await finish(ctx, rt3dDoneExpr(run(ctx,'floor().id')), 400000);
  const after = run(ctx, 'rt3dAuditLegacyByFloor[floor().id].grid.join(",")');
  check(7, 'running RT3D after Legacy leaves the Legacy grid byte-identical',
    before === after, 'the retained Legacy grid changed');
  check(8, 'the retained Legacy grid still has the right dimensions',
    pair(ctx).legacy.cols * pair(ctx).legacy.rows ===
    JSON.parse(run(ctx, 'JSON.stringify(rt3dAuditLegacyByFloor[floor().id].grid.length)')),
    'dimension mismatch');
  check(9, 'the Legacy snapshot survives being copied into the store at RT3D time',
    pair(ctx).ready === true);
}

// ============ 10..12  RT3D -> Legacy order =====================================
{
  const ctx = sandbox();
  run(ctx, SCENE);
  run(ctx, 'rt3dAuditClearRetained(); rt3dExpInit();');
  run(ctx, 'rt3dExpRunCoverage();');
  const okA = await finish(ctx, rt3dDoneExpr(run(ctx,'floor().id')), 400000);
  check(10, 'RT3D first: the coverage grid is retained', okA && pair(ctx).rt3d !== null);
  run(ctx, 'rt3dExpRunLegacy();');
  await finish(ctx, LEGACY_DONE);
  check(11, 'Legacy second: both snapshots coexist', pair(ctx).ready === true,
    JSON.stringify(retain(ctx)));
  check(12, 'RT3D -> Legacy also builds the delta map', gate(ctx) === true);
}

// ============ 13..15  repeated display toggles must destroy nothing =============
{
  const ctx = sandbox();
  run(ctx, SCENE);
  run(ctx, 'rt3dAuditClearRetained(); rt3dExpInit();');
  run(ctx, 'rt3dExpRunLegacy();');
  await finish(ctx, LEGACY_DONE);
  run(ctx, 'rt3dExpRunCoverage();');
  await finish(ctx, rt3dDoneExpr(run(ctx,'floor().id')), 400000);
  const l0 = run(ctx, 'rt3dAuditLegacyByFloor[floor().id].grid.join(",")');
  const r0 = run(ctx, 'rt3dAuditRt3dByFloor[floor().id].grid.join(",")');
  for (let i = 0; i < 6; i++) {
    run(ctx, `rt3dExpSetView('${i % 2 ? 'legacy' : 'rt3d'}');`);
    run(ctx, "rt3dExpSetView('none');");
  }
  check(13, 'toggling the displayed view repeatedly changes neither grid',
    l0 === run(ctx, 'rt3dAuditLegacyByFloor[floor().id].grid.join(\",\")') &&
    r0 === run(ctx, 'rt3dAuditRt3dByFloor[floor().id].grid.join(\",\")'),
    'a view toggle mutated a retained snapshot');
  check(14, 'availability does not depend on the displayed engine',
    run(ctx, `JSON.stringify((function(){
      var out=[];
      for(const v of ['none','legacy','rt3d','none']){ rt3dExpSetView(v);
        out.push(rt3dAuditComparisonPair(floor().id).ready); }
      return out;
    })())`) === '[true,true,true,true]',
    'availability changed with the view');
  check(15, 'the delta map still builds after all that toggling', gate(ctx) === true);
}

// ============ 16..18  floor isolation ==========================================
{
  const ctx = sandbox();
  run(ctx, SCENE);
  run(ctx, 'rt3dAuditClearRetained(); rt3dExpInit();');
  // PB: complete both
  run(ctx, 'rt3dExpRunLegacy();');
  await finish(ctx, LEGACY_DONE);
  run(ctx, 'rt3dExpRunCoverage();');
  await finish(ctx, rt3dDoneExpr(run(ctx,'floor().id')), 400000);
  check(16, 'PB has both grids', pair(ctx).ready === true);
  // switch to PA: nothing has been computed there
  run(ctx, 'state.activeFloor=1;');
  check(17, 'PA refuses to compare, because it has neither grid',
    pair(ctx).ready === false && gate(ctx) === false,
    JSON.stringify(pair(ctx)));
  // compute PA legacy only
  run(ctx, 'rt3dExpRunLegacy();');
  await finish(ctx, LEGACY_DONE);
  check(18, 'PA with Legacy only still refuses', pair(ctx).ready === false);
  // complete PA RT3D
  run(ctx, 'rt3dExpRunCoverage();');
  await finish(ctx, rt3dDoneExpr(run(ctx,'floor().id')), 400000);
  check(19, 'PA becomes comparable once it has both', pair(ctx).ready === true);
  check(20, "PB's pair survived PA being computed",
    (() => { const pb = run(ctx, "JSON.stringify(rt3dAuditComparisonPair(state.floors[0].id))");
             return pb.includes('"ready":true'); })(),
    'PB was lost while PA was computed');
  check(21, 'switching back to PA and on to PB both stay comparable',
    (() => {
      const a = JSON.parse(run(ctx, "JSON.stringify((function(){state.activeFloor=1;return rt3dAuditComparisonPair(floor().id).ready;})())"));
      const b = JSON.parse(run(ctx, "JSON.stringify((function(){state.activeFloor=0;return rt3dAuditComparisonPair(floor().id).ready;})())"));
      return a === true && b === true;
    })());
}

// ============ 22..24  the store, not the display, gates availability ===========
{
  const ctx = sandbox();
  run(ctx, SCENE);
  run(ctx, 'rt3dAuditClearRetained(); rt3dExpInit();');
  check(22, 'with no runs at all the gate refuses', gate(ctx) === false);
  // deliberately make the display look like a Legacy result WITHOUT a completed run
  run(ctx, `heatGridRssi=new Float32Array(400).fill(-70);
            heatMeta={floorId:floor().id,minx:-6,miny:-4,maxx:6,maxy:4,cols:20,rows:20};
            heatMetric='rssi'; heatRtReach=null; lastRayTraceStats=null;`);
  check(23, 'a displayed grid with no completed-run evidence is NOT retained',
    pair(ctx).legacy === null, JSON.stringify(retain(ctx)));
  check(24, 'and the gate still refuses, rather than comparing against a display artefact',
    gate(ctx) === false);
}

// ============ 25..26  the grid actually handed over is a real grid ============
{
  const ctx = sandbox();
  run(ctx, SCENE);
  run(ctx, 'rt3dAuditClearRetained(); rt3dExpInit();');
  run(ctx, 'rt3dExpRunLegacy();');
  await finish(ctx, LEGACY_DONE);
  run(ctx, 'rt3dExpRunCoverage();');
  await finish(ctx, rt3dDoneExpr(run(ctx,'floor().id')), 400000);
  const info = JSON.parse(run(ctx, `JSON.stringify((function(){
    var p=rt3dAuditComparisonPair(floor().id);
    return {
      legacyFinite: p.legacy.grid.reduce(function(a,v){return a+(Number.isFinite(v)?1:0);},0),
      rt3dFinite:   p.rt3d.grid.reduce(function(a,v){return a+(Number.isFinite(v)?1:0);},0),
      legacyLen: p.legacy.grid.length, rt3dLen: p.rt3d.grid.length,
      legacyCols: p.legacy.cols, rt3dCols: p.rt3d.cols,
      legacyRows: p.legacy.rows, rt3dRows: p.rt3d.rows
    };
  })())`));
  check(25, 'both retained grids are populated Float32Arrays of equal length',
    info.legacyLen > 0 && info.legacyLen === info.rt3dLen &&
    info.legacyFinite > 0 && info.rt3dFinite > 0, JSON.stringify(info));
  check(26, 'both retained grids describe the same cells',
    info.legacyCols === info.rt3dCols && info.legacyRows === info.rt3dRows,
    JSON.stringify(info));
}

// ============ 27..28  retention is not project state ===========================
{
  const ctx = sandbox();
  run(ctx, SCENE);
  const before = run(ctx, 'JSON.stringify(Object.keys(state))');
  run(ctx, 'rt3dAuditClearRetained(); rt3dExpInit(); rt3dExpRunLegacy();');
  await finish(ctx, LEGACY_DONE);
  run(ctx, 'rt3dExpRunCoverage();');
  await finish(ctx, rt3dDoneExpr(run(ctx,'floor().id')), 400000);
  check(27, 'the snapshot store adds no project state keys',
    before === run(ctx, 'JSON.stringify(Object.keys(state))'));
  check(28, 'the snapshot store is not reachable from state, so it cannot be saved',
    run(ctx, 'JSON.stringify(Object.keys(state).filter(function(k){return /legacyByFloor|Rt3dByFloor/i.test(k);}))') === '[]');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
