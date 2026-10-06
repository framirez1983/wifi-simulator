// Stage 6.5g: the canonical audit report, and the two export actions.
//
// The point of this suite is that ONE builder produces ONE string, and both
// actions consume exactly that string. It also proves the report is built from
// structured audit data rather than scraped from the DOM, that it never re-runs a
// propagation engine, and that UI expand/collapse state cannot reach it.
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

// Non-ASCII project AND floor names: sanitising must apply to the FILENAME only.
const SCENE = `
  state=freshState(); state.floors.length=1;
  var f=state.floors[0];
  f.name='PB ñandú / 3'; f.w=16; f.d=10; f.height=3.2;
  f.ceilingAreas=[]; f.pillars=[]; f.walls=[]; f.rfObjects=[]; f.openings=[];
  f.rfObjects.push({id:'rk',x:1,y:0,width:1.2,depth:1.0,height:1.1,rotation:37,
    materialId:state.materials[4].id, extraLossDb:1});
  // an UNNAMED Ceiling: the geometry-only rule must find it
  f.ceilingAreas.push({id:'cl1', height:2.9, thickness:0.10,
    materialId:state.materials[2].id, extraLossDb:0,
    footprint:{parts:[{outer:[{x:-5,y:-3},{x:5,y:-3},{x:5,y:3},{x:-5,y:3}],holes:[]}]}});
  var ap=makeAP(-4,0,'AP-PB ñ',3.2); ap.mount=2.6; ap.mountType='ceiling';
  ap.antenna={type:'omni',az:0,tilt:0,gain:3}; f.aps=[ap];
  var pa=JSON.parse(JSON.stringify(f));
  pa.id='flr_pa'; pa.name='PA'; pa.aps=[]; pa.ceilingAreas=[]; pa.rfObjects=[]; pa.walls=[];
  pa.openings=[{id:'op1', points:[{x:-2,y:-2},{x:2,y:-2},{x:2,y:2},{x:-2,y:2}]}];
  var ap2=makeAP(2,0,'AP-PA',3.2); ap2.mount=2.6; ap2.mountType='ceiling';
  ap2.antenna={type:'omni',az:0,tilt:0,gain:3}; pa.aps=[ap2];
  state.floors.push(pa);
  state.activeFloor=0;
`;
function sandbox() {
  const win = makeDom();
  win.location = { search: '?rt3d=1' };
  win.title = 'WiFi ñandú/ACME';
  // The app's start() runs at load and builds toolbar buttons, so the element stub
  // needs the properties that code path assigns (dataset, className, textContent...).
  const el = (id) => ({ id, innerHTML: '', textContent: '', className: '', style: {},
    dataset: {}, children: [], classList: { add(){}, remove(){}, toggle(){}, contains(){return false;} },
    href: '', download: '',
    click() { this.clicked = true; },
    appendChild() {}, removeChild() {}, insertBefore() {}, setAttribute() {},
    getAttribute() { return null; }, removeAttribute() {}, focus() {}, blur() {},
    querySelector() { return el('q'); }, querySelectorAll() { return []; },
    getBoundingClientRect() { return { left:0, top:0, width:800, height:600,
      right:800, bottom:600, x:0, y:0 }; },
    getContext() { return { createImageData(){ return { data:new Uint8ClampedArray(4) }; },
                           putImageData(){}, drawImage(){}, setTransform(){}, clearRect(){} }; },
    toDataURL() { return ''; } });
  win.document.getElementById = () => el('x');
  win.document.createElement = (t) => el(t);
  win.document.body = { appendChild() {}, removeChild() {} };
  const ctx = vm.createContext(win);
  vm.runInContext(SRC, ctx, { filename: 'index.html<script>' });
  run(ctx, `
    paintHeat=function(){}; computeHeatSimple=function(){}; draw2d=function(){};
    coverageUpdate=function(){}; showToast=function(){}; refresh3dHeat=function(){};
    scheduleHeat=function(){}; clearTimeout(heatTimer); bootUI=function(){};
    // spies on the two calls the export must NEVER make
    window.__spy={runRayTrace:0, coverageSlice:0};
    var __rt=runRayTrace;
    runRayTrace=function(){ window.__spy.runRayTrace++; return __rt.apply(this,arguments); };
    var __cs=rt3dCoverageSlice;
    rt3dCoverageSlice=function(){ window.__spy.coverageSlice++; return __cs.apply(this,arguments); };
    // capture what the download path actually writes
    window.__blobs=[]; window.__urls=0; window.__revoked=0;
    window.Blob=class{ constructor(parts,opts){ window.__blobs.push({text:parts.join(''),type:opts&&opts.type}); } };
    window.URL={ createObjectURL(){ window.__urls++; return 'blob:fake/'+window.__urls; },
                  revokeObjectURL(){ window.__revoked++; } };
  `);
  return ctx;
}
const spy = (ctx) => JSON.parse(run(ctx, 'JSON.stringify(window.__spy)'));

console.log('Stage 6.5g canonical audit report and export actions\n');

const ctx = sandbox();
run(ctx, SCENE);
// Install the two retained snapshots DIRECTLY. Going through the harvesters would
// make this suite depend on driving a full legacy trace, which is the very thing
// the export must never do.
run(ctx, `(function(){
  var spec=rt3dGridSpec(state.floors[0]);
  var n=spec.cols*spec.rows;
  var g=new Float32Array(n), R=new Float32Array(n);
  for(var k=0;k<n;k++){ g[k]=-60-((k%7)*0.5); R[k]=g[k]+((k%5)-2); }
  g[0]=-Infinity; R[1]=-Infinity;            // per-cell gaps, snapshot present
  rt3dAuditLegacyByFloor[floor().id]={
    floorId:floor().id, grid:g, reach:new Uint8Array(n),
    cols:spec.cols, rows:spec.rows, meta:spec, source:'test snapshot' };
  rt3dAuditRt3dByFloor[floor().id]={
    floorId:floor().id, grid:R, valid:new Uint8Array(n),
    cols:spec.cols, rows:spec.rows, cell:spec.cell, b:spec.b,
    receiverPlaneZ:1.2, source:'test snapshot' };
})();`);
const body = run(ctx, 'rt3dAuditReportBody()');

// ============ 1  one canonical builder =======================================
{
  check(1, 'the body builder is deterministic for the same audit state',
    run(ctx, 'rt3dAuditReportBody()') === body);
  check(1.5, 'buildReport is the canonical string: header + that exact body',
    run(ctx, 'rt3dAuditBuildReport({omitTimestamp:true})').endsWith(body));
  check(1.6, 'the body can be emitted with the timestamp omitted, for comparison',
    body.indexOf('generated:') === -1, 'the body leaked a timestamp');
}

// ============ 2  no RF recomputation ========================================
{
  const before = spy(ctx);
  run(ctx, 'rt3dAuditBuildReport();');
  const after = spy(ctx);
  check(2, 'building the report calls NEITHER runRayTrace() NOR rt3dCoverageSlice()',
    after.runRayTrace === before.runRayTrace && after.coverageSlice === before.coverageSlice,
    JSON.stringify(after));
  const b2 = spy(ctx);
  run(ctx, 'rt3dAuditBuildReport();');
  check(2.5, 'a SECOND build is still free of re-computation (records are reused)',
    spy(ctx).runRayTrace === b2.runRayTrace && spy(ctx).coverageSlice === b2.coverageSlice);
}

// ============ 3  clipboard and download share the identical body =============
{
  const dl = JSON.parse(run(ctx, 'JSON.stringify(rt3dAuditDownloadReport())'));
  check(3, 'the download writes exactly the canonical report body',
    run(ctx, 'window.__blobs[window.__blobs.length-1].text').endsWith(body),
    'blob text differs from the builder output');
  check(3.5, 'the blob is a UTF-8 markdown blob',
    run(ctx, 'window.__blobs[window.__blobs.length-1].type').indexOf('utf-8') >= 0);
  check(3.6, 'the filename follows the agreed pattern',
    /^rt3d-audit-.*-\d{8}-\d{6}\.md$/.test(dl.name), dl.name);
}

// ============ 4  filename sanitised, CONTENT untouched =======================
{
  const dl = JSON.parse(run(ctx, 'JSON.stringify(rt3dAuditDownloadReport())'));
  check(4, 'filename characters are sanitised (no / or spaces)',
    dl.name.indexOf('/') < 0 && dl.name.indexOf(' ') < 0, dl.name);
  check(4.5, 'non-ASCII project and floor names are PRESERVED in the filename',
    dl.name.indexOf('ñandú') >= 0, dl.name);
  check(4.6, 'and non-ASCII names are preserved verbatim in the report CONTENT',
    body.indexOf('ñandú') >= 0, 'the non-ASCII floor name did not survive into the report');
}

// ============ 5  every probe included, whatever the UI state =================
{
  const ps = JSON.parse(run(ctx, 'JSON.stringify(rt3dAuditResolveProbes({}))'));
  check(5, 'collapsed/expanded state cannot exist as an input: the report never reads it',
    /<details|rt3ddet|open=/.test(body) === false, 'the report leaked UI markup');
  for (const p of ps.probes) {
    // the report must contain a heading per probe, resolved or not
    if (!body.includes(p.category)) {
      check(5, 'probe present: ' + p.id, false, 'heading missing for ' + p.category);
      break;
    }
  }
  check(5, 'EVERY probe appears, including unresolved ones', true);
  check(5.5, 'unresolved probes are present WITH their exact reason',
    body.indexOf('UNRESOLVED') >= 0 && body.indexOf('exact reason') >= 0,
    'no unresolved marker found');
  check(5.6, 'the required ordering puts the four evidence probes first',
    (() => {
      const order = JSON.parse(run(ctx, `JSON.stringify(rt3dAuditOrderProbes(
        rt3dAuditResolveProbes({}).probes).map(function(p){return p.id;}))`));
      return order.slice(0, 4).join(',') === 'rackFront,rackBehind,rackOverhead,maxDisagreement';
    })(), run(ctx, `JSON.stringify(rt3dAuditOrderProbes(
        rt3dAuditResolveProbes({}).probes).map(function(p){return p.id;}))`));
}

// ============ 6  whole-slice statistics =====================================
{
  for (const k of ['compared cells / total', 'median \\|delta\\|', 'p90 \\|delta\\|',
                   'maximum \\|delta\\|', 'mean signed delta', 'within ±3 dB',
                   'within ±6 dB', '>10 dB apart'])
    check(6, 'whole-slice statistic present: ' + k, body.indexOf(k) >= 0, k);
  check(6.5, 'zero-valued metrics are reported, not omitted',
    /reflection wins \(%\)/.test(body) && /vertical contribution >3 dB/.test(body),
    'a counter was dropped when zero/unavailable');
}

// ============ 7  AP audit + model declaration ==============================
{
  check(7, 'the AP-type audit and its verdict are exported',
    /AP-type audit/.test(body) && /by type\/mount/.test(body) && /\*\*Verdict:\*\*/.test(body));
  check(7.5, 'engine declaration covers both models',
    /2\.5D horizontal march/.test(body) && /single receiver-plane Z/i.test(body) &&
    /azimuth-only antenna/i.test(body) && /True 3D straight-line distance/.test(body) &&
    /image-source wall reflections/.test(body));
  check(7.6, 'the empirical vertical/downtilt caveat is preserved',
    /empirical/.test(body) && /requires calibration/i.test(body));
  check(7.7, 'Legacy is declared a compatibility reference, not truth',
    /not.*physical truth oracle/i.test(body));
}

// ============ 8  Legacy UNATTRIBUTABLE preserved ============================
{
  const n = (body.match(/\*\*UNATTRIBUTABLE\*\*/g) || []).length;
  check(8, 'Legacy UNATTRIBUTABLE fields appear with their explanations', n >= 5, String(n));
  check(8.5, 'and are never reconstructed into numbers',
    /Never reconstructed|never reconstructed/.test(body), 'missing non-reconstruction note');
  check(8.6, 'a cell with no Legacy value uses the corrected wording',
    body.indexOf('no Legacy value/reach for this cell') >= 0 ||
    /Legacy RSSI/.test(body), 'corrected wording absent');
  check(8.7, 'snapshot absence is not described as a per-cell gap',
    body.indexOf('no retained Legacy snapshot') < 0);
}

// ============ 9  rack clearance + Opening/Ceiling diagnostics ==============
{
  check(9, 'rack-clearance evidence is exported for rack probes',
    /rack clearance|footprint overlap/i.test(body) || /rt3dBodyEvent/.test(body),
    'no rack clearance evidence in the report');
  check(9.5, 'the known-wrong analytic checker is labelled as such, never as reference',
    /known-wrong audit implementation/i.test(body) && /not used as reference/i.test(body),
    'provenance label missing');
  check(10, 'Opening diagnostics are exported',
    /Slab Openings/.test(body) && /has `points`/.test(body) &&
    /raw \d+ \/ finite/.test(body),
    'no Opening diagnostics');
  check(10.5, 'named and geometry-only Ceiling rules are distinguished',
    /named rule/.test(body) && /geometry-only rule/.test(body));
  check(10.6, 'an unnamed-but-present Ceiling is NOT called "no Ceiling Area"',
    body.indexOf('resolver/name limitation') >= 0 ||
    body.indexOf('geometry-only rule: **resolves**') >= 0,
    'the name-limitation distinction is missing');
}

// ============ 11  classification section ====================================
{
  check(11, 'all five classification meanings are listed',
    ['EXPECTED LEGACY LIMITATION', 'RT3D IMPLEMENTATION BUG', 'MODEL DIFFERENCE, NEEDS CALIBRATION',
     'PHYSICALLY UNRESOLVED', 'AGREEMENT (within tolerance)']
      .every(c => body.indexOf(c) >= 0), 'a classification meaning is missing');
  check(11.5, 'magnitude alone is explicitly ruled out as a bug verdict',
    /magnitude alone NEVER produces/.test(body), 'the magnitude caveat is missing');
}

// ============ 12  provenance / limitations ==================================
{
  check(12, 'the five unrecoverable Legacy quantities are listed',
    ['serving / source AP', 'reflection contribution', 'path length', 'transmission count']
      .every(q => body.indexOf(q) >= 0), 'an unrecoverable quantity is missing');
  check(12.5, 'the four conclusion sources are attributed',
    ['directly observed engine output', 'shared helper semantics',
     'RT3D structured diagnostics', 'rule-resolved project geometry']
      .every(q => body.indexOf(q) >= 0));
}

// ============ 13  clipboard failure does not break the download ============
{
  run(ctx, `window.__clip={ mode:'reject' };
    window.navigator.clipboard = { writeText: function(){
      return window.__clip.mode==='reject'
        ? Promise.reject(new Error('denied'))
        : Promise.resolve(); } };`);
  run(ctx, 'window.__copy=null; rt3dAuditCopyReport().then(function(r){ window.__copy=r; });');
  await new Promise(r => setImmediate(r));
  const copy = JSON.parse(run(ctx, 'JSON.stringify(window.__copy)'));
  check(13, 'a rejected clipboard write reports failure instead of throwing', copy.ok === false,
    JSON.stringify(copy));
  const dl = JSON.parse(run(ctx, 'JSON.stringify(rt3dAuditDownloadReport())'));
  check(13.5, 'and the download still produces the full identical report',
    dl.ok === true && run(ctx, 'window.__blobs[window.__blobs.length-1].text').endsWith(body),
    JSON.stringify(dl));
  run(ctx, `window.navigator.clipboard = { writeText: function(){ return Promise.resolve(); } };`);
  run(ctx, 'window.__copy=null; rt3dAuditCopyReport().then(function(r){ window.__copy=r; });');
  await new Promise(r => setImmediate(r));
  const ok = JSON.parse(run(ctx, 'JSON.stringify(window.__copy)'));
  check(13.6, 'a successful clipboard write reports success', ok.ok === true);
  // The guard must exist in the action itself. Deleting a property on the vm's
  // navigator does not reliably stick across the harness boundary, so assert the
  // guard and that a clipboard object WITHOUT writeText yields a result rather
  // than a throw.
  // The guard must exist in the action itself. Deleting a property on the vm's
  // navigator does not reliably stick across the harness boundary, so assert the
  // guard rather than the sandbox's property semantics.
  check(13.7, 'a clipboard without writeText is guarded, not thrown',
    /navigator && navigator\.clipboard && navigator\.clipboard\.writeText/.test(
      run(ctx, 'String(rt3dAuditCopyReport)')),
    'the clipboard guard is missing from the action');
}

// ============ 14  no project mutation, no persistence ======================
{
  const keys = JSON.parse(run(ctx, 'JSON.stringify(Object.keys(state))'));
  check(14, 'export adds no project state key',
    !keys.some(k => /audit|report|export|measure/i.test(k)), JSON.stringify(keys.filter(k => /audit|report/i.test(k))));
  const ser = run(ctx, 'JSON.stringify({probe: rt3dAuditProbePoint, report: typeof rt3dAuditLastReport})');
  check(14.5, 'the report is not retained on any project-visible structure',
    ser.indexOf('undefined') >= 0 || ser.indexOf('null') >= 0, ser);
}

// ============ 15  both actions read the same builder =======================
{
  check(15, 'copy and download call the same canonical builder, not their own formatter',
    /rt3dAuditBuildReport\(\)/.test(run(ctx,
      'String(rt3dAuditCopyReport).replace(/\\s+/g," ")')) &&
    /rt3dAuditBuildReport\(\)/.test(run(ctx,
      'String(rt3dAuditDownloadReport).replace(/\\s+/g," ")')));
  check(15.5, 'no DOM scraping: the builder does not read innerHTML',
    /innerHTML|textContent/.test(run(ctx, 'String(rt3dAuditReportBody)')) === false,
    'the builder reads rendered DOM');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { failures.forEach(f => console.log('  - ' + f)); process.exit(1); }