// Stage 7A.1 — Worker execution suite.
//
// The acceptance gate is Section 8: for EVERY Stage-7 oracle fixture, the
// canonical main-thread result and the canonical Worker result must be
// identical. Not "close" -- identical. The comparison is made on the serialised
// text of JSON.stringify, which in JavaScript is the shortest decimal string
// that round-trips to the SAME IEEE-754 double, so comparing the text is
// bit-for-bit equality on the doubles, -Infinity included.
//
// There is no tolerance anywhere in this file and no rounding. If the worker
// path cannot reproduce the main-thread path exactly, that is the finding.
//
// What is compared, per the brief:
//   cells evaluated, finite/non-finite cells, RSSI, serving AP id, per-AP direct
//   RSSI, best reflected RSSI, winner kind, traversal counts, and the material
//   loss family sets and their losses.
//
// Both sides run the SAME code. The main thread evaluates the application
// script in a DOM sandbox; the worker evaluates the SAME application script in
// an environment with no document, no canvas and no requestAnimationFrame.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURES, POINTS, GRID } from './stage7a-fixtures.mjs';
import { FINGERPRINT_FN } from './stage7a-fingerprint.mjs';
import { RT3DCore, APP_SOURCE, mainEnv, workerEnv, manualTick,
         SNAPSHOT_FN, runProtocol, attachProtocol } from './worker-harness.mjs';
import { makeDom, readAppScript, attachCore, installFakeWorker, run } from './loader.mjs';
import vm from 'node:vm';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const CORE_SRC = fs.readFileSync(path.join(ROOT, 'rt3d-core.js'), 'utf8');
const WORKER_SRC = fs.readFileSync(path.join(ROOT, 'rt3d-worker.js'), 'utf8');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(id, name, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${String(id).padStart(2)}. ${name}`); }
  else {
    fail++; failures.push(`${id}. ${name}${detail ? ' :: ' + detail : ''}`);
    console.log(`  FAIL ${String(id).padStart(2)}. ${name}${detail ? ' :: ' + detail : ''}`);
  }
}

// Strip comments so a source assertion cannot be satisfied by prose.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ')
            .replace(/^\s*\/\/[^\n]*$/gm, ' ');
}

const ARG = JSON.stringify({ points: POINTS, grid: GRID });
const FMT = (cells) => Array.from(cells).map(v => v === -Infinity ? '-Inf' : String(v)).join(',');

// ------------------------------------------------------------
//  BOOTSTRAP PROBE -- runs first, and gates everything else.
//
//  If the canonical script cannot be evaluated in a faithful Dedicated Worker
//  environment, every other Worker result in this file is meaningless: there is
//  no Worker runtime to compare against. That is exactly the state the first
//  browser smoke found (`MutationObserver is not defined`). It is reported here
//  as one legible line and then stops the suite, instead of surfacing as an
//  unlabelled exception from deep inside the fixture loop.
// ------------------------------------------------------------
const BOOTSTRAP = (() => {
  try { return { ok: true, env: workerEnv() }; }
  catch (e) { return { ok: false, message: String(e && e.message ? e.message : e) }; }
})();

check(0, 'the canonical script boots in a Dedicated Worker environment with no DOM',
      BOOTSTRAP.ok, BOOTSTRAP.ok ? '' : BOOTSTRAP.message);
if (!BOOTSTRAP.ok) {
  console.log(`\n${pass} passed, ${fail} failed`);
  console.log('  - 0. bootstrap :: ' + BOOTSTRAP.message);
  console.log('\n  No Worker runtime exists, so no Worker-vs-main comparison can be made.');
  process.exit(1);
}

// ============================================================
//  1. WORKER vs MAIN — the acceptance gate, over every fixture
// ============================================================
const fingerprints = {};
for (const fx of FIXTURES) {
  const main = mainEnv();
  const worker = workerEnv();
  main.run(fx.scene);
  worker.run(fx.scene);
  main.run(FINGERPRINT_FN);
  worker.run(FINGERPRINT_FN);

  const a = main.run(`JSON.stringify(stage7aFingerprint(${ARG}))`);
  const b = worker.run(`JSON.stringify(stage7aFingerprint(${ARG}))`);
  fingerprints[fx.id] = { main: a, worker: b };

  let detail = '';
  if (a !== b) {
    const x = JSON.stringify(JSON.parse(a), null, 1).split('\n');
    const y = JSON.stringify(JSON.parse(b), null, 1).split('\n');
    for (let i = 0; i < Math.max(x.length, y.length); i++)
      if (x[i] !== y[i]) { detail = `first diff line ${i + 1}: main ${x[i]} / worker ${y[i]}`; break; }
  }
  check(fx.id, `${fx.id}: worker and main-thread fingerprints are bit-identical`,
        a === b, detail);
}

// ---- 1b. each required quantity, named explicitly -------------------------
{
  const REQUIRED = [
    ['strongest RSSI', p => p.strongestRssi],
    ['serving AP id', p => p.servingApId],
    ['per-AP direct RSSI', p => p.aps.map(x => x.directRssi)],
    ['best reflected RSSI', p => p.aps.map(x => x.reflectedBestRssi)],
    ['winning path kind', p => p.aps.map(x => x.winnerKind)],
    ['traversal counts', p => p.aps.map(x => x.winningTransmissionCount)],
    ['material loss families', p => p.aps.map(x =>
      [x.matWall, x.matRfObj, x.matSlab, x.matCeil, x.matPillar])],
  ];
  const mismatches = [];
  for (const [label, pick] of REQUIRED) {
    for (const fx of FIXTURES) {
      const A = JSON.parse(fingerprints[fx.id].main);
      const B = JSON.parse(fingerprints[fx.id].worker);
      if (A.points.length !== B.points.length) { mismatches.push(`${fx.id}/${label}: point count`); continue; }
      for (let i = 0; i < A.points.length; i++) {
        const x = JSON.stringify(pick(A.points[i]));
        const y = JSON.stringify(pick(B.points[i]));
        if (x !== y) mismatches.push(`${fx.id}/${label}@pt${i}: ${x} vs ${y}`);
      }
    }
  }
  check('1b', 'every required quantity matches: RSSI, serving AP, direct/reflected, ' +
        'winner kind, traversal counts, material families',
        mismatches.length === 0, mismatches.slice(0, 3).join(' | '));

  // grid and cell-level equality, read from the same fingerprints
  const gridBad = [];
  for (const fx of FIXTURES) {
    const A = JSON.parse(fingerprints[fx.id].main).grid;
    const B = JSON.parse(fingerprints[fx.id].worker).grid;
    const cmp = [['evaluated', 'evaluated'], ['complete', 'complete'],
                 ['validCells', 'validCells'], ['noSignalCells', 'noSignalCells']];
    for (const [k] of cmp)
      if (JSON.stringify(A[k]) !== JSON.stringify(B[k]))
        gridBad.push(`${fx.id}.${k}: ${A[k]} vs ${B[k]}`);
    if (A.best.length !== B.best.length) gridBad.push(`${fx.id}: best length`);
    else for (let i = 0; i < A.best.length; i++) {
      const av = A.best[i], bv = B.best[i];
      const same = (Number.isFinite(av) === Number.isFinite(bv)) &&
                   (!Number.isFinite(av) || Object.is(av, bv));
      if (!same) { gridBad.push(`${fx.id}.best[${i}]: ${av} vs ${bv}`); break; }
    }
    for (let i = 0; i < A.valid.length; i++)
      if (A.valid[i] !== B.valid[i]) { gridBad.push(`${fx.id}.valid[${i}]`); break; }
    for (let i = 0; i < A.apBest.length; i++)
      if (A.apBest[i] !== B.apBest[i]) { gridBad.push(`${fx.id}.apBest[${i}]`); break; }
  }
  check('1c', 'cells evaluated, finite/non-finite classification, per-cell RSSI, ' +
        'valid flags and serving AP index all match',
        gridBad.length === 0, gridBad.slice(0, 3).join(' | '));
}

// ============================================================
//  2. THE JOB PROTOCOL reproduces the main-thread slice exactly
// ============================================================
{
  const fx = FIXTURES.find(f => f.id === 'crossFloor');
  const main = mainEnv();
  const worker = workerEnv();
  main.run(fx.scene);
  worker.run(fx.scene);
  worker.run(SNAPSHOT_FN);
  const snapshot = JSON.parse(worker.run('JSON.stringify(__rt3dWorkerSnapshot())'));

  // main thread: the canonical slice, computed the old way, run to COMPLETION.
  // The time budget only decides when control returns; it must be re-entered
  // until the cursor finishes, otherwise the baseline is a partial grid and the
  // comparison would be against a truncated run.
  const mainSlice = JSON.parse(main.run(`JSON.stringify((function(){
    var spec=rt3dGridSpec(state.floors[state.activeFloor]);
    var planeZ=rt3dReceiverPlaneZForFloor(state.activeFloor);
    var world=rt3dBuildWorld();
    var sources=rt3dCoverageSources();
    var stats=rt3dNewStats();
    var cursor={ j:0,i:0,best:null,apBest:null,valid:null,acc:null };
    var r=null, guard=0;
    do {
      r=rt3dCoverageSlice(world,spec,planeZ,{cursor:cursor,stats:stats,
        sources:sources,timeBudgetMs:35});
    } while(!r.complete && ++guard<100000);
    return { evaluated:r.evaluatedCells, validCells:r.validCells,
             noSignal:r.noSignalCells, complete:r.complete, total:r.totalCells,
             best:Array.from(r.best).map(function(v){return v===-Infinity?'-Inf':String(v);}),
             apBest:Array.from(r.apBest), valid:Array.from(r.valid) };
  })())`));

  // worker: the same scene through RUN_SLICE
  const { messages, tick } = runProtocol(worker, snapshot, { jobId: 11 });
  tick.flushAll();
  const done = messages.find(m => m.type === 'COMPLETE');

  check(2, 'the worker completes a RUN_SLICE job', !!done,
        done ? '' : 'no COMPLETE: ' + JSON.stringify(messages.map(m => m.type + ':' + (m.message || ''))));
  if (done) {
    const wBest = Array.from(done.grid.best).map(v => v === -Infinity ? '-Inf' : String(v));
    check('2b', 'evaluated cell count is identical', done.evaluatedCells === mainSlice.evaluated,
          `${done.evaluatedCells} vs ${mainSlice.evaluated}`);
    check('2c', 'the whole value grid is bit-identical', FMT(done.grid.best) === mainSlice.best.join(','),
          `first diff at ${(() => { for (let i = 0; i < wBest.length; i++) if (wBest[i] !== mainSlice.best[i]) return i; return -1; })()}`);
    check('2d', 'serving-AP indices and validity flags are identical',
          FMT(done.grid.apBest) === mainSlice.apBest.join(',') &&
          FMT(done.grid.valid) === mainSlice.valid.join(','), '');
    check('2e', 'valid/no-signal cell counts are identical',
          done.validCells === mainSlice.validCells && done.noSignalCells === mainSlice.noSignal,
          `${done.validCells}/${done.noSignalCells} vs ${mainSlice.validCells}/${mainSlice.noSignal}`);
  }
}

// ============================================================
//  3. DETERMINISM across repeated FRESH workers
// ============================================================
{
  const runs = [];
  for (let i = 0; i < 3; i++) {
    const fx = FIXTURES.find(f => f.id === 'reflectionWinner');
    // a genuinely fresh worker environment each time
    const worker = workerEnv();
    worker.run(fx.scene);
    worker.run(FINGERPRINT_FN);
    runs.push(worker.run(`JSON.stringify(stage7aFingerprint(${ARG}))`));
  }
  check(3, 'three fresh workers produce identical fingerprints for the same fixture',
        runs[0] === runs[1] && runs[1] === runs[2], '');
  // and identical to the main thread, so determinism is not worker-specific
  const fx = FIXTURES.find(f => f.id === 'reflectionWinner');
  const main = mainEnv();
  main.run(fx.scene); main.run(FINGERPRINT_FN);
  check('3b', 'a fresh worker also equals the main thread exactly',
        main.run(`JSON.stringify(stage7aFingerprint(${ARG}))`) === runs[0], '');
}

// ============================================================
//  4. PROGRESS: monotonic, bounded, never per-cell
// ============================================================
{
  const fx = FIXTURES.find(f => f.id === 'multiApServing');
  const worker = workerEnv();
  worker.run(fx.scene);
  worker.run(SNAPSHOT_FN);
  const snapshot = JSON.parse(worker.run('JSON.stringify(__rt3dWorkerSnapshot())'));
  const { messages, tick } = runProtocol(worker, snapshot,
    { jobId: 21, options: { progressEveryCells: 512 } });
  tick.flushAll();

  const prog = messages.filter(m => m.type === 'PROGRESS');
  const done = messages.find(m => m.type === 'COMPLETE');
  let monotonic = true;
  for (let i = 1; i < prog.length; i++)
    if (!(prog[i].evaluatedCells > prog[i - 1].evaluatedCells)) monotonic = false;
  check(4, 'progress is emitted and strictly monotonic in evaluated cells',
        prog.length > 0 && monotonic, `count=${prog.length}`);
  check('4b', 'every progress message carries evaluated, total and a percentage in [0,1]',
        prog.every(m => Number.isFinite(m.evaluatedCells) && Number.isFinite(m.totalCells) &&
                        m.totalCells > 0 && m.percent >= 0 && m.percent <= 1), '');
  check('4c', 'progress is bounded, not per-cell: far fewer messages than cells',
        prog.length > 0 && prog.length * 512 < done.evaluatedCells + 512,
        `messages=${prog.length} cells=${done && done.evaluatedCells}`);
  check('4d', 'the completed grid is transferred only once, at COMPLETE',
        messages.filter(m => m.type === 'COMPLETE').length === 1 &&
        !prog.some(m => m.grid), '');
}

// ============================================================
//  5. COMPLETE exactly once
// ============================================================
{
  const fx = FIXTURES.find(f => f.id === 'emptyLos');
  const worker = workerEnv();
  worker.run(fx.scene);
  worker.run(SNAPSHOT_FN);
  const snapshot = JSON.parse(worker.run('JSON.stringify(__rt3dWorkerSnapshot())'));
  const { messages, tick } = runProtocol(worker, snapshot, { jobId: 31 });
  tick.flushAll();
  tick.flushAll();          // pump again: nothing more may be produced
  const completes = messages.filter(m => m.type === 'COMPLETE');
  check(5, 'COMPLETE is emitted exactly once, even after the queue is drained again',
        completes.length === 1, `count=${completes.length}`);
  check('5b', 'no ERROR accompanies a successful run',
        messages.filter(m => m.type === 'ERROR').length === 0, '');
}

// ============================================================
//  6. SUPERSESSION: A starts, B supersedes, late A is ignored
// ============================================================
{
  const fx = FIXTURES.find(f => f.id === 'pillars');
  const worker = workerEnv();
  worker.run(fx.scene);
  worker.run(SNAPSHOT_FN);
  const snapshot = JSON.parse(worker.run('JSON.stringify(__rt3dWorkerSnapshot())'));

  const { sent, runtime, tick } = attachProtocol(worker);
  // A starts. Only a FEW steps are taken, so A is genuinely mid-flight when B
  // arrives -- draining the queue here would let A finish on its own and the
  // supersession would never be exercised.
  runtime.handle({ type: 'RUN_SLICE', jobId: 100, snapshot,
                   options: { progressEveryCells: 32 } });
  for (let i = 0; i < 3; i++) tick.flushOne();
  const aBefore = sent.filter(s => s.msg.type === 'PROGRESS').length;

  // B supersedes A
  runtime.handle({ type: 'RUN_SLICE', jobId: 200, snapshot, options: {} });
  tick.flushAll();
  tick.flushAll();

  const types = sent.map(s => s.msg);
  const completes = types.filter(m => m.type === 'COMPLETE');
  const aProg = types.filter(m => m.type === 'PROGRESS' && m.jobId === 100).length;
  const bProg = types.filter(m => m.type === 'PROGRESS' && m.jobId === 200).length;

  check(6, 'job A produces progress before being superseded', aBefore > 0, `A progress=${aBefore}`);
  check('6b', 'job B produces progress after superseding A', bProg > 0, `B progress=${bProg}`);
  check('6c', 'only ONE COMPLETE is ever emitted, and it belongs to B (job 200)',
        completes.length === 1 && completes[0].jobId === 200,
        `completes=${completes.map(m => m.jobId).join(',')}`);
  check('6d', 'the superseded job never completes and never publishes a grid',
        !types.some(m => m.type === 'COMPLETE' && m.jobId === 100), '');
  check('6e', 'the superseded job is told it was cancelled',
        types.some(m => m.type === 'CANCELLED' && m.jobId === 100), '');
  check('6f', 'the current job id is B', runtime.currentId() === 200, String(runtime.currentId()));
}

// ============================================================
//  7. CANCELLATION
// ============================================================
{
  const fx = FIXTURES.find(f => f.id === 'walls');
  const worker = workerEnv();
  worker.run(fx.scene);
  worker.run(SNAPSHOT_FN);
  const snapshot = JSON.parse(worker.run('JSON.stringify(__rt3dWorkerSnapshot())'));

  const { sent, runtime, tick } = attachProtocol(worker);
  // Start, take a few chunks, and cancel WHILE the job is still in flight.
  runtime.handle({ type: 'RUN_SLICE', jobId: 300, snapshot,
                   options: { progressEveryCells: 32 } });
  for (let i = 0; i < 3; i++) tick.flushOne();
  runtime.handle({ type: 'CANCEL', jobId: 300 });
  tick.flushAll();
  const types = sent.map(s => s.msg);

  check('7z', 'the cancelled job had genuinely started before the cancel',
        types.some(m => m.type === 'PROGRESS' && m.jobId === 300), '');

  check(7, 'a cancelled job reports CANCELLED', types.some(m => m.type === 'CANCELLED' && m.jobId === 300), '');
  check('7b', 'a cancelled job never emits COMPLETE',
        !types.some(m => m.type === 'COMPLETE'), '');
  check('7c', 'a cancelled job emits no grid at all',
        !types.some(m => m.grid), '');
}

// ============================================================
//  8. ERROR propagation from the worker
// ============================================================
{
  const fx = FIXTURES.find(f => f.id === 'emptyLos');
  const worker = workerEnv();
  worker.run(fx.scene);
  worker.run(SNAPSHOT_FN);
  const good = JSON.parse(worker.run('JSON.stringify(__rt3dWorkerSnapshot())'));
  // Corrupt the grid spec rather than the project: the fault must surface as a
  // job failure, and nulling `state` would leave the environment's own app-level
  // timers able to fault later, outside the run being tested.
  const broken = Object.assign({}, good, { spec: null });

  const { messages, tick } = runProtocol(worker, broken, { jobId: 400 });
  tick.flushAll();
  const err = messages.find(m => m.type === 'ERROR');
  check(8, 'a failing job reports ERROR with a message',
        !!err && typeof err.message === 'string' && err.message.length > 0,
        err ? '' : 'no ERROR emitted');
  check('8b', 'a failed job never emits COMPLETE and never publishes a grid',
        !messages.some(m => m.type === 'COMPLETE') && !messages.some(m => m.grid), '');
}

// ============================================================
//  9. THE CONTROLLER publishes only a live, current, successful COMPLETE
// ============================================================
function controllerSandbox(opts = {}) {
  const win = makeDom();
  win.location = { search: '?rt3d=1' };
  const ctx = vm.createContext(win);
  vm.runInContext(APP_SOURCE, ctx, { filename: 'index.html<script>' });
  attachCore(ctx);
  const workers = installFakeWorker(ctx, { appSource: APP_SOURCE, ...opts });
  run(ctx, `
    paintHeat=function(){}; computeHeatSimple=function(){}; draw2d=function(){};
    coverageUpdate=function(){}; showToast=function(){}; refresh3dHeat=function(){};
    scheduleHeat=function(){}; clearTimeout(heatTimer); bootUI=function(){}; uiLanguage='en';
    window.__rafQ=[]; window.__log=[];
    window.requestAnimationFrame=function(cb){ window.__rafQ.push(cb); return 1; };
    window.cancelAnimationFrame=function(){};
    window.__pump=function(n){ var k=0; while(window.__rafQ.length && k<(n||2000)){ window.__rafQ.shift()(); k++; } return k; };
    rt3dExpOut=function(h){ window.__log.push(String(h)); return ''; };`);
  return { ctx, workers };
}

const CONTROLLER_SCENE = `
  state=freshState();
  var f=state.floors[0];
  f.name='CT'; f.height=3.2; f.w=26; f.d=17; f.ceilingAreas=[];
  f.walls.push({id:'w0',x1:-13,y1:-8.5,x2:13,y2:-8.5,materialId:state.materials[4].id,
                thickness:DEFAULT_WALL_THICKNESS_M});
  var a=makeAP(-6,-4,'AP-1',3.2); a.id='ap_ct'; a.mount=2.6; f.aps.push(a);`;

{
  const { ctx } = controllerSandbox();
  run(ctx, CONTROLLER_SCENE);
  run(ctx, `window.__prev={ floorName:'PREV', receiverPlaneZ:1.2,
      spec:{ cols:10, rows:10, cell:0.16 } };
    rt3dExpLastResult=window.__prev;
    rt3dExpCanvas={ tag:'previous-canvas' };
    rt3dExpSpec=window.__prev.spec;
    rt3dExpMeta={ floorId:'prev', minx:0, miny:0, maxx:1, maxy:1 };
    rt3dExpLastCoverageBest=null; rt3dExpLastCoverage=null;`);
  run(ctx, 'rt3dExpRunCoverage(); window.__pump(4);');
  const mid = JSON.parse(run(ctx, `JSON.stringify({
    running: !!rt3dExpCovJob,
    jobId: rt3dExpCovJob ? rt3dExpCovJob.id : null })`));
  check(9, 'the controller starts a job and tracks its id', mid.running && mid.jobId === 1,
        JSON.stringify(mid));

  run(ctx, 'rt3dExpCovJob.cancel(); window.__pump(400);');
  const after = JSON.parse(run(ctx, `JSON.stringify({
    prevIntact: rt3dExpLastResult===window.__prev,
    canvasIntact: rt3dExpCanvas && rt3dExpCanvas.tag==='previous-canvas',
    specIntact: rt3dExpSpec && rt3dExpSpec.cols===10,
    coverageCached: !!(rt3dExpCache && rt3dExpCache.coverage),
    auditRetained: !!rt3dExpLastCoverageBest,
    jobCleared: rt3dExpCovJob===null,
    lastHtml: String(window.__log[window.__log.length-1]) })`));
  check('9b', 'a cancelled run publishes nothing: previous display intact, no cache, ' +
        'no retained audit snapshot',
        after.prevIntact && after.canvasIntact && after.specIntact &&
        after.coverageCached === false && after.auditRetained === false &&
        after.jobCleared && /cancelled/i.test(after.lastHtml),
        JSON.stringify({ prev: after.prevIntact, cached: after.coverageCached,
                         retained: after.auditRetained, cleared: after.jobCleared,
                         says: /cancelled/i.test(after.lastHtml) }));
}

{
  // Worker creation failure: surfaced, nothing published, NO fallback run.
  const { ctx } = controllerSandbox({ failCreate: 'synthetic worker construction failure' });
  run(ctx, CONTROLLER_SCENE);
  run(ctx, `window.__prev={ floorName:'PREV', receiverPlaneZ:1.2, spec:{cols:10,rows:10,cell:0.16} };
    rt3dExpLastResult=window.__prev; rt3dExpLastCoverageBest=null;`);
  run(ctx, 'rt3dExpRunCoverage(); window.__pump(20);');
  const r = JSON.parse(run(ctx, `JSON.stringify({
    lastError: rt3dExpLastError,
    prevIntact: rt3dExpLastResult===window.__prev,
    retained: !!rt3dExpLastCoverageBest,
    cached: !!(rt3dExpCache && rt3dExpCache.coverage),
    saysError: /worker/i.test(String(window.__log[window.__log.length-1])) })`));
  check('9c', 'a worker failure is surfaced visibly and publishes nothing',
        !!r.lastError && r.prevIntact && r.retained === false && r.cached === false && r.saysError,
        JSON.stringify(r));
  check('9d', 'a worker failure does NOT silently fall back to a main-thread run',
        r.retained === false && r.cached === false, JSON.stringify({ retained: r.retained }));
}

{
  // A worker that loads but then errors at runtime: same contract.
  const { ctx } = controllerSandbox({ failOnError: 'synthetic worker runtime failure' });
  run(ctx, CONTROLLER_SCENE);
  run(ctx, `window.__prev={ floorName:'PREV', receiverPlaneZ:1.2, spec:{cols:10,rows:10,cell:0.16} };
    rt3dExpLastResult=window.__prev; rt3dExpLastCoverageBest=null;`);
  run(ctx, 'rt3dExpRunCoverage(); window.__pump(40);');
  const r = JSON.parse(run(ctx, `JSON.stringify({
    lastError: rt3dExpLastError,
    prevIntact: rt3dExpLastResult===window.__prev,
    retained: !!rt3dExpLastCoverageBest,
    cached: !!(rt3dExpCache && rt3dExpCache.coverage) })`));
  check('9f', 'a worker RUNTIME error is surfaced and publishes nothing',
        !!r.lastError && /runtime failure/.test(String(r.lastError)) &&
        r.prevIntact && r.retained === false && r.cached === false, JSON.stringify(r));
}

{
  // Success path still publishes and retains, so the happy case is not broken.
  const { ctx } = controllerSandbox();
  run(ctx, CONTROLLER_SCENE);
  run(ctx, `rt3dExpLastResult=null; rt3dExpLastCoverageBest=null; rt3dExpCache={};`);
  run(ctx, 'rt3dExpRunCoverage(); window.__pump(4000);');
  const r = JSON.parse(run(ctx, `JSON.stringify({
    published: !!rt3dExpLastResult,
    floorName: rt3dExpLastResult ? rt3dExpLastResult.floorName : null,
    evaluated: rt3dExpLastResult ? rt3dExpLastResult.slice.evaluatedCells : null,
    retained: !!rt3dExpLastCoverageBest,
    cached: !!(rt3dExpCache && rt3dExpCache.coverage),
    jobCleared: rt3dExpCovJob===null,
    complete: rt3dExpLastResult ? rt3dExpLastResult.slice.complete : null })`));
  check('9e', 'a successful worker run publishes the field and retains the audit snapshot',
        r.published && r.complete === true && r.retained && r.cached && r.jobCleared,
        JSON.stringify(r));
}

// ============================================================
//  10. SOURCE REGRESSIONS — no rAF anywhere in the compute path
// ============================================================
{
  const coreNo = stripComments(CORE_SRC);
  check(10, 'rt3d-core.js contains no requestAnimationFrame',
        !/requestAnimationFrame/.test(coreNo), '');

  const workerNo = stripComments(WORKER_SRC);
  check('10b', 'rt3d-worker.js contains no requestAnimationFrame',
        !/requestAnimationFrame/.test(workerNo), '');
  check('10c', 'rt3d-worker.js contains no document access',
        !/\bdocument\b/.test(workerNo), '');
  check('10d', 'rt3d-worker.js yields through the shared core, not its own timer',
        /RT3DCore\.attachRuntime/.test(workerNo) && !/setTimeout/.test(workerNo), '');
  // The engine must be loaded as a CLASSIC SCRIPT. Loading it with eval looks
  // equivalent and is not: eval creates its own declarative environment, so the
  // app's top-level `let state` never becomes a global binding and the first RF
  // query dies with a ReferenceError. That failure is invisible to every Node
  // harness here, because node:vm's runInContext has classic-script semantics,
  // so it has to be pinned by a source assertion as well as by test 11.
  check('10d2', 'rt3d-worker.js loads the engine as a classic script via importScripts, ' +
        'NOT via eval',
        /RT3DCore\.loadClassicScript/.test(workerNo) &&
        /RT3DCore\.envForScope/.test(workerNo) &&
        !/\(0,\s*eval\)\(source\)/.test(workerNo), '');
  check('10d3', 'rt3d-core.js loads the engine through importScripts and a blob URL',
        /loadClassicScript/.test(coreNo) && /importScripts/.test(coreNo) &&
        /createObjectURL/.test(coreNo), '');
  check('10d4', 'a classic-script load is what the tests rely on: a top-level `let` ' +
        'declared by the loaded engine is ASSIGNABLE and readable from a later snippet',
        (() => {
          const w = workerEnv();
          // `state` is `let state;` at top level -- declared, but not initialised
          // until start() runs -- so the property that matters is that the binding
          // exists and can be assigned, not its initial value.
          return w.run('state = { probe: 42 }; state.probe') === 42;
        })(), '');
  check('10d5', 'function declarations from the loaded engine are reachable as globals',
        workerEnv().run('typeof rt3dCoverageAt') === 'function', '');

  // The browser controller: no rAF deciding whether RF cells get evaluated, and
  // no direct call into the slice from the controller at all.
  const a = APP_SRC.indexOf('function rt3dExpRunCoverage()');
  const b = APP_SRC.indexOf('\nfunction rt3dExpCoverageSummaryHtml(');
  const region = APP_SRC.slice(a, b > a ? b : a + 20000);
  const regionNo = stripComments(region);
  check('10e', 'the coverage controller contains no requestAnimationFrame',
        !/requestAnimationFrame/.test(regionNo), '');
  check('10f', 'the coverage controller does not call rt3dCoverageSlice on the main thread',
        !/rt3dCoverageSlice\(/.test(regionNo), '');
  check('10g', 'the coverage controller drives the worker through the protocol module',
        /rt3dExpWorkerStart\(/.test(regionNo) && /RT3DCore\.MSG\.RUN_SLICE/.test(APP_SRC), '');

  // The engine functions themselves stay in index.html: the worker evaluates the
  // SAME script rather than a copied core, so they must still be here.
  check('10h', 'the canonical engine still lives in index.html (no duplicated core file)',
        /function rt3dCoverageAt\(/.test(APP_SRC) &&
        /function rt3dCoverageSlice\(/.test(APP_SRC) &&
        /function rt3dBuildWorld\(/.test(APP_SRC), '');
  check('10i', 'rt3d-core.js contains no RF engine implementation',
        !/function rt3dCoverageAt\(/.test(coreNo) &&
        !/function rt3dCoverageSlice\(/.test(coreNo) &&
        !/function rt3dBuildWorld\(/.test(coreNo), '');
}

// ============================================================
//  11. The worker can evaluate the engine WITHOUT rAF existing
// ============================================================
{
  const fx = FIXTURES.find(f => f.id === 'pillars');
  const worker = workerEnv();
  check(11, 'the worker environment does not define requestAnimationFrame at all',
        typeof worker.ctx.requestAnimationFrame === 'undefined', '');
  worker.run(fx.scene);
  worker.run(FINGERPRINT_FN);
  const fp = worker.run(`JSON.stringify(stage7aFingerprint(${ARG}))`);
  check('11b', 'the canonical field still computes in an environment with no rAF, ' +
        'no document and no canvas',
        fp === fingerprints.pillars.main, '');
}

// ============================================================
//  12. THE BOOTSTRAP FAILURE CLASS
//
//  The first real browser smoke died with
//      rt3d worker boot failed: MutationObserver is not defined
//  because the canonical script has top-level DOM startups and a Dedicated
//  Worker has no DOM.
//
//  These tests pin the fix. They use a Worker environment that genuinely has NO
//  DOM -- the previous harness supplied a permissive fake DOM, which made it MORE
//  capable than a real Worker and therefore incapable of reproducing the failure.
// ============================================================

// 12a. The environment really has no DOM. If this ever passes because a shim was
// reintroduced, the tests below would be meaningless.
{
  const w = workerEnv();
  const NO_DOM = ['document', 'window', 'MutationObserver', 'ResizeObserver',
    'IntersectionObserver', 'localStorage', 'sessionStorage', 'HTMLElement',
    'Image', 'FileReader', 'OffscreenCanvas', 'matchMedia', 'getComputedStyle',
    'devicePixelRatio', 'innerWidth', 'innerHeight', 'requestAnimationFrame',
    'cancelAnimationFrame'];
  const present = NO_DOM.filter(g => w.globals[g] !== undefined);
  check('12a', 'the Worker test environment provides NO DOM APIs a real Worker lacks',
        present.length === 0, 'present: ' + present.join(', '));
  check('12b', 'the Worker environment does define the runtime-mode sentinel',
        w.globals.__RT3D_WORKER__ === true, '');
}

// 12c. THE REGRESSION. Loading the canonical script in that environment must
// succeed. Before the fix this threw `MutationObserver is not defined`.
{
  let err = null;
  let w = null;
  try { w = workerEnv(); } catch (e) { err = e; }
  check('12c', 'the canonical script loads in a Worker environment with no DOM ' +
        '(this is the reported MutationObserver failure)',
        !err, err ? err.message : '');
  if (w) {
    check('12c2', 'and it reports Worker mode, with inert presentation handles',
          w.run('RT3D_WORKER_MODE') === true &&
          w.run('cv') === null && w.run('ctx') === null && w.run('dpr') === 1, '');
    check('12c3', 'the canonical engine is fully available in the Worker',
          w.run('typeof rt3dBuildWorld') === 'function' &&
          w.run('typeof rt3dCoverageAt') === 'function' &&
          w.run('typeof rt3dCoverageSlice') === 'function' &&
          w.run('typeof rt3dCoverageColumn') === 'function', '');
    check('12c4', 'the DOM accessors degrade to null instead of throwing when ' +
          'there is no document',
          w.run('$("#anythingAtAll")') === null &&
          JSON.stringify(w.run('$$("#anythingAtAll")')) === '[]', '');
  }
}

// 12d. UI initialisation DOES happen in browser mode. The fix must not have
// disabled the editor's own startup.
{
  const win = makeDom();
  win.location = { search: '?rt3d=1' };
  const observed = [];
  win.MutationObserver = class {
    constructor(cb) { observed.push('constructed'); this._cb = cb; }
    observe(target, opts) { observed.push('observe:' + (target && target.__id || 'body')); }
    disconnect() {} takeRecords() { return []; }
  };
  const langs = [];
  const doc = win.document;
  const realDE = Object.getOwnPropertyDescriptor(doc, 'documentElement');
  // Observe the lang assignment the i18n startup performs.
  Object.defineProperty(doc, 'documentElement', {
    configurable: true,
    get() {
      const el = realDE.get ? realDE.get.call(doc) : (realDE.value);
      return new Proxy(el || {}, {
        set(t, k, v) { if (k === 'lang') langs.push(v); t[k] = v; return true; },
        get(t, k) { return t[k]; }
      });
    }
  });
  const ctx = vm.createContext(win);
  let err = null;
  try { vm.runInContext(APP_SOURCE, ctx, { filename: 'index.html<script>' }); }
  catch (e) { err = e; }

  check('12d', 'in BROWSER mode the canonical script loads with UI startup enabled',
        !err, err ? err.message : '');
  if (!err) {
    const mode = run(ctx, 'RT3D_WORKER_MODE');
    check('12d2', 'browser mode reports RT3D_WORKER_MODE === false', mode === false, String(mode));
    check('12d3', 'the i18n MutationObserver is constructed and observes the body',
          observed.includes('constructed') && observed.some(o => o.startsWith('observe:')),
          JSON.stringify(observed));
    check('12d4', 'the document language is set during startup, as before',
          langs.length > 0, 'lang assignments: ' + JSON.stringify(langs));
    check('12d5', 'the canvas handle and its 2D context ARE created in browser mode',
          run(ctx, 'cv !== null && ctx !== null') === true, '');
  }
}

// 12e. The boot probe: "can the Worker load the canonical engine at all?",
// answered without starting a field computation. This is the check the browser
// smoke can run on its own.
{
  const w = workerEnv();
  const { sent, runtime, tick } = attachProtocol(w);
  runtime.handle({ type: 'PING', jobId: 900 });
  tick.flushAll();
  const reply = sent.map(s => s.msg).find(m => m.type === 'READY' || m.type === 'ERROR');
  check('12e', 'a boot probe answers READY in a Worker with no DOM',
        !!reply && reply.type === 'READY',
        reply ? reply.type + (reply.message ? ': ' + reply.message : '') : 'no reply');
  check('12e2', 'the READY reply is not a field result and carries no grid',
        !!reply && !reply.grid && !reply.evaluatedCells, '');
}

// 12f. And the probe must NOT claim READY if the engine is genuinely absent.
{
  const w = workerEnv();
  const { sent, runtime, tick } = attachProtocol(w);
  w.run('rt3dBuildWorld = undefined;');   // break the engine in the worker scope only
  runtime.handle({ type: 'PING', jobId: 901 });
  tick.flushAll();
  const reply = sent.map(s => s.msg).find(m => m.type === 'READY' || m.type === 'ERROR');
  check('12f', 'the boot probe reports ERROR, never READY, when the engine is missing',
        !!reply && reply.type === 'ERROR', reply ? reply.type : 'no reply');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { failures.forEach(f => console.log('  - ' + f)); process.exit(1); }