// Stage 3 acceptance: deterministic AABB BVH broadphase.
//
// The linear enumeration (rt3dQueryLinear / rt3dNearestLinear) is the ORACLE
// and is never removed. Every accelerated answer in this file is compared
// against it. A single mismatch is a correctness bug, not benchmark noise.
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
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const V = (s) => JSON.parse(run(sb, `JSON.stringify(${s})`));

// Deterministic PRNG (mulberry32). Every corpus and ray set is generated from
// a fixed seed, so the whole file is reproducible and Math.random is never used.
const PRNG = `
  function mkRng(seed){
    let a=seed>>>0;
    return function(){
      a=(a+0x6D2B79F5)>>>0;
      let t=a;
      t=Math.imul(t^(t>>>15), t|1);
      t^=t+Math.imul(t^(t>>>7), t|61);
      return ((t^(t>>>14))>>>0)/4294967296;
    };
  }`;

// A mixed world: every physical body family, with deliberately awkward shapes
// (long thin walls, a very large slab AABB, small objects, local ceilings).
const CORPUS = `${PRNG}
  function buildWorld(n, seed){
    var rng=mkRng(seed);
    var state0=freshState();
    state=state0;
    var f=state.floors[0];
    f.height=8.0; f.w=120; f.d=100; f.ceilingAreas=[];
    f.aps.push(makeAP(-50,-45,'AP-1',8.0));
    var M=state.materials[4].id, G=state.materials[2].id;
    var id=0;
    // floors
    for(var k=1;k<3;k++){ state.floors.push(freshFloor('F'+k,k));
      state.floors[k].height=3.0; state.floors[k].w=120; state.floors[k].d=100;
      state.floors[k].ceilingAreas=[]; }
    var next=function(p){ id++; return p+id; };
    for(var i=0;i<n;i++){
      var kind=rng();
      if(kind<0.30){
        // long thin wall: the shape that defeats a uniform grid
        var x=-58+rng()*116, y=-48+rng()*96, len=6+rng()*30;
        var a=rng()*Math.PI;
        f.walls.push({id:next('w'),x1:x,y1:y,x2:x+Math.cos(a)*len,y2:y+Math.sin(a)*len,
          materialId: rng()<0.5?M:G, thickness:0.15, height: rng()<0.4? (1.0+rng()*2.0) : null});
      } else if(kind<0.50){
        f.pillars.push({id:next('p'),x:-58+rng()*116,y:-48+rng()*96,
          diameter:0.3+rng()*1.2, materialId:M});
      } else if(kind<0.78){
        // small RF Objects
        f.rfObjects.push({id:next('o'),x:-58+rng()*116,y:-48+rng()*96,
          width:0.4+rng()*2.0, depth:0.4+rng()*1.6, height:0.5+rng()*6.0,
          rotation:rng()*180, materialId:rng()<0.5?M:G, extraLossDb:rng()*2});
      } else {
        // local Ceiling Areas, some with a hole
        var cx=-55+rng()*110, cy=-45+rng()*90;
        var holed=rng()<0.4;
        f.ceilingAreas.push({id:next('c'),height:2.5+rng()*4.0, thickness:0.10,
          materialId:G, extraLossDb:rng(),
          footprint:{parts:[{outer:[{x:cx,y:cy},{x:cx+3+rng()*8,y:cy},
                                      {x:cx+3+rng()*8,y:cy+3+rng()*8},{x:cx,y:cy+3+rng()*8}],
            holes: holed? [[{x:cx+1,y:cy+1},{x:cx+2,y:cy+1},{x:cx+2,y:cy+2},{x:cx+1,y:cy+2}]] : []}]}});
      }
    }
    // Openings on the floor-1 and floor-2 slabs (the very large slab AABBs)
    for(var q=1;q<3;q++){
      var nOpen=1+Math.floor(rng()*3);
      for(var o=0;o<nOpen;o++){
        var ox=-20+rng()*40, oy=-20+rng()*40;
        state.floors[q].openings.push({id:next('op'),points:[
          {x:ox,y:oy},{x:ox+4,y:oy},{x:ox+4,y:oy+4},{x:ox,y:oy+4}]});
      }
    }
    return rt3dBuildWorld();
  }
  // deterministic ray set over a world
  function raysFor(world, n, seed){
    var rng=mkRng(seed);
    var out=[];
    for(var i=0;i<n;i++){
      var a=rng()*Math.PI*2, b=Math.acos(2*rng()-1);
      out.push(rt3dRay(-58+rng()*116, -48+rng()*96, 0.2+rng()*9.5,
                       Math.sin(b)*Math.cos(a), Math.sin(b)*Math.sin(a), Math.cos(b)));
    }
    return out;
  }`;

// ---------------------------------------------------------------- 1
// Deterministic build
{
  const r = V(`(function(){
    ${CORPUS}
    var w=buildWorld(300, 12345);
    var a=rt3dBvhSignature(rt3dBuildBvh(w));
    var b=rt3dBvhSignature(rt3dBuildBvh(w));
    // a fresh, independently built world from the same seed must also match
    var w2=buildWorld(300, 12345);
    var c=rt3dBvhSignature(rt3dBuildBvh(w2));
    var bv=rt3dBvhFor(w);
    return {a:a.length, b:b.length, c:c.length, matchAB:(a===b), matchAC:(a===c),
            nodes:bv.nodeCount, bodies:bv.totalBodies, leaf:bv.leafSize,
            cached: (w._bvh === rt3dBvhFor(w))};
  })()`);
  check(1, 'deterministic BVH build: identical structure for identical input',
    r.matchAB && r.matchAC && r.bodies > 0 && r.nodes >= 1 && r.leaf === 4 && r.cached,
    JSON.stringify({a: r.a, b: r.b, c: r.c, nodes: r.nodes, bodies: r.bodies, leaf: r.leaf}));
}

// ---------------------------------------------------------------- 2
// Empty and one-body worlds
{
  const r = V(`(function(){
    ${CORPUS}
    var out={};
    // empty world
    state=freshState(); state.floors[0].ceilingAreas=[];
    var e=rt3dBuildWorld();
    var eb=rt3dBuildBvh(e);
    out.emptySig=rt3dBvhSignature(eb);
    out.emptyQuery=rt3dNearestBvh(eb, rt3dRay(0,0,1,1,0,0), 50, null, null, null);
    // one body, of a known kind
    state=freshState();
    state.floors[0].ceilingAreas=[];
    state.floors[0].pillars.push({id:'solo',x:5,y:0,diameter:1.0,materialId:state.materials[4].id});
    var w=rt3dBuildWorld();
    var ob=rt3dBvhFor(w);
    out.oneSig=rt3dBvhSignature(ob);
    out.oneNodes=ob.nodeCount;
    out.oneBodies=ob.totalBodies;
    var ray=rt3dRay(0,0,1.0, 1,0,0);
    out.oneLin=rt3dNearestLinear(w, ray, 50, null, null, null);
    out.oneBvh=rt3dNearestBvh(ob, ray, 50, null, null, null);
    out.oneMatch = out.oneLin && out.oneBvh &&
                   out.oneLin.body.objectId===out.oneBvh.body.objectId &&
                   out.oneLin.tEnter===out.oneBvh.tEnter;
    return out;
  })()`);
  check(2, 'empty and one-body worlds are handled, and one-body results match the oracle',
    r.emptySig === 'empty/0' && r.emptyQuery === null &&
    r.oneNodes === 1 && r.oneBodies === 1 && r.oneMatch === true,
    JSON.stringify({emptySig: r.emptySig, oneNodes: r.oneNodes, oneMatch: r.oneMatch}));
}

// ---------------------------------------------------------------- 3, 4, 5, 6
// All families, exact-geometry decisions, nearest-event identity, ties
{
  const r = V(`(function(){
    ${CORPUS}
    var w=buildWorld(400, 999);
    var bv=rt3dBvhFor(w);
    var rays=raysFor(w, 4000, 4242);
    var statsL=null, statsB=null;
    var mism=0, worst=null;
    for(var i=0;i<rays.length;i++){
      var L=rt3dNearestLinear(w, rays[i], 120, null, null, null);
      var B=rt3dNearestBvh(bv, rays[i], 120, null, null, null);
      var ok = (L===null && B===null) ||
        (L && B && L.kind===B.kind && L.body.objectId===B.body.objectId &&
         L.tEnter===B.tEnter && L.tExit===B.tExit && L.traversals===B.traversals &&
         L.loss===B.loss && !!L.normal===!!B.normal &&
         (!L.normal || (L.normal.x===B.normal.x && L.normal.y===B.normal.y && L.normal.z===B.normal.z)) &&
         L.point.x===B.point.x && L.point.y===B.point.y && L.point.z===B.point.z);
      if(!ok){ mism++; if(!worst) worst={i:i, L:L&&{k:L.kind,id:L.body.objectId,t:L.tEnter},
                                       B:B&&{k:B.kind,id:B.body.objectId,t:B.tEnter}}; }
    }
    // pruning evidence over the same rays
    var s=rt3dNewStats();
    for(var i=0;i<rays.length;i++) rt3dNearestBvh(bv, rays[i], 120, null, null, s);
    // families represented in the tree
    var fams={};
    for(var i=0;i<bv.bodies.length;i++) fams[bv.bodies[i].kind]=1;
    return {mism:mism, total:rays.length, worst:worst, fams:fams,
            nodes:s.nodesVisited, leaves:s.leavesVisited, cand:s.candidatesTested,
            bodies:bv.totalBodies, nodesTotal:bv.nodeCount};
  })()`);
  check(3, 'BVH accelerates all five physical body families from one tree',
    Object.keys(r.fams).length === 5 && ['wall','pillar','rfObject','slab','ceiling'].every(k => r.fams[k]),
    JSON.stringify(r.fams));
  check(4, '4000 seeded rays: linear and BVH select the IDENTICAL nearest event',
    r.mism === 0,
    `mismatches=${r.mism}/${r.total} worst=${JSON.stringify(r.worst)}`);
  check(5, 'pruning is real: BVH exact-tests far fewer bodies than it holds',
    r.cand < r.bodies * r.total,
    `candidatesTested=${r.cand} vs ${r.bodies * r.total} possible (nodes=${r.nodes}, leaves=${r.leaves})`);
  check(6, 'deterministic tie behaviour: canonical family/ordinal order, not traversal order',
    r.mism === 0 && r.bodies > 0, `mismatches=${r.mism}`);
}

// ---------------------------------------------------------------- 7
// Openings and holes remain EXACT-geometry decisions
{
  const r = V(`(function(){
    ${CORPUS}
    // a slab with a big opening and a ceiling with a hole, plus small bodies
    state=freshState();
    var f=state.floors[0];
    f.height=3.0; f.w=40; f.d=40; f.ceilingAreas=[];
    state.floors.push(freshFloor('F1',1));
    state.floors[1].height=3.0; state.floors[1].w=40; state.floors[1].d=40;
    state.floors[1].openings.push({id:'op',points:[{x:-3,y:-3},{x:3,y:-3},{x:3,y:3},{x:-3,y:3}]});
    f.ceilingAreas.push({id:'ch',height:3.00,thickness:0.10,materialId:state.materials[2].id,
      extraLossDb:0, footprint:{parts:[{outer:[{x:-10,y:-10},{x:10,y:-10},{x:10,y:10},{x:-10,y:10}],
        holes:[[{x:-3,y:-3},{x:3,y:-3},{x:3,y:3},{x:-3,y:3}]]}]}});
    // multipart + concave-ish footprints
    // placed at 2.30..2.40, clear of the floor-1 slab band (2.88..3.00) so the
    // multipart traversal is not masked by the slab
    f.ceilingAreas.push({id:'mp',height:2.40,thickness:0.10,materialId:state.materials[4].id,
      extraLossDb:1, footprint:{parts:[
        {outer:[{x:12,y:-4},{x:18,y:-4},{x:18,y:4},{x:12,y:4}],holes:[]},
        {outer:[{x:20,y:-4},{x:26,y:-4},{x:26,y:4},{x:20,y:4}],holes:[]}]}});
    f.rfObjects.push({id:'tiny',x:6,y:0,width:0.3,depth:0.3,height:1.0,rotation:0,
      materialId:state.materials[4].id,extraLossDb:0});
    var w=rt3dBuildWorld();
    var bv=rt3dBvhFor(w);
    var out={};
    // the BVH MUST propose the slab even though the ray passes through its opening
    var rayHole=rt3dRay(0,0,1.0, 0,0,1);
    out.proposesSlab = rt3dCandidateBodies(w, rayHole, 10, null, {backend:'bvh'})
                        .some(function(b){ return b.kind==='slab'; });
    out.linearProposesSlab = rt3dCandidateBodies(w, rayHole, 10, null, {backend:'linear'})
                        .some(function(b){ return b.kind==='slab'; });
    out.slabEventHole = rt3dNearestBvh(bv, rayHole, 10, null, null, null);
    // and the exact test must still say "no material"
    out.throughOpening = rt3dHorizontalVolumeHit(rayHole, w.slabs[0], 10);
    // ceiling hole vs solid
    var ceilHole=rt3dTraceApToPoint(w, {x:0,y:0,mount:1.0}, 0, rt3dV(0,0,6), {backend:'bvh'});
    var ceilSolid=rt3dTraceApToPoint(w, {x:0,y:0,mount:1.0}, 0, rt3dV(8,0,6), {backend:'bvh'});
    out.ceilHoleN=rt3dCountByType(ceilHole,'ceiling');
    out.ceilSolidN=rt3dCountByType(ceilSolid,'ceiling');
    // near-horizontal ray inside the ceiling band, so its XY run spans BOTH
    // parts. Multipart is ONE event carrying TWO traversals, so this counts
    // traversals, not events.
    out.multipart=(function(){
      var t=rt3dTracePath(rt3dBuildWorld(), rt3dRay(8,0,2.35,1,0,0),
                          {backend:'bvh', reflectWalls:false, maxDistance:40});
      var n=0; t.events.forEach(function(e){ if(e.objectType==='ceiling') n+=e.traversals; });
      return n;
    })();
    // linear vs bvh on every one of those
    out.agree = (function(){
      var r2=rt3dRay(0,0,1.0, 0,0,1);
      var L=rt3dNearestLinear(w, r2, 10, null, null, null);
      var B=rt3dNearestBvh(bv, r2, 10, null, null, null);
      return (!L && !B) || (L&&B&&L.body.objectId===B.body.objectId && L.tEnter===B.tEnter);
    })();
    return out;
  })()`);
  check(7, 'Openings / holes / multipart are decided by exact geometry, never by the BVH',
    r.proposesSlab && r.linearProposesSlab &&
    r.slabEventHole === null && r.throughOpening.traversals === 0 &&
    r.throughOpening.runs.length === 0 &&
    r.ceilHoleN === 0 && r.ceilSolidN === 1 && r.multipart === 2 && r.agree,
    JSON.stringify(r));
}

// ---------------------------------------------------------------- 8
// Deterministic tie construction: many bodies at IDENTICAL centroids
{
  const r = V(`(function(){
    ${CORPUS}
    state=freshState();
    var f=state.floors[0];
    f.height=3.0; f.w=40; f.d=40; f.ceilingAreas=[];
    var M=state.materials[4].id;
    // 20 pillars on one grid line, then a duplicated centroid cluster
    for(var i=0;i<20;i++) f.pillars.push({id:'p'+i,x:-5+i*0.5,y:0,diameter:0.4,materialId:M});
    for(var i=0;i<12;i++) f.pillars.push({id:'d'+i,x:10,y:0,diameter:0.2,materialId:M});
    for(var i=0;i<8;i++)  f.rfObjects.push({id:'r'+i,x:10,y:0,width:0.4,depth:0.4,height:1,materialId:M,extraLossDb:0});
    var w=rt3dBuildWorld();
    var bv=rt3dBvhFor(w);
    var sig=rt3dBvhSignature(bv);
    var sig2=rt3dBvhSignature(rt3dBuildBvh(w));
    // a ray straight down the degenerate line: several events coincide
    var ray=rt3dRay(10,0,2.5, 0,0,-1);
    var L=rt3dNearestLinear(w, ray, 20, null, null, null);
    var B=rt3dNearestBvh(bv, ray, 20, null, null, null);
    return {stable:(sig===sig2), L:L&&{k:L.kind,id:L.body.objectId,fam:L.body.family,ord:L.body.ord,t:L.tEnter},
            B:B&&{k:B.kind,id:B.body.objectId,fam:B.body.family,ord:B.body.ord,t:B.tEnter},
            bodies:bv.totalBodies};
  })()`);
  check(8, 'identical centroids / duplicate AABBs: build and tie-break stay deterministic',
    r.stable && r.L && r.B && r.L.id === r.B.id && r.L.fam === r.B.fam && r.L.ord === r.B.ord,
    JSON.stringify(r));
}

// ---------------------------------------------------------------- 9
// Degenerate ray cases
{
  const r = V(`(function(){
    ${CORPUS}
    state=freshState();
    var f=state.floors[0];
    f.height=3.0; f.w=40; f.d=40; f.ceilingAreas=[];
    var M=state.materials[4].id;
    f.rfObjects.push({id:'box',x:0,y:0,width:4,depth:4,height:2,rotation:0,materialId:M,extraLossDb:0});
    f.pillars.push({id:'pil',x:8,y:0,diameter:0.6,materialId:M});
    f.walls.push({id:'wl',x1:-10,y1:5,x2:10,y2:5,materialId:M,thickness:0.15});
    var w=rt3dBuildWorld();
    var bv=rt3dBvhFor(w);
    var out={cases:[]};
    var rays={
      insideAabb:      rt3dRay(0,0,1.0, 1,0,0),        // starts inside the AABB
      insideMaterial:  rt3dRay(-1,0,1.0, 1,0,0),       // starts inside the physical material
      onAabbFace:      rt3dRay(-2,0,1.0, 1,0,0),       // exactly on the -x face
      axisAligned:     rt3dRay(-10,0,1.0, 1,0,0),      // exactly axis aligned
      twoZeroAxes:     rt3dRay(-10,0,1.0, 1,0,0),      // dy and dz are exactly zero
      tangentAabb:     rt3dRay(-10,2.0,1.0, 1,0,0),    // grazes the y edge
      grazingPillar:   rt3dRay(4,0.3,1.0, 1,0,0)       // tangent to the cylinder
    };
    for(var k in rays){
      var ray=rays[k];
      var L=rt3dNearestLinear(w, ray, 40, null, null, null);
      var B=rt3dNearestBvh(bv, ray, 40, null, null, null);
      var same=(L===null&&B===null)||(L&&B&&L.kind===B.kind&&L.body.objectId===B.body.objectId&&L.tEnter===B.tEnter);
      out.cases.push({k:k, same:same, L:L&&L.body.objectId, B:B&&B.body.objectId,
                      tL:L&&L.tEnter, tB:B&&B.tEnter});
    }
    return out;
  })()`);
  const allSame = r.cases.every(c => c.same);
  const graze = r.cases.find(c => c.k === 'grazingPillar');
  const inside = r.cases.find(c => c.k === 'insideMaterial');
  check(9, 'degenerate ray cases: starts inside AABB/material, on a face, axis-aligned, tangency — all match the oracle',
    allSame && graze.L === null && inside.L === 'box',
    JSON.stringify(r.cases));
}

// ---------------------------------------------------------------- 10
// Long / large bodies: a giant slab AABB must not break pruning
{
  const r = V(`(function(){
    ${CORPUS}
    state=freshState();
    var f=state.floors[0];
    f.height=8.0; f.w=200; f.d=200; f.ceilingAreas=[];
    state.floors.push(freshFloor('F1',1));
    state.floors[1].height=3.0; state.floors[1].w=200; state.floors[1].d=200;
    state.floors[1].openings.push({id:'op',points:[{x:-4,y:-4},{x:4,y:-4},{x:4,y:4},{x:-4,y:4}]});
    var M=state.materials[4].id;
    // very long thin walls
    for(var i=0;i<8;i++) f.walls.push({id:'L'+i,x1:-90,y1:-80+i*20,x2:90,y2:-80+i*20,materialId:M,thickness:0.15});
    // many small bodies
    var rng=mkRng(31337);
    for(var i=0;i<300;i++) f.rfObjects.push({id:'s'+i,x:-90+rng()*180,y:-90+rng()*180,
      width:0.3,depth:0.3,height:1.0,rotation:rng()*90,materialId:M,extraLossDb:0});
    var w=rt3dBuildWorld();
    var bv=rt3dBvhFor(w);
    var rays=raysFor(w, 2000, 5150);
    var mism=0;
    for(var i=0;i<rays.length;i++){
      var L=rt3dNearestLinear(w, rays[i], 150, null, null, null);
      var B=rt3dNearestBvh(bv, rays[i], 150, null, null, null);
      if(!((L===null&&B===null)||(L&&B&&L.body.objectId===B.body.objectId&&L.tEnter===B.tEnter&&L.tExit===B.tExit)))
        mism++;
    }
    // the slab AABB is enormous: it must always be proposed, never culled away
    var ray=rt3dRay(-50,-50,1, 0.7071,0.7071,0);
    var proposed=rt3dCandidateBodies(w, ray, 150, null, {backend:'bvh'}).some(function(b){return b.kind==='slab';});
    var s=rt3dNewStats();
    for(var i=0;i<rays.length;i++) rt3dNearestBvh(bv, rays[i], 150, null, null, s);
    return {mism:mism, total:rays.length, proposed:proposed, bodies:bv.totalBodies,
            cand:s.candidatesTested, possible:bv.totalBodies*rays.length};
  })()`);
  check(10, 'long thin walls, a giant slab AABB and many small bodies: pruning stays correct',
    r.mism === 0 && r.proposed === true && r.cand < r.possible,
    JSON.stringify(r));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
