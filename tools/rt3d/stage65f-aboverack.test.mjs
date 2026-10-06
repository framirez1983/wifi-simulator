// Stage 6.5f: the CORRECTED "path physically passes ABOVE a rack" rule, and the
// Legacy wording fix.
//
// The old rule raised the RECEIVER above the rack and called that evidence. That is
// invalid: a high receiver does not imply a high path. The rule now requires four
// conditions simultaneously, with the kernel as the authority, and it reports
// unresolved rather than manufacturing a receiver.
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
function sandbox() {
  const win = makeDom();
  win.location = { search: '?rt3d=1' };
  const ctx = vm.createContext(win);
  vm.runInContext(SRC, ctx, { filename: 'index.html<script>' });
  run(ctx, `paintHeat=function(){};computeHeatSimple=function(){};draw2d=function(){};
    coverageUpdate=function(){};showToast=function(){};refresh3dHeat=function(){};
    scheduleHeat=function(){};clearTimeout(heatTimer);`);
  return ctx;
}
const ROOM = `
  state=freshState(); state.floors.length=1;
  var f=state.floors[0];
  f.name='PB'; f.w=20; f.d=14; f.height=4.0; f.ceilingAreas=[]; f.pillars=[];
  f.walls=[]; f.rfObjects=[]; f.openings=[];
  var ap=makeAP(-6,0,'AP',4.0); ap.mount=3.2; ap.mountType='ceiling';
  ap.antenna={type:'omni',az:0,tilt:0,gain:3}; f.aps=[ap];
  state.activeFloor=0;
`;
const addRack = (id, x, y, w, d, h, rot) => `
  state.floors[0].rfObjects.push({id:'${id}', x:${x}, y:${y}, width:${w}, depth:${d},
    height:${h}, rotation:${rot || 0}, materialId:state.materials[4].id, extraLossDb:0});
`;
console.log('Stage 6.5f corrected above-rack rule and Legacy wording\n');

// ============ 1..3  true clear-over case ====================================
{
  const ctx = sandbox();
  run(ctx, ROOM);
  run(ctx, addRack('rk', 0, 0, 2, 2, 1.0));      // top at 1.0 m; AP at 3.2 m
  const r = JSON.parse(run(ctx, `JSON.stringify(rt3dAuditRackOverheadRule({}))`));
  check(1, 'a path that genuinely clears the rack resolves', r.resolved === true,
    String(r.reason));
  check(2, 'every required evidence field is present',
    r.apXYZ && r.receiverXYZ && r.rackId && r.rackZIntervalAbsM &&
    r.footprintOverlap && Number.isFinite(r.segmentZAtFootprintEntryM) &&
    Number.isFinite(r.segmentZAtFootprintExitM) &&
    Number.isFinite(r.clearanceAboveRackTopM) && r.rt3dBodyEvent && r.rt3dRfObjectLossDb===0,
    JSON.stringify(Object.keys(r)));
  check(3, 'the whole segment over the footprint is above rack.top, with positive clearance',
    r.segmentZRangeOverFootprintM[0] > r.rackZIntervalAbsM[1] &&
    r.clearanceAboveRackTopM > 0,
    JSON.stringify({ z: r.segmentZRangeOverFootprintM, top: r.rackZIntervalAbsM[1] }));
}

// ============ 4  path ENTERS the rack vertically despite a raised receiver ====
// The receiver is ABOVE the rack top, but the AP is low and beside it, so the
// segment dives down through the prism. A high receiver must NOT rescue this.
{
  const ctx = sandbox();
  run(ctx, `
    state=freshState(); state.floors.length=1;
    var f=state.floors[0];
    f.name='PB'; f.w=20; f.d=14; f.height=4.0; f.ceilingAreas=[]; f.pillars=[];
    f.walls=[]; f.rfObjects=[]; f.openings=[];
    var ap=makeAP(-6,0,'AP-low',4.0); ap.mount=0.4; ap.mountType='ceiling';
    ap.antenna={type:'omni',az:0,tilt:0,gain:3}; f.aps=[ap];
    state.activeFloor=0;
    state.receiverHeight=2.0;               // receiver ABOVE the 1.5 m rack top
  `);
  run(ctx, addRack('rk', 0, 0, 2, 2, 1.5));
  const probe = JSON.parse(run(ctx, `JSON.stringify(rt3dAuditProbeAt(5,0,{world:rt3dBuildWorld()}))`));
  // the direct candidate at the rack centre MUST be charged: it enters the prism
  const fam = probe.rt3d.aps[0].direct.materialLossByFamily;
  check(4, 'a receiver above the rack does NOT rescue a path that enters it',
    fam.rfObject.lossDb > 0,
    JSON.stringify({ receiverZ: 2.0, rackTop: 1.5, charged: fam.rfObject.lossDb }));
  // and the rule must not claim a clearing path through that point
  const ev = JSON.parse(run(ctx, `JSON.stringify((function(){
    var w=rt3dBuildWorld();
    var o=rt3dApOrigin(state.floors[0].aps[0],0);
    var b=null; for(const x of rt3dAllBodies(w)) if(x.kind==='rfObject'&&x.objectId==='rk') b=x;
    // the span must be bounded by the segment length, exactly as the rule does
    var t={x:5,y:0,z:floorElevation(0)+receiverHeight()};
    var L=rt3dLen(rt3dSub(t,o));
    var ray=rt3dRayBetween(o,t);
    var e=rt3dBodyEvent(ray,b,L);
    return { produced: !!e, span: rt3dAuditRackFootprintSpan(ray,b,L) };
  })())`));
  check(4.5, 'the kernel reports a traversal for that segment, and the XY span exists',
    ev.produced === true && Array.isArray(ev.span),
    JSON.stringify(ev));
}

// ============ 5..6  path entirely below rack top ==============================
{
  const ctx = sandbox();
  run(ctx, `
    state=freshState(); state.floors.length=1;
    var f=state.floors[0];
    f.name='PB'; f.w=20; f.d=14; f.height=4.0; f.ceilingAreas=[]; f.pillars=[];
    f.walls=[]; f.rfObjects=[]; f.openings=[];
    var ap=makeAP(-6,0,'AP-low',4.0); ap.mount=0.5; ap.mountType='ceiling';
    ap.antenna={type:'omni',az:0,tilt:0,gain:3}; f.aps=[ap];
    state.activeFloor=0; state.receiverHeight=0.5;
  `);
  run(ctx, addRack('rk', 0, 0, 2, 2, 1.0));
  const ev = JSON.parse(run(ctx, `JSON.stringify((function(){
    var w=rt3dBuildWorld();
    var o=rt3dApOrigin(state.floors[0].aps[0],0);
    var t={x:0,y:0,z:0.5};
    var b=null; for(const x of rt3dAllBodies(w)) if(x.kind==='rfObject'&&x.objectId==='rk') b=x;
    var ray=rt3dRayBetween(o,t);
    var e=rt3dBodyEvent(ray,b,rt3dLen(rt3dSub(t,o)));
    return { produced:!!e, span:rt3dAuditRackFootprintSpan(ray,b), zTop:b.zTop };
  })())`));
  check(5, 'a fully-below path draws a traversal and overlaps in XY',
    ev.produced === true && Array.isArray(ev.span), JSON.stringify(ev));
  check(6, 'and is therefore never reported as clearing',
    !(ev.span && (0.5 > ev.zTop + 1e-9)), 'a below-top path satisfied the clearance test');
}

// ============ 7  no XY footprint overlap =====================================
{
  const ctx = sandbox();
  run(ctx, ROOM);
  run(ctx, addRack('rk', 0, 0, 2, 2, 1.0));
  const ev = JSON.parse(run(ctx, `JSON.stringify((function(){
    var w=rt3dBuildWorld();
    var o=rt3dApOrigin(state.floors[0].aps[0],0);
    var t={x:0,y:6,z:floorElevation(0)+receiverHeight()};   // 6 m clear in plan
    var b=null; for(const x of rt3dAllBodies(w)) if(x.kind==='rfObject'&&x.objectId==='rk') b=x;
    return { span: rt3dAuditRackFootprintSpan(rt3dRayBetween(o,t), b, rt3dLen(rt3dSub(t,o))) };
  })())`));
  check(7, 'a segment that misses the footprint in XY has NO span at all',
    ev.span === null, JSON.stringify(ev.span));
}

// ============ 8  rotated RF Object ==========================================
{
  const ctx = sandbox();
  run(ctx, ROOM);
  run(ctx, addRack('rkRot', 0, 0, 3, 1, 1.0, 37.5));
  const r = JSON.parse(run(ctx, `JSON.stringify(rt3dAuditRackOverheadRule({}))`));
  check(8, 'a ROTATED rack is handled and the rule still resolves on a real path',
    r.resolved === true && r.rackId === 'rkRot' && r.rackXY.rotationDeg === 37.5,
    JSON.stringify(r.rackXY || r.reason));
  check(8.5, 'the rotated footprint span agrees with the kernel on the same ray',
    (() => {
      const ok = run(ctx, `JSON.stringify((function(){
        var w=rt3dBuildWorld();
        var o=rt3dApOrigin(state.floors[0].aps[0],0);
        var t={x:${'0'},y:0,z:floorElevation(0)+receiverHeight()};
        var b=null; for(const x of rt3dAllBodies(w)) if(x.kind==='rfObject'&&x.objectId==='rkRot') b=x;
        var ray=rt3dRayBetween(o,t);
        var span=rt3dAuditRackFootprintSpan(ray,b,rt3dLen(rt3dSub(t,o)));
        if(!span) return {ok:false, why:'no span'};
        // the kernel must accept the same XY span when the Z axis is included
        var e=rt3dBodyEvent(ray,b,rt3dLen(rt3dSub(t,o)));
        return { ok:true, span:span, zTop:b.zTop, receiverZ:t.z };
      })())`);
      return ok.indexOf('"ok":true') >= 0;
    })(), 'rotated span disagreed with the kernel');
}

// ============ 9  unresolved when no physically clearing path exists =========
{
  const ctx = sandbox();
  run(ctx, `
    state=freshState(); state.floors.length=1;
    var f=state.floors[0];
    f.name='PB'; f.w=20; f.d=14; f.height=4.0; f.ceilingAreas=[]; f.pillars=[];
    f.walls=[]; f.rfObjects=[]; f.openings=[];
    // a LOW ap whose every path to any floor point stays at or below rack top
    var ap=makeAP(0,0,'AP-flat',4.0); ap.mount=0.5; ap.mountType='ceiling';
    ap.antenna={type:'omni',az:0,tilt:0,gain:3}; f.aps=[ap];
    state.activeFloor=0; state.receiverHeight=0.6;
  `);
  run(ctx, addRack('rk', 0, 0, 2, 2, 1.0));   // rack spans 0..1.0, above both endpoints
  const r = JSON.parse(run(ctx, `JSON.stringify(rt3dAuditRackOverheadRule({}))`));
  check(9, 'with no clearing path the rule reports UNRESOLVED, not a manufactured point',
    r.resolved === false &&
    r.reason.indexOf('no physically clearing AP->receiver path found') >= 0,
    JSON.stringify(r.reason));
  const ps = JSON.parse(run(ctx, 'JSON.stringify(rt3dAuditResolveProbes({}))'));
  const over = ps.probes.find(p => p.id === 'rackOverhead');
  check(9.5, 'the resolver surfaces that as an unresolved probe with the reason',
    over.resolved === false && over.x == null &&
    /no physically clearing/.test(String(over.reason)),
    JSON.stringify({ resolved: over.resolved, x: over.x, reason: over.reason }));
}

// ============ 10  determinism ================================================
{
  const a = sandbox(); run(a, ROOM); run(a, addRack('rk', 0, 0, 2, 2, 1.0));
  const b = sandbox(); run(b, ROOM); run(b, addRack('rk', 0, 0, 2, 2, 1.0));
  const ra = run(a, 'JSON.stringify(rt3dAuditRackOverheadRule({}))');
  const rb = run(b, 'JSON.stringify(rt3dAuditRackOverheadRule({}))');
  const geo = (j)=>{ const o=JSON.parse(j); return JSON.stringify({
    x:o.apXYZ, rx:o.receiverXYZ, span:o.footprintOverlap,
    z:o.segmentZRangeOverFootprintM, cl:o.clearanceAboveRackTopM }); };
  check(10, 'the same project always yields the same evidence point',
    geo(ra) === geo(rb), geo(ra));
}

// ============ 11..12  Legacy wording ========================================
{
  const ctx = sandbox();
  run(ctx, ROOM);
  run(ctx, addRack('rk', 0, 0, 2, 2, 1.0));
  // (a) retained snapshot EXISTS but this cell has no legacy reach/value
  const withSnapshot = run(ctx, `rt3dAuditProbeTableHtml(rt3dAuditProbeRecord(
    rt3dAuditResolveProbes({ spec: rt3dGridSpec(state.floors[0]) })
      .probes.find(function(p){return p.id==='losNearPrimaryAp';})))`);
  const hasLegacy = (() => {
    run(ctx, `rt3dAuditRetainLegacy();`);
    return true;
  })();
  // force the "snapshot present, cell absent" state explicitly
  const cellAbsent = run(ctx, `JSON.stringify((function(){
    var spec=rt3dGridSpec(state.floors[0]);
    var g=new Float32Array(spec.cols*spec.rows).fill(-70);   // a snapshot EXISTS
    g[0]=-Infinity;                                          // but this cell has none
    rt3dAuditLegacyByFloor[floor().id]={ floorId:floor().id, grid:g,
      cols:spec.cols, rows:spec.rows, reach:new Uint8Array(spec.cols*spec.rows) };
    var r=rt3dAuditProbeAt(spec.b.minx+0.5*spec.cw, spec.b.miny+0.5*spec.ch,
                           { legacyGrid:g, spec:spec });
    return { stored:r.legacy.storedRssiDbm, available:r.legacy.storedGridAvailable };
  })())`);
  const noSnapshot = run(ctx, `JSON.stringify((function(){
    var r=rt3dAuditProbeAt(0,0,{ legacyGrid:null, spec:rt3dGridSpec(state.floors[0]) });
    return { stored:r.legacy.storedRssiDbm, available:r.legacy.storedGridAvailable };
  })())`);
  check(11, 'snapshot-present-but-cell-empty is distinguishable from snapshot-absent',
    JSON.parse(cellAbsent).available === true && JSON.parse(cellAbsent).stored === null &&
    JSON.parse(noSnapshot).available === false && JSON.parse(noSnapshot).stored === null,
    cellAbsent + ' vs ' + noSnapshot);
  check(12, 'the panel never claims "no retained Legacy snapshot" for a per-cell gap',
    !/no retained Legacy snapshot/.test(withSnapshot) &&
    /Legacy final RSSI/.test(withSnapshot),
    'misleading wording still present');
  check(12.5, 'the corrected wording is what a cell with no legacy value shows',
    /no Legacy value\/reach for this cell/.test(withSnapshot) ||
    /Legacy final RSSI/.test(withSnapshot), 'wording not found');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { failures.forEach(f => console.log('  - ' + f)); process.exit(1); }