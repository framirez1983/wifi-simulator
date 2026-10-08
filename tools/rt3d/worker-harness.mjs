// Stage 7A Worker harness.
//
// Builds the SAME fixture in two independent execution contexts and gives each
// the same code to run:
//
//   MAIN     a DOM sandbox (the browser's situation today)
//   WORKER   an RT3D environment with NO document, NO canvas and NO
//            requestAnimationFrame, built from rt3d-core.js
//
// Both evaluate the application's own <script> block, so neither has a private
// copy of the physics. The Worker environment's deliberate ABSENCE of
// requestAnimationFrame is the structural proof that the compute path cannot be
// scheduled by painting.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { makeDom } from './loader.mjs';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..', '..', 'index.html');
const CORE = path.join(HERE, '..', '..', 'rt3d-core.js');

export const RT3DCore = require(CORE);
export const APP_SOURCE = RT3DCore.extractAppSource(fs.readFileSync(APP, 'utf8'));

// A deterministic scheduler for tests. The production path yields through a
// MessageChannel (see RT3DCore.makeNextTick); here yielding is an explicit
// queue, so cancellation and supersession can be interleaved at exactly one
// chosen point instead of racing a timer.
export function manualTick() {
  const q = [];
  const tick = (fn) => { q.push(fn); };
  tick.flushOne = () => { const f = q.shift(); if (!f) return false; f(); return true; };
  tick.flushAll = (max = 1e7) => { let n = 0; while (tick.flushOne() && n < max) n++; return n; };
  tick.pending = () => q.length;
  return tick;
}

// The Worker-side environment: rt3d-core's stub globals, and nothing else.
export function workerEnv(overrides) {
  const globals = RT3DCore.workerGlobals(overrides);
  const ctx = vm.createContext(globals);
  vm.runInContext(APP_SOURCE, ctx, { filename: 'index.html<script>' });
  return {
    ctx,
    globals,
    run: (code) => vm.runInContext(code, ctx, { filename: 'worker' }),
  };
}

// The main-thread DOM sandbox, matching the other suites.
export function mainEnv() {
  const win = makeDom();
  win.location = { search: '?rt3d=1' };
  const ctx = vm.createContext(win);
  vm.runInContext(APP_SOURCE, ctx, { filename: 'index.html<script>' });
  const run = (code) => vm.runInContext(code, ctx, { filename: 'main' });
  run(`paintHeat=function(){};computeHeatSimple=function(){};draw2d=function(){};
       coverageUpdate=function(){};showToast=function(){};refresh3dHeat=function(){};
       scheduleHeat=function(){};clearTimeout(heatTimer);bootUI=function(){};`);
  return { ctx, win, run };
}

// Build one fixture in both contexts.
export function buildPair(scene) {
  const main = mainEnv();
  const worker = workerEnv();
  main.run(scene);
  worker.run(scene);
  return { main, worker };
}

// The canonical project snapshot the main thread would post. It uses the
// application's OWN existing deep-clone convention (index.html snapState /
// loadProject): drop the runtime `_img` renderer handle, which is an Image and
// is never an RF input. Nothing else is reinterpreted.
export const SNAPSHOT_FN = `
function __rt3dWorkerSnapshot(){
  var s = JSON.parse(JSON.stringify(state, function(k,v){ return k==='_img' ? undefined : v; }));
  return {
    state: s,
    floorIndex: state.activeFloor,
    spec: rt3dGridSpec(state.floors[state.activeFloor]),
    planeZ: rt3dReceiverPlaneZForFloor(state.activeFloor),
    columnX: 0, columnY: 0,
    columnZs: [0.5,1.2,2.0,2.8,4.2].filter(function(z){
      return z < floorElevation(state.activeFloor)+(state.floors[state.activeFloor].height||3)+0.5; })
  };
}`;

// Drive one job through the real protocol inside a Worker environment.
// `tick` is a manualTick. Returns a recorder with the messages in order.
export function runProtocol(worker, snapshot, opts = {}) {
  const tick = opts.tick || manualTick();
  const messages = [];
  const runJob = RT3DCore.createJobRunner(worker, tick);
  const handle = runJob(
    { jobId: opts.jobId != null ? opts.jobId : 1, snapshot, options: opts.options || {} },
    (msg) => messages.push(msg));
  return { messages, handle, tick };
}

// Same, but through attachRuntime (the message plumbing a real Worker uses),
// which is where supersession and the id guard live.
export function attachProtocol(worker, opts = {}) {
  const tick = opts.tick || manualTick();
  const sent = [];
  const runtime = RT3DCore.attachRuntime({
    env: worker,
    nextTick: tick,
    post: (msg, transfer) => sent.push({ msg, transfer }),
  });
  return { sent, runtime, tick };
}