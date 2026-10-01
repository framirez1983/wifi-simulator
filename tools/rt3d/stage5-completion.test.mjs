// Stage 5 completion-path regression.
//
// A browser smoke test on S4 reported: progress reached "tracing 100%: 3420 /
// 3420 rays" and then STAYED there. No summary, no grid, blank map.
//
// These tests pin the invariant that was violated:
//
//     cursor >= total  ->  finalize exactly once  ->  stop
//
// and prove it holds regardless of fan size, AP count, whether the last ray
// lands on a batch or time-slice boundary, zero samples, or cancellation. They
// also assert finalization fires EXACTLY ONCE, and that reaching
// processed === total can never leave the runner in a tracing state.
//
// The clock is faked and requestAnimationFrame is an explicit queue, so the
// boundary cases are deterministic instead of depending on machine speed, and a
// frozen rAF (a hidden browser tab) can be reproduced on purpose.
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

// tickStep controls how fast the fake clock advances per performance.now() call,
// which decides how many rays fit inside one 35 ms slice:
//    0 -> the whole job fits in one slice, no yielding at all
//   10 -> a few rays per slice, many yields
//   20 -> one ray per slice, so the final ray lands as the budget expires
function makeSandbox(tickStep) {
  const win = makeDom();
  win.location = { search: '?rt3d=1' };
  const ctx = vm.createContext(win);
  vm.runInContext(SRC, ctx, { filename: 'index.html<script>' });
  run(ctx, `
    paintHeat=function(){}; computeHeatSimple=function(){}; draw2d=function(){};
    coverageUpdate=function(){}; showToast=function(){}; refresh3dHeat=function(){};
    scheduleHeat=function(){}; clearTimeout(heatTimer);

    window.__now = 0;
    window.__rafQ = [];
    window.__timers = [];
    window.__tid = 0;
    window.__tickStep = ${tickStep || 0};
    window.__tick = 0;
    window.performance = { now: function(){
      window.__tick += window.__tickStep; return window.__now + window.__tick; } };
    window.requestAnimationFrame = function(cb){ window.__rafQ.push(cb); return window.__rafQ.length; };
    window.cancelAnimationFrame = function(){};
    // A faithful timer set: clearTimeout must actually cancel, otherwise a
    // re-armed watchdog leaves stale entries behind and "nothing is armed after
    // completion" cannot be asserted at all.
    window.setTimeout = function(fn, ms){
      var t={ id:++window.__tid, fn:fn, ms:ms||0 };
      window.__timers.push(t); return t.id;
    };
    window.clearTimeout = function(id){
      for(var i=0;i<window.__timers.length;i++){
        if(window.__timers[i].id===id){ window.__timers.splice(i,1); return; }
      }
    };

    // ONE queued callback per pump, rAF first, because the runner re-arms rAF.
    // A non-zero-delay timer is never run implicitly: that is the watchdog, and
    // firing it by accident would mask the very stranding this file catches.
    window.__pumpOne = function(advanceMs){
      if(window.__rafQ.length){
        var cb=window.__rafQ.shift();
        window.__now += (advanceMs!=null?advanceMs:1);
        cb(); return 'raf';
      }
      for(var i=0;i<window.__timers.length;i++){
        if(!window.__timers[i].ms){ var t=window.__timers.splice(i,1)[0]; t.fn(); return 'timer'; }
      }
      return null;
    };
    window.__pump = function(advanceMs, maxSteps){
      var steps=0;
      while(window.__pumpOne(advanceMs) && steps<(maxSteps||1000000)) steps++;
      return steps;
    };
    window.__fireDelayed = function(){
      for(var i=0;i<window.__timers.length;i++){
        if(window.__timers[i].ms){ var t=window.__timers[i]; window.__timers.splice(i,1);
          window.__now += t.ms; t.fn(); return true; }
      }
      return false;
    };
  `);
  return ctx;
}

function scene(ctx, aps) {
  run(ctx, `
    state=freshState();
    var f=state.floors[0]; f.height=3.0; f.w=40; f.d=40; f.ceilingAreas=[];
    var M4=state.materials[4].id;
    f.walls.push({id:'w',x1:-15,y1:-15,x2:15,y2:-15,materialId:M4,thickness:DEFAULT_WALL_THICKNESS_M});
    for(var i=0;i<${aps};i++) f.aps.push(makeAP(-10+i*2,0,'AP-'+i,3.0));
    state.activeFloor=0;
  `);
}

// Aim the receiver plane out of every ray's reach without touching physics:
// the function the runner calls is replaced, not the kernel.
function pinPlane(ctx, absZ) {
  run(ctx, `window.__origPlaneZ = window.__origPlaneZ || rt3dExpPlaneZ;
            rt3dExpPlaneZ = function(){ return ${absZ}; };`);
}

const HOOKS = `{
  onProgress: function(frac,d,t){ window.__ev.push({k:'progress', d:d, t:t, frac:frac}); },
  onDone:     function(r){ window.__ev.push({k:'done', res:r}); },
  onError:    function(e){ window.__ev.push({k:'error', msg:String(e&&e.message||e)}); }
}`;

function startRun(ctx, preset) {
  run(ctx, 'window.__ev=[]; window.__timers.length=0; window.__rafQ.length=0;');
  run(ctx, `window.__job = rt3dExpRun(${JSON.stringify(preset)}, ${HOOKS});`);
}
const evOf = (ctx) => JSON.parse(run(ctx, 'JSON.stringify(window.__ev)'));
const dones = (ctx) => evOf(ctx).filter((e) => e.k === 'done');

// Step one queued callback at a time so slices are observable and cancellation
// can land between two of them.
function drive(ctx, { advanceMs = 0, cancelAfter = null } = {}) {
  let slices = 0;
  for (;;) {
    if (run(ctx, `window.__pumpOne(${advanceMs})`) === null) break;
    slices++;
    if (dones(ctx).length || evOf(ctx).some((e) => e.k === 'error')) break;
    if (cancelAfter !== null && slices >= cancelAfter) run(ctx, 'window.__job.cancel();');
    if (slices > 1000000) break;
  }
  return { slices, ev: evOf(ctx) };
}

console.log('Stage 5 completion-path regression\n');

// ---------------------------------------------------------------- 1
// The real observed shape: 5 APs x medium fan = 3420 rays.
{
  const sb = makeSandbox(10);
  scene(sb, 5);
  startRun(sb, 'medium');
  const r = drive(sb, { advanceMs: 0 });
  const d = dones(sb);
  const res = d[0] && d[0].res;
  check(1, '3420 rays (5 APs x medium) completes and finalizes exactly once',
    res && d.length === 1 && res.totalUnits === 3420 &&
    res.completedUnits === 3420 && res.emittedRays === 3420 &&
    !res.cancelled && res.finishReason === 'completed',
    JSON.stringify({ dones: d.length, total: res && res.totalUnits,
                     completed: res && res.completedUnits, reason: res && res.finishReason }));
  const prog = r.ev.filter((e) => e.k === 'progress');
  check('1b', 'progress is never painted at 100%: the strand signature cannot occur',
    prog.length > 1 && !prog.some((e) => e.d >= e.t),
    JSON.stringify({ events: prog.length, atTotal: prog.filter((e) => e.d >= e.t).length,
                     first: prog[0], last: prog[prog.length - 1] }));
  check('1c', 'the final progress event is below total, and a done event follows it',
    r.ev[r.ev.length - 1].k === 'done' &&
    prog[prog.length - 1].d < prog[prog.length - 1].t,
    JSON.stringify({ lastEvent: r.ev[r.ev.length - 1].k,
                     lastProgress: prog[prog.length - 1] }));
}

// ---------------------------------------------------------------- 2
// A finished run must leave nothing armed.
{
  const sb = makeSandbox(10);
  scene(sb, 2);
  startRun(sb, 'low');
  drive(sb, { advanceMs: 0 });
  const idle = JSON.parse(run(sb, `JSON.stringify({
    raf: window.__rafQ.length, timers: window.__timers.length })`));
  check(2, 'a finished run leaves no queued slice and no armed watchdog',
    idle.raf === 0 && idle.timers === 0, JSON.stringify(idle));
}

// ---------------------------------------------------------------- 3
// total smaller than one batch.
{
  const sb = makeSandbox();
  scene(sb, 1);
  startRun(sb, 'low');
  const r = drive(sb, { advanceMs: 0 });
  const res = r.ev.find((e) => e.k === 'done');
  check(3, 'total smaller than one batch finalizes in a single slice, without yielding',
    res && res.res.totalUnits === 84 && res.res.completedUnits === 84 &&
    r.slices === 1 && res.res.finishReason === 'completed',
    JSON.stringify({ slices: r.slices, total: res && res.res.totalUnits,
                     reason: res && res.res.finishReason }));
}

// ---------------------------------------------------------------- 4
// The last ray landing exactly as the time slice expires. Advancing the fake
// clock past the budget each step makes the loop exit on BOTH conditions at
// once, which is the case the browser report describes.
{
  // tickStep 20 puts the budget boundary on the same ray as the last one, so the
  // loop can exit for EITHER reason. This is the reported browser case.
  const sb = makeSandbox(20);
  scene(sb, 2);
  startRun(sb, 'low');
  const r = drive(sb, { advanceMs: 0 });
  const d = dones(sb);
  const res = d[0] && d[0].res;
  check(4, 'the last ray landing on the time-slice boundary still finalizes',
    res && d.length === 1 && res.totalUnits === 168 &&
    res.completedUnits === res.totalUnits && r.slices > 1 &&
    res.finishReason === 'completed',
    JSON.stringify({ dones: d.length, total: res && res.totalUnits,
                     completed: res && res.completedUnits, slices: r.slices }));
}

// ---------------------------------------------------------------- 5
// Mid-budget completion across many slices.
{
  const sb = makeSandbox(10);
  scene(sb, 3);
  startRun(sb, 'medium');
  const r = drive(sb, { advanceMs: 0 });
  const d = dones(sb);
  const res = d[0] && d[0].res;
  check(5, 'completion across many slices finalizes exactly once',
    res && d.length === 1 && res.completedUnits === 3 * 684,
    JSON.stringify({ dones: d.length, completed: res && res.completedUnits, slices: r.slices }));
}

// ---------------------------------------------------------------- 6
// Zero receiver-plane samples.
{
  const sb = makeSandbox();
  scene(sb, 2);
  pinPlane(sb, -500);
  startRun(sb, 'low');
  drive(sb, { advanceMs: 0 });
  const d = dones(sb);
  const res = d[0] && d[0].res;
  check(6, 'zero receiver-plane samples still finalizes: 0 samples, 0% coverage, all cells no-data',
    res && d.length === 1 && res.samples.length === 0 && res.sampledCells === 0 &&
    res.unsampledCells === res.totalCells && res.coveragePct === 0 &&
    res.completedUnits === res.totalUnits,
    JSON.stringify({ samples: res && res.samples.length, sampled: res && res.sampledCells,
                     cov: res && res.coveragePct, reason: res && res.finishReason }));
}

// ---------------------------------------------------------------- 7
// Non-zero samples.
{
  const sb = makeSandbox();
  scene(sb, 3);
  startRun(sb, 'low');
  drive(sb, { advanceMs: 0 });
  const res = evOf(sb).find((e) => e.k === 'done');
  const r = res && res.res;
  check(7, 'non-zero samples finalizes with a populated grid',
    !!r && r.samples.length > 0 && r.sampledCells > 0 && r.coveragePct > 0,
    JSON.stringify(r && { samples: r.samples.length, cells: r.sampledCells, cov: r.coveragePct }));
}

// ---------------------------------------------------------------- 8
// Cancellation immediately before completion.
{
  const sb = makeSandbox(10);
  scene(sb, 4);
  startRun(sb, 'high');
  const progBefore = evOf(sb).length;
  const r = drive(sb, { advanceMs: 0, cancelAfter: 2 });
  const d = dones(sb);
  const res = d[0] && d[0].res;
  check(8, 'cancellation immediately before completion finalizes once, flagged cancelled, partial',
    d.length === 1 && res && res.cancelled === true &&
    res.completedUnits < res.totalUnits && res.emittedRays === res.completedUnits,
    JSON.stringify({ progressEventsBeforeCancel: progBefore, dones: d.length,
                     cancelled: res && res.cancelled,
                     completed: res && res.completedUnits, total: res && res.totalUnits,
                     reason: res && res.finishReason }));
}

// ---------------------------------------------------------------- 9
// Repeated run after a completed run.
{
  const sb = makeSandbox(10);
  scene(sb, 2);
  startRun(sb, 'low'); drive(sb, { advanceMs: 0 });
  const first = dones(sb)[0].res;
  startRun(sb, 'low'); drive(sb, { advanceMs: 0 });
  const second = dones(sb).filter((e) => e.k === 'done');
  // the second run restarts the event log, so exactly one done must be present
  const res = second[0] && second[0].res;
  check(9, 'a repeated run after a completed run finalizes normally and identically',
    second.length === 1 && res && res.completedUnits === res.totalUnits &&
    res.sampledCells === first.sampledCells && res.finishReason === 'completed',
    JSON.stringify({ dones: second.length, cells1: first.sampledCells,
                     cells2: res && res.sampledCells, reason: res && res.finishReason }));
}

// ---------------------------------------------------------------- 10
// A suspended requestAnimationFrame (hidden tab) must still finalize.
{
  const sb = makeSandbox();
  scene(sb, 2);
  startRun(sb, 'high');
  // deliberately do NOT pump rAF; fire the watchdog as the browser would when
  // its timer fires in a hidden tab
  run(sb, 'window.__fireDelayed();');
  const d = dones(sb);
  const res = d[0] && d[0].res;
  check(10, 'a suspended rAF finalizes via the watchdog instead of hanging',
    d.length === 1 && res && /watchdog/.test(res.finishReason),
    JSON.stringify({ dones: d.length, reason: res && res.finishReason }));
}

// ---------------------------------------------------------------- 11
// A throw while finalizing is reported, not swallowed.
{
  const sb = makeSandbox();
  scene(sb, 1);
  const r = JSON.parse(run(sb, `JSON.stringify((function(){
    var ev=[];
    window.__job = rt3dExpRun('low', {
      onProgress: function(){},
      onDone: function(){ ev.push('done'); throw new Error('synthetic paint failure'); },
      onError: function(e){ ev.push('error:'+e.message); }
    });
    window.__pump(0, 100000);
    return ev;
  })())`));
  check(11, 'a finalization failure is surfaced through onError exactly once, with no done',
    r.filter((e) => e.startsWith('error:')).length === 1 &&
    r.includes('error:synthetic paint failure'),
    JSON.stringify(r));
}

// ---------------------------------------------------------------- 12
// Structural: completion must precede both the progress paint and the re-arm.
{
  const c = SRC.indexOf('if(done>=totalUnits){ finish(false); return; }');
  const p = SRC.indexOf('hooks.onProgress(done/totalUnits', c);
  const y = SRC.indexOf('requestAnimationFrame(slice);', c);
  check(12, 'in the source the completion check precedes the progress paint and the re-arm',
    c > 0 && p > c && y > c,
    `complete@${c} progress@${p} rearm@${y}`);
}

// ---------------------------------------------------------------- 13
// Finalization is guarded exactly once, structurally.
{
  const a = SRC.indexOf('function finish(');
  const b = SRC.indexOf('function finalize(');
  const fin = SRC.slice(a, b);
  check(13, 'finish() returns early when already settled, so it can only fire once',
    a > 0 && b > a &&
    /if\(settled\) return false;\s*settled=true;/.test(fin.replace(/\s+/g, ' ')),
    fin.slice(0, 160).replace(/\s+/g, ' '));
}

// ---------------------------------------------------------------- 14
// A watchdog abort is a STALL, not a completion, and says so on the result.
{
  const sb = makeSandbox();
  scene(sb, 2);
  startRun(sb, 'high');
  run(sb, 'window.__fireDelayed();');
  const d = dones(sb);
  const res = d[0] && d[0].res;
  check(14, 'a watchdog abort sets stalled:true and is distinguishable from a completion',
    res && res.stalled === true && /watchdog/.test(res.finishReason) &&
    res.cancelled === false && res.completedUnits < res.totalUnits,
    JSON.stringify(res && { stalled: res.stalled, reason: res.finishReason,
                            cancelled: res.cancelled,
                            done: res.completedUnits, total: res.totalUnits }));
}

// ---------------------------------------------------------------- 15
// A normal completion is never flagged stalled.
{
  const sb = makeSandbox();
  scene(sb, 2);
  startRun(sb, 'low');
  drive(sb, { advanceMs: 0 });
  const res = dones(sb)[0].res;
  check(15, 'a normal completion sets stalled:false and finishReason "completed"',
    res && res.stalled === false && res.finishReason === 'completed' && !res.cancelled,
    JSON.stringify(res && { stalled: res.stalled, reason: res.finishReason,
                             cancelled: res.cancelled }));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
