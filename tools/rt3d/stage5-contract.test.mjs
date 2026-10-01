// Stage 5 result / grid-spec CONTRACT test — behavioural, not source inspection.
//
// The real browser run failed with:
//
//     RT3D finalisation failed: can't access property "b", res.spec is undefined
//
// rt3dExpStart()'s onDone read res.spec.b, but the result object never had a
// spec: rt3dExpBin() returned a bare data grid, finalize() patched a spec onto
// the GRID after the fact, and the result carried only gridCellM. So the grid
// and the result had two different, half-implemented owners of the same
// contract, and the one the meta builder wanted did not exist.
//
// The previous 176-check suite missed it because nothing ever executed the real
// browser integration path end to end: rt3dExpStart() was only called on a
// sandbox with the flag OFF, and the completion tests supplied their own hooks
// instead of the production ones. This file closes that gap. Every check below
// drives the REAL rt3dExpStart() -> rt3dExpRun() -> finalize() -> onDone ->
// rt3dExpPaint() -> rt3dExpSetView() path.
//
// THE CONTRACT BEING PINNED
//   The RUN RESULT is the single owner of the canonical grid specification.
//     result.spec   exact rt3dGridSpec() used for binning, incl. floor bounds
//     result.grid   bin DATA only: best, reach, serving, counters
//   The grid carries no spec, so a caller cannot paint cells without also
//   declaring which grid they belong to.
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
  if (cond) { pass++; console.log(`  ok   ${String(id).padStart(2)}. ${name}`); }
  else {
    fail++; failures.push(`${id}. ${name}${detail ? ' :: ' + detail : ''}`);
    console.log(`  FAIL ${String(id).padStart(2)}. ${name}${detail ? ' :: ' + detail : ''}`);
  }
}

// A sandbox whose DOM stub records what the panel and canvases actually received,
// so the real integration path can be driven and inspected.
function makeSandbox() {
  const win = makeDom();
  win.location = { search: '?rt3d=1' };
  const built = [];
  // every element the app creates, so we can inspect the canvas that
  // rt3dExpPaint() produced
  const doc = win.document;
  const origCreate = doc.createElement;
  doc.createElement = (tag) => {
    const e = origCreate(tag);
    if (String(tag).toLowerCase() === 'canvas') {
      e.tagName = 'canvas';
      built.push(e);
    }
    return e;
  };
  const ctx = vm.createContext(win);
  vm.runInContext(SRC, ctx, { filename: 'index.html<script>' });
  run(ctx, `
    paintHeat=function(){}; computeHeatSimple=function(){}; coverageUpdate=function(){};
    showToast=function(){}; refresh3dHeat=function(){}; scheduleHeat=function(){};
    clearTimeout(heatTimer);
    // record the real draw2d invocations instead of rendering: the canvas work
    // is covered by inspecting the canvas rt3dExpPaint() returns.
    window.__drawCalls=0;
    draw2d=function(){ window.__drawCalls++; };
    window.__canvasBuilt = 0;
  `);
  return { ctx, canvases: built };
}

// Two floors with different geometry, so a spec from one can never be confused
// with a spec from the other.
function twoFloors(sb) {
  run(sb.ctx, `
    state=freshState();
    var M4=state.materials[4].id;
    var f0=state.floors[0];
    f0.name='PB'; f0.height=3.2; f0.w=26; f0.d=17; f0.ceilingAreas=[];
    f0.walls.push({id:'w0',x1:-13,y1:-8,x2:13,y2:-8,materialId:M4,thickness:DEFAULT_WALL_THICKNESS_M});
    f0.aps.push(makeAP(-6,0,'AP-PB-1',3.2));
    f0.aps.push(makeAP(6,0,'AP-PB-2',3.2));
    state.floors.push(freshFloor('PA',1));
    var f1=state.floors[1];
    f1.name='PA'; f1.height=2.9; f1.w=34; f1.d=22; f1.ceilingAreas=[];
    f1.walls.push({id:'w1',x1:-17,y1:-11,x2:17,y2:-11,materialId:M4,thickness:DEFAULT_WALL_THICKNESS_M});
    f1.aps.push(makeAP(0,0,'AP-PA-1',2.9));
    state.activeFloor=0;
  `);
}

// Drive the REAL integration path: rt3dExpStart() and let its own rAF loop run.
// The sandbox rAF is setTimeout-backed, so pumping the macrotask queue is enough.
async function runThroughUi(sb, { floor = 0 } = {}) {
  run(sb.ctx, `state.activeFloor=${floor};`);
  // Clear the previous run's result so this run's poll is not satisfied by the
  // last one. Test setup only: it does not change what the app does.
  run(sb.ctx, 'rt3dExpLastResult=null; rt3dExpLastError=null; rt3dExpCanvas=null;' +
              'rt3dExpSpec=null; rt3dExpMeta=null; rt3dExpCells=null;');
  const before = sb.canvases.length;
  run(sb.ctx, 'rt3dExpStart();');
  // Drive the sandbox's setTimeout-backed rAF until the real onDone fires. The
  // deadline is wall-clock, not an iteration count: a job legitimately occupies
  // the loop for seconds, and a guard-count poll would expire before it.
  await run(sb.ctx, `new Promise(function(res){
    var deadline = Date.now() + 180000;
    (function tick(){
      if(rt3dExpLastResult || rt3dExpLastError) return res(1);
      if(Date.now() > deadline) return res(0);
      setTimeout(tick, 1);
    })();
  })`);
  return { result: JSON.parse(run(sb.ctx, `JSON.stringify((function(){
      if(!rt3dExpLastResult) return null;
      var r=rt3dExpLastResult;
      return { hasSpec: !!r.spec, spec: r.spec,
               floorIndex: r.floorIndex, floorId: r.floorId, floorName: r.floorName,
               receiverPlaneZ: r.receiverPlaneZ,
               total: r.grid.total, sampled: r.grid.sampled, samples: r.samples.length,
               gridHasSpec: !!r.grid.spec, finishReason: r.finishReason };
    })())`)),
    error: run(sb.ctx, 'rt3dExpLastError ? String(rt3dExpLastError) : null'),
    newCanvases: sb.canvases.length - before,
    canvas: sb.canvases[sb.canvases.length - 1],
    drawCalls: JSON.parse(run(sb.ctx, 'JSON.stringify(window.__drawCalls)')),
    meta: JSON.parse(run(sb.ctx, `JSON.stringify(rt3dExpMeta)`)),
    spec: JSON.parse(run(sb.ctx, `JSON.stringify(rt3dExpSpec)`)),
    cellsLen: JSON.parse(run(sb.ctx, 'JSON.stringify(rt3dExpCells?rt3dExpCells.length:0)')),
  };
}

console.log('Stage 5 result / grid-spec contract (behavioural)\n');

// ---------------------------------------------------------------- 1
// The reported bug: a completed result must carry its grid spec.
{
  const sb = makeSandbox();
  twoFloors(sb);
  const r = await runThroughUi(sb, { floor: 0 });
  check(1, 'a completed RT3D result carries its grid spec (res.spec is defined)',
    r.result && r.result.hasSpec && r.error === null,
    JSON.stringify({ error: r.error, hasSpec: r.result && r.result.hasSpec }));
}

// ---------------------------------------------------------------- 2
// The run completed and produced real data.
{
  const sb = makeSandbox();
  twoFloors(sb);
  const r = await runThroughUi(sb, { floor: 0 });
  const res = r.result;
  check(2, 'the job completed through the real UI path with real samples',
    res && res.samples > 0 && res.sampled > 0 && res.finishReason === 'completed',
    JSON.stringify(res && { samples: res.samples, sampled: res.sampled, reason: res.finishReason }));
}

// ---------------------------------------------------------------- 3
// The grid must NOT own a spec: the result is the single owner.
{
  const sb = makeSandbox();
  twoFloors(sb);
  const r = await runThroughUi(sb, { floor: 0 });
  check(3, 'the grid carries no spec of its own — the result is the single owner',
    r.result && r.result.hasSpec && r.result.gridHasSpec === false,
    JSON.stringify(r.result && { hasSpec: r.result.hasSpec, gridHasSpec: r.result.gridHasSpec }));
}

// ---------------------------------------------------------------- 4
// The spec must be the EXACT rt3dGridSpec used for binning.
{
  const sb = makeSandbox();
  twoFloors(sb);
  const r = await runThroughUi(sb, { floor: 0 });
  const expect = JSON.parse(run(sb.ctx, `JSON.stringify(rt3dGridSpec(state.floors[0]))`));
  const got = r.result && r.result.spec;
  const same = got && expect &&
    got.cols === expect.cols && got.rows === expect.rows &&
    got.cell === expect.cell && got.cw === expect.cw && got.ch === expect.ch &&
    got.b.minx === expect.b.minx && got.b.miny === expect.b.miny &&
    got.b.maxx === expect.b.maxx && got.b.maxy === expect.b.maxy;
  check(4, 'the result spec is byte-equal to rt3dGridSpec() for the run floor',
    same && r.result.total === expect.cols * expect.rows,
    JSON.stringify({ got: got && { cols: got.cols, rows: got.rows, cell: got.cell },
                     expect: { cols: expect.cols, rows: expect.rows, cell: expect.cell },
                     total: r.result && r.result.total }));
}

// ---------------------------------------------------------------- 5
// Painting must not throw, and the canvas must match that spec.
{
  const sb = makeSandbox();
  twoFloors(sb);
  const r = await runThroughUi(sb, { floor: 0 });
  const spec = r.result && r.result.spec;
  const c = r.canvas;
  check(5, 'painting completes without throwing and the canvas matches the result spec',
    r.error === null && !!c && c.width === spec.cols && c.height === spec.rows,
    JSON.stringify({ error: r.error, canvas: c && [c.width, c.height],
                     spec: spec && [spec.cols, spec.rows] }));
}

// ---------------------------------------------------------------- 6
// The cell list and the displayed meta must come from the same spec.
{
  const sb = makeSandbox();
  twoFloors(sb);
  const r = await runThroughUi(sb, { floor: 0 });
  const spec = r.result && r.result.spec;
  const metaOk = r.meta && r.meta.minx === spec.b.minx && r.meta.maxx === spec.b.maxx &&
                 r.meta.miny === spec.b.miny && r.meta.maxy === spec.b.maxy &&
                 r.meta.floorId === r.result.floorId;
  // 2 ints per sampled cell
  const cellsOk = !!r.result && r.cellsLen === 2 * r.result.sampled;
  const specSame = r.spec && r.spec.cols === spec.cols && r.spec.rows === spec.rows;
  check(6, 'cached meta, cached spec and the cell list all derive from one snapshot',
    metaOk && cellsOk && specSame,
    JSON.stringify({ metaOk, cellsOk, specSame, cells: r.cellsLen,
                     sampled: r.result && r.result.sampled }));
}

// ---------------------------------------------------------------- 7
// The view must actually have been switched and redrawn.
{
  const sb = makeSandbox();
  twoFloors(sb);
  const r = await runThroughUi(sb, { floor: 0 });
  const state = JSON.parse(run(sb.ctx, `JSON.stringify({
    choice: rt3dExpChoice, engine: rt3dExpDisplayedEngine(),
    showHeat: showHeat, hasCanvas: !!rt3dExpCanvas, hasSpec: !!rt3dExpSpec })`));
  check(7, 'finalization marks RT3D as displayed, turns the legacy layer off and redraws',
    state.choice === 'rt3d' && state.engine === 'rt3d' && state.showHeat === false &&
    state.hasCanvas && state.hasSpec && r.drawCalls > 0,
    JSON.stringify({ ...state, drawCalls: r.drawCalls }));
}

// ---------------------------------------------------------------- 8
// SNAPSHOT: PB run, then switch the active floor to PA BEFORE repainting.
// The cached PB result must still describe PB.
{
  const sb = makeSandbox();
  twoFloors(sb);
  const pb = await runThroughUi(sb, { floor: 0 });
  run(sb.ctx, 'state.activeFloor=1; draw2d();');
  const after = JSON.parse(run(sb.ctx, `JSON.stringify({
    cachedFloorIndex: rt3dExpLastResult.floorIndex,
    cachedFloorId: rt3dExpLastResult.floorId,
    cachedFloorName: rt3dExpLastResult.floorName,
    cachedPlaneZ: rt3dExpLastResult.receiverPlaneZ,
    cachedSpecCols: rt3dExpLastResult.spec.cols,
    cachedSpecRows: rt3dExpLastResult.spec.rows,
    cachedSpecMinx: rt3dExpLastResult.spec.b.minx,
    cachedMetaFloorId: rt3dExpMeta.floorId,
    engine: rt3dExpDisplayedEngine(),
    activeFloor: state.activeFloor
  })`));
  const pbSpec = (pb.result && pb.result.spec) || {};
  const pbRes = pb.result || {};
  check(8, 'after switching to PA the cached PB result still carries the PB spec and plane',
    !!pb.result &&
    after.cachedFloorIndex === 0 && after.cachedFloorName === 'PB' &&
    after.cachedSpecCols === pbSpec.cols && after.cachedSpecRows === pbSpec.rows &&
    after.cachedSpecMinx === pbSpec.b.minx &&
    after.cachedPlaneZ === pbRes.receiverPlaneZ &&
    after.cachedMetaFloorId === pbRes.floorId,
    JSON.stringify(after));
  check('8b', 'a result belonging to another floor is NOT reported as the displayed engine',
    after.engine === 'none' && after.activeFloor === 1,
    JSON.stringify({ engine: after.engine, activeFloor: after.activeFloor }));
}

// ---------------------------------------------------------------- 9
// PB then PA: each cached result keeps its own correct spec.
{
  const sb = makeSandbox();
  twoFloors(sb);
  const pb = await runThroughUi(sb, { floor: 0 });
  const pa = await runThroughUi(sb, { floor: 1 });
  if(!pb.result || !pa.result){
    check(9, 'a PB run and a PA run each keep their own spec, plane and cell count', false,
          'a run did not produce a result: ' + JSON.stringify({pb:!!pb.result, pa:!!pa.result}));
  }
  const pbExpect = JSON.parse(run(sb.ctx,
    'JSON.stringify(rt3dGridSpec(state.floors[0]))'));
  const paExpect = JSON.parse(run(sb.ctx,
    'JSON.stringify(rt3dGridSpec(state.floors[1]))'));
  const cache = JSON.parse(run(sb.ctx, 'JSON.stringify(rt3dExpCache.rt3d ? ' +
    '{floorIndex:rt3dExpCache.rt3d.floorIndex, floorName:rt3dExpCache.rt3d.floorName, ' +
    'planeZ:rt3dExpCache.rt3d.receiverPlaneZ, cols:rt3dExpCache.rt3d.spec.cols, ' +
    'rows:rt3dExpCache.rt3d.spec.rows, total:rt3dExpCache.rt3d.grid.total, ' +
    'sampled:rt3dExpCache.rt3d.grid.sampled} : null)'));
  const pbOk = pb.result.spec.cols === pbExpect.cols && pb.result.spec.rows === pbExpect.rows;
  const paOk = pa.result.spec.cols === paExpect.cols && pa.result.spec.rows === paExpect.rows;
  if(!pb.result || !pa.result){
    check('9b', 'the cache holds the PA result with PA geometry', false, 'no result to check');
    console.log(`\n${pass} passed, ${fail} failed`);
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  const distinct = pb.result.spec.cols !== pa.result.spec.cols ||
                   pb.result.spec.rows !== pa.result.spec.rows ||
                   pb.result.receiverPlaneZ !== pa.result.receiverPlaneZ;
  check(9, 'a PB run and a PA run each keep their own spec, plane and cell count',
    pbOk && paOk && distinct && pa.result.floorIndex === 1 && pa.result.floorName === 'PA' &&
    pa.result.receiverPlaneZ === 3.2 + 1.2 && pb.result.receiverPlaneZ === 1.2,
    JSON.stringify({ pbOk, paOk, distinct,
                     pb: { cols: pb.result.spec.cols, rows: pb.result.spec.rows, z: pb.result.receiverPlaneZ },
                     pa: { cols: pa.result.spec.cols, rows: pa.result.spec.rows, z: pa.result.receiverPlaneZ } }));
  check('9b', 'the cache holds the PA result with PA geometry and total matching its spec',
    cache && cache.floorIndex === 1 && cache.cols === paExpect.cols &&
    cache.rows === paExpect.rows && cache.total === paExpect.cols * paExpect.rows,
    JSON.stringify({ cache, paExpect: { cols: paExpect.cols, rows: paExpect.rows } }));
}

// ---------------------------------------------------------------- 10
// Switching Legacy <-> RT3D restores each cached grid without recomputation.
{
  const sb = makeSandbox();
  twoFloors(sb);
  await runThroughUi(sb, { floor: 0 });
  const canvasId = sb.canvases.length;
  run(sb.ctx, 'rt3dExpSetView("none"); rt3dExpSetView("rt3d");');
  const back = JSON.parse(run(sb.ctx, `JSON.stringify({
    engine: rt3dExpDisplayedEngine(), hasCanvas: !!rt3dExpCanvas,
    canBuild: rt3dExpLastResult.finishReason })`));
  check(10, 'switching away and back restores the cached RT3D grid with no new canvas built',
    back.engine === 'rt3d' && back.hasCanvas && sb.canvases.length === canvasId,
    JSON.stringify({ ...back, canvasesBefore: canvasId, canvasesAfter: sb.canvases.length }));
}

// ---------------------------------------------------------------- 11
// rt3dExpPaint must REFUSE a result with no spec rather than silently degrading.
{
  const sb = makeSandbox();
  twoFloors(sb);
  await runThroughUi(sb, { floor: 0 });
  const r = JSON.parse(run(sb.ctx, `JSON.stringify((function(){
    if(!rt3dExpLastResult) return {skipped:'no result'};
    var res = JSON.parse(JSON.stringify(rt3dExpLastResult));
    delete res.spec;
    try { rt3dExpPaint(res); return {threw:false}; }
    catch(e){ return {threw:true, msg:String(e.message)}; }
  })())`));
  check(11, 'rt3dExpPaint throws a named error when handed a result with no spec',
    r.threw === true && /grid spec/.test(r.msg || ''), JSON.stringify(r));
}

// ---------------------------------------------------------------- 12
// Structural: the grid no longer carries a spec anywhere in the source.
{
  const bin = SRC.slice(SRC.indexOf('function rt3dExpBin('),
                        SRC.indexOf('function rt3dExpPaint('));
  const res = SRC.slice(SRC.indexOf('const res={'), SRC.indexOf('if(res.grid.total'));
  check(12, 'structurally: rt3dExpBin returns no spec, and the result literal declares one',
    !/\bspec\s*:/.test(bin) && /\n      spec:spec,/.test(res) && !/binned\.spec=/.test(SRC),
    `binDeclaresSpec=${/\\bspec\\s*:/.test(bin)} resDeclaresSpec=${/\\n      spec:spec,/.test(res)} ` +
    `patchesGrid=${/binned\\.spec=/.test(SRC)}`);
}

// ---------------------------------------------------------------- 13
// A STALLED run must never be published. This is the watchdog path: the engine
// stops making progress (a hidden tab suspends requestAnimationFrame), the
// watchdog fires, and the run is aborted. What must NOT happen is a
// half-traced grid being cached or displayed as a normal RT3D result.
//
// A VALID run goes first, so there is a real grid to protect; then a stall is
// forced and that grid must still be exactly the one cached and displayed.
{
  const sb = makeSandbox();
  twoFloors(sb);
  await runThroughUi(sb, { floor: 0 });
  const good = JSON.parse(run(sb.ctx, `JSON.stringify({
    floorIndex: rt3dExpLastResult.floorIndex,
    cols: rt3dExpLastResult.spec.cols,
    rows: rt3dExpLastResult.spec.rows,
    sampled: rt3dExpLastResult.grid.sampled,
    reason: rt3dExpLastResult.finishReason,
    cacheCols: rt3dExpCache.rt3d ? rt3dExpCache.rt3d.spec.cols : null,
    cacheSampled: rt3dExpCache.rt3d ? rt3dExpCache.rt3d.grid.sampled : null })`));
  const canvasesBefore = sb.canvases.length;

  // Force a stall: shorten the watchdog, then let requestAnimationFrame stop
  // delivering slices once the run has started — exactly what a hidden tab does.
  run(sb.ctx, `
    RT3D_EXP_WATCHDOG_MS = 80;
    var __rafReal = window.requestAnimationFrame;
    window.__rafN = 0;
    window.requestAnimationFrame = function(cb){
      if(++window.__rafN > 2) return 0;
      return window.__rafReal(cb);
    };
  `);
  run(sb.ctx, 'rt3dExpStart();');
  await run(sb.ctx, `new Promise(function(res){
    var deadline = Date.now() + 30000;
    (function tick(){
      if(rt3dExpLastStall || rt3dExpLastError) return res(1);
      if(Date.now() > deadline) return res(0);
      setTimeout(tick, 5);
    })();
  })`);

  const after = JSON.parse(run(sb.ctx, `JSON.stringify({
    lastResultFloor: rt3dExpLastResult ? rt3dExpLastResult.floorIndex : null,
    lastResultCols: rt3dExpLastResult ? rt3dExpLastResult.spec.cols : null,
    lastResultSampled: rt3dExpLastResult ? rt3dExpLastResult.grid.sampled : null,
    lastResultReason: rt3dExpLastResult ? rt3dExpLastResult.finishReason : null,
    cacheCols: rt3dExpCache.rt3d ? rt3dExpCache.rt3d.spec.cols : null,
    cacheSampled: rt3dExpCache.rt3d ? rt3dExpCache.rt3d.grid.sampled : null,
    cacheStalled: rt3dExpCache.rt3d ? !!rt3dExpCache.rt3d.stalled : null,
    stallRecorded: rt3dExpLastStall ? {
      done: rt3dExpLastStall.completedUnits, total: rt3dExpLastStall.totalUnits } : null,
    specCols: rt3dExpSpec ? rt3dExpSpec.cols : null,
    engine: rt3dExpDisplayedEngine() })`));

  check(13, 'a watchdog stall is recorded, and the last valid result survives untouched',
    after.stallRecorded && after.stallRecorded.total > after.stallRecorded.done &&
    after.lastResultFloor === good.floorIndex &&
    after.lastResultCols === good.cols &&
    after.lastResultSampled === good.sampled &&
    after.cacheCols === good.cacheCols &&
    after.cacheSampled === good.cacheSampled &&
    after.cacheStalled === false,
    JSON.stringify({ good, after }));

  check('13b', 'no new canvas was built and the displayed grid is still the valid one',
    sb.canvases.length === canvasesBefore && after.specCols === good.cols &&
    after.engine === 'rt3d',
    JSON.stringify({ canvasesBefore, canvasesAfter: sb.canvases.length,
                     specCols: after.specCols, engine: after.engine }));

  check('13c', 'the cached result is not the stalled one and is not flagged stalled',
    after.cacheStalled === false && after.lastResultReason === good.reason &&
    !/watchdog/.test(String(after.lastResultReason)),
    JSON.stringify({ cacheStalled: after.cacheStalled,
                     lastResultReason: after.lastResultReason, goodReason: good.reason }));
}

// ---------------------------------------------------------------- 14
// With NO prior valid run, a stall must leave nothing published at all.
{
  const sb = makeSandbox();
  twoFloors(sb);
  run(sb.ctx, `
    RT3D_EXP_WATCHDOG_MS = 80;
    var __rafReal2 = window.requestAnimationFrame;
    window.__rafN2 = 0;
    window.requestAnimationFrame = function(cb){
      if(++window.__rafN2 > 2) return 0;
      return window.__rafReal2(cb);
    };
  `);
  run(sb.ctx, 'rt3dExpStart();');
  await run(sb.ctx, `new Promise(function(res){
    var deadline = Date.now() + 30000;
    (function tick(){
      if(rt3dExpLastStall || rt3dExpLastError) return res(1);
      if(Date.now() > deadline) return res(0);
      setTimeout(tick, 5);
    })();
  })`);
  const after = JSON.parse(run(sb.ctx, `JSON.stringify({
    lastResult: !!rt3dExpLastResult,
    cached: !!(rt3dExpCache && rt3dExpCache.rt3d),
    canvas: !!rt3dExpCanvas, spec: !!rt3dExpSpec, meta: !!rt3dExpMeta,
    cells: !!rt3dExpCells,
    stall: rt3dExpLastStall ? { done: rt3dExpLastStall.completedUnits,
                                total: rt3dExpLastStall.totalUnits } : null })`));
  check(14, 'a stall with no prior result publishes nothing: no cache, canvas, spec, meta or result',
    after.stall && !after.lastResult && !after.cached && !after.canvas &&
    !after.spec && !after.meta && !after.cells,
    JSON.stringify(after));
}

// ---------------------------------------------------------------- 15
// Normal completion is unaffected.
{
  const sb = makeSandbox();
  twoFloors(sb);
  const r = await runThroughUi(sb, { floor: 0 });
  const flags = JSON.parse(run(sb.ctx, `JSON.stringify({
    stalled: rt3dExpLastResult.stalled, cancelled: rt3dExpLastResult.cancelled,
    reason: rt3dExpLastResult.finishReason, stall: rt3dExpLastStall,
    cached: !!(rt3dExpCache && rt3dExpCache.rt3d) })`));
  check(15, 'a normal completion is not flagged stalled and still caches and displays normally',
    r.result && flags.stalled === false && flags.cancelled === false &&
    flags.reason === 'completed' && flags.stall === null && flags.cached === true,
    JSON.stringify(flags));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
