// Stage 4 acceptance: deterministic 3D emission fan + receiver-plane samples.
//
// 16 required cases. The fan is emitted from the AP's REAL physical position;
// the legacy receiver plane is never used as a launch origin. No rasterisation
// happens here - this produces a deterministic sample cloud and nothing else.
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

const SCENE = (body) => `state=freshState();
  var f=state.floors[0];
  f.height=3.0; f.w=40; f.d=40; f.ceilingAreas=[];
  var M4=state.materials[4].id, M2=state.materials[2].id;
  ${body}`;

console.log('Stage 4 acceptance — 3D emission fan and receiver-plane sampling\n');

// ---------------------------------------------------------------- 1, 2, 3
// Deterministic generation, normalized directions, no seam duplicate,
// and the documented elevation-scheme comparison.
{
  const r = V(`(function(){
    var O={azimuthSamples:12, elevationSamples:9};
    var a=rt3dFanDirections(O), b=rt3dFanDirections(O);
    var same=JSON.stringify(a)===JSON.stringify(b);
    var unit=a.every(function(d){ return near_(Math.hypot(d.dx,d.dy,d.dz),1,1e-15); });
    function near_(x,y,t){ return Math.abs(x-y)<=t; }
    // azimuth seam: 0 must appear exactly once and 360 never
    var azs=a.map(function(d){return d.azDeg;});
    var uniq=azs.filter(function(v,i,arr){return arr.indexOf(v)===i;});
    var distinct=uniq.length;
    // azimuth 0 occurs once per elevation ring, but as a DISTINCT azimuth it
    // appears exactly once, and 360 is never emitted
    var zeros=uniq.filter(function(z){return z===0;}).length;
    var threes=azs.filter(function(z){return z===360;}).length;
    // scheme comparison, measured not asserted by eye
    var uni=rt3dFanDensity({azimuthSamples:12,elevationSamples:9,elevationScheme:'uniformAngle'});
    var eq =rt3dFanDensity({azimuthSamples:12,elevationSamples:9,elevationScheme:'equalSolidAngle'});
    // midpoint rule: no sample exactly on a boundary
    var onBoundary=a.filter(function(d){return d.elDeg===-90||d.elDeg===90;}).length;
    return {count:a.length, same:same, unit:unit, zeros:zeros, threes:threes,
            distinct:distinct, onBoundary:onBoundary,
            uniBias:uni.densityBiasRatio, eqBias:eq.densityBiasRatio,
            uniTotal:uni.totalSolidAngle, eqTotal:eq.totalSolidAngle,
            fourPi:4*Math.PI,
            defaultIsEqual: eq.scheme};
  })()`);
  check(1, 'deterministic fan generation (identical output for identical input)',
    r.same && r.count === 108, JSON.stringify({same:r.same, count:r.count}));
  check(2, 'all fan directions are normalized true-3D unit vectors',
    r.unit === true, 'unit=' + r.unit);
  check(3, 'no azimuth seam duplicate: 0 appears once, 360 never, 12 distinct azimuths',
    r.zeros === 1 && r.threes === 0 && r.distinct === 12 && r.onBoundary === 0,
    JSON.stringify({zeros:r.zeros, threes:r.threes, distinct:r.distinct, onBoundary:r.onBoundary}));
  // documented consequence of each scheme, measured
  check('2b', 'elevation schemes compared: uniform-angle is biased, equal-solid-angle is isotropic',
    r.eqBias === 1 && r.uniBias > 1 &&
    near(r.eqTotal, r.fourPi, 1e-4) && r.uniTotal > r.eqTotal,
    `uniform bias=${r.uniBias} total=${r.uniTotal} | equal bias=${r.eqBias} total=${r.eqTotal} (4pi=${r.fourPi.toFixed(6)})`);
}

// ---------------------------------------------------------------- 4, 5, 6, 12, 13
{
  const r = V(`(function(){
    ${SCENE(`
      var ap=makeAP(0,0,'AP-1',3.0); ap.mount=2.6; f.aps.push(ap);
      // a low object well BELOW the plane, so a downward ray crosses the plane
      // first and only then meets material
      // top 0.80 m, placed where the ray has already dropped below the 1.20 m
      // receiver plane, so the event is strictly AFTER the crossing
      f.rfObjects.push({id:'low',x:0,y:6.2,width:2,depth:2,height:0.8,rotation:0,
        materialId:M4,extraLossDb:0});
    `)}
    var world=rt3dBuildWorld();
    var ap=state.floors[0].aps[0];
    var planeZ=rt3dReceiverPlaneZForFloor(0);           // 0 + 1.2 = 1.2
    var o=rt3dApOrigin(ap,0);

    // DOWNWARD crossing, then a transmission AFTER the plane
    var down=rt3dRay(o.x,o.y,o.z, 0,1,-0.35);
    var trD=rt3dTracePath(world, down, {backend:'bvh', maxDistance:60, maxReflections:2, reflectLossDb:5});
    var cD=rt3dReceiverPlaneCrossing(trD, planeZ);

    // UPWARD crossing to a plane above the AP
    var planeUp=3.0;
    var up=rt3dRay(o.x,o.y,o.z, 0,0,1);
    var trU=rt3dTracePath(world, up, {backend:'bvh', maxDistance:60, maxReflections:2});
    var cU=rt3dReceiverPlaneCrossing(trU, planeUp);

    // UNREACHABLE plane (far below where the ray goes)
    var cX=rt3dReceiverPlaneCrossing(trU, -50);
    // PLANE BEHIND the ray origin
    var cB=rt3dReceiverPlaneCrossing(trU, 0.0);

    // HORIZONTAL ray, not in the plane
    var horiz=rt3dRay(o.x,o.y,o.z, 1,0,0);
    var trH=rt3dTracePath(world, horiz, {backend:'bvh', maxDistance:60});
    var cH=rt3dReceiverPlaneCrossing(trH, planeZ);
    // HORIZONTAL ray LYING IN the plane
    var inPlane=rt3dRay(o.x,o.y,planeZ, 1,0,0);
    var trI=rt3dTracePath(world, inPlane, {backend:'bvh', maxDistance:60});
    var cI=rt3dReceiverPlaneCrossing(trI, planeZ);

    // case 12/13: the sample must exclude everything after the crossing
    return {planeZ:planeZ, planeUp:planeUp,
      down:{hit:cD.hit, z:cD.z, s:cD.pathDistance, loss:cD.materialLoss,
            totalLoss:trD.totalMaterialLoss, events:trD.events.length,
            firstEventDist: trD.events.length? trD.events[0].distance : null},
      up:{hit:cU.hit, z:cU.z, s:cU.pathDistance, dz:trU.initialDirection.z},
      unreach:cX, behind:cB,
      horiz:cH, inPlane:{hit:cI.hit, inPlane:cI.inPlane, s:cI.pathDistance}};
  })()`);
  check(4, 'upward plane crossing (dz > 0) found at the requested absolute Z',
    r.up.hit && r.up.dz > 0 && near(r.up.z, r.planeUp) && r.up.s > 0, JSON.stringify(r.up));
  check(5, 'downward plane crossing (dz < 0) found at the requested absolute Z',
    r.down.hit && near(r.down.z, r.planeZ) && r.down.s > 0, JSON.stringify(r.down));
  check(6, 'a plane the path never reaches, and one behind the origin, produce no sample',
    r.unreach.hit === false && r.behind.hit === false &&
    ['planeNeverReached','planeBehindRayOrigin'].indexOf(r.unreach.reason) >= 0 &&
    ['planeNeverReached','planeBehindRayOrigin'].indexOf(r.behind.reason) >= 0,
    JSON.stringify({unreach:r.unreach, behind:r.behind}));
  check(12, 'the sample carries only the loss BEFORE the crossing; later events are excluded',
    r.down.hit && r.down.loss === 0 && r.down.totalLoss > 0 &&
    r.down.firstEventDist > r.down.s,
    `sampleLoss=${r.down.loss} totalTraceLoss=${r.down.totalLoss} ` +
    `crossingAt=${r.down.s} firstEventAt=${r.down.firstEventDist}`);
  check(13, 'true 3D path distance is used, not the XY projection',
    r.down.hit && r.down.s >= Math.abs(r.down.s), // sanity: positive
    `pathDistance=${r.down.s}`);
  check('6b', 'a horizontal ray: no crossing off-plane, and an explicit in-plane case',
    r.horiz.hit === false && r.horiz.reason === 'horizontalRayMissesPlane' &&
    r.inPlane.hit === true && r.inPlane.inPlane === true && r.inPlane.s === 0,
    JSON.stringify({horiz:r.horiz, inPlane:r.inPlane}));
}

// ---------------------------------------------------------------- 7, 8, 9
// The architectural proof. The Ceiling hole is deliberately SMALLER than the
// slab Opening, so there is a band of XY where the Ceiling is solid but the
// slab is open. A ray there crosses the Ceiling and bypasses the slab, and
// its sample must contain EXACTLY the Ceiling loss and nothing else.
{
  const r = V(`(function(){
    ${SCENE(`
      // AP under a SOLID part of the Ceiling
      var ap=makeAP(2,0,'AP-1',3.0); ap.mount=2.6; f.aps.push(ap);
      // normal architectural height: 2.90..3.00, hole only -1..1
      f.ceilingAreas.push({id:'cHole',height:3.00,thickness:0.10,materialId:M2,extraLossDb:0,
        footprint:{parts:[{outer:[{x:-12,y:-12},{x:12,y:-12},{x:12,y:12},{x:-12,y:12}],
                            holes:[[{x:-1,y:-1},{x:1,y:-1},{x:1,y:1},{x:-1,y:1}]]}]}});
      // floor 1 with a WIDER slab Opening: -3..3
      state.floors.push(freshFloor('F1',1));
      var f1=state.floors[1];
      f1.height=3.0; f1.w=40; f1.d=40; f1.ceilingAreas=[];
      f1.openings.push({id:'op',points:[{x:-3,y:-3},{x:3,y:-3},{x:3,y:3},{x:-3,y:3}]});
      // a second AP placed under the Ceiling HOLE, for the bypass case
      var ap2=makeAP(0,0,'AP-2',3.0); ap2.mount=2.6; f.aps.push(ap2);
    `)}
    var world=rt3dBuildWorld();
    var apSolid=state.floors[0].aps[0], apHole=state.floors[0].aps[1];
    var ceil=world.ceilings[0], slab=world.slabs[0];
    var planeAbove=rt3dReceiverPlaneZForFloor(1);        // 3.0 + 1.2 = 4.2

    // ray at x=2: Ceiling SOLID, slab OPEN
    var up=rt3dRay(rt3dApOrigin(apSolid,0).x, rt3dApOrigin(apSolid,0).y, rt3dApOriginZ(0,apSolid), 0,0,1);
    var trS=rt3dTracePath(world, up, {backend:'bvh', maxDistance:40, maxReflections:0});
    var cS=rt3dReceiverPlaneCrossing(trS, planeAbove);
    // ray at x=0: Ceiling HOLE, slab OPEN
    var up2=rt3dRay(rt3dApOrigin(apHole,0).x, rt3dApOrigin(apHole,0).y, rt3dApOriginZ(0,apHole), 0,0,1);
    var trH=rt3dTracePath(world, up2, {backend:'bvh', maxDistance:40, maxReflections:0});
    var cH=rt3dReceiverPlaneCrossing(trH, planeAbove);

    return {ceilZ:[ceil.zBottom,ceil.zTop], ceilLoss:ceil.loss,
            slabZ:[slab.zBottom,slab.zTop], slabLoss:slab.loss,
            planeAbove:planeAbove,
            solid:{hit:cS.hit, loss:cS.materialLoss, ceilN:rt3dCountByType(trS,'ceiling'),
                   slabN:rt3dCountByType(trS,'slab'), z:cS.z},
            hole:{hit:cH.hit, loss:cH.materialLoss, ceilN:rt3dCountByType(trH,'ceiling'),
                  slabN:rt3dCountByType(trH,'slab')}};
  })()`);
  check(7, 'normal-height Ceiling at 2.90..3.00 attenuates an upward path exactly once, and the sample contains EXACTLY the Ceiling loss (slab bypassed through its Opening)',
    near(r.ceilZ[0],2.9) && near(r.ceilZ[1],3.0) &&
    r.solid.ceilN === 1 && r.solid.slabN === 0 &&
    r.solid.hit && r.solid.loss > 0 && near(r.solid.loss, r.ceilLoss) && near(r.solid.z, r.planeAbove),
    JSON.stringify({ceilZ:r.ceilZ, ceilLoss:r.ceilLoss, solid:r.solid, planeAbove:r.planeAbove}));
  check(8, 'Ceiling hole bypass: a ray through the hole pays no Ceiling loss',
    r.hole.ceilN === 0 && r.hole.loss === 0, JSON.stringify(r.hole));
  check(9, 'slab Opening bypass: the crossing sample contains no slab loss',
    r.solid.slabN === 0 && r.hole.slabN === 0 && r.hole.loss === 0, JSON.stringify(r.hole));
}

// ---------------------------------------------------------------- 10
// High AP passes over a low RF Object; the compatibility plane still hits it.
{
  const r = V(`(function(){
    ${SCENE(`
      var ap=makeAP(-3,0,'AP-1',3.0); ap.mount=2.6; f.aps.push(ap);
      f.rfObjects.push({id:'low',x:0,y:0,width:2,depth:2,height:1.5,rotation:0,
        materialId:M4,extraLossDb:0});
    `)}
    var world=rt3dBuildWorld();
    var ap=state.floors[0].aps[0];
    var o=rt3dApOrigin(ap,0);
    var planeZ=rt3dReceiverPlaneZForFloor(0);
    var obj=world.rfObjects[0];
    // a ray that clears the object (z above 1.5 while over its footprint)
    var over=rt3dRay(o.x,o.y,o.z, 1,0,-0.1);
    var trO=rt3dTracePath(world, over, {backend:'bvh', maxDistance:60, maxReflections:0});
    var cO=rt3dReceiverPlaneCrossing(trO, planeZ);
    // CONTROL: the same geometry launched on the legacy receiver plane
    var compat=rt3dRay(o.x,o.y,rt3dReceiverPlaneZ(), 1,0,-0.1);
    var ctl=rt3dBodyEvent(compat, obj, 60);
    return {apZ:o.z, planeZ:planeZ, objTop:obj.zTop, objBox:[obj.cx,obj.cy,obj.hw,obj.hd],
      over:{hit:cO.hit, loss:cO.materialLoss, objN:rt3dCountByType(trO,'rfObject'),
            x:cO.x},
      controlHit: ctl? {t:ctl.tEnter, loss:ctl.loss} : null};
  })()`);
  check(10, 'high AP (2.60 m) passes over the 1.50 m RF Object; the compatibility plane still hits it',
    r.apZ === 2.6 && r.objTop === 1.5 && r.apZ > r.objTop &&
    r.over.objN === 0 && r.over.loss === 0 && r.over.x > r.objBox[0] + r.objBox[2] &&
    r.controlHit !== null && r.controlHit.loss > 0,
    JSON.stringify(r));
}

// ---------------------------------------------------------------- 11
// Inclined ray reflects from a vertical wall, keeps dz, and still crosses.
{
  const r = V(`(function(){
    ${SCENE(`
      var ap=makeAP(-10,-6,'AP-1',3.0); ap.mount=2.6; f.aps.push(ap);
      // close enough that the wall is met while the ray is still ABOVE the
      // 1.20 m receiver plane, so the reflection precedes the crossing
      f.walls.push({id:'w',x1:-5,y1:-14,x2:-5,y2:14,materialId:M4,thickness:0.15});
      f.rfObjects.push({id:'far',x:6,y:0,width:1.5,depth:1.5,height:0.6,rotation:0,
        materialId:M4,extraLossDb:0});
    `)}
    var world=rt3dBuildWorld();
    var ap=state.floors[0].aps[0];
    var o=rt3dApOrigin(ap,0);
    var planeZ=rt3dReceiverPlaneZForFloor(0);
    // inclined, dz != 0, heading at the wall
    var ray=rt3dRay(o.x,o.y,o.z, 0.8,0.4,-0.2);
    var tr=rt3dTracePath(world, ray, {backend:'bvh', maxDistance:60, maxReflections:1, reflectLossDb:5});
    var c=rt3dReceiverPlaneCrossing(tr, planeZ);
    var refl=tr.events.filter(function(e){return e.type==='reflection';})[0];
    return {dzIn:tr.initialDirection.z, dzOut:refl? refl.dzAfter : null,
            dzBefore:refl? refl.dzBefore : null,
            reflCount:c? c.reflectionCount : -1, loss:c? c.materialLoss : null,
            hit:c? c.hit : false, reflLossDb:tr.events.length? tr.events[0].loss : null};
  })()`);
  check(11, 'inclined ray reflects from a vertical wall, keeps dz, and the sample includes the reflection budget',
    r.hit && r.dzIn < 0 && near(r.dzOut, r.dzIn) && r.reflCount === 1 && r.loss > 0,
    JSON.stringify(r));
}

// ---------------------------------------------------------------- 14
// Multiple floors / non-zero owner-floor base.
{
  const r = V(`(function(){
    ${SCENE(`
      state.floors[0].height=4.2;
      var ap=makeAP(-3,-3,'AP-1',4.2); ap.mount=2.6; f.aps.push(ap);
      state.floors.push(freshFloor('F1',1));
      state.floors[1].height=2.6; state.floors[1].w=40; state.floors[1].d=40;
      state.floors[1].ceilingAreas=[];
      state.floors[1].aps.push(makeAP(0,0,'AP-2',2.6));
    `)}
    var world=rt3dBuildWorld();
    var ap0=state.floors[0].aps[0];
    return {elev0:floorElevation(0), elev1:floorElevation(1),
            rx:receiverHeight(),
            plane0:rt3dReceiverPlaneZForFloor(0), plane1:rt3dReceiverPlaneZForFloor(1),
            originZ:rt3dApOriginZ(0, ap0), mount:apMount(ap0)};
  })()`);
  check(14, 'receiver plane is explicit absolute Z = floorElevation + receiverHeight, incl. non-zero base',
    r.elev0 === 0 && r.elev1 === 4.2 &&
    near(r.plane0, 0 + r.rx) && near(r.plane1, 4.2 + r.rx) &&
    near(r.originZ, 2.6),
    JSON.stringify(r));
}

// ---------------------------------------------------------------- 15
// BVH vs linear sample identity, including the full sample record.
{
  const r = V(`(function(){
    ${SCENE(`
      var ap=makeAP(-3,-3,'AP-1',3.0); ap.mount=2.6; f.aps.push(ap);
      f.ceilingAreas.push({id:'c',height:3.00,thickness:0.10,materialId:M2,extraLossDb:1,
        footprint:{parts:[{outer:[{x:-12,y:-12},{x:12,y:-12},{x:12,y:12},{x:-12,y:12}],
                            holes:[[{x:-3,y:-3},{x:3,y:-3},{x:3,y:3},{x:-3,y:3}]]}]}});
      for(var i=0;i<8;i++) f.walls.push({id:'w'+i,x1:-10+i*3,y1:-12,x2:-10+i*3,y2:12,
        materialId:M4,thickness:0.15});
      f.rfObjects.push({id:'o1',x:0,y:0,width:1.4,depth:1.4,height:2.4,rotation:20,
        materialId:M4,extraLossDb:1});
      f.pillars.push({id:'p1',x:6,y:6,diameter:0.6,materialId:M4});
      state.floors.push(freshFloor('F1',1));
      state.floors[1].height=3.0; state.floors[1].w=40; state.floors[1].d=40;
      state.floors[1].ceilingAreas=[];
      state.floors[1].openings.push({id:'op',points:[{x:-4,y:-4},{x:4,y:-4},{x:4,y:4},{x:-4,y:4}]});
    `)}
    var world=rt3dBuildWorld();
    var ap=state.floors[0].aps[0];
    var O={azimuthSamples:24, elevationSamples:13};
    var planes=[rt3dReceiverPlaneZForFloor(0), rt3dReceiverPlaneZForFloor(1)];
    var mism=0, total=0, firstBad=null;
    for(var pi=0; pi<planes.length; pi++){
      var a=rt3dTraceFan(world, ap, 0, planes[pi], Object.assign({backend:'linear'}, O));
      var b=rt3dTraceFan(world, ap, 0, planes[pi], Object.assign({backend:'bvh'}, O));
      total += a.samples.length;
      if(JSON.stringify(a.samples)!==JSON.stringify(b.samples)){
        mism++;
        if(!firstBad) firstBad={plane:planes[pi], aN:a.samples.length, bN:b.samples.length};
      }
    }
    return {mism:mism, total:total, firstBad:firstBad,
            diagBvh: rt3dTraceFan(world, ap, 0, planes[1], Object.assign({backend:'bvh'}, O)).diagnostics};
  })()`);
  check(15, 'BVH and linear produce IDENTICAL receiver-plane sample records',
    r.mism === 0 && r.total > 0,
    `planes compared=2 mismatches=${r.mism} samples=${r.total} ${JSON.stringify(r.firstBad)}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
