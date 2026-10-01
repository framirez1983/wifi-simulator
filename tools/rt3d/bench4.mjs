// Stage 4 item 15: fan diagnostics and runtime at several explicit fan sizes.
//
// Reports emitted rays, rays that reached the receiver plane, direct vs
// reflected samples, average events per ray, average path distance, BVH
// candidates per query and runtime per AP.
//
// Absolute times carry the Node vm cross-context constant overhead noted in
// the earlier benchmarks; the counts and ratios are exact.
import { loadApp, run, blankState } from './loader.mjs';

const sb = loadApp();
blankState(sb);
const V = (s) => JSON.parse(run(sb, `JSON.stringify(${s})`));

console.log('Stage 4 — emission fan and receiver-plane sampling performance\n');

const SCENE = `
  state=freshState();
  var f=state.floors[0];
  f.height=3.0; f.w=40; f.d=40; f.ceilingAreas=[];
  var M4=state.materials[4].id, M2=state.materials[2].id;
  var ap=makeAP(0,0,'AP-1',3.0); ap.mount=2.6; f.aps.push(ap);
  f.ceilingAreas.push({id:'c',height:3.00,thickness:0.10,materialId:M2,extraLossDb:0,
    footprint:{parts:[{outer:[{x:-15,y:-15},{x:15,y:-15},{x:15,y:15},{x:-15,y:15}],
                        holes:[[{x:-4,y:-4},{x:4,y:-4},{x:4,y:4},{x:-4,y:4}]]}]}});
  for(var i=0;i<14;i++) f.walls.push({id:'w'+i,x1:-14+i*2.2,y1:-16,x2:-14+i*2.2,y2:16,
    materialId:M4,thickness:0.15});
  for(var i=0;i<10;i++) f.rfObjects.push({id:'o'+i,x:-12+i*2.6,y:6,width:1.2,depth:1.2,height:2.2,
    rotation:i*17,materialId:M4,extraLossDb:1});
  for(var i=0;i<8;i++) f.pillars.push({id:'p'+i,x:-12+i*3.0,y:-7,diameter:0.5,materialId:M4});
  state.floors.push(freshFloor('F1',1));
  state.floors[1].height=3.0; state.floors[1].w=40; state.floors[1].d=40;
  state.floors[1].ceilingAreas=[];
  state.floors[1].openings.push({id:'op',points:[{x:-6,y:-6},{x:6,y:-6},{x:6,y:6},{x:-6,y:6}]});`;

const SIZES = [
  { az: 12, el: 7 },
  { az: 36, el: 19 },
  { az: 72, el: 33 },
  { az: 144, el: 65 },
];

const rows = [];
for (const { az, el } of SIZES) {
  const r = JSON.parse(run(sb, `JSON.stringify((function(){
    ${SCENE}
    var world=rt3dBuildWorld();
    var ap=state.floors[0].aps[0];
    var t0=performance.now();
    var fan=rt3dTraceFan(world, ap, 0, rt3dReceiverPlaneZForFloor(0),
                         {azimuthSamples:${az}, elevationSamples:${el}, maxDistance:60});
    var wallMs=performance.now()-t0;
    var d=fan.diagnostics;
    return {bodies:d.totalBodies, emitted:d.totalEmittedRays, reached:d.raysReachingPlane,
            missed:d.raysTerminatedBeforePlane, direct:d.directSamples, refl:d.reflectedSamples,
            ev:d.averageEventsPerRay, dist:d.averagePathDistance,
            cand:d.bvhCandidatesTested, nodes:d.bvhNodesVisited,
            ms:wallMs, perAp:d.runtimePerApMs,
            bias:fan.density.densityBiasRatio, totalSr:fan.density.totalSolidAngle};
  })())`));
  r.label = `${az}x${el}`;
  rows.push(r);
}

const pad = (v, n) => String(v).padStart(n);
console.log('az x el     bodies   emitted   reached   missed   direct  refl  avgEv  avgDist(m)  cand/ray   ms/AP   densityBias');
for (const r of rows) {
  console.log(
    `${pad(r.label, 8)} ${pad(r.bodies, 7)} ${pad(r.emitted, 9)} ${pad(r.reached, 9)} ` +
    `${pad(r.missed, 8)} ${pad(r.direct, 8)} ${pad(r.refl, 5)} ${pad(r.ev, 6)} ${pad(r.dist, 11)} ` +
    `${pad((r.cand / r.emitted).toFixed(1), 10)} ${pad(r.ms.toFixed(1), 7)} ${pad(r.bias, 12)}`);
}
console.log('');
console.log('densityBias is max/min solid angle per elevation ring. 1.000 means the');
console.log('fan is isotropic; the equal-solid-angle scheme reports exactly 1.000.');
console.log('cand/ray is BVH exact-tests per emitted ray - it does NOT grow with the');
console.log('fan, only with scene complexity, which is the point of the BVH.');
console.log('');
console.log('Each row is one AP over the full sphere (elevation -90..+90), so the');
console.log('reached count is bounded by the rays that travel downward to the plane.');
