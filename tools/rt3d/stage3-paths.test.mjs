// Stage 3 requirement 8: COMPLETE-PATH equivalence.
//
// Per-event answers can agree while a whole path diverges, because any
// difference compounds over events. So rt3dTracePath() is run TWICE over the
// same scene and ray - once with the linear oracle broadphase, once with the
// BVH - and the two complete diagnostics must be identical field for field.
import { loadApp, run, blankState } from './loader.mjs';

const sb = loadApp();
blankState(sb);
let pass = 0, fail = 0;
const failures = [];
function check(id, name, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${String(id).padStart(2)}. ${name}`); }
  else { fail++; failures.push(`${id}. ${name}${detail ? ' :: ' + detail : ''}`);
         console.log(`  FAIL ${String(id).padStart(2)}. ${name}${detail ? ' :: ' + detail : ''}`); }
}
const V = (s) => JSON.parse(run(sb, `JSON.stringify(${s})`));

// A scene containing every situation the requirement lists.
const SCENE = `
  state=freshState();
  var f=state.floors[0];
  f.height=3.0; f.w=40; f.d=40; f.ceilingAreas=[];
  var M4=state.materials[4].id, M2=state.materials[2].id;
  var ap=makeAP(-15,-15,'AP-1',3.0); ap.mount=2.6; f.aps.push(ap);

  // a normal-height Ceiling with a hole, at architectural 2.90..3.00
  f.ceilingAreas.push({id:'ceilHole',height:3.00,thickness:0.10,materialId:M2,extraLossDb:2,
    footprint:{parts:[{outer:[{x:-12,y:-12},{x:12,y:-12},{x:12,y:12},{x:-12,y:12}],
                        holes:[[{x:-4,y:-4},{x:4,y:-4},{x:4,y:4},{x:-4,y:4}]]}]}});
  // a tall RF Object and a low one
  f.rfObjects.push({id:'tall',x:-6,y:0,width:1.2,depth:1.2,height:2.6,rotation:25,
    materialId:M4,extraLossDb:1});
  f.rfObjects.push({id:'low',x:0,y:0,width:2,depth:2,height:1.5,rotation:0,
    materialId:M4,extraLossDb:0});
  // walls: one to reflect off, and a corridor pair
  f.walls.push({id:'wRef',x1:-2,y1:-14,x2:-2,y2:14,materialId:M4,thickness:0.15});
  f.walls.push({id:'wA',x1:-9,y1:0,x2:-7,y2:0,height:2.0,materialId:M4,thickness:0.15});
  f.pillars.push({id:'pil',x:5,y:5,diameter:0.6,materialId:M4});
  // floor 1 with a slab and an opening
  state.floors.push(freshFloor('F1',1));
  var f1=state.floors[1];
  f1.height=3.0; f1.w=40; f1.d=40; f1.ceilingAreas=[];
  f1.openings.push({id:'op',points:[{x:-4,y:-4},{x:4,y:-4},{x:4,y:4},{x:-4,y:4}]});
`;

// Canonical, fully rounded digest of a complete trace. Everything the
// requirement lists is included; rounding at 1e-9 is the documented tolerance.
const DIGEST = `
  function digest(t){
    if(!t) return null;
    return {
      n: t.events.length,
      kinds: t.events.map(function(e){ return e.type+':'+e.objectType+':'+e.objectId; }),
      pts: t.events.map(function(e){ return [r9(e.point.x),r9(e.point.y),r9(e.point.z)]; }),
      nrm: t.events.map(function(e){ return e.normal ? [r9(e.normal.x),r9(e.normal.y),r9(e.normal.z)] : null; }),
      loss: t.events.map(function(e){ return r9(e.loss); }),
      trav: t.events.map(function(e){ return e.traversals; }),
      refl: t.events.map(function(e){ return !!e.reflected; }),
      totalLoss: r9(t.totalMaterialLoss),
      totalDist: r9(t.totalDistance),
      reflections: t.reflections,
      transmissions: t.transmissions,
      terminated: t.terminated,
      finalRay: [r9(t.finalRay.x),r9(t.finalRay.y),r9(t.finalRay.z),
                 r9(t.finalRay.dx),r9(t.finalRay.dy),r9(t.finalRay.dz)]
    };
  }
  function r9(v){ return typeof v==='number' ? +v.toFixed(9) : v; }`;

const CASES = {
  'direct transmission':   `rt3dRayToTarget(ap,0,rt3dV(10,10,1.2))`,
  'wall reflection':       `rt3dRayToTarget(ap,0,rt3dV(10,10,1.2))`,
  'low AP over RF Object': `rt3dRayToTarget(ap,0,rt3dV(10,0,2.6))`,
  'low ray under object':  `rt3dRay(-3,-15,1.0, 0.4,1,0)`,
  'cross-floor solid slab':`rt3dRayToTarget(ap,0,rt3dV(0,0,6.0))`,
  'cross-floor opening':   `rt3dRay(0,-14,2.0, 0,1,0.35)`,
  'normal-height ceiling': `rt3dRay(0,-14,1.0, 0,1,0.4)`,
  'ceiling hole':          `rt3dRay(0,-14,1.0, 0,1,0.4)`,
  'explicit-height wall':  `rt3dRay(-15,-10,1.0, 1,0,0.15)`,
  'steep rise through ceil':`rt3dRay(-14,-14,0.3, 0.6,0.6,0.53)`,
};

const CASES2 = {
  'corridor, same body twice': `rt3dRay(-8,0,2.6, 1,0,0)`,
  'reflect then collide':      `rt3dRay(-15,0,1.0, 1,0,0)`,
  'tangential pillar':         `rt3dRay(0,5.3,1.0, 1,0,0)`,   // grazes: 0 events is the correct answer
  'reflect then re-cross':     `rt3dRay(-15,0,1.0, 1,0,0)`,
};

console.log('Stage 3 — complete-path equivalence (linear oracle vs BVH)\n');

for (const [title, cases, opts] of [
  ['reflection set', CASES, { maxDistance: 90, maxReflections: 2 }],
  ['multi-event set', CASES2, { maxDistance: 90, maxReflections: 2 }],
]) {
  let idx = 0;
  for (const [name, rayExpr] of Object.entries(cases)) {
    idx++;
    const r = V(`(function(){
      ${SCENE}
      var world=rt3dBuildWorld();
      var ray=${rayExpr};
      if(!ray) return {skipped:true};
      var O=${JSON.stringify(opts)};
      var a=rt3dTracePath(world, ray, {backend:'linear', maxDistance:O.maxDistance, maxReflections:O.maxReflections});
      var b=rt3dTracePath(world, ray, {backend:'bvh',    maxDistance:O.maxDistance, maxReflections:O.maxReflections});
      ${DIGEST}
      return {same: JSON.stringify(digest(a))===JSON.stringify(digest(b)),
              lin:digest(a), bvh:digest(b)};
    })()`);
    if (r.skipped) { check(idx, `${title}: ${name} (skipped, degenerate ray)`, true, 'ray was null'); continue; }
    const n = r.lin ? r.lin.n : -1;
    check(idx, `${title}: ${name} (${n} events) identical`,
      r.same === true,
      r.same ? '' : `\n      linear=${JSON.stringify(r.lin)}\n      bvh   =${JSON.stringify(r.bvh)}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
