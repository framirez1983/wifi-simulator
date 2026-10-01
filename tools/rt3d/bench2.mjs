// Stage 2 item 17 — performance of the EXPERIMENTAL path tracer.
//
// Measures three things, as required:
//   - the average nearest-event query
//   - the average complete direct path
//   - the average one-reflection path
// for representative worlds of ~25, ~100 and ~500 bodies.
//
// No acceleration is added: the Stage-1 broadphase seam is untouched and
// rt3dQuery is still the single replaceable scan. The numbers are here to
// show where the cost is, not to justify premature optimisation.
import { loadApp, run, blankState } from './loader.mjs';

const sb = loadApp();
blankState(sb);
const V = (s) => JSON.parse(run(sb, `JSON.stringify(${s})`));

function world(nWalls, nPillars, nObjects, nCeilings) {
  return V(`(function(){
    state=freshState();
    var f=state.floors[0];
    f.height=8.0; f.w=90; f.d=70; f.ceilingAreas=[];
    f.aps.push(makeAP(-3,-3,'AP-1',8.0));
    var M=state.materials[4].id;
    for(var i=0;i<${nWalls};i++){
      var x=-44+(i%15)*6.0, y=-34+Math.floor(i/15)*6.0;
      f.walls.push({id:'w'+i,x1:x,y1:y,x2:x+4.0,y2:y,materialId:M,thickness:0.15});
    }
    for(var i=0;i<${nPillars};i++)
      f.pillars.push({id:'p'+i,x:-43+(i%15)*6.0,y:-33+Math.floor(i/15)*6.0,diameter:0.6,materialId:M});
    for(var i=0;i<${nObjects};i++)
      f.rfObjects.push({id:'o'+i,x:-43+(i%15)*6.0,y:-33+Math.floor(i/15)*6.0,
        width:1.2,depth:0.9,height:6.0,rotation:(i*7)%90,materialId:M,extraLossDb:1});
    for(var i=0;i<${nCeilings};i++){ var cx=-40+i*9;
      f.ceilingAreas.push({id:'c'+i,height:7.5,thickness:0.10,materialId:M,extraLossDb:0,
        footprint:{parts:[{outer:[{x:cx,y:-5},{x:cx+6,y:-5},{x:cx+6,y:5},{x:cx,y:5}],holes:[]}]}}); }
    state.floors.push(freshFloor('F1',1));
    state.floors[1].height=3.0; state.floors[1].w=90; state.floors[1].d=70;
    var w=rt3dBuildWorld();
    return {bodies:w.walls.length+w.pillars.length+w.rfObjects.length+w.slabs.length+w.ceilings.length,
            sig:rt3dWorldSignature(w)};
  })()`);
}

console.log('Stage 2 — experimental path tracer performance');
console.log('(parallel engine, not wired to the app; the app never runs this)');
console.log('');
console.log('CAVEAT: these run inside the Node vm that evaluates index.html, where');
console.log('every call is a cross-context global lookup. That inflates ALL absolute');
console.log('times by a large constant (the Stage-1 harness measures a bare in-vm');
console.log('loop at ~16 ns, and a native call ~0). The SCALING with body count and');
console.log('the per-body cost are the meaningful figures; the absolute numbers are');
console.log('not comparable to browser performance.\n');

const N = 300;
for (const [label, counts] of [
  ['~25  bodies', [10, 6, 6, 3]],
  ['~100 bodies', [40, 25, 25, 10]],
  ['~500 bodies', [200, 130, 130, 40]],
]) {
  const w = world(...counts);
  const r = JSON.parse(run(sb, `JSON.stringify((function(){
    var world=rt3dBuildWorld();
    var ap=state.floors[0].aps[0], az=rt3dApOriginZ(0, ap);
    var N=${N};

    // (1) nearest-event query: the per-step cost the tracer pays
    var ray=rt3dRay(ap.x, ap.y, az, 0.7, 0.3, 0.4);
    var t0=performance.now();
    for(var i=0;i<N*20;i++) rt3dCandidateEvents(world, ray, 120, null);
    var t1=performance.now();
    var queryNs=((t1-t0)*1e6)/(N*20);

    // (2) complete direct path (no reflection)
    var t2=performance.now();
    var ev=0;
    for(var i=0;i<N;i++){
      var a=(i/N)*Math.PI*2, ca=Math.cos(a), sa=Math.sin(a);
      var tr=rt3dTracePath(world, rt3dRay(ap.x, ap.y, az, ca, sa, 0.35), {reflectWalls:false, maxDistance:120});
      ev+=tr.events.length;
    }
    var t3=performance.now();
    var directNs=((t3-t2)*1e6)/N;

    // (3) one-reflection path
    var t4=performance.now();
    var ev2=0;
    for(var i=0;i<N;i++){
      var a=(i/N)*Math.PI*2, ca=Math.cos(a), sa=Math.sin(a);
      var tr=rt3dTracePath(world, rt3dRay(ap.x, ap.y, az, ca, sa, 0.35), {reflectWalls:true, maxReflections:1, maxDistance:120});
      ev2+=tr.events.length;
    }
    var t5=performance.now();
    var reflNs=((t5-t4)*1e6)/N;

    return {queryNs:+queryNs.toFixed(1), directNs:+directNs.toFixed(1), reflNs:+reflNs.toFixed(1),
            directEvents:+(ev/N).toFixed(2), reflEvents:+(ev2/N).toFixed(2)};
  })())`));
  console.log(`${label}  ${w.sig}`);
  console.log(`   nearest-event query    ${String(r.queryNs).padStart(10)} ns`);
  console.log(`   complete direct path   ${String(r.directNs).padStart(10)} ns  (${r.directEvents} events/path)`);
  console.log(`   one-reflection path    ${String(r.reflNs).padStart(10)} ns  (${r.reflEvents} events/path)`);
  console.log(`   query ns per body      ${(r.queryNs / w.bodies).toFixed(1)}`);
  console.log('');
}

console.log('The broadphase is still the Stage-1 linear scan, so the nearest-event');
console.log('query is O(bodies) and dominates. rt3dQuery is the single seam where a');
console.log('uniform grid / BVH / spatial hash would be substituted; no primitive,');
console.log('contract or tracer loop would change.');
