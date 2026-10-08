// ============================================================
//  RT3D WORKER CORE — Stage 7A.1
//
//  ONE physics implementation, TWO execution locations.
//
//  There is no second copy of the RT3D engine here, and none anywhere in
//  Stage 7A. This file contains no RF mathematics at all. It contains:
//
//    * the job protocol (message names and payload shapes),
//    * a DOM-free environment in which the application's OWN source text can be
//      evaluated, and
//    * a transport-agnostic job runner that drives the canonical engine
//      functions (rt3dBuildWorld, rt3dBvhFor, rt3dCoverageSlice,
//      rt3dCoverageColumn) which continue to live in index.html.
//
//  WHY THE WORKER EVALUATES index.html RATHER THAN A COPIED CORE FILE
//  ----------------------------------------------------------------
//  A Dedicated Worker cannot import an inline <script>. The two obvious
//  alternatives were a copied engine file (a second implementation, which is
//  exactly the thing this stage forbids and which drifts the moment either
//  copy is edited) or extracting the computational closure out of index.html
//  (large surgery on a frozen, 614-check-validated engine).
//
//  Instead the worker fetches index.html and evaluates the same <script> block
//  the main thread evaluates, verbatim, in its own global scope. The worker and
//  the main thread therefore run byte-identical code. That makes "one physics
//  implementation" true by construction rather than by discipline: there is no
//  second file that could disagree.
//
//  The cost is that the worker parses the whole application script once per
//  worker instance. That is accepted and NOT optimised here — Stage 7A.1 moves
//  execution location only, and one long-lived worker amortises it.
//
//  WHY requestAnimationFrame IS DELIBERATELY ABSENT
//  ------------------------------------------------
//  A Dedicated Worker has no requestAnimationFrame, and the point of this stage
//  is that RT3D computation must not be scheduled by it. So the bootstrap below
//  does not define requestAnimationFrame at all. If any code path the worker
//  executes were to reach for it, evaluation or the run would THROW instead of
//  quietly working. That turns "the compute path has no rAF dependency" from a
//  convention into a structural property that cannot rot.
//
//  Yielding between compute chunks uses nextTick() (MessageChannel where
//  available, setTimeout otherwise) — never rAF. A MessageChannel yield is not
//  suspended by tab visibility, which is the whole product requirement.
// ============================================================
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;   // Node tests
  else root.RT3DCore = api;                                                 // worker + main
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ------------------------------------------------------------
  //  PROTOCOL
  //
  //  Every message carries a jobId. A consumer MUST ignore any message whose
  //  jobId is not the current job. That single rule is what makes supersession
  //  safe: a superseded job may still have messages in flight, and they are
  //  recognisable because their id is stale.
  // ------------------------------------------------------------
  var MSG = {
    RUN_SLICE: 'RUN_SLICE',   // main -> worker
    CANCEL:    'CANCEL',      // main -> worker
    PROGRESS:  'PROGRESS',    // worker -> main
    COMPLETE:  'COMPLETE',    // worker -> main
    CANCELLED: 'CANCELLED',   // worker -> main
    ERROR:     'ERROR',       // worker -> main
    // Boot probe. Deliberately separate from RUN_SLICE so that "did the Worker
    // manage to load the engine at all?" can be answered without starting a
    // multi-second field computation. This is the check that distinguishes a
    // bootstrap failure (the first browser smoke's `MutationObserver is not
    // defined`) from a physics or scheduling problem.
    PING:      'PING',
    READY:     'READY'
  };

  // Default cadence for progress. Bounded by CELLS, not by time, so the number
  // of messages cannot explode on a fast machine and cannot vanish on a slow
  // one, and a run of 60 000 cells emits a few hundred messages rather than
  // 60 000. Per-cell messaging is never used.
  var DEFAULT_PROGRESS_EVERY_CELLS = 512;

  // Wall-clock budget for one compute chunk inside the worker. This is the same
  // idea as the old per-frame budget: keep individual chunks short enough that
  // a CANCEL message can be observed promptly, and so progress is emitted
  // regularly. It is NOT a paint budget -- nothing is painted from here.
  var DEFAULT_CHUNK_MS = 35;

  // ------------------------------------------------------------
  //  SOURCE EXTRACTION
  // ------------------------------------------------------------
  // The application's single inline <script>. The <script src=...> tags are not
  // matched: the pattern requires the attribute-free form, so exactly the block
  // the browser executes is the block the worker evaluates.
  function extractAppSource(html) {
    var m = /<script>\n([\s\S]*?)\n<\/script>/.exec(html);
    if (!m) throw new Error('rt3d-core: application <script> block not found');
    return m[1];
  }

  // ------------------------------------------------------------
  //  ENVIRONMENT — a faithful Dedicated Worker global.
  //
  //  THIS FUNCTION DELIBERATELY PROVIDES NO DOM.
  //
  //  An earlier version of this file handed the Worker a permissive fake DOM --
  //  `document`, `window`, `MutationObserver` and all -- purely so the
  //  application script would evaluate. That was a mistake, and an expensive
  //  one: it made the harness MORE capable than a real Dedicated Worker, so it
  //  could never reproduce the real failure class. The first browser smoke died
  //  with `MutationObserver is not defined`, and no test here could have noticed,
  //  because every DOM API it would have needed was already present.
  //
  //  A Dedicated Worker has NO: document, window, localStorage, sessionStorage,
  //  MutationObserver, ResizeObserver, IntersectionObserver, HTMLElement, Image,
  //  FileReader, OffscreenCanvas, matchMedia, getComputedStyle, devicePixelRatio,
  //  innerWidth/innerHeight, requestAnimationFrame.
  //
  //  It DOES have: self/globalThis, location, navigator, timers, fetch, Blob,
  //  URL, TextDecoder/Encoder, console, performance, structuredClone, and
  //  addEventListener on its own global.
  //
  //  If a future top-level statement reaches for a DOM API, this environment must
  //  let it fail loudly, exactly as the browser did. Emulating the DOM here would
  //  only turn the coupling back into something invisible.
  // ------------------------------------------------------------
  function workerGlobals(overrides) {
    var g = {
      console: typeof console !== 'undefined' ? console : null,
      performance: typeof performance !== 'undefined' ? performance : null,
      setTimeout: setTimeout, clearTimeout: clearTimeout,
      setInterval: typeof setInterval !== 'undefined' ? setInterval : undefined,
      clearInterval: typeof clearInterval !== 'undefined' ? clearInterval : undefined,
      queueMicrotask: typeof queueMicrotask !== 'undefined' ? queueMicrotask : undefined,
      structuredClone: typeof structuredClone !== 'undefined' ? structuredClone : undefined,
      TextDecoder: typeof TextDecoder !== 'undefined' ? TextDecoder : undefined,
      TextEncoder: typeof TextEncoder !== 'undefined' ? TextEncoder : undefined,
      // WorkerLocation and WorkerNavigator do exist in a Worker.
      location: { search: '', href: '' },
      navigator: typeof navigator !== 'undefined' ? navigator : { userAgent: 'worker' },
      // addEventListener exists on the WorkerGlobalScope itself (message, error).
      addEventListener: function () {}, removeEventListener: function () {},
      dispatchEvent: function () { return false; },
      postMessage: function () {},
      fetch: function () { return Promise.reject(new Error('rt3d-core: fetch unavailable in this host')); }
    };
    if (overrides) for (var k in overrides) if (Object.prototype.hasOwnProperty.call(overrides, k)) g[k] = overrides[k];
    g.self = g;
    g.globalThis = g;
    // The sentinel the application script checks to skip UI-only startup. It is
    // set here, and by the real worker, BEFORE the application script runs.
    g.__RT3D_WORKER__ = true;
    return g;
  }

  // Load `source` into `scope` as a CLASSIC SCRIPT.
  //
  // This matters, and eval is the wrong tool here. A Dedicated Worker cannot
  // import an inline <script>, so the obvious implementation is
  // `(0,eval)(source)` -- and that is broken. Eval creates its own declarative
  // environment, so the application's top-level `let state` (and every other
  // top-level let/const) would NOT become a global binding, and the next snippet
  // that reads `state` would fail with a ReferenceError. A classic script is
  // different: its top-level let/const DO become global lexical bindings, exactly
  // as in an HTML <script> tag. That is the relationship the main thread has
  // with its own script, and the one the engine assumes.
  //
  // importScripts is the worker's own mechanism for evaluating a classic script.
  // A blob URL is used because the source lives inline in index.html rather than
  // at a URL of its own.
  //
  // There is deliberately no fallback. If this cannot be done, the worker reports
  // the failure; appearing to boot and then failing on the first RF query would be
  // exactly the invisible breakage this stage exists to remove.
  function loadClassicScript(scope, source) {
    if (typeof scope.importScripts !== 'function')
      throw new Error('rt3d-core: importScripts unavailable; cannot load the engine as a classic script');
    if (typeof scope.Blob !== 'function' || !scope.URL || typeof scope.URL.createObjectURL !== 'function')
      throw new Error('rt3d-core: Blob/createObjectURL unavailable; cannot load the engine as a classic script');
    var url = scope.URL.createObjectURL(new scope.Blob([source], { type: 'text/javascript' }));
    try { scope.importScripts(url); }
    finally { scope.URL.revokeObjectURL(url); }
  }

  // Wrap an EXISTING global scope -- the worker's own `self` -- without replacing
  // it. importScripts loads a classic script into that scope, so the engine's
  // bindings live there and must be read from there.
  //
  // `run` uses INDIRECT eval, which evaluates in the global scope of this realm.
  // Because rt3d-core.js is itself a classic script in the worker, that scope is
  // the worker's global, which is where the engine now lives. Indirect eval is
  // only used to ASSIGN `state` and to CALL engine functions; it never declares
  // anything, so eval's own scoping rules cannot bite.
  function envForScope(scope) {
    return {
      globals: scope,
      run: function (code) { return (0, eval)(code); }
    };
  }

  // Evaluate `source` in `env` and return a run() that evaluates further code in
  // the same scope. `evalFn` is injected because Node tests use node:vm, whose
  // runInContext has classic-script semantics (top-level let becomes a
  // context-global lexical binding), which is what this relies on.
  function createEnv(source, globals, evalFn) {
    var env = workerGlobals(globals);
    evalFn(source, env);
    return {
      globals: env,
      run: function (code) { return evalFn(code, env); }
    };
  }

  // ------------------------------------------------------------
  //  nextTick — the ONLY scheduler this stage uses.
  //
  //  Not requestAnimationFrame: rAF is suspended entirely in a hidden tab, which
  //  is the defect being fixed. A MessageChannel message is a macrotask that the
  //  event loop delivers regardless of visibility; it exists precisely so that
  //  yielding between chunks also lets a CANCEL message be delivered.
  // ------------------------------------------------------------
  function makeNextTick(scope) {
    var MC = scope && scope.MessageChannel;
    if (MC) {
      var ch = new MC();
      var queue = [];
      ch.port1.onmessage = function () {
        var fn = queue.shift();
        if (fn) fn();
      };
      return function (fn) {
        queue.push(fn);
        ch.port2.postMessage(0);
      };
    }
    return function (fn) { setTimeout(fn, 0); };
  }

  // ------------------------------------------------------------
  //  JOB RUNNER
  //
  //  Transport-agnostic. `emit` receives protocol messages; a Dedicated Worker
  //  posts them, a test collects them. Both drive identical compute code.
  // ------------------------------------------------------------
  function createJobRunner(env, nextTick) {
    var yieldNow = nextTick || makeNextTick(env && env.globals);

    return function runJob(job, emit) {
      var jobId = job.jobId;
      var opts = job.options || {};
      var cancelled = false;
      var finished = false;
      var chunkMs = opts.timeBudgetMs != null ? opts.timeBudgetMs : DEFAULT_CHUNK_MS;
      var progressEvery = opts.progressEveryCells != null
        ? opts.progressEveryCells : DEFAULT_PROGRESS_EVERY_CELLS;

      function isStale() { return cancelled || finished; }

      // Report cancellation EXACTLY once, and only if the job had not already
      // completed. Without this a cancelled job would simply stop emitting and
      // the consumer would wait forever for a COMPLETE that is never coming.
      var cancelledReported = false;
      function reportCancelled() {
        if (cancelledReported || finished) return;
        cancelledReported = true;
        emit({ type: MSG.CANCELLED, jobId: jobId });
      }

      // Called between chunks. Returning true means "stop and report cancelled".
      function step() {
        if (isStale()) return;

        var slice = null, column = null;
        try {
          // --- inject the canonical project snapshot -------------------
          // The main thread resolved application state into the exact data the
          // engine already consumes; the worker installs it and then calls the
          // SAME canonical functions. No second floor/slab/Ceiling/Opening model.
          env.globals.__RT3D_JOB_STATE__ = job.snapshot.state;
          env.globals.__RT3D_JOB__ = job.snapshot;
          env.run('state = __RT3D_JOB_STATE__;');

          // --- canonical setup, in the canonical order ------------------
          // Live objects the chunk loop needs are stashed onto the snapshot
          // itself, so the generated code below can name them without this
          // side ever having to serialise a world.
          var world = env.run('rt3dBuildWorld()');
          job.snapshot.world = world;
          var bvh = env.run('rt3dBvhFor(__RT3D_JOB__.world)');
          // AP participation is the canonical audited selector, recomputed by the
          // canonical function. Never re-implemented on this side.
          var sources = env.run('rt3dCoverageSources()');
          job.snapshot.sources = sources;
          var stats = env.run('rt3dNewStats()');
          job.snapshot.stats = stats;
          var cursor = { j: 0, i: 0, best: null, apBest: null, valid: null, acc: null };
          job.snapshot.cursor = cursor;
          job.snapshot.backend = opts.backend || 'bvh';
          job.snapshot.chunkMs = chunkMs;
          job.snapshot.columnX = job.snapshot.columnX || 0;
          job.snapshot.columnY = job.snapshot.columnY || 0;
          job.snapshot.columnZs = job.snapshot.columnZs || [];

          var lastReported = 0;
          var sliceRes = null;

          // Chunk loop. Each iteration evaluates until the chunk deadline, then
          // yields so a CANCEL can be observed and progress is emitted.
          var runChunk = function () {
            if (isStale()) { reportCancelled(); return; }
            try {
              sliceRes = env.run(
                'rt3dCoverageSlice(__RT3D_JOB__.world, __RT3D_JOB__.spec, __RT3D_JOB__.planeZ, {' +
                '  cursor: __RT3D_JOB__.cursor, stats: __RT3D_JOB__.stats,' +
                '  sources: __RT3D_JOB__.sources, backend: __RT3D_JOB__.backend,' +
                '  timeBudgetMs: __RT3D_JOB__.chunkMs })');

              var evaluated = sliceRes.evaluatedCells;
              if (evaluated - lastReported >= progressEvery) {
                lastReported = evaluated;
                emit({
                  type: MSG.PROGRESS, jobId: jobId,
                  evaluatedCells: evaluated,
                  totalCells: sliceRes.totalCells,
                  percent: sliceRes.totalCells ? evaluated / sliceRes.totalCells : 1,
                  validCells: sliceRes.validCells,
                  directPathsTested: sliceRes.diagnostics.directPathsTested,
                  validReflectedPaths: sliceRes.diagnostics.validReflectedPaths,
                  worldBodies: sliceRes.diagnostics.worldBodies
                });
              }

              if (!sliceRes.complete) {
                // Cancelled between chunks: stop here rather than starting
                // another chunk of work nobody will receive.
                if (cancelled) { reportCancelled(); return; }
                yieldNow(runChunk);
                return;
              }

              // --- complete: build the transferable payload --------------
              column = env.run(
                'rt3dCoverageColumn(__RT3D_JOB__.world, __RT3D_JOB__.columnX, __RT3D_JOB__.columnY,' +
                '  __RT3D_JOB__.columnZs, { sources: __RT3D_JOB__.sources,' +
                '  backend: "bvh", stats: rt3dNewStats() })');

              var d = sliceRes.diagnostics;
              // Only deterministic, physics-bearing diagnostics cross the
              // boundary. Wall-clock timings stay on the computing side and are
              // not part of any equality claim.
              var payload = {
                type: MSG.COMPLETE,
                jobId: jobId,
                spec: {
                  cols: sliceRes.spec.cols, rows: sliceRes.spec.rows,
                  cell: sliceRes.spec.cell, cw: sliceRes.spec.cw, ch: sliceRes.spec.ch,
                  raySpacing: sliceRes.spec.raySpacing,
                  b: { minx: sliceRes.spec.b.minx, miny: sliceRes.spec.b.miny,
                       maxx: sliceRes.spec.b.maxx, maxy: sliceRes.spec.b.maxy }
                },
                planeZ: sliceRes.planeZ,
                evaluatedCells: sliceRes.evaluatedCells,
                validCells: sliceRes.validCells,
                noSignalCells: sliceRes.noSignalCells,
                complete: sliceRes.complete,
                row: sliceRes.row,
                grid: { best: sliceRes.best, apBest: sliceRes.apBest, valid: sliceRes.valid },
                diagnostics: {
                  receiverPlaneZ: d.receiverPlaneZ,
                  cellsEvaluated: d.cellsEvaluated,
                  participatingAps: d.participatingAps,
                  ownerFloors: d.ownerFloors,
                  directPathsTested: d.directPathsTested,
                  validReflectedPaths: d.validReflectedPaths,
                  worldBodies: d.worldBodies,
                  bvhNodes: bvh && bvh.nodeCount != null ? bvh.nodeCount : 0,
                  bvhCandidatesTested: d.bvhCandidatesTested,
                  rasterRule: d.rasterRule,
                  aggregationRule: d.aggregationRule,
                  antennaModel: d.antennaModel,
                  aggregationNote: d.aggregationNote
                },
                column: JSON.parse(JSON.stringify(column)),
                sources: JSON.parse(JSON.stringify(sources.map(function (s) {
                  return { apId: s.ap.id, apName: s.ap.name || '', floorIndex: s.floorIndex };
                })))
              };

              finished = true;
              emit(payload, [payload.grid.best.buffer,
                             payload.grid.apBest.buffer,
                             payload.grid.valid.buffer]);
            } catch (err) {
              finished = true;
              emit({ type: MSG.ERROR, jobId: jobId,
                     message: String(err && err.message ? err.message : err) });
            }
          };

          yieldNow(runChunk);
        } catch (err) {
          finished = true;
          emit({ type: MSG.ERROR, jobId: jobId,
                 message: String(err && err.message ? err.message : err) });
        }
      }

      yieldNow(step);

      return {
        cancel: function () { cancelled = true; },
        isCancelled: function () { return cancelled; }
      };
    };
  }

  // ------------------------------------------------------------
  //  WORKER RUNTIME — message plumbing for a real Dedicated Worker.
  //  Exported so the browser worker file stays a few lines, and so tests can
  //  drive the identical plumbing without a Worker.
  // ------------------------------------------------------------
  function attachRuntime(options) {
    var env = options.env;
    var post = options.post;
    var nextTick = options.nextTick || makeNextTick(env && env.globals);
    var runJob = createJobRunner(env, nextTick);
    var current = null;          // handle for the in-flight job
    var currentId = null;        // job id currently allowed to publish

    function handle(msg) {
      if (!msg || !msg.type) return;
      if (msg.type === MSG.PING) {
        // A boot probe, answered only once the engine is actually loaded. The
        // engine's presence is asserted rather than assumed: if the classic
        // script failed to evaluate, this must NOT say READY.
        var loaded = false;
        try { loaded = (env.run('typeof rt3dBuildWorld') === 'function')
                      && (env.run('typeof rt3dCoverageSlice') === 'function'); }
        catch (_) { loaded = false; }
        post({ type: loaded ? MSG.READY : MSG.ERROR, jobId: msg.jobId,
               message: loaded ? null : 'engine not loaded in worker scope' });
        return;
      }
      if (msg.type === MSG.RUN_SLICE) {
        // A new job supersedes whatever was running. The old handle is
        // cancelled so its in-flight chunk stops at the next yield.
        if (current) current.cancel();
        currentId = msg.jobId;
        current = runJob(msg, function (out, transfer) {
          // Guard every outbound message with the CURRENT job id. A superseded
          // job that is already mid-chunk will observe its own cancellation and
          // emit CANCELLED, but the id check here is the belt-and-braces rule
          // that no stale payload can ever be delivered as current.
          if (msg.jobId !== currentId) {
            if (out.type === MSG.COMPLETE || out.type === MSG.ERROR) return;
          }
          post(out, transfer);
        });
      } else if (msg.type === MSG.CANCEL) {
        if (current && msg.jobId === currentId) current.cancel();
      }
    }

    return { handle: handle, currentId: function () { return currentId; } };
  }

  return {
    MSG: MSG,
    DEFAULT_PROGRESS_EVERY_CELLS: DEFAULT_PROGRESS_EVERY_CELLS,
    DEFAULT_CHUNK_MS: DEFAULT_CHUNK_MS,
    extractAppSource: extractAppSource,
    loadClassicScript: loadClassicScript,
    envForScope: envForScope,
    createEnv: createEnv,
    workerGlobals: workerGlobals,
    makeNextTick: makeNextTick,
    createJobRunner: createJobRunner,
    attachRuntime: attachRuntime
  };
});