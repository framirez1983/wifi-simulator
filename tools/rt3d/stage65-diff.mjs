// Stage 6.5 differential measurement: Legacy RT vs RT3D, side by side.
//
// NOT a check — a measurement. It runs the REAL production runRayTrace() and the
// REAL Stage-6 coverage slice over the same floor and reports the difference.
//
//   node tools/rt3d/stage65-diff.mjs                        # built-in ladder scenes
//   node tools/rt3d/stage65-diff.mjs path/to/project.json    # any saved project
//
// The legacy result comes from heatGridRssi, written by the untouched production
// tracer. Nothing here re-implements, patches or approximates it: whatever the
// legacy engine produced IS the legacy number.
//
// What this tool refuses to do:
//   * tune either engine,
//   * treat agreement as a target,
//   * report a legacy quantity it did not actually read from legacy state.
//   Per-cell legacy attribution (serving AP, per-traversal loss, reflection
//   contribution) is genuinely unrecoverable after deposition; the probe reports
//   that limit instead of reconstructing it.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeDom, run } from './loader.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, '..', '..', 'index.html'), 'utf8')
  .match(/<script>\n([\s\S]*?)\n<\/script>/)[1];

const argv = process.argv.slice(2);
const projectFile = argv.find(a => !a.startsWith('-'));
const FLOOR = Number((argv.find(a => a.startsWith('--floor=')) || '--floor=0').split('=')[1]);
// --full walks every cell instead of striding. Correct but slow: a full probe pass
// solves a reflection candidate per wall per AP, which is orders of magnitude more
// work than the coverage field itself.
const FULL = argv.includes('--full');
const STRIDE = Number((argv.find(a => a.startsWith('--stride=')) || (FULL ? '1' : '--stride=4')).split('=')[1]);
const DELTA_PNG = (argv.find(a => a.startsWith('--delta-png=')) || '').split('=')[1] || null;

// A FileReader that reads from an in-memory string, so the REAL loadProject()
// runs — including its real migration block — instead of a copy of it that could
// drift from the app.
function sandboxWithFileReader() {
  const win = makeDom();
  win.location = { search: '?rt3d=1' };
  win.FileReader = class {
    readAsText(file) { this.result = file.__text; setTimeout(() => this.onload && this.onload(), 0); }
  };
  win.Image = class { set src(v) { if (this.onload) this.onload(); } };
  const ctx = vm.createContext(win);
  vm.runInContext(SRC, ctx, { filename: 'index.html<script>' });
  run(ctx, `
    paintHeat=function(){}; draw2d=function(){}; coverageUpdate=function(){};
    showToast=function(){}; refresh3dHeat=function(){}; scheduleHeat=function(){};
    computeHeatSimple=function(){}; clearTimeout(heatTimer); bootUI=function(){};
    build3d=function(){}; requestAnimationFrame=function(cb){ setTimeout(function(){cb(Date.now());},0); };
  `);
  return ctx;
}
const settle = () => new Promise(r => setImmediate(r));
async function pump(ctx, until, maxTicks) {
  for (let i = 0; i < (maxTicks || 200000); i++) {
    if (run(ctx, `!!(${until})`)) return true;
    await settle();
  }
  return false;
}

// ---- scenes -----------------------------------------------------------------
// The built-in set is the controlled ladder, one scene per question. Each is a
// real project state built with the app's own helpers.
const SCENES = {
  emptyLos: `
    state=freshState();
    var f=state.floors[0];
    f.name='PB'; f.w=20; f.d=14; f.height=3.0; f.ceilingAreas=[]; f.pillars=[];
    f.walls=[]; f.rfObjects=[]; f.openings=[];
    var W=10,H=7,pts=[[-W,-H],[W,-H],[W,H],[-W,H]];
    for(var i=0;i<4;i++){var a=pts[i],b=pts[(i+1)%4];
      f.walls.push({id:'w'+i,x1:a[0],y1:a[1],x2:b[0],y2:b[1],
        materialId:state.materials[2].id, thickness:DEFAULT_WALL_THICKNESS_M});}
    var ap=makeAP(0,0,'AP-1',3.0); ap.mount=2.6; ap.mountType='ceiling';
    ap.antenna={type:'omni',az:0,tilt:0,gain:3}; f.aps=[ap];
    state.activeFloor=0;`,
  // a room split by a FINITE-height wall: the plan is identical above and below,
  // so any difference is purely the true-3D clearance Legacy cannot express
  lowWall: `
    state=freshState();
    var f=state.floors[0];
    f.name='PB'; f.w=20; f.d=14; f.height=3.0; f.ceilingAreas=[]; f.pillars=[];
    f.walls=[]; f.rfObjects=[]; f.openings=[];
    var W=10,H=7,pts=[[-W,-H],[W,-H],[W,H],[-W,H]];
    for(var i=0;i<4;i++){var a=pts[i],b=pts[(i+1)%4];
      f.walls.push({id:'w'+i,x1:a[0],y1:a[1],x2:b[0],y2:b[1],
        materialId:state.materials[2].id, thickness:DEFAULT_WALL_THICKNESS_M});}
    f.walls.push({id:'wLow',x1:0,y1:-7,x2:0,y2:7,height:1.0,
      materialId:state.materials[4].id, thickness:DEFAULT_WALL_THICKNESS_M});
    var ap=makeAP(-5,0,'AP-1',3.0); ap.mount=2.6; ap.mountType='ceiling';
    ap.antenna={type:'omni',az:0,tilt:0,gain:3}; f.aps=[ap];
    state.activeFloor=0;`,
  // patch antennas with real downtilt: this is where the vertical model bites
  patchDowntilt: `
    state=freshState();
    var f=state.floors[0];
    f.name='PB'; f.w=26; f.d=17; f.height=3.2; f.ceilingAreas=[]; f.pillars=[];
    f.walls=[]; f.rfObjects=[]; f.openings=[];
    var W=13,H=8.5,pts=[[-W,-H],[W,-H],[W,H],[-W,H]];
    for(var i=0;i<4;i++){var a=pts[i],b=pts[(i+1)%4];
      f.walls.push({id:'w'+i,x1:a[0],y1:a[1],x2:b[0],y2:b[1],
        materialId:state.materials[4].id, thickness:DEFAULT_WALL_THICKNESS_M});}
    [[-9,-5.5],[3,-5.5],[3,5.5],[-9,5.5]].forEach(function(c,i){
      var ap=makeAP(c[0],c[1],'AP-P'+(i+1),3.2); ap.mount=2.9; ap.mountType='ceiling';
      ap.antenna={type:'patch',az:0,tilt:25,gain:5}; f.aps.push(ap); });
    state.activeFloor=0;`,
  // a rack field: true-3D obstacle heights around RF Objects
  racks: `
    state=freshState();
    var f=state.floors[0];
    f.name='PB'; f.w=26; f.d=17; f.height=3.2; f.ceilingAreas=[]; f.pillars=[];
    f.walls=[]; f.rfObjects=[]; f.openings=[];
    var W=13,H=8.5,pts=[[-W,-H],[W,-H],[W,H],[-W,H]];
    for(var i=0;i<4;i++){var a=pts[i],b=pts[(i+1)%4];
      f.walls.push({id:'w'+i,x1:a[0],y1:a[1],x2:b[0],y2:b[1],
        materialId:state.materials[4].id, thickness:DEFAULT_WALL_THICKNESS_M});}
    [[-5,-2],[0,-2],[5,-2],[-5,3],[0,3],[5,3]].forEach(function(c,i){
      f.rfObjects.push({id:'rk'+i,x:c[0],y:c[1],width:1.0,depth:2.0,height:2.0,
        rotation:0, materialId:state.materials[4].id, extraLossDb:2}); });
    [[-9,-5.5],[6,5.5]].forEach(function(c,i){
      var ap=makeAP(c[0],c[1],'AP-R'+(i+1),3.2); ap.mount=2.6; ap.mountType='ceiling';
      ap.antenna={type:'omni',az:0,tilt:0,gain:3}; f.aps.push(ap); });
    state.activeFloor=0;`,
};

// ---- run one comparison -----------------------------------------------------
async function compare(ctx, label) {
  const spec = JSON.parse(run(ctx, `JSON.stringify((function(){
    var s=rt3dGridSpec(state.floors[state.activeFloor]);
    return { cols:s.cols, rows:s.rows, cell:s.cell, cw:s.cw, ch:s.ch, b:s.b };
  })())`));

  // ---- the REAL legacy tracer, driven to completion ----
  run(ctx, 'heatGridRssi=null; heatRtReach=null; lastRayTraceStats=null; runRayTrace(null);');
  const legacyDone = await pump(ctx, 'heatGridRssi');
  if (!legacyDone) throw new Error(`${label}: legacy runRayTrace() never completed in the harness`);
  const legacy = JSON.parse(run(ctx, `JSON.stringify({
    grid: Array.from(heatGridRssi), reach: Array.from(heatRtReach), meta: heatMeta,
    stats: lastRayTraceStats })`));

  // ---- the REAL Stage-6 slice, one point query per cell ----
  const rt3d = JSON.parse(run(ctx, `JSON.stringify((function(){
    var w=rt3dBuildWorld();
    var spec=rt3dGridSpec(state.floors[state.activeFloor]);
    var z=rt3dReceiverPlaneZForFloor(state.activeFloor);
    var cur={j:0,i:0,best:null,apBest:null,valid:null,acc:null};
    var s=null, guard=0;
    do { s=rt3dCoverageSlice(w, spec, z, { cursor:cur }); guard++; } while(!s.complete && guard<2000000);
    return { grid: Array.from(s.best), diag: s.diagnostics, total: s.totalCells,
             planeZ: z, evaluated: s.evaluatedCells, guard: guard };
  })())`));

  const st = JSON.parse(run(ctx, `JSON.stringify(rt3dAuditDeltaStats(
    ${JSON.stringify(legacy.grid)}, ${JSON.stringify(rt3d.grid)},
    {cols:${spec.cols}, rows:${spec.rows}}))`));
  const corr = JSON.parse(run(ctx, `JSON.stringify(rt3dAuditCorrelate(
    ${JSON.stringify(st)}, {cols:${spec.cols}, rows:${spec.rows}, cell:${spec.cell},
      cw:${spec.cw}, ch:${spec.ch}, b:${JSON.stringify(spec.b)}}, {floorIndex:${FLOOR}}))`));

  // ---- reflection contribution over a deterministic sample of cells ----
  const refl = JSON.parse(run(ctx, `JSON.stringify((function(){
    var w=rt3dBuildWorld();
    var spec=rt3dGridSpec(state.floors[state.activeFloor]);
    var z=rt3dReceiverPlaneZForFloor(state.activeFloor);
    var stride=Math.max(1, Math.floor(spec.rows/26));   // deterministic, not random
    var wins=0, n=0, adv=[], validRefl=0, tested=0, directBetter=0;
    for(var j=0;j<spec.rows;j+=stride){
      for(var i=0;i<spec.cols;i+=stride){
        var x=spec.b.minx+(i+0.5)*spec.cw, y=spec.b.miny+(j+0.5)*spec.ch;
        var p=rt3dAuditProbeAt(x,y,{world:w, spec:spec});
        n++;
        tested += p.rt3d.aps.reduce(function(s,a){return s+a.reflection.candidatesTested;},0);
        validRefl += p.rt3d.aps.reduce(function(s,a){return s+a.reflection.validCandidates;},0);
        for(const a of p.rt3d.aps){
          if(a.strongest.kind==='reflected'){ wins++; if(a.reflection.advantageOverDirectDb!=null) adv.push(a.reflection.advantageOverDirectDb); }
          else if(a.strongest.kind==='direct') directBetter++;
        }
      }
    }
    adv.sort(function(a,b){return a-b;});
    return { sampledCells:n, stride:stride,
             apPathsWhereReflectionWon:wins, apPathsWhereDirectWon:directBetter,
             pctApPathsWhereReflectionWon: (wins+directBetter)?+(100*wins/(wins+directBetter)).toFixed(2):null,
             medianAdvantageDbWhenItWon: adv.length? adv[Math.floor(adv.length/2)] : null,
             maxAdvantageDb: adv.length? adv[adv.length-1] : null,
             reflectCandidatesTested:tested, validReflectedCandidates:validRefl };
  })())`));

  // ---- legacy 2D-vs-3D distance term, made explicit ----
  const dist2 = JSON.parse(run(ctx, `JSON.stringify((function(){
    var w=rt3dBuildWorld();
    var spec=rt3dGridSpec(state.floors[state.activeFloor]);
    var z=rt3dReceiverPlaneZForFloor(state.activeFloor);
    var stride=Math.max(1, Math.floor(spec.rows/26));
    var plExp=state.plExp, pl1=fsplAt1m(BANDS[state.band].mhz);
    var gaps=[], maxGap=-Infinity, maxAt=null;
    for(var j=0;j<spec.rows;j+=stride) for(var i=0;i<spec.cols;i+=stride){
      var x=spec.b.minx+(i+0.5)*spec.cw, y=spec.b.miny+(j+0.5)*spec.ch;
      var p=rt3dAuditProbeAt(x,y,{world:w, spec:spec});
      for(const a of p.rt3d.aps){
        // Legacy on the SAME floor uses only the horizontal distance; on a
        // cross-floor path it adds the vertical separation to the traced path.
        // Either way the straight 3D distance is not what it propagates with.
        var legacyD = (a.ownerFloorIndex===state.activeFloor)
          ? a.horizontalDistanceM
          : Math.hypot(a.horizontalDistanceM, Math.abs(a.apZ-planeZ));
        var gap = (pl1+plExp*10*Math.log10(Math.max(0.5,a.true3dDistanceM)))
                - (pl1+plExp*10*Math.log10(Math.max(0.5,legacyD)));
        gaps.push(gap);
        if(gap>maxGap){ maxGap=gap; maxAt={x:+x.toFixed(3),y:+y.toFixed(3),apId:a.apId,
          horizontalM:a.horizontalDistanceM, true3dM:a.true3dDistanceM,
          legacyDistanceM:+legacyD.toFixed(3), pathLossGapDb:+gap.toFixed(3)}; }
      }
    }
    gaps.sort(function(a,b){return a-b;});
    return { medianGapDb:+gaps[Math.floor(gaps.length/2)].toFixed(3),
             maxGapDb:+maxGap.toFixed(3), maxAt:maxAt,
             note:'positive means RT3D applies MORE path loss than legacy would, purely '
                 +'from using the true 3D distance where legacy propagates with a '
                 +'horizontal distance on the same floor' };
  })())`));

  // ---- vertical antenna contribution over the same sample ----
  const vert = JSON.parse(run(ctx, `JSON.stringify((function(){
    var w=rt3dBuildWorld();
    var spec=rt3dGridSpec(state.floors[state.activeFloor]);
    var z=rt3dReceiverPlaneZForFloor(state.activeFloor);
    var stride=Math.max(1, Math.floor(spec.rows/26));
    var over3=0, over6=0, over10=0, n=0, maxDb=0, maxAt=null, applies=0, flat=0;
    for(var j=0;j<spec.rows;j+=stride) for(var i=0;i<spec.cols;i+=stride){
      var x=spec.b.minx+(i+0.5)*spec.cw, y=spec.b.miny+(j+0.5)*spec.ch;
      var p=rt3dAuditProbeAt(x,y,{world:w, spec:spec});
      for(const a of p.rt3d.aps){
        n++;
        if(!a.antenna.verticalModelApplies){ flat++; continue; }
        applies++;
        var d=Math.abs(a.antenna.verticalDeltaDb);
        if(d>3) over3++; if(d>6) over6++; if(d>10) over10++;
        if(d>maxDb){ maxDb=d; maxAt={x:x,y:y,apId:a.apId,deltaDb:a.antenna.verticalDeltaDb,
          offAxisDeg:a.antenna.offAxisDeg, clipped:a.antenna.elevationPenaltyClipped}; }
      }
    }
    return { apPaths:n, ceilingOmniFlatNoVerticalModel:flat,
             verticalModelApplies:applies,
             pctOver3Db: applies? +(100*over3/applies).toFixed(2):null,
             pctOver6Db: applies? +(100*over6/applies).toFixed(2):null,
             pctOver10Db: applies? +(100*over10/applies).toFixed(2):null,
             maxVerticalDeltaDb:+maxDb.toFixed(4), maxAt:maxAt };
  })())`));

  // ---- the AP-type audit: does this project even exercise the vertical model? ----
  const apTypes = JSON.parse(run(ctx, 'JSON.stringify(rt3dAuditApTypeReport())'));

  // ---- rule-resolved evidence probe set, with a full comparison per resolved point ----
  const probeSet = JSON.parse(run(ctx, `JSON.stringify((function(){
    var ps=rt3dAuditResolveProbes({ spec: ${JSON.stringify(spec)},
      legacyGrid: heatGridRssi, rt3dGrid: rt3dExpLastCoverageBest });
    var rows=[];
    for(const p of ps.probes){
      if(!p.resolved){ rows.push({ probe:p, comparison:null }); continue; }
      var r=rt3dAuditProbeAt(p.x, p.y, { spec: ${JSON.stringify(spec)},
        legacyGrid: heatGridRssi, reachGrid: heatRtReach });
      rows.push({ probe:p, comparison:r,
                  classification:rt3dAuditClassifyDisagreement(r) });
    }
    return { meta:{ floorName: ps.floorName, resolved: ps.resolvedCount,
                    unresolved: ps.unresolvedCount,
                    provenance: ps.coordinateProvenance }, rows: rows };
  })())`));

  // ---- whole-slice diagnostics ----
  const slice = JSON.parse(run(ctx, `JSON.stringify(rt3dAuditSliceDiagnostics(
    ${JSON.stringify(legacy.grid)}, ${JSON.stringify(rt3d.grid)},
    { cols:${spec.cols}, rows:${spec.rows}, cell:${spec.cell}, cw:${spec.cw}, ch:${spec.ch},
      b:${JSON.stringify(spec.b)} },
    { floorIndex:${FLOOR}, stride:${STRIDE} }))`));

  // ---- the worst cells, explained per AP ----
  const worst = JSON.parse(run(ctx, `JSON.stringify((function(){
    var w=rt3dBuildWorld();
    var spec=rt3dGridSpec(state.floors[state.activeFloor]);
    var L=${JSON.stringify(legacy.grid)}, R=${JSON.stringify(rt3d.grid)};
    var idx=[];
    for(var k=0;k<L.length;k++)
      if(Number.isFinite(L[k])&&Number.isFinite(R[k])) idx.push({k:k,d:R[k]-L[k]});
    idx.sort(function(a,b){ return Math.abs(b.d)-Math.abs(a.d); });
    var out=[];
    for(var n=0;n<Math.min(4,idx.length);n++){
      var k=idx[n].k, ci=Math.floor(k/spec.cols), cj=k-ci*spec.cols;
      var x=spec.b.minx+(cj+0.5)*spec.cw, y=spec.b.miny+(ci+0.5)*spec.ch;
      var p=rt3dAuditProbeAt(x,y,{world:w, spec:spec, legacyGrid:L, reachGrid:Array.from(heatRtReach)});
      out.push({ x:x, y:y, legacyDbm: L[k], rt3dDbm: R[k], deltaDb: idx[n].d,
                 cellIndex:k, probe:p });
    }
    return out;
  })())`));

  return { label, spec, legacy: { stats: legacy.stats, meta: legacy.meta }, rt3d: rt3d.diag, st, corr, refl, vert, dist2, apTypes, probeSet, slice, worst };
}

// ---- print ------------------------------------------------------------------
// null-safe dB formatter: an unreachable path reports 'n/a' rather than crashing
const db = (v, d) => (v == null || !Number.isFinite(v)) ? 'n/a' : v.toFixed(d == null ? 2 : d);
function table(rows, cols) {
  const w = cols.map(c => Math.max(c.length, ...rows.map(r => String(r[c.key] ?? '').length)));
  const line = (v) => v.map((s, i) => String(s ?? '').padEnd(w[i])).join('  ');
  return [line(cols.map(c => c.label)), line(w.map(n => '-'.repeat(n))), ...rows.map(r => line(cols.map(c => r[c.key])))].join('\n');
}

(async () => {
  const cases = [];
  if (projectFile) {
    if (!fs.existsSync(projectFile)) { console.error(`no such file: ${projectFile}`); process.exit(1); }
    const ctx = sandboxWithFileReader();
    const json = fs.readFileSync(projectFile, 'utf8');
    // the REAL loadProject(), so the migration block is the app's own
    run(ctx, `loadProject({ name:'p.wifiproj.json', __text: ${JSON.stringify(json)} });`);
    const ok = await pump(ctx, '!!state && state.floors && state.floors.length');
    if (!ok) throw new Error('loadProject() did not produce a project');
    const meta = JSON.parse(run(ctx, `JSON.stringify({
      file:${JSON.stringify(path.basename(projectFile))},
      floors: state.floors.map(function(f){return f.name;}),
      activeFloor: state.activeFloor, band: state.band,
      receiverHeight: state.receiverHeight, plExp: state.plExp,
      aps: state.floors.reduce(function(n,f){return n+(f.aps||[]).length;},0) })`));
    console.log(`\n=== Stage 6.5 differential audit ===`);
    console.log(`project: ${meta.file}`);
    console.log(`floors: ${meta.floors.join(', ')}   band: ${meta.band}   ` +
                `receiverHeight: ${meta.receiverHeight} m   plExp: ${meta.plExp}   APs: ${meta.aps}`);
    if (meta.floors.length > 1) {
      console.log(`\nNOTE: only floor index ${FLOOR} is compared. Legacy RT always traces the\n` +
                  `      ACTIVE floor, so a multi-floor project must be run once per floor with\n` +
                  `      --floor=N and the active floor set accordingly.`);
    }
    cases.push(await compare(ctx, `project floor ${FLOOR}`));
  } else {
    for (const [name, script] of Object.entries(SCENES)) {
      const ctx = sandboxWithFileReader();
      run(ctx, 'state=freshState();');
      run(ctx, script);
      run(ctx, 'bootUI=function(){};');
      cases.push(await compare(ctx, name));
    }
  }

  for (const c of cases) {
    console.log(`\n\n################ ${c.label} ################`);
    console.log(`grid: ${c.spec.cols} x ${c.spec.rows} = ${c.spec.cols * c.spec.rows} cells @ ${c.spec.cell} m`);
    console.log(`\n-- 1. whole-slice difference statistics --`);
    console.log(table([{
      compared: c.st.cellsCompared, onlyL: c.st.cellsOnlyLegacy, onlyR: c.st.cellsOnlyRt3d,
      medAbs: c.st.medianAbsDeltaDb, p90Abs: c.st.p90AbsDeltaDb, maxAbs: c.st.maxAbsDeltaDb,
      meanSigned: c.st.meanSignedDeltaDb, w3: c.st.within3DbPct + '%',
      w6: c.st.within6DbPct + '%', o10: c.st.over10DbPct + '%'
    }], [
      { key: 'compared', label: 'compared' }, { key: 'onlyL', label: 'onlyLegacy' },
      { key: 'onlyR', label: 'onlyRt3d' }, { key: 'medAbs', label: 'med|d|' },
      { key: 'p90Abs', label: 'p90|d|' }, { key: 'maxAbs', label: 'max|d|' },
      { key: 'meanSigned', label: 'mean signed' }, { key: 'w3', label: 'within 3dB' },
      { key: 'w6', label: 'within 6dB' }, { key: 'o10', label: '>10dB' }
    ]));
    // ---------------- AP-type audit: is the vertical pathology even reachable? ----
    console.log(`\n-- AP TYPE AUDIT (decides whether the vertical model matters here) --`);
    console.log(table([c.apTypes], [
      { key:'participatingAps', label:'participating APs' },
      { key:'verticalModelAppliesOnAps', label:'vertical applies' },
      { key:'verticalModelBypassedOnAps', label:'vertical bypassed' }
    ]));
    console.log(`   by type/mount: ${JSON.stringify(c.apTypes.byTypeAndMount)}`);
    console.log(`   VERDICT: ${c.apTypes.verdict}`);
    if(c.apTypes.aps.length)
      console.log(table(c.apTypes.aps.map(a=>({
        id:a.apId, type:a.antennaType+'/'+a.mountType, tilt:a.tiltDeg+'d',
        bw:a.elevationBandwidthDeg+'d', flat:a.ceilingOmniFlat?'yes':'no'
      })), [
        { key:'id', label:'AP' }, { key:'type', label:'type/mount' },
        { key:'tilt', label:'downtilt' }, { key:'bw', label:'elev bw' },
        { key:'flat', label:'no vertical term' }
      ]));

    // ---------------- compact comparison table for the resolved evidence probes ----
    console.log(`\n-- EVIDENCE PROBE SET: compact comparison (Legacy vs RT3D) --`);
    console.log(`   ${c.probeSet.meta.provenance}`);
    console.log(`   resolved ${c.probeSet.meta.resolved}, unresolved ${c.probeSet.meta.unresolved}`);
    console.log('\n   coordinate XYZ | legacy | rt3d | delta | servingAP | direct | bestRefl | winning | azGain | fullGain | vert | wall | rfObj | slab | ceil | CLASSIFICATION');
    for(const row of c.probeSet.rows){
      const p=row.probe, r=row.comparison;
      if(!r){
        console.log(`   [unresolved] ${p.category}: ${p.reason}`);
        continue;
      }
      const s=r.rt3d.aps.find(a=>a.apId===r.rt3d.servingApId) || r.rt3d.aps[0];
      const fam=s.winningLossByFamily||{};
      const g=v=>(v==null?'n/a':(typeof v==='number'?v.toFixed(2):v));
      const rf=s.reflection.best;
      console.log(`   (${r.point.x.toFixed(2)}, ${r.point.y.toFixed(2)}, ${r.point.z.toFixed(2)}) | ` +
        `${g(r.comparison.legacyStoredDbm)} | ${g(r.comparison.rt3dDbm)} | ` +
        `${r.comparison.deltaDb==null?'n/a':(r.comparison.deltaDb>0?'+':'')+r.comparison.deltaDb.toFixed(2)} | ` +
        `${r.rt3d.servingApId||'-'} | ${g(s.direct.receivedPowerDbm)} | ${g(rf?rf.receivedPowerDbm:null)} | ` +
        `${s.strongest.kind} | ${g(s.antenna.azGainDb)} | ${g(s.antenna.fullGainDb)} | ` +
        `${s.antenna.ceilingOmniFlat?'n/a':g(s.antenna.verticalDeltaDb)} | ` +
        `${g((fam.wall||{}).lossDb)} | ${g((fam.rfObject||{}).lossDb)} | ` +
        `${g((fam.slab||{}).lossDb)} | ${g((fam.ceiling||{}).lossDb)} | ` +
        `${row.classification.classification}`);
      console.log(`       ${p.category}`);
      console.log(`       why: ${row.classification.reason}`);
      const extra=row.classification.attributed.filter(t=>t.absDb>=0.5)
        .map(t=>`${t.term} ${t.db>0?'+':''}${t.db.toFixed(2)}`);
      if(extra.length) console.log(`       attributed: ${extra.join(' | ')}`);
      if(Math.abs(row.classification.unexplainedResidualDb||0)>=1)
        console.log(`       UNEXPLAINED RESIDUAL ${row.classification.unexplainedResidualDb} dB`);
      if(row.classification.pathology)
        console.log(`       PATHOLOGY: ${JSON.stringify(row.classification.pathology)}`);
      console.log(`       legacy UNATTRIBUTABLE here: ${r.legacy.unattributable.map(u=>u.quantity).join('; ')}`);
    }

    // ---------------- whole-slice diagnostics ----------------
    console.log(`\n-- WHOLE-SLICE DIAGNOSTICS (stride ${c.slice.sampling.stride}, ` +
      `${c.slice.sampling.cellsVisited}/${c.slice.sampling.gridCells} cells = ` +
      `${c.slice.sampling.coveragePct}%) --`);
    const ws=c.slice.wholeSlice;
    console.log(`   median |delta| ${ws.medianAbsDeltaDb} dB   p90 ${ws.p90AbsDeltaDb} dB   max ${ws.maxAbsDeltaDb} dB`);
    console.log(`   within +/-3 dB: ${ws.within3Db} (${ws.within3DbPct}%)   within +/-6 dB: ${ws.within6Db} (${ws.within6DbPct}%)   >10 dB: ${ws.over10Db} (${ws.over10DbPct}%)`);
    console.log(`   mean signed ${ws.meanSignedDeltaDb} dB   cells only RT3D ${ws.cellsOnlyRt3d}   only legacy ${ws.cellsOnlyLegacy}`);
    const R=c.slice.reflection;
    console.log(`\n   reflections: won ${R.apPathsWhereReflectionWon} of ` +
      `${R.apPathsWhereReflectionWon+R.apPathsWhereDirectWon} AP paths (${R.pctApPathsWhereReflectionWins}%)`);
    console.log(`     median advantage when it won ${R.medianAdvantageDbWhenItWon} dB, max ${R.maxAdvantageDb} dB`);
    console.log(`     ${R.note}`);
    const V=c.slice.verticalAntenna;
    console.log(`\n   vertical antenna term: applies on ${V.apPathsWhereVerticalApplies} AP paths`);
    console.log(`     >3 dB: ${V.countOver3Db} (${V.pctOver3Db}%)   >6 dB: ${V.countOver6Db} (${V.pctOver6Db}%)   >10 dB: ${V.countOver10Db} (${V.pctOver10Db}%)   max ${V.maxVerticalDeltaDb} dB`);
    if(V.maxAt) console.log(`     worst: ${JSON.stringify(V.maxAt)}`);
    if(!V.apPathsWhereVerticalApplies)
      console.log('     NO AP ON THIS PROJECT EXERCISES THE VERTICAL MODEL, so every one of');
      console.log('     these counts is structurally 0 and the patch pathology cannot occur here.');
    console.log(`\n   per geometric class: ${JSON.stringify(c.slice.perClass)}`);

    console.log(`\n-- 5. true-3D distance term: RT3D vs the legacy distance semantics --`);
    console.log(`   median ${c.dist2.medianGapDb} dB, max ${c.dist2.maxGapDb} dB`);
    console.log(`   ${c.dist2.note}`);
    if (c.dist2.maxAt) console.log(`   worst: ${JSON.stringify(c.dist2.maxAt)}`);
    console.log(`\n-- 4. reflection contribution (sampled every ${c.refl.stride} rows) --`);
    console.log(table([c.refl], [
      { key: 'sampledCells', label: 'cells' },
      { key: 'apPathsWhereDirectWon', label: 'direct won' },
      { key: 'apPathsWhereReflectionWon', label: 'reflected won' },
      { key: 'pctApPathsWhereReflectionWon', label: '% refl won' },
      { key: 'medianAdvantageDbWhenItWon', label: 'med adv' },
      { key: 'maxAdvantageDb', label: 'max adv' },
      { key: 'reflectCandidatesTested', label: 'cand tested' },
      { key: 'validReflectedCandidates', label: 'valid cand' }
    ]));
    console.log(`\n-- 3. vertical antenna contribution --`);
    console.log(table([c.vert], [
      { key: 'apPaths', label: 'AP paths' },
      { key: 'ceilingOmniFlatNoVerticalModel', label: 'no vert model' },
      { key: 'verticalModelApplies', label: 'vert applies' },
      { key: 'pctOver3Db', label: '%>3dB' },
      { key: 'pctOver6Db', label: '%>6dB' },
      { key: 'pctOver10Db', label: '%>10dB' },
      { key: 'maxVerticalDeltaDb', label: 'max dB' }
    ]));
    if (c.vert.maxAt) console.log(`   worst: ${JSON.stringify(c.vert.maxAt)}`);
    console.log(`\n-- 7. spatial correlation with |dRssi| (NOT causation) --`);
    console.log(table(c.corr.rows, [
      { key: 'class', label: 'class' }, { key: 'cells', label: 'cells' },
      { key: 'pctOfCompared', label: '% of compared' },
      { key: 'medianAbsDeltaDb', label: 'med|d| db' }, { key: 'note', label: 'note' }
    ]));
    console.log(`   ${c.corr.disclaimer}`);
    console.log(`\n-- 6/2/3. worst disagreements, explained per AP --`);
    for (const wst of c.worst) {
      console.log(`\n   cell (${wst.x.toFixed(2)}, ${wst.y.toFixed(2)})  ` +
                  `legacy ${wst.legacyDbm.toFixed(2)} dBm -> rt3d ${wst.rt3dDbm.toFixed(2)} dBm  ` +
                  `dRssi ${wst.deltaDb > 0 ? '+' : ''}${wst.deltaDb.toFixed(2)} dB`);
      const pr = wst.probe;
      for (const a of pr.rt3d.aps) {
        const fams = a.winningLossByFamily
          ? Object.entries(a.winningLossByFamily)
              .filter(([, v]) => v.lossDb !== 0)
              .map(([k, v]) => `${k} ${db(v.lossDb)}dB x${v.traversals}`).join(', ')
          : '(no material crossed)';
        console.log(`     ${a.apId}  floor ${a.ownerFloorIndex}  ` +
                    `ap(${db(a.apXYZ.x)},${db(a.apXYZ.y)},${db(a.apXYZ.z)}) -> ` +
                    `rx(${db(a.receiverXYZ.x)},${db(a.receiverXYZ.y)},${db(a.receiverXYZ.z)})`);
        console.log(`       dist dh=${db(a.horizontalDistanceM)}m d3=${db(a.true3dDistanceM)}m` +
                    `  tx=${a.txPowerDbm}dBm  gain az=${db(a.antenna.azGainDb)}` +
                    ` vert=${a.antenna.ceilingOmniFlat ? 'n/a (ceiling omni has no elevation term)' : db(a.antenna.elevationPenaltyDb)}` +
                    `${a.antenna.elevationPenaltyClipped ? ' [CAPPED at ' + a.antenna.elevationCapDb + ' dB]' : ''}` +
                    `  total=${db(a.antenna.fullGainDb)}dBi`);
        console.log(`       winning=${a.strongest.kind} @ ${db(a.strongest.receivedPowerDbm)}dBm` +
                    `  material: ${fams}`);
        if (a.reflection.best) {
          const rb = a.reflection.best;
          console.log(`       best reflection: wall ${rb.wallObjectId} at ` +
            `(${db(rb.reflectionPoint.x)},${db(rb.reflectionPoint.y)},${db(rb.reflectionPoint.z)})` +
            ` legs ${db(rb.legAP.distanceM)}+${db(rb.legPR.distanceM)}=${db(rb.pathDistanceM)}m` +
            `  mat ${db(rb.materialLossDb)}dB + refl ${rb.reflectionLossDb}dB` +
            ` -> ${db(rb.receivedPowerDbm)}dBm` +
            `  (advantage over direct ${db(a.reflection.advantageOverDirectDb)}dB)`);
        }
      }
      console.log(`     legacy reach flag ${wst.probe.legacy.reach} (${wst.probe.legacy.reachMeaning})`);
      console.log(`     legacy could NOT report for this cell: ` +
        wst.probe.legacy.unattributable.map(u => u.quantity).join('; '));
    }
    console.log(`\n-- per-engine provenance --`);
    console.log(`   legacy rays: ${JSON.stringify(c.legacy.stats && c.legacy.stats.raysPerAp)}`);
    console.log(`   legacy branches: ${c.legacy.stats && c.legacy.stats.processedBranches}, ` +
                `elapsed ${c.legacy.stats && c.legacy.stats.elapsedMs} ms`);
    console.log(`   RT3D: ${c.rt3d.cellsEvaluated} cells, ${c.rt3d.directPathsTested} direct, ` +
                `${c.rt3d.validReflectedPaths} valid reflections, ${c.rt3d.totalMs} ms`);
  }

  console.log(`\n\n-- truth hierarchy --`);
  console.log('   real measurement / known physical geometry');
  console.log('        < physically justified model');
  console.log('        < legacy behaviour (runRayTrace)');
  console.log('   Legacy output is NOT truth. It is a compatibility oracle.');
  console.log('   No measurement data exists for these runs, so nothing above is');
  console.log('   calibrated against reality.');
})().catch(e => { console.error(e); process.exit(1); });
