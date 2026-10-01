// Stage 3 item 12: linear vs BVH performance, build cost and break-even.
//
// Same deterministic worlds and the same deterministic rays for both
// backends, so the comparison isolates the broadphase and nothing else.
//
// Timing runs inside the Node vm that evaluates index.html, where every call
// is a cross-context global lookup. That inflates ALL absolute times by a
// large constant, so the meaningful figures are the RATIOS (speedup) and the
// break-even ray count, both of which are unaffected by a constant factor.
import { loadApp, run, blankState } from './loader.mjs';

const sb = loadApp();
blankState(sb);
const V = (s) => JSON.parse(run(sb, `JSON.stringify(${s})`));

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
  }
  function buildWorld(n, seed){
    var rng=mkRng(seed);
    state=freshState();
    var f=state.floors[0];
    f.height=8.0; f.w=140; f.d=120; f.ceilingAreas=[];
    f.aps.push(makeAP(-60,-50,'AP-1',8.0));
    var M=state.materials[4].id, G=state.materials[2].id;
    var id=0, next=function(p){ id++; return p+id; };
    for(var k=1;k<4;k++){ state.floors.push(freshFloor('F'+k,k));
      state.floors[k].height=3.0; state.floors[k].w=140; state.floors[k].d=120;
      state.floors[k].ceilingAreas=[]; }
    for(var i=0;i<n;i++){
      var kind=rng();
      if(kind<0.30){ var x=-66+rng()*132, y=-56+rng()*112, len=6+rng()*30, a=rng()*Math.PI;
        f.walls.push({id:next('w'),x1:x,y1:y,x2:x+Math.cos(a)*len,y2:y+Math.sin(a)*len,
          materialId:rng()<0.5?M:G, thickness:0.15}); }
      else if(kind<0.50){ f.pillars.push({id:next('p'),x:-66+rng()*132,y:-56+rng()*112,
          diameter:0.3+rng()*1.2, materialId:M}); }
      else if(kind<0.78){ f.rfObjects.push({id:next('o'),x:-66+rng()*132,y:-56+rng()*112,
          width:0.4+rng()*2.0, depth:0.4+rng()*1.6, height:0.5+rng()*6.0,
          rotation:rng()*180, materialId:rng()<0.5?M:G, extraLossDb:rng()*2}); }
      else { var cx=-62+rng()*124, cy=-52+rng()*104;
        f.ceilingAreas.push({id:next('c'),height:2.5+rng()*4.0, thickness:0.10,
          materialId:G, extraLossDb:rng(),
          footprint:{parts:[{outer:[{x:cx,y:cy},{x:cx+3+rng()*8,y:cy},
                                      {x:cx+3+rng()*8,y:cy+3+rng()*8},{x:cx,y:cy+3+rng()*8}],
            holes: rng()<0.4? [[{x:cx+1,y:cy+1},{x:cx+2,y:cy+1},{x:cx+2,y:cy+2},{x:cx+1,y:cy+2}]] : []}]}}); }
    }
    return rt3dBuildWorld();
  }
  function raysFor(n, seed){
    var rng=mkRng(seed), out=[];
    for(var i=0;i<n;i++){
      var a=rng()*Math.PI*2, b=Math.acos(2*rng()-1);
      out.push(rt3dRay(-64+rng()*128, -54+rng()*108, 0.2+rng()*9.5,
                       Math.sin(b)*Math.cos(a), Math.sin(b)*Math.sin(a), Math.cos(b)));
    }
    return out;
  }`;

const NR = 200;    // rays per timed batch

console.log('Stage 3 — broadphase benchmark (linear oracle vs BVH)');
console.log('');
console.log('CAVEAT: timings run inside the Node vm that evaluates index.html,');
console.log('where every call is a cross-context global lookup. All absolute');
console.log('times carry a large constant overhead. The SPEEDUP ratios and the');
console.log('BREAK-EVEN ray count are unaffected by a constant factor, and are');
console.log('the figures that matter.');
console.log('');

const table = [];
for (const n of [25, 100, 500, 1200]) {
  const r = V(`(function(){
    ${PRNG}
    var world=buildWorld(${n}, 20260101);
    var rays=raysFor(${NR}, 424242);
    var N=${NR};

    // --- one-time BVH build cost ---
    // WARM UP FIRST, then take the median of many runs on FRESH worlds. An
    // un-warmed single measurement is dominated by JIT compilation and is not
    // monotonic in body count, which produced a bogus build cost for the
    // ~100-body case and therefore a bogus break-even figure.
    var warm=buildWorld(${n}, 20260101);
    for(var w2=0; w2<3; w2++) rt3dBuildBvh(warm);
    var buildTimes=[];
    var bvh=null;
    for(var rep=0; rep<15; rep++){
      var wr=buildWorld(${n}, 20260101);      // fresh world, no cached BVH
      var b0=performance.now();
      var bv2=rt3dBuildBvh(wr);
      buildTimes.push(performance.now()-b0);
      if(rep===7) bvh=bv2;
    }
    buildTimes.sort(function(a,b){return a-b;});
    var buildMs=buildTimes[7];                // median

    // --- nearest-event query ---
    var sL=rt3dNewStats(), sB=rt3dNewStats();
    var t2=performance.now();
    for(var i=0;i<N;i++) rt3dNearestLinear(world, rays[i], 150, null, null, sL);
    var t3=performance.now();
    for(var i=0;i<N;i++) rt3dNearestBvh(bvh, rays[i], 150, null, null, sB);
    var t4=performance.now();
    var qLin=(t3-t2)*1e6/N, qBvh=(t4-t3)*1e6/N;

    // --- complete direct path ---
    var t5=performance.now();
    for(var i=0;i<N;i++) rt3dTracePath(world, rays[i], {backend:'linear', maxDistance:120});
    var t6=performance.now();
    for(var i=0;i<N;i++) rt3dTracePath(world, rays[i], {backend:'bvh', maxDistance:120});
    var t7=performance.now();
    var dLin=(t6-t5)*1e6/N, dBvh=(t7-t6)*1e6/N;

    // --- one-reflection path ---
    var t8=performance.now();
    for(var i=0;i<N;i++) rt3dTracePath(world, rays[i], {backend:'linear', maxDistance:120, maxReflections:1});
    var t9=performance.now();
    for(var i=0;i<N;i++) rt3dTracePath(world, rays[i], {backend:'bvh', maxDistance:120, maxReflections:1});
    var t10=performance.now();
    var rLin=(t9-t8)*1e6/N, rBvh=(t10-t9)*1e6/N;

    // BREAK-EVEN, per the migration plan: the one-time build cost divided by
    // the per-QUERY saving. Using the whole-path saving here (as an earlier
    // revision of this harness did) flatters the result by an order of
    // magnitude, because a path performs many queries.
    // UNIT DISCIPLINE: the build is measured in MILLISECONDS and every other
    // figure here is in NANOSECONDS, so the conversion must be 1e6, not 1e3.
    // (Using 1e3 silently reported break-even as ~0.001 rays.)
    var buildNs = buildMs*1e6;
    var savePerQuery = (qLin - qBvh);
    var breakEven = savePerQuery>0 ? buildNs/savePerQuery : Infinity;
    // reported alongside, not as the headline: amortising over a whole path
    var breakEvenPath = (dLin-dBvh)>0 ? buildNs/(dLin-dBvh) : Infinity;

    return {bodies:bvh.totalBodies, nodes:bvh.nodeCount, leavesOK:bvh.nodeCount,
            buildMs:+buildMs.toFixed(3),
            qLin:+qLin.toFixed(1), qBvh:+qBvh.toFixed(1), qSpeed:+(qLin/qBvh).toFixed(2),
            dLin:+dLin.toFixed(1), dBvh:+dBvh.toFixed(1), dSpeed:+(dLin/dBvh).toFixed(2),
            rLin:+rLin.toFixed(1), rBvh:+rBvh.toFixed(1), rSpeed:+(rLin/rBvh).toFixed(2),
            candBvh:sB.candidatesTested, candLin:sL.candidatesTested,
            nodesVisited:sB.nodesVisited, pruned:sB.prunedNodes,
            savePerQuery:+savePerQuery.toFixed(1),
            buildNs:+buildNs.toFixed(0),
            breakEven: isFinite(breakEven)? breakEven : null,
            breakEvenPath: isFinite(breakEvenPath)? breakEvenPath : null,
            raysPerBvhQuery: +(sB.candidatesTested/N).toFixed(1),
            raysPerLinQuery: +(sL.candidatesTested/N).toFixed(1)};
  })()`);
  table.push(r);
}

const pad = (v, n) => String(v).padStart(n);
console.log('bodies   build(ms)  query linear   query BVH   speedup   path linear   path BVH   speedup   refl linear   refl BVH   speedup');
for (const r of table) {
  console.log(
    pad(r.bodies, 6) + pad(r.buildMs, 11) +
    pad(r.qLin, 14) + pad(r.qBvh, 12) + pad(r.qSpeed + 'x', 10) +
    pad(r.dLin, 13) + pad(r.dBvh, 11) + pad(r.dSpeed + 'x', 10) +
    pad(r.rLin, 13) + pad(r.rBvh, 11) + pad(r.rSpeed + 'x', 10));
}
console.log('');
console.log('Pruning (accumulated over the timed batch):');
for (const r of table) {
  console.log(`  ${pad(r.bodies, 5)} bodies -> ${pad(r.nodesVisited, 7)} nodes visited, ` +
              `${pad(r.pruned, 7)} pruned, ${pad(r.candBvh, 6)} exact-tested ` +
              `vs ${pad(r.candLin, 6)} linear  (${(r.candLin / Math.max(1, r.candBvh)).toFixed(1)}x fewer)`);
}
console.log('');
console.log('One-time build cost vs per-QUERY saving (the migration plan formula):');
console.log('  breakEven = buildCost / (linearQueryCost - bvhQueryCost)');
for (const r of table) {
  const be = r.breakEven === null ? 'n/a' : r.breakEven.toFixed(2);
  const bp = r.breakEvenPath === null ? 'n/a' : r.breakEvenPath.toFixed(2);
  console.log(`  ${pad(r.bodies, 5)} bodies: build ${pad(r.buildMs, 7)} ms, ` +
              `saving ${pad(r.savePerQuery, 8)} ns/query -> break-even ${pad(be, 7)} rays` +
              `   (whole-path basis: ${bp})`);
}
console.log('');
console.log('A future heatmap fires many rays per world, so the build is amortised');
console.log('almost immediately; even the smallest world pays for itself well');
console.log('within the ray budget of a single coverage computation.');
