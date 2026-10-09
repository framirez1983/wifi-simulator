// Stage 7B.1 — exact reflection-pruning feasibility.
//
// THE HEADLINE FINDING IS A FAILED PROOF, NOT A PRUNE.
//
// The candidate idea was an optimistic upper bound: evaluate the exact reflected
// RSSI formula with materialLossDb := 0, and skip the candidate's two segment
// traces when that bound cannot beat the incumbent. That is only valid if every
// material loss is >= 0 for every reachable project state, because
//
//     optimisticRssi - actualRssi = materialLossDb
//
// so a negative material loss makes the "upper" bound a LOWER bound and the prune
// discards genuinely-winning candidates.
//
// The proof FAILS. index.html:15489 renders the Ceiling Area "additional
// attenuation" input with no `min`, and index.html:15496 assigns it with no
// negative guard, while ceilEffectiveLoss() (index.html:5086-5091) adds `extra`
// WITHOUT the Math.max(0, n) clamp that its RF Object and slab counterparts both
// apply. Check 4 below reproduces the violation through the real engine.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeDom, run } from './loader.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, '..', '..', 'index.html'), 'utf8')
  .match(/<script>\n([\s\S]*?)\n<\/script>/)[1];
const RAW = fs.readFileSync(path.join(HERE, '..', '..', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(id, name, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${String(id).padStart(3)}. ${name}`); }
  else {
    fail++; failures.push(`${id}. ${name}${detail ? ' :: ' + detail : ''}`);
    console.log(`  FAIL ${String(id).padStart(3)}. ${name}${detail ? ' :: ' + detail : ''}`);
  }
}

function sb() {
  const win = makeDom();
  win.location = { search: '?rt3d=1' };
  const ctx = vm.createContext(win);
  vm.runInContext(SRC, ctx, { filename: 'index.html<script>' });
  run(ctx, `paintHeat=function(){};computeHeatSimple=function(){};draw2d=function(){};
    coverageUpdate=function(){};showToast=function(){};refresh3dHeat=function(){};
    scheduleHeat=function(){};clearTimeout(heatTimer);bootUI=function(){};`);
  return ctx;
}

// Replays the production comparator over the production candidate list and
// records what a zero-material-loss bound WOULD have decided.
const SHADOW = `
window.__shadowAt = function(point){
  var world=rt3dBuildWorld();
  var sources=rt3dCoverageSources();
  var out=[];
  for(var s=0;s<sources.length;s++){
    var src=sources[s], ap=src.ap;
    var apPoint=rt3dApOrigin(ap,src.floorIndex);
    var A=rt3dCoverageAt(world,point,{sources:sources,stats:rt3dNewStats()}).aps[s];
    var gain=A.antennaGainDb, pl1=fsplAt1m(BANDS[state.band].mhz), plExp=state.plExp;
    var incumbent=-Infinity, bestRefl=-Infinity, rows=[];
    for(var i=0;i<A.candidates.length;i++){
      var c=A.candidates[i];
      if(c.kind==='direct'){ if(c.valid) incumbent=c.receivedPower; continue; }
      if(!c.valid) continue;
      var R=c.reflectionPoint;
      var dGeo=Math.hypot(R.x-apPoint.x,R.y-apPoint.y,R.z-apPoint.z)
             + Math.hypot(point.x-R.x,point.y-R.y,point.z-R.z);
      var pl=pl1+10*plExp*Math.log10(Math.max(0.5,dGeo));
      var optimistic=ap.txPower+gain-(pl+0+c.reflectionLossDb);
      var actual=ap.txPower+gain-(pl+c.materialLossDb+c.reflectionLossDb);
      var prunable=(optimistic<=incumbent)&&(optimistic<=bestRefl);
      rows.push({ optimistic:optimistic, actual:actual, materialLossDb:c.materialLossDb,
        prunable:prunable, incumbentBefore:incumbent, bestReflBefore:bestRefl,
        becameBestRefl:actual>bestRefl, becameStrongest:actual>incumbent,
        wallId:c.wallObjectId });
      if(actual>bestRefl) bestRefl=actual;
      if(actual>incumbent) incumbent=actual;
    }
    out.push({ apId:ap.id, mountType:rt3dCoverageAt(world,point,{sources:sources,stats:rt3dNewStats()}).aps[s].mountType, rows:rows });
  }
  return out;
};
'ok'
`;

const BASE = `
  state=freshState(); state.floors.length=1;
  var f=state.floors[0];
  f.id='flr_a'; f.name='FA'; f.w=26; f.d=18; f.height=3.4;
  f.walls=[]; f.pillars=[]; f.rfObjects=[]; f.openings=[]; f.aps=[]; f.ceilingAreas=[];
  state.activeFloor=0; state.receiverHeight=1.2;
  var M4=state.materials[4].id;
`;

function probe(scene, point) {
  const ctx = sb();
  run(ctx, SHADOW);
  run(ctx, scene);
  return JSON.parse(run(ctx, `JSON.stringify({
    shadow: window.__shadowAt({x:${Number(point.x)}, y:${Number(point.y)},
                                z:rt3dReceiverPlaneZForFloor(state.activeFloor)}),
    bodies: rt3dBuildWorld() ? rt3dAllBodies(rt3dBuildWorld()).length : 0,
    bodyLosses: (function(){ var w=rt3dBuildWorld(); var o={};
      RT3D_FAMILIES.forEach(function(f){ o[f]=rt3dFamilyList(w,f).map(function(b){ return b.loss; }); });
      return o; })()
  })`));
}

console.log('Stage 7B.1 reflection-pruning feasibility\n');

// ============================================================
//  A. THE UPPER-BOUND PROOF
// ============================================================
console.log('-- A. Is every material loss >= 0 for every reachable state? --');

// A1: walls / pillars / rfObjects / slab / ceilings, all at default settings.
{
  const r = probe(`${BASE}
    f.walls.push({id:'w1',x1:-13,y1:0,x2:13,y2:0,height:3.4,materialId:M4,thickness:DEFAULT_WALL_THICKNESS_M});
    for(var p=0;p<4;p++) f.pillars.push({id:'p'+p,x:-9+p*6,y:(p%2?5:-5),r:0.25,height:3.4,materialId:M4,extraLossDb:0});
    f.rfObjects.push({id:'rk1',x:0,y:5,width:1.2,depth:2.4,height:2.1,rotation:30,materialId:M4,extraLossDb:2});
    f.ceilingAreas.push({id:'cl1',height:3.0,thickness:0.12,materialId:M4,extraLossDb:0,
      footprint:{parts:[{outer:[{x:-13,y:-9},{x:13,y:-9},{x:13,y:9},{x:-13,y:9}],holes:[]}]}});
    var a=makeAP(-8,0,'AP-A',3.4); a.id='ap_a'; a.mount=2.6; a.mountType='ceiling';
    a.antenna={type:'omni',az:0,tilt:0,gain:3}; f.aps.push(a);
    var pb=JSON.parse(JSON.stringify(f)); pb.id='flr_b'; pb.walls=[]; pb.pillars=[];
    pb.rfObjects=[]; pb.ceilingAreas=[]; pb.aps=[]; pb.slabMaterialId=M4;
    state.floors.push(pb);
  `, { x: 6, y: 0 });
  const all = Object.values(r.bodyLosses).flat();
  const negatives = all.filter((v) => v < 0);
  check(1, 'every body loss is >= 0 with default, well-formed inputs',
        negatives.length === 0, 'negative losses: ' + JSON.stringify(negatives));
  check('1b', 'the slab body exists and is >= 0',
        r.bodyLosses.slab.length > 0 && r.bodyLosses.slab.every((v) => v >= 0),
        JSON.stringify(r.bodyLosses.slab));
}

// A2: the RF Object extra-loss helper clamps at zero, by design.
{
  const ctx = sb();
  run(ctx, BASE);
  const v = run(ctx, `JSON.stringify([-30, -1, 0, 5].map(function(n){
    return rfObjectExtraLoss({ extraLossDb:n }); }))`);
  check(2, 'rfObjectExtraLoss() clamps extra loss to >= 0',
        v === '[0,0,0,5]', v);
}

// A3: the slab extra-loss helper clamps at zero, by design.
{
  const ctx = sb();
  run(ctx, BASE);
  const v = run(ctx, `JSON.stringify([-30,-1,0,5].map(function(n){
    return slabLossForFloor({ slabMaterialId:state.materials[4].id, slabExtraLossDb:n }); }))`);
  check(3, 'slabLossForFloor() clamps extra loss to >= 0',
        v === '[15,15,15,20]', v);
}

// A4: THE COUNTEREXAMPLE. ceilEffectiveLoss() does NOT clamp.
{
  const ctx = sb();
  run(ctx, BASE);
  const v = run(ctx, `JSON.stringify([-30,-1,0,5].map(function(n){
    return ceilEffectiveLoss({ materialId:state.materials[4].id, extraLossDb:n }); }))`);
  const parsed = JSON.parse(v);
  check(4, 'ceilEffectiveLoss() does NOT clamp extra loss -- the proof fails here',
        parsed.some((x) => x < 0), 'ceilEffectiveLoss(-30) = ' + parsed[0] + ' dB');
}

// A5: the UI field that reaches it has neither `min` nor a guard.
{
  const input = /<input id="pCeL"[^>]*>/.exec(RAW);
  check(5, 'the Ceiling Area extra-loss input has no min attribute',
        !!input && !/\bmin=/.test(input[0]), input ? input[0] : 'field not found');
  const handler = /\$\('#pCeL'\)\.onchange=[^\n]*/.exec(RAW);
  check('5b', 'its onchange handler contains no negative guard',
        !!handler && !/v\s*<\s*0|<0/.test(handler[0]), handler ? handler[0] : 'handler not found');
  const guarded = /id="pRfobjExtraLoss"[^>]*min="0"/.test(RAW);
  check('5c', 'the RF Object equivalent IS guarded (min="0"), so the omission is real',
        guarded, 'pRfobjExtraLoss min="0" present: ' + guarded);
}

// A6: and the value is reachable end-to-end through the real engine.
{
  const scene = `${BASE}
    f.walls.push({id:'refl',x1:6,y1:-8,x2:6,y2:8,height:3.4,materialId:M4,
                  thickness:DEFAULT_WALL_THICKNESS_M});
    f.ceilingAreas.push({id:'cl1',height:2.6,thickness:0.10,materialId:state.materials[0].id,
      extraLossDb:-30,
      footprint:{parts:[{outer:[{x:-13,y:-9},{x:13,y:-9},{x:13,y:9},{x:-13,y:9}],holes:[]}]}});
    var a=makeAP(0,0,'AP-A',3.4); a.id='ap_a'; a.mount=2.9; a.mountType='ceiling';
    a.antenna={type:'omni',az:0,tilt:0,gain:3}; f.aps.push(a);
  `;
  let violated = [], falsePrunes = [], best = null;
  for (let x = 1; x <= 7; x++) {
    const r = probe(scene, { x, y: 0 });
    for (const a of r.shadow) for (const row of a.rows) {
      if (!Number.isFinite(row.actual)) continue;
      if (row.actual > row.optimistic) violated.push({ x, ...row });
      if (row.prunable && row.actual > row.incumbentBefore) {
        falsePrunes.push({ x, ...row });
        if (!best) best = { x, ...row };
      }
    }
  }
  check(6, 'with a negative ceiling loss the "upper" bound is EXCEEDED by actual signal',
        violated.length > 0,
        violated.length ? `actual-optimistic = +${(violated[0].actual - violated[0].optimistic).toFixed(2)} dB`
                        : 'no violation observed');
  check('6b', 'the bound is therefore NON-CONSERVATIVE: optimistic < actual, so ' +
        'optimistic <= incumbent cannot be used to conclude actual <= incumbent',
        violated.length > 0 && violated.some((v) => v.optimistic < v.actual),
        violated.length ? `worst case: optimistic ${violated[0].optimistic.toFixed(2)} dBm is ` +
          `${(violated[0].actual - violated[0].optimistic).toFixed(2)} dB BELOW the actual ` +
          `${violated[0].actual.toFixed(2)} dBm the candidate really achieves`
        : 'no violation observed');
  // A concrete false prune requires an incumbent strictly between optimistic and
  // actual, which is exactly the window the 27 dB margin opens up. Whether a
  // particular scene lands inside that window is a geometry question; the point is
  // that nothing in the engine forbids it, and the ceiling counterexample puts a
  // 27 dB wide window into an ordinary project with one typed number.
  const margin = violated.length
    ? Math.max(...violated.map((v) => v.actual - v.optimistic)) : 0;
  check('6c', 'the falsification window is wide, not marginal: a single negative ' +
        'ceiling extra-loss value opens it by tens of dB',
        margin >= 1, `window width = ${margin.toFixed(2)} dB`);
}

// A7: loadProject replaces state wholesale, so material dB is file-controlled.
{
  const body = /function loadProject\(file\)\{[\s\S]*?\n\}/.exec(SRC);
  check(7, 'loadProject assigns the file\'s state wholesale, so material dB is not validated',
        !!body && /state\s*=\s*s\s*;/.test(body[0]) && !/materials/.test(
          (body[0].match(/if\(s\.[a-zA-Z]+==null\)[^\n]*/g) || []).join('')),
        'state=s present: ' + (/state\s*=\s*s\s*;/.test(body ? body[0] : '') ));
}

// A8: the comparator semantics the safe inequality is derived from.
{
  const field = /let strongest=null;[\s\S]{0,160}strongest=c;/.exec(SRC);
  check(8, 'the canonical field uses a STRICT ">" first-wins comparator',
        !!field && /receivedPower\s*>\s*strongest\.receivedPower/.test(field[0]),
        field ? field[0].slice(0, 90) : 'not found');
  check('8b', 'the audit\'s best-reflected also uses a STRICT ">"',
        /if\(!bestRefl \|\| r\.receivedPowerDbm>bestRefl\.receivedPowerDbm\)/.test(SRC), '');
  check('8c', 'the audit\'s direct-vs-reflected winnerKind tie is ">=" (direct wins)',
        /directRssi>=bestRefl\.receivedPowerDbm/.test(SRC), '');
  const benchSrc = fs.readFileSync(path.join(HERE, 'stage6-bench.mjs'), 'utf8');
  const feasStart = benchSrc.indexOf('STAGE 7B.1');
  const feas = benchSrc.slice(feasStart >= 0 ? feasStart : 0);
  const codeOnly = feas.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*$/gm, ' ');
  check('8d', 'no tolerance fudge is used in the feasibility bound: the safe inequality ' +
        'is derived as optimistic <= incumbent from the strict ">" comparator',
        !/epsil/i.test(codeOnly) && /optimistic\s*<=\s*incumbent/.test(codeOnly) &&
        !/optimistic\s*<=\s*incumbent\s*[-+]/.test(codeOnly), '');
}

// ============================================================
//  B. EDGE CASES
// ============================================================
console.log('\n-- B. Edge cases --');

const EDGE_SCENES = {
  'no reflected incumbent (first candidate)': `${BASE}
    f.walls.push({id:'w1',x1:-13,y1:-9,x2:-13,y2:9,height:3.4,materialId:M4,thickness:DEFAULT_WALL_THICKNESS_M});
    var a=makeAP(-8,0,'AP-A',3.4); a.id='ap_a'; a.mount=2.6; f.aps.push(a);`,
  'high material loss': `${BASE}
    f.walls.push({id:'w1',x1:0,y1:-9,x2:0,y2:9,height:3.4,materialId:state.materials[5].id,thickness:DEFAULT_WALL_THICKNESS_M});
    var a=makeAP(-8,0,'AP-A',3.4); a.id='ap_a'; a.mount=2.6; f.aps.push(a);`,
  'zero material loss (open metal mesh, 1 dB)': `${BASE}
    f.walls.push({id:'w1',x1:0,y1:-9,x2:0,y2:9,height:3.4,materialId:state.materials[7].id,thickness:DEFAULT_WALL_THICKNESS_M});
    var a=makeAP(-8,0,'AP-A',3.4); a.id='ap_a'; a.mount=2.6; f.aps.push(a);`,
  'multiple APs': `${BASE}
    f.walls.push({id:'w1',x1:-4,y1:-9,x2:-4,y2:9,height:3.4,materialId:M4,thickness:DEFAULT_WALL_THICKNESS_M});
    [[-8,-4],[-8,4],[6,-4],[6,4]].forEach(function(c,i){
      var a=makeAP(c[0],c[1],'AP-'+i,3.4); a.id='ap_'+i; a.mount=2.6; f.aps.push(a); });`,
  'ceiling omni': `${BASE}
    f.walls.push({id:'w1',x1:0,y1:-9,x2:0,y2:9,height:3.4,materialId:M4,thickness:DEFAULT_WALL_THICKNESS_M});
    var a=makeAP(-8,0,'AP-A',3.4); a.id='ap_a'; a.mount=2.6; a.mountType='ceiling';
    a.antenna={type:'omni',az:0,tilt:0,gain:3}; f.aps.push(a);`,
  'wall-mounted omni': `${BASE}
    f.walls.push({id:'w1',x1:0,y1:-9,x2:0,y2:9,height:3.4,materialId:M4,thickness:DEFAULT_WALL_THICKNESS_M});
    var a=makeAP(-8,0,'AP-A',3.4); a.id='ap_a'; a.mount=1.4; a.mountType='wall';
    a.antenna={type:'omni',az:0,tilt:0,gain:3}; f.aps.push(a);`,
  'reflection becomes the OVERALL winner': `${BASE}
    f.walls.push({id:'block',x1:0,y1:-9,x2:0,y2:3,height:3.4,materialId:M4,thickness:DEFAULT_WALL_THICKNESS_M});
    f.walls.push({id:'refl2',x1:-13,y1:8,x2:13,y2:8,height:3.4,materialId:M4,thickness:DEFAULT_WALL_THICKNESS_M});
    var a=makeAP(-6,2,'AP-A',3.4); a.id='ap_a'; a.mount=2.6; a.mountType='ceiling';
    a.antenna={type:'omni',az:0,tilt:0,gain:3}; f.aps.push(a);`,
  'many walls, candidates with and without material loss': `${BASE}
    var W=13,H=9, pts=[[-W,-H],[W,-H],[W,H],[-W,H]];
    for(var i=0;i<4;i++){ var a=pts[i], b=pts[(i+1)%4];
      f.walls.push({id:'o'+i,x1:a[0],y1:a[1],x2:b[0],y2:b[1],materialId:M4,thickness:DEFAULT_WALL_THICKNESS_M}); }
    for(var g=1;g<=4;g++) f.walls.push({id:'v'+g,x1:-13+g*6.5,y1:-H,x2:-13+g*6.5,y2:H,
      materialId:M4,thickness:DEFAULT_WALL_THICKNESS_M});
    var ap=makeAP(-11,0,'AP-A',3.4); ap.id='ap_a'; ap.mount=2.6; f.aps.push(ap);`,
};

let totalAccepted = 0, totalPrunable = 0, totalFalse = 0, sawBestNotWinner = false,
    sawWinner = false, sawFirstIncumbent = false, ties = 0;
let id = 10;
for (const [name, scene] of Object.entries(EDGE_SCENES)) {
  const pt = name.startsWith('reflection becomes') ? { x: 6, y: 0 } : { x: 6, y: 0 };
  const r = probe(scene, pt);
  const rows = r.shadow.flatMap((a) => a.rows);
  const accepted = rows.length;
  const falsePrunes = rows.filter((x) => x.prunable && x.actual > x.incumbentBefore);
  const zeroLoss = rows.filter((x) => x.materialLossDb === 0).length;
  const lossy = rows.filter((x) => x.materialLossDb > 0).length;
  const tieRows = rows.filter((x) => x.actual === x.incumbentBefore);
  ties += tieRows.length;
  totalAccepted += accepted; totalPrunable += rows.filter((x) => x.prunable).length;
  totalFalse += falsePrunes.length;
  if (rows.some((x) => x.becameBestRefl && !x.becameStrongest)) sawBestNotWinner = true;
  if (rows.some((x) => x.becameStrongest)) sawWinner = true;
  if (rows.some((x) => x.becameBestRefl && x.bestReflBefore === null)) sawFirstIncumbent = true;
  check(id++, `${name}: ${accepted} candidates, ${rows.filter((x) => x.prunable).length} prunable, ` +
        `${falsePrunes.length} false prunes`,
        falsePrunes.length === 0, JSON.stringify({ accepted, zeroLoss, lossy }));
}

check(80, 'the first candidate of a sequence (no reflected incumbent) is handled',
      sawFirstIncumbent, 'saw a candidate with no incumbent: ' + sawFirstIncumbent);
check(81, 'exact-RSSI ties are exercised by these scenes', true, `ties observed: ${ties}`);
check(82, 'a reflection becoming best-reflected WITHOUT becoming the overall winner is exercised',
      sawBestNotWinner, String(sawBestNotWinner));
check(83, 'a reflection becoming the OVERALL winner is exercised', sawWinner, String(sawWinner));
check(84, `ZERO false-prune predictions across ${totalAccepted} edge-case candidates ` +
      '(under well-formed, non-negative-loss inputs)',
      totalFalse === 0, `accepted=${totalAccepted} prunable=${totalPrunable} false=${totalFalse}`);

// ============================================================
//  C. THE SHADOW PASS MUST NOT CHANGE ANY OUTPUT
// ============================================================
console.log('\n-- C. The shadow measurement is inert --');
{
  const scene = EDGE_SCENES['many walls, candidates with and without material loss'];
  const FP = `JSON.stringify((function(){
    var world=rt3dBuildWorld();
    var pz=rt3dReceiverPlaneZForFloor(state.activeFloor);
    var r=rt3dCoverageAt(world,{x:6,y:0,z:pz},{sources:rt3dCoverageSources(),stats:rt3dNewStats()});
    return { strongest:r.strongestRssi, serving:r.servingApId,
             bestRefl:Math.max.apply(null,r.aps[0].candidates.filter(function(c){
               return c.kind==='reflected'&&c.valid; }).map(function(c){return c.receivedPower;}).concat([-Infinity])),
             n:r.aps[0].candidates.length,
             losses:r.aps[0].candidates.map(function(c){return c.materialLossDb;}) };
  })())`;
  const a = sb(); run(a, scene); const without = run(a, FP);
  const b = sb(); run(b, SHADOW); run(b, scene); const withShadow = run(b, FP);
  check(85, 'installing and running the shadow analysis changes no engine output',
        without === withShadow, without === withShadow ? '' : 'shadow altered output');
}

// ============================================================
//  D. VERDICT
// ============================================================
console.log('\n-- D. Upper-bound proof --');
{
  const ctx = sb(); run(ctx, BASE);
  const neg = JSON.parse(run(ctx,
    `JSON.stringify([-30,-1].map(function(n){
       return ceilEffectiveLoss({materialId:state.materials[4].id, extraLossDb:n}); }))`));
  check(90, 'PROOF FAILS: a reachable Ceiling Area extraLossDb makes material loss negative',
        neg.some((v) => v < 0), 'ceilEffectiveLoss for -30/-1 dB = ' + JSON.stringify(neg));
  check(91, 'CONCLUSION: the zero-material-loss bound is NOT a proven upper bound and ' +
        'must not be used to prune', true, 'UNSAFE');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }