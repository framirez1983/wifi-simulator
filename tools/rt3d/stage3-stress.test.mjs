// Stage 3 item 9: differential stress testing.
//
// A seeded corpus at 25 / 100 / 500 / 1200+ bodies, thousands of rays each.
// For every ray the linear ORACLE and the BVH must select the identical
// physical event, and for a subset the COMPLETE PATH must be identical too.
// Math.random is never used: every world and ray comes from a fixed seed, so
// any mismatch is reproducible and is a correctness bug, not noise.
import { loadApp, run, blankState } from './loader.mjs';

const sb = loadApp();
blankState(sb);
let fail = 0;
const ok = (n, c, d) => { if (c) console.log('  ok   ' + n); else { fail++; console.log('  FAIL ' + n + (d ? ' :: ' + d : '')); } };

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
    f.height=9.0; f.w=160; f.d=140; f.ceilingAreas=[];
    f.aps.push(makeAP(-70,-60,'AP-1',9.0));
    var M=state.materials[4].id, G=state.materials[2].id;
    var id=0, next=function(p){ id++; return p+id; };
    for(var k=1;k<4;k++){ state.floors.push(freshFloor('F'+k,k));
      state.floors[k].height=3.0; state.floors[k].w=160; state.floors[k].d=140;
      state.floors[k].ceilingAreas=[]; }
    for(var i=0;i<n;i++){
      var kind=rng();
      if(kind<0.28){ var x=-76+rng()*152, y=-66+rng()*132, len=5+rng()*34, a=rng()*Math.PI;
        f.walls.push({id:next('w'),x1:x,y1:y,x2:x+Math.cos(a)*len,y2:y+Math.sin(a)*len,
          materialId:rng()<0.5?M:G, thickness:0.15, height: rng()<0.35? (0.8+rng()*2.2) : null}); }
      else if(kind<0.48){ f.pillars.push({id:next('p'),x:-76+rng()*152,y:-66+rng()*132,
          diameter:0.25+rng()*1.4, materialId:M}); }
      else if(kind<0.76){ f.rfObjects.push({id:next('o'),x:-76+rng()*152,y:-66+rng()*132,
          width:0.3+rng()*2.4, depth:0.3+rng()*1.8, height:0.4+rng()*7.0,
          rotation:rng()*180, materialId:rng()<0.5?M:G, extraLossDb:rng()*2}); }
      else { var cx=-72+rng()*144, cy=-62+rng()*124;
        f.ceilingAreas.push({id:next('c'),height:2.2+rng()*5.0, thickness:0.10,
          materialId:G, extraLossDb:rng(),
          footprint:{parts:[{outer:[{x:cx,y:cy},{x:cx+3+rng()*10,y:cy},
                                      {x:cx+3+rng()*10,y:cy+3+rng()*10},{x:cx,y:cy+3+rng()*10}],
            holes: rng()<0.45? [[{x:cx+1,y:cy+1},{x:cx+2,y:cy+1},{x:cx+2,y:cy+2},{x:cx+1,y:cy+2}]] : []}]}}); }
    }
    for(var q=1;q<4;q++){
      var no=1+Math.floor(rng()*3);
      for(var o=0;o<no;o++){ var ox=-30+rng()*60, oy=-30+rng()*60;
        state.floors[q].openings.push({id:next('op'),points:[
          {x:ox,y:oy},{x:ox+5,y:oy},{x:ox+5,y:oy+5},{x:ox,y:oy+5}]}); }
    }
    return rt3dBuildWorld();
  }
  function raysFor(n, seed){
    var rng=mkRng(seed), out=[];
    for(var i=0;i<n;i++){
      var a=rng()*Math.PI*2, b=Math.acos(2*rng()-1);
      out.push(rt3dRay(-74+rng()*148, -64+rng()*128, 0.15+rng()*10.0,
                       Math.sin(b)*Math.cos(a), Math.sin(b)*Math.sin(a), Math.cos(b)));
    }
    return out;
  }`;

console.log('Stage 3 — differential stress: linear oracle vs BVH\n');

const SIZES = [
  { n: 25, rays: 3000, paths: 150 },
  { n: 100, rays: 3000, paths: 150 },
  { n: 500, rays: 3000, paths: 150 },
  { n: 1200, rays: 3000, paths: 150 },
];

let totalRays = 0, totalPaths = 0, totalMism = 0;
for (const { n, rays, paths } of SIZES) {
  const r = JSON.parse(run(sb, `JSON.stringify((function(){
    ${PRNG}
    var world=buildWorld(${n}, 20260101);
    var bvh=rt3dBuildBvh(world);
    var rs=raysFor(${rays}, 777001);
    var mism=0, firstBad=null, hits=0;
    for(var i=0;i<rs.length;i++){
      var L=rt3dNearestLinear(world, rs[i], 160, null, null, null);
      var B=rt3dNearestBvh(bvh, rs[i], 160, null, null, null);
      if(L) hits++;
      var same=(L===null&&B===null)||(L&&B&&
        L.kind===B.kind && L.body.objectId===B.body.objectId &&
        L.tEnter===B.tEnter && L.tExit===B.tExit &&
        L.traversals===B.traversals && L.loss===B.loss &&
        L.point.x===B.point.x && L.point.y===B.point.y && L.point.z===B.point.z &&
        (!!L.normal)===(!!B.normal) &&
        (!L.normal || (L.normal.x===B.normal.x && L.normal.y===B.normal.y && L.normal.z===B.normal.z)));
      if(!same){ mism++; if(!firstBad) firstBad={i:i,
        L:L&&{k:L.kind,id:L.body.objectId,t:L.tEnter},
        B:B&&{k:B.kind,id:B.body.objectId,t:B.tEnter}}; }
    }
    // complete paths over a subset
    var pMism=0, pFirst=null, pEvents=0;
    for(var i=0;i<${paths};i++){
      var ray=rs[i*7 % rs.length];
      var a=rt3dTracePath(world, ray, {backend:'linear', maxDistance:140, maxReflections:2});
      var b=rt3dTracePath(world, ray, {backend:'bvh',    maxDistance:140, maxReflections:2});
      pEvents += a? a.events.length : 0;
      var ka=JSON.stringify(a&&a.events.map(function(e){return [e.type,e.objectType,e.objectId,e.distance,e.loss,e.traversals,!!e.reflected];}));
      var kb=JSON.stringify(b&&b.events.map(function(e){return [e.type,e.objectType,e.objectId,e.distance,e.loss,e.traversals,!!e.reflected];}));
      var sa=JSON.stringify([a&&a.totalMaterialLoss, a&&a.totalDistance, a&&a.terminated, a&&a.finalRay]);
      var sb2=JSON.stringify([b&&b.totalMaterialLoss, b&&b.totalDistance, b&&b.terminated, b&&b.finalRay]);
      if(ka!==kb || sa!==sb2){ pMism++; if(!pFirst) pFirst={i:i, a:ka, b:kb}; }
    }
    return {bodies:bvh.totalBodies, nodes:bvh.nodeCount, rays:rs.length, hits:hits,
            mism:mism, firstBad:firstBad, pMism:pMism, pFirst:pFirst, pEvents:pEvents};
  })())`));

  totalRays += r.rays; totalPaths += paths; totalMism += r.mism + r.pMism;
  ok(`${String(r.bodies).padStart(5)} bodies: ${r.rays} rays, identical nearest event ` +
     `(${r.hits} hits, ${r.mism} mismatches) + ${paths} identical paths (${r.pEvents} events, ${r.pMism} mismatches)`,
     r.mism === 0 && r.pMism === 0,
     JSON.stringify({ firstBad: r.firstBad, pFirst: r.pFirst }));
}

console.log('');
console.log(`  total rays compared : ${totalRays}`);
console.log(`  total paths compared: ${totalPaths}`);
console.log(`  total mismatches    : ${totalMism}`);
console.log('');
console.log(fail === 0
  ? '  linear oracle and BVH are bit-identical on every event and every path'
  : `  ${fail} check(s) failed`);
process.exit(fail === 0 ? 0 : 1);
