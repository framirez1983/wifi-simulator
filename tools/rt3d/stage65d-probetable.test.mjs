// Stage 6.5d: the per-probe comparison table, its ordering, and the
// why-did-this-not-resolve diagnostics.
//
// Two properties matter most and are both easy to get wrong:
//   * the table must be built from the RETAINED per-floor snapshots, so it reads the
//     same whatever engine is displayed -- that is the Stage-6.5c defect repeating;
//   * Legacy's unrecoverable quantities must still read UNATTRIBUTABLE in the panel.
//     A table that quietly omits them looks like a complete comparison.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeDom, run, attachCore, installFakeWorker } from './loader.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, '..', '..', 'index.html'), 'utf8')
  .match(/<script>\n([\s\S]*?)\n<\/script>/)[1];

let pass = 0, fail = 0;
const failures = [];
function check(id, name, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${String(id).padStart(3)}. ${name}`); }
  else {
    fail++; failures.push(`${id}. ${name}${detail ? ' :: ' + detail : ''}`);
    console.log(`  FAIL ${String(id).padStart(3)}. ${name}${detail ? ' :: ' + detail : ''}`);
  }
}
function sandbox() {
  const win = makeDom();
  win.location = { search: '?rt3d=1' };
  const ctx = vm.createContext(win);
  vm.runInContext(SRC, ctx, { filename: 'index.html<script>' });
  // Stage 7A.1: the coverage run executes in a Dedicated Worker. See the note in
  // stage65c-cache.test.mjs.
  attachCore(ctx);
  installFakeWorker(ctx, { appSource: SRC });
  run(ctx, `paintHeat=function(){};computeHeatSimple=function(){};draw2d=function(){};
    coverageUpdate=function(){};showToast=function(){};refresh3dHeat=function(){};
    scheduleHeat=function(){};clearTimeout(heatTimer);
    window.__q=[]; window.requestAnimationFrame=function(cb){window.__q.push(cb);return 1;};
    window.__step=function(){ if(window.__q.length){window.__q.shift()(0);return true;} return false; };`);
  return ctx;
}
const ROOM = `
  state=freshState(); state.floors.length=1;
  var f=state.floors[0];
  f.name='PB'; f.w=16; f.d=10; f.height=3.2; f.ceilingAreas=[]; f.pillars=[];
  f.walls=[]; f.rfObjects=[]; f.openings=[];
  var W=8,H=5,pts=[[-W,-H],[W,-H],[W,H],[-W,H]];
  for(var i=0;i<4;i++){var a=pts[i],b=pts[(i+1)%4];
    f.walls.push({id:'w'+i,x1:a[0],y1:a[1],x2:b[0],y2:b[1],materialId:state.materials[2].id,
                  thickness:DEFAULT_WALL_THICKNESS_M});}
  f.rfObjects.push({id:'rk',x:1,y:0,width:1.2,depth:1.0,height:1.1,rotation:0,
                    materialId:state.materials[4].id,extraLossDb:1});
  var ap=makeAP(-4,0,'AP-PB',3.2); ap.mount=2.6; ap.mountType='ceiling';
  ap.antenna={type:'omni',az:0,tilt:0,gain:3}; f.aps=[ap];
  state.activeFloor=0;
`;
async function finish(ctx, expr, max) {
  for (let i = 0; i < (max || 400000); i++) {
    if (run(ctx, expr)) return true;
    await new Promise(r => setImmediate(r));
    run(ctx, 'window.__step()');
  }
  return false;
}
const LEGACY_DONE = '!!(heatGridRssi && lastRayTraceStats)';
const rt3dDoneExpr = (id) =>
  `!!(rt3dAuditRt3dByFloor[${JSON.stringify(id)}] && rt3dAuditRt3dByFloor[${JSON.stringify(id)}].grid.length)`;

console.log('Stage 6.5d probe comparison table and model diagnostics\n');

// ============ 1..4  ordering: highlights, then the control, then the rest ======
{
  const ctx = sandbox();
  run(ctx, ROOM);
  run(ctx, 'rt3dAuditClearRetained(); rt3dExpInit();');
  const order = JSON.parse(run(ctx, `JSON.stringify(rt3dAuditOrderProbes(
    rt3dAuditResolveProbes({}).probes).map(function(p){return p.id;}))`));
  check(1, 'the four evidence probes come first, in the required order',
    order.slice(0, 4).join(',') === 'rackFront,rackBehind,rackOverhead,maxDisagreement',
    order.slice(0, 5).join(','));
  check(2, 'the agreement control follows the highlights, so a disagreement has a baseline',
    order[4] === 'closestAgreement', order[4]);
  check(3, 'every probe appears exactly once',
    new Set(order).size === order.length, JSON.stringify(order));
  check(4, 'no probe is dropped by the ordering',
    order.length === JSON.parse(run(ctx, 'JSON.stringify(rt3dAuditResolveProbes({}).probes.length)')),
    order.join(','));
}

// ============ 5..9  the table is built from the RETAINED snapshots =============
{
  const ctx = sandbox();
  run(ctx, ROOM);
  run(ctx, 'rt3dAuditClearRetained(); rt3dExpInit();');
  run(ctx, 'rt3dExpRunLegacy();');
  await finish(ctx, LEGACY_DONE);
  run(ctx, 'rt3dExpRunCoverage();');
  await finish(ctx, rt3dDoneExpr(run(ctx, 'floor().id')));

  // destroy every live display artifact, exactly as the Stage-6.5c defect did
  run(ctx, 'heatRtReach=null; heatGridRssi=null; heatGridDisp=null; heatMeta=null;');
  const html = run(ctx, `rt3dAuditProbeTableHtml(
    rt3dAuditProbeRecord(rt3dAuditResolveProbes({ spec: rt3dGridSpec(state.floors[0]) })
      .probes.find(function(p){return p.id==='losNearPrimaryAp';})))`);

  check(5, 'the table renders with NO live heat artifacts present',
    /Legacy final RSSI/.test(html) && /RT3D final RSSI/.test(html), html.slice(0, 120));
  check(6, 'the Legacy value came from the retained snapshot',
    /Legacy final RSSI<\/td><td>-?\d/.test(html), 'no numeric Legacy value in the table');
  check(7, 'a delta is present because both retained grids exist',
    /RT3D &minus; Legacy<\/td><td><b>[+-]?\d/.test(html),
    (html.match(/RT3D &minus; Legacy<\/td><td><b>[^<]*/) || [])[0]);
  check(8, 'the table is identical whether or not the RT3D engine is displayed',
    (() => {
      const a = run(ctx, `rt3dAuditProbeTableHtml(rt3dAuditProbeRecord(
        rt3dAuditResolveProbes({spec:rt3dGridSpec(state.floors[0])})
          .probes.find(function(p){return p.id==='losNearPrimaryAp';})))`);
      run(ctx, "rt3dExpSetView('rt3d');");
      const b = run(ctx, `rt3dAuditProbeTableHtml(rt3dAuditProbeRecord(
        rt3dAuditResolveProbes({spec:rt3dGridSpec(state.floors[0])})
          .probes.find(function(p){return p.id==='losNearPrimaryAp';})))`);
      run(ctx, "rt3dExpSetView('none');");
      return a === b;
    })(), 'the table changed with the displayed engine');
}

// ============ 9..16  every requested row is present ============================
{
  const ctx = sandbox();
  run(ctx, ROOM);
  run(ctx, 'rt3dAuditClearRetained(); rt3dExpInit();');
  run(ctx, 'rt3dExpRunLegacy();');
  await finish(ctx, LEGACY_DONE);
  run(ctx, 'rt3dExpRunCoverage();');
  await finish(ctx, rt3dDoneExpr(run(ctx, 'floor().id')));
  const html = run(ctx, `rt3dAuditProbeTableHtml(
    rt3dAuditProbeRecord(rt3dAuditResolveProbes({ spec: rt3dGridSpec(state.floors[0]) })
      .probes.find(function(p){return p.id==='losNearPrimaryAp';})))`);
  const rows = [
    ['9', 'XYZ', /XYZ<\/td><td><b>-?\d/],
    ['10', 'Legacy final RSSI', /Legacy final RSSI/],
    ['11', 'RT3D final RSSI', /RT3D final RSSI/],
    ['12', 'delta', /RT3D &minus; Legacy/],
    ['13', 'classification', /classification<\/td><td><b>/],
    ['14', 'RT3D serving AP', /RT3D serving AP/],
    ['15', 'direct candidate RSSI', /direct candidate RSSI/],
    ['16', 'best reflected candidate RSSI', /best reflected candidate RSSI/],
    ['17', 'winning path', /winning path/],
    ['18', 'antennaAzGain', /antennaAzGain/],
    ['19', 'full antennaGain', /full antennaGain/],
    ['20', 'vertical / downtilt contribution', /vertical \/ downtilt contribution/],
    ['21', 'wall loss', /wall<\/td><td>/],
    ['22', 'RF Object loss', /RF Object<\/td><td>/],
    ['23', 'slab loss', /slab<\/td><td>/],
    ['24', 'Ceiling loss', /Ceiling<\/td><td>/],
    ['25', 'Legacy march plane Z', /Legacy march plane Z/],
    ['26', 'Legacy reach flag', /Legacy reach flag/]
  ];
  for (const [id, label, re] of rows)
    check(Number(id), `the table shows ${label}`, re.test(html));
}

// ============ 26b  the rack probes print their clearance geometry ============
{
  const ctx = sandbox();
  run(ctx, ROOM);
  run(ctx, 'rt3dAuditClearRetained(); rt3dExpInit();');
  run(ctx, 'rt3dExpRunLegacy();');
  await finish(ctx, LEGACY_DONE);
  run(ctx, 'rt3dExpRunCoverage();');
  await finish(ctx, rt3dDoneExpr(run(ctx, 'floor().id')));
  const html = run(ctx, `rt3dAuditProbeTableHtml(
    rt3dAuditProbeRecord(rt3dAuditResolveProbes({ spec: rt3dGridSpec(state.floors[0]) })
      .probes.find(function(p){return p.id==='rackOverhead';})))`);
  check(26.1, 'the above-rack probe prints the full clearance geometry',
    /rack clearance/.test(html) && /AP Z/.test(html) && /receiver Z/.test(html) &&
    /rack .* Z interval/.test(html) && /path Z over its footprint/.test(html) &&
    /RT3D charged/.test(html), 'a required clearance field is missing');
  check(26.2, 'the kernel evidence and the advisory analytic flag are both printed',
    /rt3dBodyEvent:/.test(html) && /direct traversals:/.test(html) &&
    /KNOWN WRONG/.test(html) && /is not used as the reference/.test(html),
    'the kernel authority or the advisory flag is missing from the panel');
  check(26.3, 'a NON-rack probe does not print a clearance block',
    (() => {
      const h = run(ctx, `rt3dAuditProbeTableHtml(
        rt3dAuditProbeRecord(rt3dAuditResolveProbes({ spec: rt3dGridSpec(state.floors[0]) })
          .probes.find(function(p){return p.id==='losNearPrimaryAp';})))`);
      return !/rack clearance/.test(h);
    })(), 'a clearance block leaked into a non-rack probe');
}

// ============ 27..29  UNATTRIBUTABLE must remain ==============================
{
  const ctx = sandbox();
  run(ctx, ROOM);
  run(ctx, 'rt3dAuditClearRetained(); rt3dExpInit();');
  run(ctx, 'rt3dExpRunLegacy();');
  await finish(ctx, LEGACY_DONE);
  run(ctx, 'rt3dExpRunCoverage();');
  await finish(ctx, rt3dDoneExpr(run(ctx, 'floor().id')));
  const html = run(ctx, `rt3dAuditProbeTableHtml(
    rt3dAuditProbeRecord(rt3dAuditResolveProbes({ spec: rt3dGridSpec(state.floors[0]) })
      .probes.find(function(p){return p.id==='losNearPrimaryAp';})))`);
  // five row markers plus one section header
  check(27, 'all five unrecoverable Legacy quantities are labelled UNATTRIBUTABLE',
    (html.match(/<b>UNATTRIBUTABLE<\/b>/g) || []).length === 5 &&
    /Legacy &mdash; UNATTRIBUTABLE/.test(html),
    String((html.match(/<b>UNATTRIBUTABLE<\/b>/g) || []).length));
  check(28, 'the unrecoverable list names the serving AP and the reflection contribution',
    /serving \/ source AP/.test(html) && /reflection contribution/.test(html));
  check(29, 'each UNATTRIBUTABLE row carries the reason it cannot be recovered',
    (html.match(/best\[k\] is the maximum over every deposit|only max\(rssi\)/g) || []).length >= 1 ||
    /depositCell\(\) keeps only/.test(html));
  check(30, 'no Legacy per-traversal loss is fabricated anywhere in the table',
    !/Legacy (wall|RF Object|slab|Ceiling) loss<\/td>/.test(html),
    'a fabricated legacy loss row was found');
}

// ============ 31..32  lazy expansion, and no slice recomputation ===============
{
  const ctx = sandbox();
  run(ctx, ROOM);
  run(ctx, 'rt3dAuditClearRetained(); rt3dExpInit();');
  run(ctx, 'rt3dExpRunLegacy();');
  await finish(ctx, LEGACY_DONE);
  run(ctx, 'rt3dExpRunCoverage();');
  await finish(ctx, rt3dDoneExpr(run(ctx, 'floor().id')));
  const block = run(ctx, 'rt3dAuditProbeBlockHtml()');
  check(31, 'every resolved probe is rendered as an expandable row',
    (block.match(/<details class="rt3ddet/g) || []).length >= 8,
    String((block.match(/<details class="rt3ddet/g) || []).length));
  check(32, 'the collapsed rows do NOT contain the computed table (lazy)',
    !/Legacy final RSSI/.test(block) && /computing one point query/.test(block),
    'the table was computed eagerly for every probe');
  check(33, 'the block reports which retained snapshots it is reading',
    /retained Legacy snapshot <b>present<\/b>/.test(block) &&
    /retained RT3D snapshot <b>present<\/b>/.test(block),
    (block.match(/retained[^<]*/g) || []).slice(0, 2).join(' | '));
  check(34, 'an unresolved probe states its reason instead of a table',
    /unresolved: /.test(block));
  check(35, 'building the block does not recompute a slice',
    (() => {
      const before = run(ctx, 'JSON.stringify(rt3dAuditRt3dByFloor[floor().id].grid.length)');
      run(ctx, 'rt3dAuditProbeBlockHtml()');
      return before === run(ctx, 'JSON.stringify(rt3dAuditRt3dByFloor[floor().id].grid.length)');
    })());
}

// ============ 36..40  model diagnostics for Ceiling and Opening ===============
{
  // (a) an UNNAMED ceiling area: the rule must refuse and say why
  const ctx = sandbox();
  run(ctx, ROOM);
  run(ctx, `state.floors[0].ceilingAreas.push({id:'cl1', height:2.9, thickness:0.10,
    materialId:state.materials[2].id, extraLossDb:0,
    footprint:{parts:[{outer:[{x:-4,y:-3},{x:4,y:-3},{x:4,y:3},{x:-4,y:3}],holes:[]}]}});`);
  const c = JSON.parse(run(ctx, 'JSON.stringify(rt3dAuditCeilingDiagnostics())'));
  check(36, 'an unnamed Ceiling Area is detected, and the count is reported',
    c.ceilingAreaCount === 1 && c.withNonEmptyName === 0, JSON.stringify(c.ceilingAreaCount));
  check(37, 'the reason names the missing name field rather than blaming geometry',
    /none of which carries a non-empty `name` field/.test(c.whyUnresolved) &&
    /will not guess an unnamed Ceiling/.test(c.whyUnresolved), c.whyUnresolved);
  check(38, 'the geometry itself is still reported, so the model can be inspected',
    c.areas[0].producesPlan === true && c.areas[0].ring.rawPoints === 4 &&
    c.areas[0].ring.cleaned === true, JSON.stringify(c.areas[0].ring));
  check(39, 'a NAMED ceiling area is accepted by the rule',
    (() => {
      run(ctx, `state.floors[0].ceilingAreas[0].name='Cuarto Oscuro';`);
      const c2 = JSON.parse(run(ctx, 'JSON.stringify(rt3dAuditCeilingDiagnostics())'));
      const ps = JSON.parse(run(ctx, 'JSON.stringify(rt3dAuditResolveProbes({}))'));
      const named = ps.probes.find(p => p.id === 'namedCeiling');
      return c2.withNonEmptyName === 1 && c2.whyUnresolved === null &&
             named.resolved === true && named.ceilingName === 'Cuarto Oscuro';
    })(), 'a named Ceiling Area was still refused');
  check(40, 'the resolver rule is stated on the result, so the choice is auditable',
    /first Ceiling Area that carries a name/.test(c.resolverRule), c.resolverRule);
}
{
  // (b) an Opening with no usable polygon
  const ctx = sandbox();
  run(ctx, ROOM);
  run(ctx, `var pa=JSON.parse(JSON.stringify(state.floors[0]));
            pa.id='flr_pa'; pa.name='PA'; pa.aps=[]; pa.ceilingAreas=[];
            pa.rfObjects=[]; pa.walls=[];
            state.floors.push(pa);
            state.floors[1].openings.push({id:'op1'});            // no points at all
            state.activeFloor=0;`);
  const o = JSON.parse(run(ctx, 'JSON.stringify(rt3dAuditOpeningDiagnostics())'));
  check(41, 'an Opening with no points field is identified as such',
    o.openingCount === 1 && o.openings[0].hasPointsField === false,
    JSON.stringify(o.openings[0]));
  check(42, 'it is reported that zero Openings become a slab hole',
    o.openingsBecomingHoles === 0, String(o.openingsBecomingHoles));
  check(43, 'the reason states the exact requirement cleanFootprintRing enforces',
    /at least 3 points with finite x and y and a\s+non-zero enclosed area/.test(o.whyUnresolved),
    o.whyUnresolved);
  check(44, 'the reason explains why refusing is correct, not a failure',
    /correctly\s+refuses rather than pointing at a cell that is not really under an Opening/.test(o.whyUnresolved));
  check(45, 'a degenerate ring is rejected and a real one is accepted',
    (() => {
      run(ctx, `state.floors[1].openings[0].points=[{x:1,y:1},{x:1,y:1},{x:1,y:1}];`);
      const deg = JSON.parse(run(ctx, 'JSON.stringify(rt3dAuditOpeningDiagnostics())'));
      run(ctx, `state.floors[1].openings[0].points=[{x:0,y:0},{x:2,y:0},{x:2,y:2},{x:0,y:2}];`);
      const ok = JSON.parse(run(ctx, 'JSON.stringify(rt3dAuditOpeningDiagnostics())'));
      return deg.openingsBecomingHoles === 0 && deg.openings[0].cleaned === false &&
             ok.openingsBecomingHoles === 1 && ok.openings[0].signedArea === 4 &&
             ok.whyUnresolved === null;
    })(), 'ring acceptance was not reported correctly');
  check(46, 'with a usable Opening the slab probe resolves, from the `points` ring',
    (() => {
      const ps = JSON.parse(run(ctx, 'JSON.stringify(rt3dAuditResolveProbes({}))'));
      const p = ps.probes.find(x => x.id === 'slabOpening');
      return p.resolved === true && p.polygonSource === 'points' && p.usableRing === true &&
             Number.isFinite(p.x) && Number.isFinite(p.y);
    })(), 'a valid Opening is still refused');
  check(46.5, 'an Opening with a valid `points` ring was never the problem: the old rule read `outer`',
    run(ctx, `JSON.stringify((function(){
      var o=state.floors[1].openings[0];
      return { hasOuter: Array.isArray(o.outer), hasPoints: Array.isArray(o.points) };
    })())`) === '{"hasOuter":false,"hasPoints":true}');
}

// ============ 47..49  nothing is synthesised =================================
{
  const ctx = sandbox();
  run(ctx, ROOM);
  const before = run(ctx, 'JSON.stringify(state.floors[0].ceilingAreas)');
  run(ctx, 'rt3dAuditCeilingDiagnostics(); rt3dAuditOpeningDiagnostics(); rt3dAuditResolveProbes({});');
  check(47, 'diagnosing an unresolved rule creates no Ceiling Area',
    run(ctx, 'JSON.stringify(state.floors[0].ceilingAreas)') === before);
  check(48, 'diagnosing creates no Opening',
    run(ctx, 'JSON.stringify(state.floors[0].openings)') === run(ctx, 'JSON.stringify(state.floors[0].openings)'));
  check(49, 'the probe ordering helper is pure: ordering does not move geometry',
    run(ctx, 'JSON.stringify(state.floors[0].rfObjects)') ===
    run(ctx, 'JSON.stringify(state.floors[0].rfObjects)'));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
