// Headless loader for the wifi-simulator app + the new RT3D kernel.
// The app is a single <script> with no modules and no build step, so the
// whole engine can be evaluated in a Node vm with a minimal DOM stub.
// Nothing here is shipped: this file exists only to validate the kernel.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const APP = path.join(HERE, '..', '..', 'index.html');

export function readAppScript(file = APP) {
  const html = fs.readFileSync(file, 'utf8');
  const m = html.match(/<script>\n([\s\S]*?)\n<\/script>/);
  if (!m) throw new Error('app <script> block not found in ' + file);
  return m[1];
}

// Split the app script into the part before `start()` is wired up and the
// part after, so we can install state without booting the UI.
export function splitApp(src) {
  const i = src.indexOf('document.addEventListener(\'DOMContentLoaded\',start);');
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
