// Stage 6 browser-runner regression: responsiveness and instrumentation.
//
// A real browser run on S4 stalled at "building world and BVH" indefinitely. The
// world/BVH build was never at fault (Stage 5 measured it at 0-1 ms on this very
// project). The real cause was scheduling:
//
//   * the status string was written BEFORE any phase ran, so it could not
//     describe work that had already moved on, and
//   * the first evaluation batch was budgeted in ROWS, so one animation frame
//     could contain minutes of synchronous point queries and never repaint.
//
// These tests pin the fix without depending on wall-clock speed: the fake clock
// advances only when the harness advances it, so "was there a yield?" is a
// deterministic question.
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

// A sandbox with a controllable clock and an explicit animation-frame queue, so
// each frame is observable. Cost per point query is charged to the fake clock, so
// a large grid WOULD blow a real frame budget unless the budget is honoured.
function makeSandbox({ perQueryMs = 0.25 } = {}) {
  const win = makeDom();
  win.location = { search: '?rt3d=1' };
  const ctx = vm.createContext(win);
  vm.runInContext(SRC, ctx, { filename: 'index.html<script>' });
  run(ctx, `
    paintHeat=function(){}; computeHeatSimple=function(){}; draw2d=function(){};
    coverageUpdate=function(){}; showToast=function(){}; refresh3dHeat=function(){};
    scheduleHeat=function(){}; clearTimeout(heatTimer);

    // Pin the UI language: the panel is translated, and these assertions match
    // on rendered text. Without this the suite would silently test against
    // Spanish (the application default) and match nothing.
    uiLanguage='en';

    window.__now = 0;
    window.__rafQ = [];
    window.__log = [];        // one entry per rendered panel state
    window.__paints = 0;
    window.__perQueryMs = ${perQueryMs};
    window.__queries = 0;
    // charge the fake clock for every point query, so a frame that ignores its
    // time budget is visible as a huge clock jump
    var __realCoverageAt = rt3dCoverageAt;
    window.__origCoverageAt = rt3dCoverageAt;
    rt3dCoverageAt = function(){
      window.__queries++;
      window.__now += window.__perQueryMs;
      return window.__origCoverageAt.apply(this, arguments);
    };
    // Node's Performance.prototype.now is a non-writable accessor, so assigning to
    // performance.now is a SILENT no-op. Replace the whole object instead, or the
    // "fake clock" is inert and the timing assertions really run on wall-clock.
    window.performance = { now: function(){ return window.__now; } };
    window.requestAnimationFrame = function(cb){ window.__rafQ.push(cb); return window.__rafQ.length; };
    window.cancelAnimationFrame = function(){};
    // record every panel render, so progress and phases are observable
    var __realOut = rt3dExpOut;
    rt3dExpOut = function(html){
      window.__paints++;
      window.__log.push({ now: window.__now, queries: window.__queries, html: String(html) });
      return __realOut(html);
    };
    // one queued callback, advancing the clock by the frame budget
    window.__pumpOne = function(advanceMs){
      if(!window.__rafQ.length) return null;
      var cb = window.__rafQ.shift();
      window.__now += (advanceMs==null?16:advanceMs);
      cb();
      return 'raf';
    };
    window.__pump = function(maxSteps, advanceMs){
      var n=0;
      while(window.__pumpOne(advanceMs) && n<(maxSteps||1000000)) n++;
      return n;
    };
  `);
  return ctx;
}

// A wide grid: cols wide enough that a 12-ROW batch would be minutes of work,
// which is exactly the bug under test.
const SCENE = `
  state=freshState();
  var f=state.floors[0];
  f.name='PB'; f.height=3.2; f.w=26; f.d=17; f.ceilingAreas=[];
  var M4=state.materials[4].id, M2=state.materials[2].id;
  var W=13,H=8.5, pts=[[-W,-H],[W,-H],[W,H],[-W,H]];
  for(var i=0;i<4;i++){ var a=pts[i], b=pts[(i+1)%4];
    f.walls.push({id:'w'+i,x1:a[0],y1:a[1],x2:b[0],y2:b[1],materialId:M4,
                   thickness:DEFAULT_WALL_THICKNESS_M}); }
  f.rfObjects.push({id:'rk',x:-4,y:2,width:1.0,depth:2.2,height:2.0,rotation:0,
                    materialId:M4,extraLossDb:2});
  var o=[{x:-13,y:-8.5},{x:13,y:-8.5},{x:13,y:8.5},{x:-13,y:8.5}];
  var hA=[{x:-3,y:-3},{x:3,y:-3},{x:3,y:3},{x:-3,y:3}];
  f.ceilingAreas.push({id:'cl1',height:3.05,thickness:0.10,materialId:M2,extraLossDb:0,
    footprint:{parts:[{outer:o,holes:[hA]}]}});
  [[-9,-5.5],[3,-5.5],[3,5.5]].forEach(function(c,i){
    var ap=makeAP(c[0],c[1],'AP-'+(i+1),3.2); ap.mount=2.6; f.aps.push(ap); });
  state.activeFloor=0;`;

console.log('Stage 6 browser-runner regression\n');

// ------------------------------------------------------------------ 1, 2, 3
// World/BVH setup is its own phase, the slice constructor is cheap, and a yield
// happens before a non-trivial field can finish.
{
  const sb = makeSandbox();
  run(sb, SCENE);
  const r = JSON.parse(run(sb, `JSON.stringify((function(){
    var shape = (function(){
      var world=rt3dBuildWorld();
      return { bodies: rt3dAllBodies(world).length,
               cols: rt3dGridSpec(state.floors[0]).cols,
               rows: rt3dGridSpec(state.floors[0]).rows,
               aps: rt3dCoverageSources().length };
    })();
    var before = window.__queries;
    // create the cursor exactly as the browser runner does: this MUST be cheap
    var t0=window.__now;
    var world=rt3dBuildWorld();
    var bvh=rt3dBvhFor(world);
    var spec=rt3dGridSpec(state.floors[0]);
    var cursor={ j:0, i:0, best:null, apBest:null, valid:null, acc:null };
    var setupDone=window.__now - t0;
    var afterCtor=window.__queries;
    var queriesFromSetup = window.__queries - before;
    // now take ONE evaluation frame under the real time budget
    var frame0=window.__now;
    var slice=rt3dCoverageSlice(world, spec, rt3dReceiverPlaneZForFloor(0),
      { cursor:cursor, sources:rt3dCoverageSources(), timeBudgetMs: RT3D_COV_FRAME_MS });
    var frameMs=window.__now - frame0;
    return { shape: shape,
             setupQueries: queriesFromSetup,
             setupMs: +setupDone.toFixed(2),
             ctorEvaluated: slice.evaluatedCells,
             frameMs: +frameMs.toFixed(2),
             frameQueries: window.__queries - afterCtor,
             frameComplete: slice.complete,
             cursorAdvanced: cursor.j>0 || cursor.i>0,
             firstRowCells: slice.spec.cols,
             perQueryMs: window.__perQueryMs,
             totalCells: slice.totalCells };
  })())`));
  check(1, 'world/BVH/grid/AP setup completes as its own phase, in milliseconds',
    r.setupMs < 50 && r.shape.bodies > 0 && r.shape.aps === 3,
    JSON.stringify({ setupMs: r.setupMs, bodies: r.shape.bodies, aps: r.shape.aps }));
  check(2, 'the cursor and slice setup perform NO evaluation: zero point queries',
    r.setupQueries === 0 && r.frameQueries > 0,
    JSON.stringify({ setupQueries: r.setupQueries, firstFrameQueries: r.frameQueries }));
  // The deadline is consulted only every 8 cells, to keep the clock read off the
  // hot path. So a frame may overshoot its budget by at most one check interval:
  // if the deadline is crossed just AFTER a check, the frame runs 8 more cells
  // before it notices. That bound -- not a hard "<= budget" -- is the invariant,
  // and what actually matters is that the overshoot is a CONSTANT handful of
  // cells rather than the whole field. This assertion previously read
  // frameMs <= 35 and passed only because the fake clock was inert and the
  // measurement silently came from real wall-clock; with a working clock the
  // honest figure is 36 ms, which is inside the interval bound.
  const budgetMs = 35, interval = 8, overshootAllowed = interval * r.perQueryMs;
  check(3, 'one evaluation frame honours the time budget (within one check interval) and yields before the field can finish',
    r.frameMs <= budgetMs + overshootAllowed + 1e-6 && !r.frameComplete && r.cursorAdvanced &&
    r.frameQueries > 0 && r.frameQueries < r.totalCells,
    JSON.stringify({ frameMs: r.frameMs, budget: budgetMs,
                     overshootAllowed: +overshootAllowed.toFixed(2),
                     queries: r.frameQueries, total: r.totalCells,
                     complete: r.frameComplete, advanced: r.cursorAdvanced }));
}

// ------------------------------------------------------------------ 4, 5
// Through the REAL runner: phases are announced before they run, progress
// advances from 0, and a large grid can never sit in the setup status while
// evaluation is executing.
{
  const sb = makeSandbox();
  run(sb, SCENE);
  run(sb, 'rt3dExpRunCoverage();');
  // frame 1: the kickoff that starts the phase machine
  run(sb, 'window.__pumpOne(16);');
  const afterKick = JSON.parse(run(sb, 'JSON.stringify(window.__log.map(function(l){return l.html;}))'));
  // frame 2..: phases proceed and evaluation starts
  run(sb, 'window.__pumpOne(16); window.__pumpOne(16);');
  const frames = JSON.parse(run(sb, `JSON.stringify(window.__pump(400, 16))`));
  const log = JSON.parse(run(sb, `JSON.stringify(window.__log.map(function(l){
    return { now:l.now, queries:l.queries,
             phase:/(snapshotting|building the RT3D world|building the BVH|initialising|evaluating cells|finalising|painting)/.exec(l.html),
             cells:/([0-9,]+) \\/ ([0-9,]+)/.exec(l.html) };
  }))`));

  const phasesSeen = log.map((l) => l.phase && l.phase[1]).filter(Boolean);
  // The first five phases must appear in this order, each announced BEFORE its
  // work begins: a phase label must never describe work that has already moved on.
  const REQUIRED = ['snapshotting', 'building the RT3D world', 'building the BVH',
                    'initialising', 'evaluating cells'];
  const order = REQUIRED.map((p) => phasesSeen.indexOf(p));
  check(4, 'every phase is announced in order before it runs: snapshot, world, BVH, init, evaluate',
    order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1])),
    JSON.stringify({ order, seen: phasesSeen.slice(0, 8) }));
  check(5, 'progress advances from 0 before completion, and the panel is never stuck in setup while evaluating',
    log.some((l) => l.phase && l.phase[1] === 'evaluating cells') &&
    log.some((l) => l.cells && Number(String(l.cells[1]).replace(/,/g, '')) > 0) &&
    frames > 1,
    JSON.stringify({ frames, evaluates: log.filter((l) => l.phase && l.phase[1] === 'evaluating cells').length }));
}

// ------------------------------------------------------------------ 6, 7
// Cancellation works once evaluation has begun, and publishes nothing.
{
  const sb = makeSandbox();
  run(sb, SCENE);
  // establish a PREVIOUS valid display that must survive
  run(sb, `window.__prevResult = { floorName:'PREV', receiverPlaneZ:1.2,
      spec:{ cols:10, rows:10, cell:0.16 } };
    rt3dExpLastResult = window.__prevResult;
    rt3dExpCanvas = { tag:'previous-canvas' };
    rt3dExpSpec = window.__prevResult.spec;
    rt3dExpMeta = { floorId:'prev', minx:0,miny:0,maxx:1,maxy:1 };`);
  run(sb, 'rt3dExpRunCoverage();');
  run(sb, 'window.__pumpOne(16); window.__pumpOne(16);');
  // cancel mid-evaluation, then drain
  const mid = JSON.parse(run(sb,
    `JSON.stringify({ evaluating: /evaluating cells/.test(String(window.__log[window.__log.length-1].html)) })`));
  run(sb, 'rt3dExpCovJob.cancel(); window.__pump(400, 16);');
  const after = JSON.parse(run(sb, `JSON.stringify({
    prevIntact: rt3dExpLastResult===window.__prevResult,
    canvasIntact: rt3dExpCanvas && rt3dExpCanvas.tag==='previous-canvas',
    specIntact: rt3dExpSpec && rt3dExpSpec.cols===10,
    metaIntact: rt3dExpMeta && rt3dExpMeta.floorId==='prev',
    jobCleared: rt3dExpCovJob===null,
    lastHtml: String(window.__log[window.__log.length-1].html),
    coverageCached: !!(rt3dExpCache && rt3dExpCache.coverage)
  })`));
  check(6, 'cancellation takes effect once evaluation has begun',
    mid.evaluating === true && after.jobCleared,
    JSON.stringify({ mid, jobCleared: after.jobCleared }));
  check(7, 'a cancelled run publishes nothing: the previous valid display is untouched',
    after.prevIntact && after.canvasIntact && after.specIntact && after.metaIntact &&
    after.coverageCached === false && /cancelled/i.test(after.lastHtml),
    JSON.stringify({ prevIntact: after.prevIntact, canvasIntact: after.canvasIntact,
                     coverageCached: after.coverageCached,
                     saysCancelled: /cancelled/i.test(after.lastHtml) }));
}

// ------------------------------------------------------------------ 8
// Structural: the slice is budgeted in TIME and the cursor is a CELL position,
// not a row count.
{
  const a = SRC.indexOf('function rt3dCoverageSlice(');
  const b = SRC.indexOf('function rt3dCoverageColumn(');
  const src = SRC.slice(a, b)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/[^\n]*$/gm, ' ')
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
  check(8, 'the slice budgets TIME and resumes at a cell, not a row',
    /timeBudgetMs/.test(src) && /opts\.cursor\.i/.test(src) &&
    /const iStart = opts\.cursor \? \(opts\.cursor\.i\|0\) : 0;/.test(src),
    'timeBudgetMs=' + /timeBudgetMs/.test(src) + ' cellCursor=' + /opts\.cursor\.i/.test(src));
  check('8b', 'the browser runner no longer budgets evaluation in rows',
    !/rowBudget:\s*12/.test(SRC) && /timeBudgetMs:\s*RT3D_COV_FRAME_MS/.test(SRC));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
