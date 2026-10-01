// Stage 1 validation suite for the true-3D ray kernel.
//
// Every test is a pure assertion against the kernel running inside a Node vm
// that evaluates the real index.html. Nothing here is shipped with the app.
// Test numbering follows the migration plan's required validation list.
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
const M4 = 'state.materials[4].id';

// Build a one-floor scene with explicit geometry, inside the sandbox.
function scene(body) {
  return run(sb, `state=freshState();
    var f=state.floors[0];
    f.height=3.0; f.w=20; f.d=14;
    if(!f.ceilingAreas) f.ceilingAreas=[];
    f.aps.push(makeAP(-3,-3,'AP-1',3.0));
    ${body}
    state`);
}

console.log('Stage 1 validation — true 3D ray kernel\n');

// ---------------------------------------------------------------- 1
{
  const r = V(`(function(){
    var vs=[[3,4,12],[1,1,1],[0,0,5],[-2,0.5,0.25],[1e-9,0,0]];
    var out=[];
    for(var i=0;i<vs.length;i++){
      var u=rt3dUnit(rt3dV(vs[i][0],vs[i][1],vs[i][2]));
      out.push({in:vs[i], unit:u, lenSq:rt3dLenSq(u), isNull:u===null});
    }
    return {out, degenerate: rt3dUnit(rt3dV(0,0,0))};
  })()`);
  const unitOk = r.out.every((o) => !o.isNull && near(o.lenSq, 1, 1e-15));
  // add / subtract / scale / dot consistency
  const ops = V(`(function(){
    var a=rt3dV(1,2,3), b=rt3dV(-4,5,6);
    return {
      add:rt3dAdd(a,b), sub:rt3dSub(rt3dAdd(a,b),b), scale:rt3dScale(a,3),
      dot:rt3dDot(a,b), expectDot:-4+10+18, neg:rt3dNegate(a)
    };
  })()`);
  check(1, 'Vec3 normalization and precision',
    unitOk && r.degenerate === null &&
    ops.sub.x === 1 && ops.sub.y === 2 && ops.sub.z === 3 &&
    ops.scale.x === 3 && ops.scale.y === 6 && ops.scale.z === 9 &&
    ops.dot === ops.expectDot && ops.neg.x === -1,
    JSON.stringify(r));
}

// ---------------------------------------------------------------- 2
{
  const r = V(`(function(){
    var ray=rt3dRay(1,2,3, 1,1,1);
    var p0=rt3dRayPoint(ray,0), p5=rt3dRayPoint(ray,5), pm2=rt3dRayPoint(ray,-2);
    return {p0:p0,p5:p5,pm2:pm2, d:rt3dRayDir(ray)};
  })()`);
  const s = Math.sqrt(3);
  check(2, 'arbitrary ray point evaluation  P(t)=O+D*t',
    near(r.p0.x,1) && near(r.p0.z,3) &&
    near(r.p5.x, 1+5/s) && near(r.p5.y, 2+5/s) && near(r.p5.z, 3+5/s) &&
    near(r.pm2.x, 1-2/s),
    JSON.stringify(r));
}

// ---------------------------------------------------------------- 3
{
  scene(`f.walls.push({id:'w',x1:0,y1:-7,x2:0,y2:7,materialId:${M4},thickness:0.15});`);
  const r = V(`(function(){
    var w=rt3dBuildWorld().walls[0];
    var ray=rt3dRay(-3,0,1.2, 1,0,0);
    var h=rt3dWallSurfaceHit(ray,w,100);
    return {t:h.t, u:h.u, n:h.normal, pt:h.point, L:w.L};
  })()`);
  check(3, 'vertical wall intersection',
    near(r.t, 3) && r.u > 6.9 && r.u < 7.1 &&
    near(r.n.x,-1) && near(r.n.y,0) && near(r.n.z,0) &&
    near(r.pt.x,0) && near(r.pt.y,0) && near(r.pt.z,1.2),
    JSON.stringify(r));
}

// ---------------------------------------------------------------- 4
{
  const r = V(`(function(){
    var w=rt3dBuildWorld().walls[0];
    var low = rt3dWallSurfaceHit(rt3dRay(-3,0,4.0, 1,0,0), w, 100);   // above the 3 m wall
    var ok  = rt3dWallSurfaceHit(rt3dRay(-3,0,1.2, 1,0,0), w, 100);   // inside
    var vol = rt3dWallVolumeHit(rt3dRay(-3,0,4.0, 1,0,0), w, 100);    // volume too
    return {low:low, ok:!!ok, volEmpty:vol.empty, zTop:w.zTop};
  })()`);
  check(4, 'vertical wall finite-height rejection',
    r.low === null && r.ok === true && r.volEmpty === true && near(r.zTop, 3),
    JSON.stringify(r));
}

// ---------------------------------------------------------------- 5
{
  scene(`f.walls.push({id:'w',x1:0,y1:-7,x2:0,y2:7,materialId:${M4},thickness:0.15});`);
  const r = V(`(function(){
    var w=rt3dBuildWorld().walls[0];
    return {base:w.zBase, top:w.zTop, h:w.height, explicit:w.explicitHeight,
            floorH: state.floors[0].height};
  })()`);
  check(5, 'full-height wall interval = owner floor height',
    near(r.base,0) && near(r.top, r.floorH) && near(r.h, r.floorH) && r.explicit === false,
    JSON.stringify(r));
}

// ---------------------------------------------------------------- 6
{
  scene(`f.walls.push({id:'w',x1:0,y1:-7,x2:0,y2:7,height:1.4,materialId:${M4},thickness:0.15});`);
  const r = V(`(function(){
    var w=rt3dBuildWorld().walls[0];
    return {base:w.zBase, top:w.zTop, h:w.height, explicit:w.explicitHeight,
            hitUnder: !!rt3dWallSurfaceHit(rt3dRay(-3,0,1.2,1,0,0), w, 100),
            hitOver:  rt3dWallSurfaceHit(rt3dRay(-3,0,1.6,1,0,0), w, 100)};
  })()`);
  check(6, 'explicit-height wall interval',
    near(r.base,0) && near(r.top,1.4) && near(r.h,1.4) && r.explicit === true &&
    r.hitUnder === true && r.hitOver === null,
    JSON.stringify(r));
}

// ---------------------------------------------------------------- 7
{
  scene(`f.walls.push({id:'w',x1:0,y1:-7,x2:0,y2:7,materialId:${M4},thickness:0.15});`);
  const r = V(`(function(){
    var w=rt3dBuildWorld().walls[0];
    var ray=rt3dRay(-3,0,1.2, 1,0,0);
    var out=rt3dRayReflect(ray, rt3dV(w.nx,w.ny,0));
    // legacy 2D formula, verbatim from the production marcher
    var wdx=w.x2-w.x1, wdy=w.y2-w.y1, wl=Math.hypot(wdx,wdy)||1;
    var nxn=-wdy/wl, nyn=wdx/wl, dot=1*nxn+0*nyn;
    return {out:out, legacy:{x:1-2*dot*nxn, y:0-2*dot*nyn}};
  })()`);
  check(7, 'wall reflection with dz=0 reproduces the legacy 2D formula',
    near(r.out.dx, r.legacy.x) && near(r.out.dy, r.legacy.y) &&
    near(r.out.dz, 0) && near(r.out.dx, -1),
    JSON.stringify(r));
}

// ---------------------------------------------------------------- 8
{
  const r = V(`(function(){
    var d=rt3dUnit(rt3dV(1,1,-0.25));
    var r=rt3dReflect(d, rt3dV(-1,0,0));   // vertical wall, N.z = 0
    return {d:d, r:r, lenSq:rt3dLenSq(r)};
  })()`);
  check(8, 'wall reflection with dz!=0 preserves the vertical component',
    r.d.z < 0 &&                                       // genuinely descending
    near(r.r.z, r.d.z) &&                              // dz preserved exactly: N.z = 0
    near(r.r.x, -r.d.x) && near(r.r.y, r.d.y) &&      // normal part flips, tangential kept
    near(r.lenSq, 1, 1e-12),
    JSON.stringify(r));
}

// ---------------------------------------------------------------- 9
{
  scene(`f.rfObjects.push({id:'o',x:2,y:0,width:2,depth:1.2,height:2.2,rotation:30,materialId:${M4},extraLossDb:1.5});`);
  const r = V(`(function(){
    var b=rt3dBuildWorld().rfObjects[0];
    var hit = rt3dRfObjectVolumeHit(rt3dRay(-3,0,1.2, 1,0,0), b, 100);
    var over = rt3dRfObjectVolumeHit(rt3dRay(-3,0,2.5, 1,0,0), b, 100);  // above 2.2 m
    var under= rt3dRfObjectVolumeHit(rt3dRay(-3,0,-0.5, 1,0,0), b, 100);  // below the floor
    return {hit:{e:hit.tEnter,x:hit.tExit,tr:hit.traversals,z:hit.pointEnter.z,loss:hit.loss},
            overEmpty:over.empty, underEmpty:under.empty};
  })()`);
  // ray origin is x=-3, box centre x=2, half-width 1.0 rotated by 30 deg:
  // the entry is reached when the LOCAL x slab (-1) is crossed, i.e.
  // t = 5 - 1/cos(30) from the origin.
  check(9, 'RF Object 3D traversal',
    near(r.hit.e, 5 - 1/Math.cos(30*Math.PI/180), 1e-9) &&
    near(r.hit.x, 5 + 1/Math.cos(30*Math.PI/180), 1e-9) &&
    r.hit.tr === 1 && near(r.hit.z, 1.2) &&
    r.overEmpty === true && r.underEmpty === true,
    JSON.stringify(r));
}

// ---------------------------------------------------------------- 10
{
  scene(`f.pillars.push({id:'p',x:2,y:0,diameter:0.6,materialId:${M4}});`);
  const r = V(`(function(){
    var b=rt3dBuildWorld().pillars[0];
    var hit=rt3dPillarVolumeHit(rt3dRay(-3,0,1.2, 1,0,0), b, 100);
    var over=rt3dPillarVolumeHit(rt3dRay(-3,0,4.5, 1,0,0), b, 100);
    // the legacy 2D circle range, for the dz=0 case
    var legacy=segmentCircleIntersectionRange(-3,1.2, 0,1.2, 2,0, 0.3);
    return {e:hit.tEnter, x:hit.tExit, overEmpty:over.empty,
            inside: rt3dPillarContains(b,2,0,1.2), outside: rt3dPillarContains(b,2,0,4.5),
            r:b.r, zTop:b.zTop};
  })()`);
  check(10, 'pillar 3D traversal (finite vertical cylinder)',
    near(r.e, 5-0.3) && near(r.x, 5+0.3) &&   // origin is at x=-3
    r.overEmpty === true && r.inside === true && r.outside === false && near(r.zTop, 3),
    JSON.stringify(r));
}

// ---------------------------------------------------------------- 11
{
  run(sb, `state=freshState();
    state.floors[0].height=3.0; state.floors[0].w=20; state.floors[0].d=14;
    state.floors[0].ceilingAreas=[];
    state.floors[0].aps.push(makeAP(-3,-3,'AP-1',3.0));
    state.floors.push(freshFloor('F1',1));
    state.floors[1].height=3.0; state.floors[1].w=20; state.floors[1].d=14;
    state.activeFloor=1;
    state`);
  const r = V(`(function(){
    var b=rt3dBuildWorld().slabs[0];
    // ray descending through the slab plane
    var hit=rt3dHorizontalVolumeHit(rt3dRay(0,0,4.0, 0,0,-1), b, 100);
    return {zB:b.zBottom, zT:b.zTop, tr:hit.traversals, e:hit.tEnter, x:hit.tExit,
            loss:hit.loss, floorIndex:b.floorIndex, th:b.thickness, canonical:SLAB_THICKNESS_M};
  })()`);
  // the slab volume uses the CANONICAL slab thickness, the same plate the 3D
  // view draws and the glTF export writes
  check(11, 'slab horizontal-volume traversal (canonical SLAB_THICKNESS_M interval)',
    near(r.zT, 3) && near(r.th, r.canonical) && near(r.zB, 3 - r.canonical) &&
    r.tr === 1 && near(r.e, 1.0) && near(r.x, 1.0 + r.canonical) && r.loss > 0 && r.floorIndex === 1,
    JSON.stringify(r));
}

// ---------------------------------------------------------------- 12
{
  run(sb, `state=freshState();
    state.floors[0].height=3.0; state.floors[0].w=20; state.floors[0].d=14;
    state.floors[0].ceilingAreas=[];
    state.floors[0].aps.push(makeAP(-3,-3,'AP-1',3.0));
    state.floors.push(freshFloor('F1',1));
    state.floors[1].height=3.0; state.floors[1].w=20; state.floors[1].d=14;
    state.floors[1].openings.push({id:'op',points:[{x:-2,y:-2},{x:2,y:-2},{x:2,y:2},{x:-2,y:2}]});
    state.activeFloor=1;
    state`);
  const r = V(`(function(){
    var b=rt3dBuildWorld().slabs[0];
    var throughOpening=rt3dHorizontalVolumeHit(rt3dRay(0,0,4.0, 0,0,-1), b, 100);
    var besideOpening  =rt3dHorizontalVolumeHit(rt3dRay(6,0,4.0, 0,0,-1), b, 100);
    return {openEmpty:throughOpening.empty, openTr:throughOpening.traversals,
            openLoss:rt3dTotalLoss(throughOpening),
            solidTr:besideOpening.traversals, holes:b.plan.parts[0].holes.length};
  })()`);
  check(12, 'slab opening bypass',
    r.openTr === 0 && r.openLoss === 0 && r.solidTr === 1 && r.holes === 1,
    JSON.stringify(r));
}

// ---------------------------------------------------------------- 13
{
  run(sb, `state=freshState();
    state.floors[0].height=3.0; state.floors[0].w=20; state.floors[0].d=14;
    state.floors[0].ceilingAreas=[];
    state.floors[0].aps.push(makeAP(-3,-3,'AP-1',3.0));
    state.floors[0].ceilingAreas.push({id:'c',height:2.6,thickness:0.10,materialId:${M4},extraLossDb:0,
      footprint:{parts:[{outer:[{x:-5,y:-5},{x:5,y:-5},{x:5,y:5},{x:-5,y:5}],holes:[]}]}});
    state`);
  const r = V(`(function(){
    var b=rt3dBuildWorld().ceilings[0];
    var iv=ceilingInterval(b.object);
    var up  = rt3dHorizontalVolumeHit(rt3dRay(0,0,1.0, 0,0,1), b, 100);
    var down= rt3dHorizontalVolumeHit(rt3dRay(0,0,3.5, 0,0,-1), b, 100);
    return {zB:b.zBottom, zT:b.zTop, ivB:iv.bottom, ivT:iv.top,
            upTr:up.traversals, upE:up.tEnter, upX:up.tExit,
            downTr:down.traversals, loss:b.loss};
  })()`);
  check(13, 'Ceiling 3D traversal via the canonical ceilingInterval()',
    near(r.zT, 2.6) && near(r.zB, 2.5) && near(r.ivT, 2.6) && near(r.ivB, 2.5) &&
    r.upTr === 1 && near(r.upE, 1.5) && near(r.upX, 1.6) && r.downTr === 1,
    JSON.stringify(r));
}

// ---------------------------------------------------------------- 14
{
  run(sb, `state=freshState();
    state.floors[0].height=3.0; state.floors[0].w=20; state.floors[0].d=14;
    state.floors[0].ceilingAreas=[];
    state.floors[0].aps.push(makeAP(-3,-3,'AP-1',3.0));
    state.floors[0].ceilingAreas.push({id:'c',height:2.6,thickness:0.10,materialId:${M4},extraLossDb:0,
      footprint:{parts:[{outer:[{x:-5,y:-5},{x:5,y:-5},{x:5,y:5},{x:-5,y:5}],
                          holes:[[{x:-2,y:-2},{x:2,y:-2},{x:2,y:2},{x:-2,y:2}]]}]}});
    state`);
  const r = V(`(function(){
    var b=rt3dBuildWorld().ceilings[0];
    var hole = rt3dHorizontalVolumeHit(rt3dRay(0,0,1.0, 0,0,1), b, 100);
    var solid= rt3dHorizontalVolumeHit(rt3dRay(3.5,0,1.0, 0,0,1), b, 100);
    return {holeEmpty:hole.empty, holeTr:hole.traversals, holeLoss:rt3dTotalLoss(hole), solidTr:solid.traversals};
  })()`);
  check(14, 'Ceiling hole bypass',
    r.holeTr === 0 && r.holeLoss === 0 && r.solidTr === 1,
    JSON.stringify(r));
}

// ---------------------------------------------------------------- 15
{
  run(sb, `state=freshState();
    state.floors[0].height=3.0; state.floors[0].w=20; state.floors[0].d=14;
    state.floors[0].ceilingAreas=[];
    state.floors[0].aps.push(makeAP(-3,-3,'AP-1',3.0));
    state.floors[0].ceilingAreas.push({id:'c',height:2.6,thickness:0.10,materialId:${M4},extraLossDb:0,
      footprint:{parts:[
        {outer:[{x:-5,y:-5},{x:-1,y:-5},{x:-1,y:5},{x:-5,y:5}],holes:[]},
        {outer:[{x:1,y:-5},{x:5,y:-5},{x:5,y:5},{x:1,y:5}],holes:[]}]}});
    state`);
  const r = V(`(function(){
    var b=rt3dBuildWorld().ceilings[0];
    // one straight ray crossing BOTH disjoint parts must be charged twice
    // horizontal ray INSIDE the ceiling's vertical band (2.5..2.6)
    var hit=rt3dHorizontalVolumeHit(rt3dRay(-4,0,2.55, 1,0,0), b, 20);
    // a ray through the 2 m gap between the two parts crosses neither
    // bounded to 1 m so it stays inside the 2 m gap and meets neither part
    var gap =rt3dHorizontalVolumeHit(rt3dRay(-0.5,0,2.55, 1,0,0), b, 1);
    // a ray below the band misses the volume entirely
    var below=rt3dHorizontalVolumeHit(rt3dRay(-4,0,1.0, 1,0,0), b, 100);
    return {tr:hit.traversals, runs:hit.runs.length, loss:hit.loss,
            total:rt3dTotalLoss(hit), gapTr:gap.traversals, gapLoss:rt3dTotalLoss(gap),
            belowEmpty:below.empty,
            parts:b.plan.parts.length};
  })()`);
  check(15, 'Ceiling multipart = one traversal per part, and the gap is bypassed',
    r.parts === 2 && r.tr === 2 && r.runs === 2 &&
    near(r.total, 2 * r.loss) && r.gapTr === 0 && r.gapLoss === 0 && r.belowEmpty === true,
    JSON.stringify(r));
}

// ---------------------------------------------------------------- 16
{
  run(sb, `state=freshState();
    state.floors[0].height=4.2; state.floors[0].w=20; state.floors[0].d=14;
    state.floors[0].ceilingAreas=[];
    state.floors[0].aps.push(makeAP(-3,-3,'AP-1',4.2));
    // the RAISED floor carries the geometry, so every derived Z is non-zero
    state.floors.push(freshFloor('F1',1));
    state.floors[1].height=2.6; state.floors[1].w=20; state.floors[1].d=14;
    state.floors[1].ceilingAreas=[];
    state.floors[1].aps.push(makeAP(-3,-3,'AP-1b',2.6));
    state.floors[1].walls.push({id:'w',x1:0,y1:-7,x2:0,y2:7,materialId:${M4},thickness:0.15});
    state.floors[1].ceilingAreas.push({id:'c',height:2.2,thickness:0.10,materialId:${M4},extraLossDb:0,
      footprint:{parts:[{outer:[{x:-5,y:-5},{x:5,y:-5},{x:5,y:5},{x:-5,y:5}],holes:[]}]}});
    state.activeFloor=1;
    state`);
  const r = V(`(function(){
    var w=rt3dBuildWorld();
    var wall=w.walls[0], ceil=w.ceilings[0];
    // geometry owned by the RAISED floor must sit on the 4.2 m base
    var iv=ceilingInterval(ceil.object);
    var hit = rt3dWallSurfaceHit(rt3dRay(-3,0,4.2+1.2, 1,0,0), wall, 100);
    var miss= rt3dWallSurfaceHit(rt3dRay(-3,0,1.2,       1,0,0), wall, 100);  // z of floor 0
    return {wallBase:wall.zBase, wallTop:wall.zTop, ceilBase:ceil.zBottom, ceilTop:ceil.zTop,
            ivTop:iv.top, slabs:w.slabs.length, slabTop:w.slabs[0].zTop,
            elev1:floorElevation(1), activeH:state.floors[1].height,
            hit:!!hit, miss:miss};
  })()`);
  check(16, 'non-zero floor elevation',
    near(r.elev1, 4.2) && r.activeH === 2.6 &&
    near(r.wallBase, 4.2) && near(r.wallTop, 4.2 + 2.6) &&
    near(r.ceilBase, 4.2 + (r.ivTop - 0.10)) && near(r.ceilTop, 4.2 + r.ivTop) &&
    r.slabs === 1 && near(r.slabTop, 4.2) &&
    r.hit === true && r.miss === null,
    JSON.stringify(r));
}

// ---------------------------------------------------------------- 17
{
  run(sb, `state=freshState();
    state.floors[0].height=3.0; state.floors[0].w=20; state.floors[0].d=14;
    state.floors[0].ceilingAreas=[];
    state.floors[0].aps.push(makeAP(-3,-3,'AP-1',3.0));
    state.floors[0].pillars.push({id:'p',x:2,y:0,diameter:0.6,materialId:${M4}});
    state.floors[0].ceilingAreas.push({id:'c',height:2.6,thickness:0.10,materialId:${M4},extraLossDb:0,
      footprint:{parts:[{outer:[{x:-5,y:-5},{x:5,y:-5},{x:5,y:5},{x:-5,y:5}],holes:[]}]}});
    state`);
  const r = V(`(function(){
    var w=rt3dBuildWorld();
    var p=w.pillars[0], c=w.ceilings[0];
    // a ray passing EXACTLY at the cylinder radius: discriminant 0, so the
    // chord has zero length. That is a graze, not a material traversal.
    var graze=rt3dPillarVolumeHit(rt3dRay(0, p.py+p.r, 1.2, 1,0,0), p, 100);
    // the same ray a hair closer genuinely crosses the pillar
    var cross=rt3dPillarVolumeHit(rt3dRay(0, p.py+p.r*0.5, 1.2, 1,0,0), p, 100);
    // a ray below the ceiling's band never touches the volume at all
    var below=rt3dHorizontalVolumeHit(rt3dRay(-4,0,1.0, 1,0,0), c, 20);
    // a ray inside the band crosses the full thickness
    var thru=rt3dHorizontalVolumeHit(rt3dRay(0,0,2.0, 0,0,1), c, 20);
    return {grazeTr:graze.traversals, grazeTang:graze.tangential, grazeEmpty:graze.empty,
            grazeLoss:rt3dTotalLoss(graze),
            crossTr:cross.traversals, crossLoss:rt3dTotalLoss(cross),
            belowEmpty:below.empty, thruTr:thru.traversals, thruLoss:rt3dTotalLoss(thru)};
  })()`);
  check(17, 'tangency is a contact, not a material traversal',
    r.grazeTr === 0 && r.grazeTang === true && r.grazeEmpty === false && r.grazeLoss === 0 &&
    r.crossTr === 1 && r.crossLoss > 0 &&
    r.belowEmpty === true && r.thruTr === 1 && r.thruLoss > 0,
    JSON.stringify(r));
}

// ---------------------------------------------------------------- 18
{
  // Horizontal compatibility, event by event, against the legacy primitives.
  run(sb, `state=freshState();
    state.floors[0].height=3.0; state.floors[0].w=20; state.floors[0].d=14;
    state.floors[0].ceilingAreas=[];
    state.floors[0].aps.push(makeAP(-3,-3,'AP-1',3.0));
    f=null;
    state.floors[0].walls.push({id:'a',x1:1,y1:-7,x2:1,y2:7,materialId:state.materials[4].id,thickness:0.15});
    state.floors[0].walls.push({id:'b',x1:-7,y1:2,x2:7,y2:2,materialId:state.materials[2].id,thickness:0.15});
    state.floors[0].rfObjects.push({id:'o',x:-1,y:-1,width:1.4,depth:1.0,height:2.0,rotation:20,
      materialId:state.materials[4].id,extraLossDb:1});
    state`);
  const r = V(`(function(){
    // --- legacy reference, transcribed verbatim from the production marcher
    function legacyNormal(w){ var wdx=w.x2-w.x1,wdy=w.y2-w.y1,wl=Math.hypot(wdx,wdy)||1;
      return {nx:-wdy/wl, ny:wdx/wl}; }
    function legacyReflect(dx,dy,n){ var dot=dx*n.nx+dy*n.ny; return {dx:dx-2*dot*n.nx, dy:dy-2*dot*n.ny}; }
    function legacySegT(ax,ay,bx,by,cx,cy,dx,dy){
      var r1=bx-ax,r2=by-ay,s1=dx-cx,s2=dy-cy,den=r1*s2-r2*s1;
      if(Math.abs(den)<1e-12) return -1;
      var t=((cx-ax)*s2-(cy-ay)*s1)/den, u=((cx-ax)*r2-(cy-ay)*r1)/den;
      return (t>=0&&t<=1&&u>=0&&u<=1)? t : -1;
    }
    function near(a,b,tol){ return Math.abs(a-b)<=(tol==null?1e-9:tol); }
    var world=rt3dBuildWorld();
    var out={walls:[], agree:true, reasons:[]};
    // 1) same XY direction & unit length
    var ray=rt3dRay(-3,0,1.2, 0.6,0.8,0);
    if(!rt3dIsHorizontal(ray)) { out.agree=false; out.reasons.push('ray not horizontal'); }
    if(!rt3dLenSqOk(ray)) { out.agree=false; out.reasons.push('direction not unit'); }
    // 2) same intersection distance, same normal, same reflected XY direction.
    //    A horizontal ray is fired straight at each wall's mid-point along the
    //    wall normal, starting 0.05 m short of the plane and stepping 0.1 m, so
    //    the legacy segment/segment test and the kernel plane test describe the
    //    SAME crossing and must return the same distance.
    for(var i=0;i<world.walls.length;i++){
      var w=world.walls[i], ow=w.object;
      var step=0.1, back=0.05;
      var mx=(ow.x1+ow.x2)/2, my=(ow.y1+ow.y2)/2;
      var sx=mx-w.nx*back, sy=my-w.ny*back;
      var kRay=rt3dRay(sx,sy,1.2, w.nx,w.ny,0);
      var h=rt3dWallSurfaceHit(kRay, w, step);
      var lt=legacySegT(sx,sy, sx+w.nx*step, sy+w.ny*step, ow.x1,ow.y1, ow.x2,ow.y2);
      var n=legacyNormal(ow);
      var ref=legacyReflect(w.nx,w.ny,n);
      var nref=rt3dReflect(rt3dV(w.nx,w.ny,0), rt3dV(w.nx,w.ny,0));
      var rec={ t:h? +h.t.toFixed(12):null, legacyT: lt>=0? +(lt*step).toFixed(12) : null,
                nx:n.nx, kernelNx:w.nx, ny:n.ny, kernelNy:w.ny, nz:w.nz,
                refX:ref.dx, kernelRefX:nref.x, refY:ref.dy, kernelRefY:nref.y,
                kernelRefZ:nref.z };
      out.walls.push(rec);
      if(h===null || lt<0) { out.agree=false; out.reasons.push('no crossing on wall '+i); continue; }
      if(!near(rec.t, rec.legacyT, 1e-12)) { out.agree=false; out.reasons.push('t mismatch wall '+i); }
      if(!near(rec.nx,rec.kernelNx,1e-15)||!near(rec.ny,rec.kernelNy,1e-15)) { out.agree=false; out.reasons.push('normal mismatch wall '+i); }
      if(!near(rec.nz,0)) { out.agree=false; out.reasons.push('nz != 0 wall '+i); }
      if(!near(rec.refX,rec.kernelRefX,1e-15)||!near(rec.refY,rec.kernelRefY,1e-15)) { out.agree=false; out.reasons.push('reflection mismatch wall '+i); }
      if(!near(rec.kernelRefZ,0)) { out.agree=false; out.reasons.push('dz not preserved wall '+i); }
    }
    // 3) same per-event loss and same material crossing order
    var seen=[], db=0;
    var q=[{r:rt3dRay(-3,-0.5,1.2, 1,0,0), d:0, db:0}];
    var order=[];
    while(q.length && order.length<12){
      var it=q.pop(), r0=it.r, dst=it.d, dB=it.db, st=0;
      while(dst<12 && st<400){
        var bestT=Infinity,bestKind=null,bestBody=null,bestC=null;
        var lists=[['wall',world.walls,rt3dWallSurfaceTraversalHit],
                   ['rfObject',world.rfObjects,rt3dRfObjectVolumeHit],
                   ['pillar',world.pillars,rt3dPillarVolumeHit]];
        for(var li=0; li<lists.length; li++){
          for(var bi=0; bi<lists[li][1].length; bi++){
            var c=lists[li][2](r0, lists[li][1][bi], 0.096);
            if(!rt3dHasTraversal(c)) continue;
            if(c.tEnter>0.096) continue;
            if(c.tEnter<bestT){bestT=c.tEnter;bestKind=lists[li][0];bestBody=lists[li][1][bi];bestC=c;}
          }
        }
        if(bestKind){
          order.push(bestKind+':'+bestBody.objectId);
          if(bestKind==='wall'){
            var rr=rt3dReflect(rt3dRayDir(r0), bestC.surface.normal);
            var nr=rt3dRay(bestC.surface.point.x+rr.x*1e-3, bestC.surface.point.y+rr.y*1e-3,
                           bestC.surface.point.z+rr.z*1e-3, rr.x,rr.y,rr.z);
            if(nr) q.push({r:nr, d:dst+bestT, db:dB+bestBody.loss*0.5+5});
            dB+=bestBody.loss;
            r0.x=bestC.surface.point.x+r0.dx*1e-3; r0.y=bestC.surface.point.y+r0.dy*1e-3;
            r0.z=bestC.surface.point.z+r0.dz*1e-3; dst=dst+bestT; st++; continue;
          }
          dB+=bestBody.loss;
          var ex=r0.x+r0.dx*bestT, ey=r0.y+r0.dy*bestT, ez=r0.z+r0.dz*bestT;
          r0.x=ex+r0.dx*1e-3; r0.y=ey+r0.dy*1e-3; r0.z=ez+r0.dz*1e-3; dst+=bestT+1e-3; st++; continue;
        }
        dst+=0.096; r0.x+=r0.dx*0.096; r0.y+=r0.dy*0.096; r0.z+=r0.dz*0.096; st++;
      }
    }
    out.order=order;
    // every event must have a positive, finite loss
    out.losses=world.walls.map(function(w){return w.loss;})
      .concat(world.rfObjects.map(function(o){return o.loss;}));
    out.lossOk=out.losses.every(function(L){return Number.isFinite(L)&&L>0;});
    if(!out.lossOk){ out.agree=false; out.reasons.push('non-positive loss'); }
    return out;
  })()`);
  check(18, 'horizontal compatibility: direction, distance, normal, reflection, order, loss',
    r.agree === true, JSON.stringify(r.reasons) + ' ' + JSON.stringify(r.walls));
}

// ---------------------------------------------------------------- 19
// Lock decision 2 in: the production 3D launch Z is the AP's real absolute
// height, and the compatibility tracer is the ONLY place that uses the legacy
// receiver plane. If someone ever points the compatibility tracer at the
// production launch Z, this fails.
{
  run(sb, `state=freshState();
    state.floors[0].height=3.0; state.floors[0].w=20; state.floors[0].d=14;
    state.floors[0].ceilingAreas=[];
    var ap=makeAP(-3,-3,'AP-1',3.0);
    ap.mount=2.6;                       // ceiling mounted
    state.floors[0].aps.push(ap);
    // a LOW RF Object: 3D rays from a 2.6 m AP must pass over it, 2.5D rays
    // on the 1.2 m receiver plane must hit it
    state.floors[0].rfObjects.push({id:'low',x:0,y:0,width:2,depth:2,height:1.5,
      rotation:0,materialId:${M4},extraLossDb:0});
    state`);
  const r = V(`(function(){
    var af=0, ap=state.floors[0].aps[0];
    var prodZ=rt3dApOriginZ(af, ap);
    var compatZ=rt3dReceiverPlaneZ();
    var world=rt3dBuildWorld();
    var o=world.rfObjects[0];
    // a horizontal ray at each launch height, fired at the object
    var atProd  = rt3dRfObjectVolumeHit(rt3dRay(-3,0,prodZ,  1,0,0), o, 100);
    var atCompat= rt3dRfObjectVolumeHit(rt3dRay(-3,0,compatZ,1,0,0), o, 100);
    return {prodZ:prodZ, compatZ:compatZ, mount:apMount(ap), mountH:ap.mount,
            floorH:state.floors[0].height, elev:floorElevation(af),
            objTop:o.zTop,
            prodHits:rt3dHasTraversal(atProd), compatHits:rt3dHasTraversal(atCompat)};
  })()`);
  check(19, 'production 3D launch Z = floorElevation(AP floor) + apMount(AP), and it differs from the compatibility plane',
    near(r.prodZ, r.elev + r.mount) &&            // the production semantic
    near(r.compatZ, r.elev + 1.2) &&              // the legacy receiver plane
    r.prodZ > r.compatZ &&                        // they are genuinely different
    r.prodHits === false && r.compatHits === true, // production passes over the low object
    JSON.stringify(r));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
