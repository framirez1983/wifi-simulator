// ============================================================
//  RT3D COVERAGE WORKER — Stage 7A.1
//
//  Entry point for the Dedicated Worker that evaluates the Stage-6 Coverage
//  Field. All logic lives in rt3d-core.js; this file only supplies a transport.
//
//  It evaluates the SAME application <script> block the main thread runs, so
//  the RF maths is not duplicated — see rt3d-core.js for why.
//
//  There is NO requestAnimationFrame, NO document access, NO canvas and NO DOM
//  event anywhere in this file or in the core it loads. That is the product
//  requirement: RT3D computation must continue when the browser stops
//  painting. This worker has no way to observe painting at all, so it cannot
//  accidentally depend on it.
// ============================================================
importScripts('./rt3d-core.js');

var runtime = null;
var booting = null;

// Boot is asynchronous because the application source has to be fetched. Jobs
// that arrive first are queued, not dropped.
var pending = [];
var failed = null;

function fail(message) {
  failed = message;
  while (pending.length) {
    var job = pending.shift();
    self.postMessage({ type: RT3DCore.MSG.ERROR, jobId: job.jobId, message: message });
  }
}

function boot() {
  if (runtime) return Promise.resolve(runtime);
  if (booting) return booting;
  if (failed) return Promise.reject(new Error(failed));

  booting = fetch('./index.html')
    .then(function (r) {
      if (!r.ok) throw new Error('cannot fetch index.html: HTTP ' + r.status);
      return r.text();
    })
    .then(function (html) {
      var source = RT3DCore.extractAppSource(html);
      // The engine is loaded as a CLASSIC SCRIPT, not with eval.
      //
      // Eval would be the obvious choice and it is wrong: eval gets its own
      // declarative environment, so the application's top-level `let state`
      // would not become a global binding and the first RF query would fail with
      // a ReferenceError. A classic script's top-level let/const DO become global
      // lexical bindings, which is the relationship the main thread has with its
      // own <script> and the one the engine relies on.
      //
      // Afterwards, indirect eval is safe and is used only for the small snippets
      // that ASSIGN `state` and CALL the engine functions. Those work because
      // `state` is now a real global lexical binding and the engine's function
      // declarations are properties of the global object.
      var globals = self;   // the worker's own global scope; importScripts needs it
      // The runtime-mode sentinel, set BEFORE the canonical script is evaluated.
      // It tells the application to skip its UI-only startups (the i18n DOM
      // observer, the 2D canvas, the device-pixel ratio, the editor's global
      // listeners and app startup), none of which exist in a Worker. It gates
      // presentation side effects only -- never an RF function or constant.
      globals.__RT3D_WORKER__ = true;
      RT3DCore.loadClassicScript(globals, source);
      var env = RT3DCore.envForScope(globals);
      runtime = RT3DCore.attachRuntime({
        env: env,
        post: function (msg, transfer) {
          if (transfer && transfer.length) self.postMessage(msg, transfer);
          else self.postMessage(msg);
        }
      });
      var queued = pending.splice(0, pending.length);
      queued.forEach(function (job) { runtime.handle(job); });
      return runtime;
    })
    .catch(function (err) {
      fail('rt3d worker boot failed: ' + (err && err.message ? err.message : err));
      booting = null;
      throw err;
    });

  return booting;
}

self.onmessage = function (ev) {
  var msg = ev && ev.data;
  if (!msg || !msg.type) return;

  if (msg.type === RT3DCore.MSG.PING) {
    // Boot probe. Answered once the engine is loaded; queued like a job so it
    // still reports the boot failure if the engine could not be evaluated.
    if (failed) { self.postMessage({ type: RT3DCore.MSG.ERROR, jobId: msg.jobId, message: failed }); return; }
    if (runtime) { runtime.handle(msg); return; }
    pending.push(msg);
    boot().catch(function () { /* failure already surfaced via fail() */ });
    return;
  }

  if (msg.type === RT3DCore.MSG.CANCEL) {
    // Cancellation must work even while the worker is still booting: record it
    // so the job is cancelled the moment it starts.
    if (runtime) { runtime.handle(msg); return; }
    pending.push({ type: RT3DCore.MSG.CANCEL, jobId: msg.jobId });
    return;
  }

  if (msg.type !== RT3DCore.MSG.RUN_SLICE) return;
  if (failed) { self.postMessage({ type: RT3DCore.MSG.ERROR, jobId: msg.jobId, message: failed }); return; }
  if (runtime) { runtime.handle(msg); return; }
  pending.push(msg);
};

boot().catch(function () { /* failure already surfaced via fail() */ });