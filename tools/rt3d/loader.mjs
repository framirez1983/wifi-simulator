// Headless loader for the wifi-simulator app + the new RT3D kernel.
// The app is a single <script> with no modules and no build step, so the
// whole engine can be evaluated in a Node vm with a minimal DOM stub.
// Nothing here is shipped: this file exists only to validate the kernel.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
export const APP = path.join(HERE, '..', '..', 'index.html');

export function readAppScript(file = APP) {
  const html = fs.readFileSync(file, 'utf8');
  const m = html.match(/<script>\n([\s\S]*?)\n<\/script>/);
  if (!m) throw new Error('app <script> block not found in ' + file);
  return m[1];
}

// Split the app script into the part before `start()` is wired up and the
// part after, so we can install state without booting the UI.
//
// Stage 7A.1 wraps the startup tail in `if(!RT3D_WORKER_MODE){ … }`, so cutting
// at the old code marker -- a line now INSIDE that block -- would leave an
// opening brace in `core` and every suite that loads the app would die with
// "SyntaxError: Unexpected end of input". The application therefore carries an
// explicit `//<rt3d-bootstrap-tail>` sentinel on its own column-0 line at the
// boundary, which is balanced by construction. The legacy marker is still
// accepted as a fallback so an older index.html still loads.
export function splitApp(src) {
  const SENTINEL = '//<rt3d-bootstrap-tail>';
  const LEGACY = 'document.addEventListener(\'DOMContentLoaded\',start);';
  let i = src.indexOf(SENTINEL);
  if (i >= 0) return { core: src.slice(0, i), tail: src.slice(i) };
  i = src.indexOf(LEGACY);
  if (i < 0) throw new Error('bootstrap marker not found');
  return { core: src.slice(0, i), tail: src.slice(i) };
}

function el() {
  const e = {
    style: {}, dataset: {},
    // toggle() is here because the application's own toolbar wiring already uses it
    classList: { add(){}, remove(){}, toggle(){}, contains(){return false;} },
    children: [], options: [], className: '', value: '', checked: false,
    // innerHTML is real state here: panels are written by innerHTML and asserted
    // on by tests, and an element that forgets it hides every rendering bug.
    innerHTML: '', textContent: '',
    getContext(){ return ctx2d(); },
    // Listeners are RECORDED and dispatch is real. addEventListener(){} silently
    // discarding every handler means a click-driven code path can never be tested:
    // the wiring either works or is invisible. A previous harness gap of this kind
    // hid a real TypeError for an entire stage.
    _l: Object.create(null),
    addEventListener(t, f){ (this._l[t] || (this._l[t] = [])).push(f); },
    removeEventListener(t, f){ const a = this._l[t]; if (!a) return;
      const i = a.indexOf(f); if (i >= 0) a.splice(i, 1); },
    dispatchEvent(ev){ const a = this._l[ev.type]; if (!a) return false;
      for (const f of a.slice()) f.call(this, ev); return true; },
    listenerCount(t){ return (this._l[t] || []).length; },
    appendChild(){}, append(){}, remove(){}, insertBefore(){}, setAttribute(){},
    getAttribute(){ return null; }, removeAttribute(){}, focus(){}, blur(){},
    querySelector(){ return el(); }, querySelectorAll(){ return []; },
    getBoundingClientRect(){ return {x:0,y:0,width:800,height:600,left:0,top:0,right:800,bottom:600}; },
    toDataURL(){ return ''; },
  };
  return e;
}
function ctx2d() {
  const noop = () => {};
  return new Proxy({}, {
    get(t, k) {
      if (k === 'canvas') return el();
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient')
        return () => ({ addColorStop: noop });
      if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      // createImageData must return a correctly sized buffer. Without this the
      // proxy silently returns noop, so any paint path that reads img.data
      // throws — which hid the fact that the Stage-5 paint path was never
      // actually executed by the test suite.
      if (k === 'createImageData') return (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(4, (w | 0) * (h | 0) * 4)) });
      if (k === 'putImageData') return noop;
      return typeof k === 'string' ? (t[k] !== undefined ? t[k] : noop) : noop;
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

export function makeDom() {
  const doc = {
    readyState: 'complete',
    body: el(), head: el(), documentElement: el(),
    createElement: () => el(), createElementNS: () => el(),
    createTextNode: (t) => ({ nodeValue: t }),
    // Cached by id: the app writes innerHTML on one lookup and a test reads it on
    // another, so a fresh element per call would make every panel assertion read
    // an empty string and silently match nothing.
    getElementById: (() => { const byId = Object.create(null);
      return (id) => (byId[id] || (byId[id] = el())); })(),
    // The app's $() is querySelector, so this is the path that matters: it MUST
    // return a stable element per selector. Returning a fresh one made every panel
    // write land on a throwaway object, so innerHTML assertions read '' and passed
    // or failed for reasons unrelated to the code under test.
    querySelector: (() => { const bySel = Object.create(null);
      return (sel) => (bySel[sel] || (bySel[sel] = el())); })(),
    querySelectorAll: () => [],
    addEventListener(){}, removeEventListener(){},
    createDocumentFragment: () => el(),
  };
  const store = new Map();
  const win = {
    document: doc,
    devicePixelRatio: 1,
    innerWidth: 1280, innerHeight: 800,
    addEventListener(){}, removeEventListener(){}, dispatchEvent(){},
    requestAnimationFrame: (cb) => setTimeout(() => cb(Date.now()), 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    matchMedia: () => ({ matches: false, addEventListener(){}, removeEventListener(){} }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    THREE: undefined,
    URL: { createObjectURL: () => '', revokeObjectURL(){} },
    Blob: class { constructor(){} },
    FileReader: class { readAsDataURL(){} },
    navigator: { userAgent: 'node' },
    MutationObserver: class { observe(){} disconnect(){} takeRecords(){ return []; } },
    ResizeObserver: class { observe(){} disconnect(){} unobserve(){} },
    IntersectionObserver: class { observe(){} disconnect(){} unobserve(){} },
    Image: class { set src(v){} get src(){ return ''; } },
    OffscreenCanvas: class { getContext(){ return ctx2d(); } },
    TextDecoder, TextEncoder, URL, URLSearchParams, Buffer,
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    performance,
    console,
  };
  win.window = win;
  win.self = win;
  win.globalThis = win;
  return win;
}

// Build a fresh sandbox with the app's engine code evaluated.
// Returns the sandbox, on which state/floor()/etc. are now live.
export function loadApp(file = APP) {
  const src = readAppScript(file);
  const { core } = splitApp(src);
  const win = makeDom();
  const ctx = vm.createContext(win);
  vm.runInContext(core, ctx, { filename: 'index.html<script>' });
  return ctx;
}

// The shipped worker protocol module (rt3d-core.js). It is loaded from the real
// file on disk, so the main thread, the Worker and the tests all share ONE
// definition of the message names and of the job runner. It contains no RF
// mathematics.
export const CORE_PATH = path.join(HERE, '..', '..', 'rt3d-core.js');
export const CORE_SOURCE = fs.readFileSync(CORE_PATH, 'utf8');

// Install RT3DCore into an existing sandbox. Needed by any test that drives the
// real worker controller, because the controller talks to the protocol module.
export function attachCore(ctx) {
  vm.runInContext(CORE_SOURCE, ctx, { filename: 'rt3d-core.js' });
  return ctx;
}

// A test double for a Dedicated Worker.
//
// It is NOT a reimplementation of the compute: it evaluates the SAME
// application source the main thread evaluated and runs the SAME
// RT3DCore job runner, so the physics exercised is the physics under test. The
// only thing it replaces is the transport -- messages are delivered through the
// host's rAF pump, because a Node vm has no event loop of its own and the host
// has to be able to step the run deterministically.
//
// Note the deliberate asymmetry: the WORKER-side compute loop still yields
// through RT3DCore's own nextTick, never through rAF. rAF only delivers
// messages to the main thread here, exactly as a real Worker delivers them on
// its own event loop.
export function installFakeWorker(ctx, options = {}) {
  const appSource = options.appSource || readAppScript();
  const RT3DCoreApi = require_(CORE_PATH);
  const host = ctx;                 // the sandbox global
  let seq = 0;
  const instances = [];

  class FakeWorker {
    constructor(url) {
      this.url = url;
      this.onmessage = null;
      this.onerror = null;
      this.onmessageerror = null;
      this.terminated = false;
      this.posted = [];
      this.tickQ = [];               // the worker's own event-loop callbacks
      this.msgQ = [];                // messages in both directions
      this.scheduled = false;
      seq++; this.id = seq;
      instances.push(this);

      // A worker that loads but then fails at runtime (import error, throwing
      // module body) reports through onerror rather than throwing, so that path
      // is exercised too.
      if (options.failOnError) {
        const self = this;
        const fire = () => {
          if (!self.terminated && self.onerror) self.onerror({ message: options.failOnError });
        };
        if (typeof host.requestAnimationFrame === 'function') host.requestAnimationFrame(fire);
        else setTimeout(fire, 0);
      }

      if (options.failCreate) {
        // A Worker whose construction fails (blocked, bad URL, no worker
        // support) must surface as a throw, exactly as a real one does, so the
        // controller's own error path is what handles it.
        throw new Error(options.failCreate);
      }

      // A genuinely separate execution context, built from the SAME application
      // source the main thread evaluated.
      const globals = RT3DCoreApi.workerGlobals({ performance: host.performance });
      const wctx = vm.createContext(globals);
      vm.runInContext(appSource, wctx, { filename: 'index.html<script>(worker)' });
      this.env = {
        ctx: wctx, globals,
        run: (code) => vm.runInContext(code, wctx, { filename: 'worker' }),
      };

      const self = this;
      // `nextTick` is the worker's event loop. In a real worker this is a
      // MessageChannel (RT3DCore.makeNextTick); here it is a queue the host
      // steps, so a run can be advanced deterministically and one chunk at a
      // time. The worker's CODE is unchanged and never mentions rAF -- this is a
      // stand-in for the event loop, not a scheduler chosen by the engine.
      this.runtime = RT3DCoreApi.attachRuntime({
        env: this.env,
        nextTick: (fn) => { self.tickQ.push(fn); self.schedule(); },
        post: (msg, transfer) => {
          if (self.terminated) return;
          self.msgQ.push({ request: false, msg });
          self.schedule();
        },
      });
    }

    // One host frame performs ONE step: deliver a message if one is waiting,
    // otherwise run one queued event-loop callback. Interleaving them this way
    // mirrors a real event loop closely enough to exercise interleaving bugs.
    step() {
      if (this.terminated) return false;
      if (this.msgQ.length) {
        const item = this.msgQ.shift();
        if (item.request) { if (this.runtime) this.runtime.handle(item.msg); }
        else if (this.onmessage) this.onmessage({ data: item.msg });
      } else if (this.tickQ.length) {
        this.tickQ.shift()();
      } else {
        return false;
      }
      // Keep the pump alive while work remains. The scheduled flag is cleared by
      // the pump wrapper before this runs, so this cannot desynchronise.
      if (this.msgQ.length || this.tickQ.length) this.schedule();
      return true;
    }

    schedule() {
      if (this.scheduled || this.terminated) return;
      this.scheduled = true;
      const self = this;
      const pump = () => { self.scheduled = false; self.step(); };
      if (typeof host.requestAnimationFrame === 'function') host.requestAnimationFrame(pump);
      else setTimeout(pump, 0);
    }

    postMessage(msg, transfer) {
      if (this.terminated) return;
      this.posted.push(msg);
      this.msgQ.push({ request: true, msg });
      this.schedule();
    }

    terminate() {
      this.terminated = true;
      this.tickQ.length = 0;
      this.msgQ.length = 0;
    }
  }

  ctx.Worker = FakeWorker;
  vm.runInContext('window.Worker = Worker;', ctx);
  return { instances, FakeWorker };
}

// Evaluate code INSIDE the sandbox, so lexical bindings declared by the
// app script (notably `let state`) are visible to it. Assigning
// sandbox.state from outside would create an unrelated global property.
export function run(sandbox, code, filename = 'test') {
  return vm.runInContext(code, sandbox, { filename });
}

// A fresh state with the app's own material table, no demo geometry.
export function blankState(sandbox) {
  return run(sandbox, 'state=freshState(); state');
}
