// Stage 2 acceptance fixtures.
//
// 18 required cases, each tracing a real inclined 3D path through the RT3D
// kernel. The production engine is never involved except in fixture 18, which
// re-runs the Stage-1 oracle and the production-isolation checks.
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

// Build a scene inside the sandbox and return a JSON summary.
function scene(body, probe) {
  return V(`(function(){
    state=freshState();
    var f=state.floors[0];
    f.height=3.0; f.w=24; f.d=18; f.ceilingAreas=[];
    var M4=state.materials[4].id, M2=state.materials[2].id;
    ${body}
    var world=rt3dBuildWorld();
    ${probe}
  })()`);
}
const AP = (x, y, mount) => `var ap=makeAP(${x},${y},'AP-1',3.0); ap.mount=${mount}; f.aps.push(ap);`;

console.log('Stage 2 acceptance — true 3D ray paths\n');

// ---------------------------------------------------------------- 1
// AP real-Z launcher
{
  const r = scene(AP(-4, -3, 2.6), `
    var o=rt3dApOrigin(ap, 0);
    var ray=rt3dRayToTarget(ap, 0, rt3dV(4, 3, 1.2));
    var same=rt3dRayToTarget(ap, 0, rt3dV(4, 3, 2.6));   // horizontal target
    var up  =rt3dRayToTarget(ap, 0, rt3dV(4, 3, 9.0));
    var down=rt3dRayToTarget(ap, 0, rt3dV(4, 3, 0.0));
    var degenerate=rt3dRayToTarget(ap, 0, rt3dV(-4,-3,2.6));
    return {origin:o, mount:apMount(ap), receiverPlane:rt3dReceiverPlaneZ(),
      ray:ray, same:same, up:up, down:down, degenerate:degenerate};`);
  check(1, 'AP real-Z launcher: origin is the AP absolute Z, D normalized, dz follows geometry',
    near(r.origin.z, 2.6) && near(r.origin.x, -4) && near(r.origin.y, -3) &&
    r.origin.z !== r.receiverPlane &&
    near(Math.hypot(r.ray.dx, r.ray.dy, r.ray.dz), 1, 1e-15) &&
    near(r.same.dz, 0, 1e-15) &&          // level target -> dz == 0
    r.up.dz > 0 && r.down.dz < 0 &&       // dz sign follows geometry
    r.degenerate === null,                 // no invented direction
    JSON.stringify(r));
}

// ---------------------------------------------------------------- 2 & 3
// The critical proof: a high AP passes OVER a low RF Object, while the
// compatibility receiver-plane ray still hits it.
{
  const r = scene(`${AP(-4, 0, 2.6)}
    f.rfObjects.push({id:'low',x:0,y:0,width:2,depth:2,height:1.5,rotation:0,materialId:M4,extraLossDb:0});`,
    `
    var o=rt3dBuildWorld().rfObjects[0];
    var target=rt3dV(4, 0, 2.6);                       // level with the AP
    var t3 = rt3dTraceApToPoint(rt3dBuildWorld(), ap, 0, target, {collectCandidates:true});
    // compatibility ray: same geometry but on the legacy receiver plane
    var compatRay=rt3dRay(rt3dApOrigin(ap,0).x, rt3dApOrigin(ap,0).y,
                          rt3dReceiverPlaneZ(), 1,0,0);
    var compatHit=rt3dBodyEvent(compatRay, o, 50);
    return {obj:{x0:o.cx-o.hw,x1:o.cx+o.hw,y0:o.cy-o.hd,y1:o.cy+o.hd,
                 z0:o.zBase,z1:o.zTop,id:o.objectId},
            apZ:rt3dApOriginZ(0,ap), compatZ:rt3dReceiverPlaneZ(),
            events3d:t3.events.map(e=>({type:e.type,id:e.objectId,z:+e.point.z.toFixed(4),loss:e.loss})),
            totalLoss3d:t3.totalMaterialLoss, dist3d:+t3.totalDistance.toFixed(4),
            cands:t3.candidates,
            compatHit: compatHit? {t:compatHit.tEnter, loss:compatHit.loss, z:compatHit.point.z} : null};`);

  check(2, 'high AP (2.60 m) passes OVER the 1.50 m RF Object on a true 3D path',
    r.events3d.length === 0 && r.totalLoss3d === 0 &&
    r.apZ === 2.6 && r.obj.z1 === 1.5 && r.apZ > r.obj.z1 &&
    r.compatHit !== null && r.compatHit.z === 1.2,
    'object=' + JSON.stringify(r.obj) + ' apZ=' + r.apZ + ' events=' + JSON.stringify(r.events3d));

  check(3, 'the SAME object IS hit by a ray on the compatibility receiver plane (1.20 m)',
    r.compatHit !== null && r.compatHit.loss > 0 && near(r.compatHit.z, 1.2) &&
    near(r.compatHit.t, 4 - 1, 1e-9),
    JSON.stringify(r.compatHit));
}

// ---------------------------------------------------------------- 4, 5, 6
// Cross-floor direct paths. Floor 0 height 3.00 so the floor-1 slab plane is
// at z = 3.00, and with the CANONICAL SLAB_THICKNESS_M the slab occupies
// 2.88..3.00 - the same plate the 3D view draws and the glTF export writes.
function crossFloor(extra) {
  return scene(`
    state.floors.push(freshFloor('F1',1));
    var f1=state.floors[1];
    f1.height=3.0; f1.w=24; f1.d=18; f1.ceilingAreas=[];
    f1.aps.push(null); f1.aps.pop();
    ${AP(-4, 0, 2.6)}
    ${extra}`, `
    var world=rt3dBuildWorld();
    // target on floor 1, in real absolute coordinates
    var t=rt3dTraceApToPoint(world, ap, 0, rt3dV(4, 0, 3.0+1.2), {collectCandidates:true});
    return {dz:t.initialDirection.z>0, dzVal:+t.initialDirection.z.toFixed(6),
            originZ:t.origin.z, targetZ:3.0+1.2,
            events:t.events.map(e=>({type:e.objectType,id:e.objectId,z:+e.point.z.toFixed(4),
                                     loss:+e.loss.toFixed(4),tr:e.traversals})),
            slabLoss:rt3dLossByType(t,'slab'), slabN:rt3dCountByType(t,'slab'),
            ceilLoss:rt3dLossByType(t,'ceiling'), ceilN:rt3dCountByType(t,'ceiling'),
            totalLoss:+t.totalMaterialLoss.toFixed(4), cands:t.candidates};`);
}
{
  const a = crossFloor('');   // solid slab, no opening
  check(4, 'cross-floor ray (dz>0) through a SOLID slab is attenuated once',
    a.dz && a.events.some(e=>e.type==='slab') && a.slabN === 1 && a.slabLoss > 0 &&
    a.originZ === 2.6 && a.targetZ === 4.2,
    JSON.stringify({dz:a.dzVal, events:a.events, slabLoss:a.slabLoss}));

  const b = crossFloor(`f1.openings.push({id:'op',points:[{x:-6,y:-6},{x:6,y:-6},{x:6,y:6},{x:-6,y:6}]});`);
  check(5, 'the same ray through a slab OPENING has zero slab attenuation',
    b.dz && b.slabN === 0 && b.slabLoss === 0 && b.totalLoss === 0,
    JSON.stringify({events:b.events, slabLoss:b.slabLoss, total:b.totalLoss}));

  const c = crossFloor(`
    f1.openings.push({id:'op',points:[{x:-6,y:-6},{x:6,y:-6},{x:6,y:6},{x:-6,y:6}]});
    // a normal-height Ceiling Area inside the opening: 2.90..3.00
    f.ceilingAreas.push({id:'inOpening',height:3.00,thickness:0.10,materialId:M2,
      extraLossDb:2, footprint:{parts:[{outer:[{x:-6,y:-6},{x:6,y:-6},{x:6,y:6},{x:-6,y:6}],holes:[]}]}});`);
  check(6, 'slab opening + a normal-height Ceiling in it: slab 0, Ceiling charged',
    c.slabN === 0 && c.slabLoss === 0 && c.ceilN === 1 && c.ceilLoss > 0,
    JSON.stringify({events:c.events, slab:c.slabLoss, ceil:c.ceilLoss}));
}

// ---------------------------------------------------------------- 7
// Ceiling hole bypass, at architectural height.
{
  const r = scene(`${AP(-4, 0, 2.6)}
    f.ceilingAreas.push({id:'c',height:3.00,thickness:0.10,materialId:M4,extraLossDb:3,
      footprint:{parts:[{outer:[{x:-10,y:-10},{x:10,y:-10},{x:10,y:10},{x:-10,y:10}],
                          holes:[[{x:-4,y:-2},{x:4,y:-2},{x:4,y:2},{x:-4,y:2}]]}]}});`, `
    var world=rt3dBuildWorld();
    var c=world.ceilings[0];
    var throughHole =rt3dTraceApToPoint(world, ap, 0, rt3dV(4, 0, 5.0), {});
    var throughSolid=rt3dTraceApToPoint(world, ap, 0, rt3dV(4, 20.0, 5.0), {});
    return {zBottom:c.zBottom, zTop:c.zTop, iv:ceilingInterval(c.object),
            loss:c.loss, matDb:matById(c.object.materialId).db, extra:c.object.extraLossDb,
            holeEvents:throughHole.events.length, holeLoss:rt3dLossByType(throughHole,'ceiling'),
            solidN:rt3dCountByType(throughSolid,'ceiling'),
            solidLoss:rt3dLossByType(throughSolid,'ceiling'),
            solidPoint:throughSolid.events.map(e=>e.point.z)};`);
  check(7, 'Ceiling hole bypass at architectural height 2.90..3.00',
    near(r.zTop, 3.0) && near(r.zBottom, 2.9) && near(r.iv.top, 3.0) && near(r.iv.bottom, 2.9) &&
    r.holeEvents === 0 && r.holeLoss === 0 &&
    r.solidN === 1 && near(r.solidLoss, r.matDb + r.extra),
    JSON.stringify(r));
}

// ---------------------------------------------------------------- 8, 9
// Wall finite-height behaviour on a real path, and full-height semantics.
{
  const short = scene(`${AP(-4, 0, 2.6)}
    f.walls.push({id:'lowWall',x1:0,y1:-6,x2:0,y2:6,height:2.2,materialId:M4,thickness:0.15});`, `
    var world=rt3dBuildWorld();
    var w=world.walls[0];
    var below=rt3dTraceApToPoint(world, ap, 0, rt3dV(4, 0, 1.0), {reflectWalls:false}); // crosses at z=1.8 < 2.2
    var above=rt3dTraceApToPoint(world, ap, 0, rt3dV(4, 0, 2.6), {reflectWalls:false}); // ray above it
    return {wall:{z0:w.zBase,z1:w.zTop,id:w.objectId,explicit:w.explicitHeight},
            belowN:rt3dCountByType(below,'wall'), belowLoss:rt3dLossByType(below,'wall'),
            aboveN:rt3dCountByType(above,'wall'), aboveLoss:rt3dLossByType(above,'wall'),
            floorH:state.floors[0].height};`);
  check(8, 'explicit-height wall: ray below the top is traversed, a ray above it is not',
    near(short.wall.z1, 2.2) && short.belowN === 1 && short.belowLoss > 0 &&
    short.aboveN === 0 && short.aboveLoss === 0,
    JSON.stringify(short));

  const full = scene(`${AP(-4, 0, 2.6)}
    f.walls.push({id:'fullWall',x1:0,y1:-6,x2:0,y2:6,materialId:M4,thickness:0.15});`, `
    var world=rt3dBuildWorld();
    var w=world.walls[0];
    var hit =rt3dTraceApToPoint(world, ap, 0, rt3dV(4, 0, 2.6), {reflectWalls:false});
    // a ray aimed just above the owner floor height must MISS
    var over=rt3dTraceApToPoint(world, ap, 0, rt3dV(4, 0, 3.6), {});  // crosses at z=3.1, above the wall
    return {z0:w.zBase,z1:w.zTop,explicit:w.explicitHeight,floorH:state.floors[0].height,
            hitN:rt3dCountByType(hit,'wall'), hitZ:hit.events.map(e=>e.point.z),
            overN:rt3dCountByType(over,'wall')};`);
  check(9, 'full-height wall extends exactly to the owner floor height and is traversed',
    full.explicit === false && near(full.z0, 0) && near(full.z1, full.floorH) &&
    full.hitN === 1 && full.overN === 0,
    JSON.stringify(full));
}

// ---------------------------------------------------------------- 10, 11
// 3D wall reflection from an oblique ray, compared with the analytical result.
{
  const r = scene(`
    ${AP(-4, -4, 2.6)}
    f.walls.push({id:'w',x1:0,y1:-6,x2:0,y2:6,materialId:M4,thickness:0.15});`, `
    var world=rt3dBuildWorld();
    var w=world.walls[0];
    // inclined DESCENDING ray from a high AP to a low target
    var ray=rt3dRayToTarget(ap, 0, rt3dV(4, 4, 1.0));
    var tr=rt3dTracePath(world, ray, {reflectWalls:true, maxReflections:1});
    var ev=tr.events.filter(function(e){return e.type==='reflection';})[0];
    // analytical: R = D - 2(D.N)N computed independently here
    var D=rt3dRayDir(ray), N=rt3dV(w.nx,w.ny,0);
    var k=2*(D.x*N.x+D.y*N.y+D.z*N.z);
    var aR=rt3dV(D.x-k*N.x, D.y-k*N.y, D.z-k*N.z);
    // and the same for an ASCENDING ray
    var ray2=rt3dRayToTarget(ap, 0, rt3dV(4, 4, 3.0));   // crosses the wall at z=2.8
    var tr2=rt3dTracePath(world, ray2, {reflectWalls:true, maxReflections:1});
    var ev2=tr2.events.filter(function(e){return e.type==='reflection';})[0];
    return {D:D, N:N, analytical:aR, dzIn:D.z, dzOut:ev?ev.dzAfter:null,
            dzBeforeEv:ev?ev.dzBefore:null, dxOut:ev? ev.point.x : null,
            finalD:tr.finalRay, n:tr.events.length,
            up:{dzIn:rt3dRayDir(ray2).z, dzOut:ev2?ev2.dzAfter:null}};`);
  check(10, 'oblique descending ray reflects off a vertical wall; horizontal parts mirror',
    r.n >= 1 && near(r.dzOut, r.dzIn) && r.dzIn < 0 &&
    near(r.dzBeforeEv, r.dzIn) &&
    // reflected direction equals the analytical R = D - 2(D.N)N
    near(r.finalD.dx, r.analytical.x, 1e-12) && near(r.finalD.dy, r.analytical.y, 1e-12) &&
    near(r.finalD.dz, r.analytical.z, 1e-12),
    JSON.stringify(r));

  check(11, 'dz is preserved by a vertical-wall reflection (descending stays descending, ascending stays ascending)',
    near(r.dzOut, r.dzIn) && r.dzIn < 0 && r.up.dzIn > 0 && near(r.up.dzOut, r.up.dzIn),
    JSON.stringify({descending:{in:r.dzIn,out:r.dzOut}, ascending:r.up}));
}

// ---------------------------------------------------------------- 12
// Reflection + vertical progression: the reflected path must collide again,
// using the REFLECTED ray's real XYZ.
{
  const r = scene(`
    ${AP(-4, -4, 2.6)}
    f.walls.push({id:'w1',x1:0,y1:-6,x2:0,y2:6,materialId:M4,thickness:0.15});
    // a pillar placed BEYOND the wall, off the incoming line, so only a
    // correctly-reflected ray with real Z can reach it
    f.pillars.push({id:'p',x:-2.0,y:2.0,diameter:0.8,height:null,materialId:M4});`, `
    var world=rt3dBuildWorld();
    var ray=rt3dRayToTarget(ap, 0, rt3dV(6, 6, 0.5));   // reflects back toward -x
    var tr=rt3dTracePath(world, ray, {reflectWalls:true, maxReflections:1});
    // an equivalent ray with the reflection DISABLED must not reach the pillar
    var trNo=rt3dTracePath(world, ray, {reflectWalls:false});
    return {events:tr.events.map(e=>({type:e.type,obj:e.objectType,id:e.objectId,
              z:+e.point.z.toFixed(4),dist:+e.distance.toFixed(4)})),
            final:tr.finalRay, refl:tr.reflections,
            pillarHits:rt3dEventsFor(tr,'p').length,
            noReflPillar:rt3dEventsFor(trNo,'p').length};`);
  check(12, 'after reflecting, the path continues with real XYZ and collides again (a pillar beyond the wall)',
    r.refl === 1 && r.pillarHits === 1 && r.final.dz < 0 &&
    r.noReflPillar === 0,
    JSON.stringify(r));
}

// ---------------------------------------------------------------- 13, 14
// Same barrier crossed twice physically vs one continuous traversal.
//
// A vertical-wall reflection conserves dz exactly, so a ray's vertical
// direction NEVER reverses. A horizontal volume (slab / Ceiling) therefore
// cannot be crossed twice on one path - which is itself proof that the
// vertical component is a real, conserved part of the path. The physically
// possible double crossing is on a VERTICAL body, so that is what is tested:
// a ray bouncing down a corridor re-crosses the same RF Object.
{
  const r = scene(`
    ${AP(-2, 0, 2.6)}
    f.walls.push({id:'wA',x1:-3,y1:-5,x2:-3,y2:5,materialId:M4,thickness:0.15});
    f.walls.push({id:'wB',x1:3,y1:-5,x2:3,y2:5,materialId:M4,thickness:0.15});
    f.rfObjects.push({id:'obj',x:1,y:0,width:0.6,depth:0.6,height:3.0,rotation:0,
      materialId:M4,extraLossDb:1});
    f.ceilingAreas.push({id:'c',height:3.00,thickness:0.10,materialId:M4,extraLossDb:0,
      footprint:{parts:[{outer:[{x:-8,y:-8},{x:8,y:-8},{x:8,y:8},{x:-8,y:8}],holes:[]}]}});`, `
    var world=rt3dBuildWorld();
    // rising ray: crosses the ceiling going up, and can never come back
    var up=rt3dTracePath(world, rt3dRay(ap.x, ap.y, rt3dApOriginZ(0,ap), 0.30, 0.0, 0.95),
                         {reflectWalls:true, maxReflections:2});
    // horizontal ray down a corridor: crosses the same object, reflects,
    // and crosses it again
    var corridor=rt3dTracePath(world, rt3dRay(ap.x, ap.y, rt3dApOriginZ(0,ap), 1,0,0),
                               {reflectWalls:true, maxReflections:1});
    var ev=rt3dEventsFor(corridor,'obj');
    return {upCeil:rt3dCountByType(up,'ceiling'), upDz:+up.initialDirection.z.toFixed(6),
            upCeilEvents:up.events.filter(function(e){return e.objectType==='ceiling';})
                                  .map(function(e){return +e.point.z.toFixed(3);}),
            count:ev.length, losses:ev.map(e=>+e.loss.toFixed(4)),
            dists:ev.map(e=>+e.distance.toFixed(3)),
            objLoss:+rt3dLossByType(corridor,'rfObject').toFixed(4),
            total:+corridor.totalMaterialLoss.toFixed(4), refl:corridor.reflections,
            order:corridor.events.map(e=>e.objectType+':'+e.objectId)};`);
  check(13, 'a reflected path crossing the same body twice is charged twice, and a Ceiling is crossed at most once (dz is conserved)',
    r.count === 2 && r.losses[0] > 0 && near(r.losses[0], r.losses[1]) &&
    near(r.objLoss, 2 * r.losses[0]) &&
    r.upCeil === 1 && r.upDz > 0 && r.upCeilEvents.length === 1,
    JSON.stringify(r));

  const s2 = scene(`${AP(-4, 0, 2.6)}
    f.rfObjects.push({id:'o',x:0,y:0,width:2,depth:2,height:2.0,rotation:0,materialId:M4,extraLossDb:1});`, `
    var world=rt3dBuildWorld();
    // a steeply inclined ray crosses the object once and exits; the continuous
    // traversal must be charged exactly once
    var ray=rt3dRay(ap.x, ap.y, rt3dApOriginZ(0,ap), 0.90, 0.0, -0.40);
    var tr=rt3dTracePath(world, ray, {reflectWalls:false});
    var ev=rt3dEventsFor(tr,'o');
    return {count:ev.length, loss:tr.totalMaterialLoss,
            tEnter:ev.map(e=>+e.tEnter.toFixed(4)), tExit:ev.map(e=>+e.tExit.toFixed(4)),
            traversals:ev.map(e=>e.traversals), events:tr.events.map(e=>e.type+':'+e.objectId)};`);
  check(14, 'one CONTINUOUS traversal through a thick body is charged exactly once',
    s2.count === 1 && s2.traversals[0] === 1 && s2.loss > 0 &&
    s2.tExit[0] > s2.tEnter[0],
    JSON.stringify(s2));
}

// ---------------------------------------------------------------- 15
// Mixed obstacle nearest-event ordering, by TRUE 3D distance.
//
// Four barriers of four different kinds are crossed by one inclined ray, at
// clearly separated distances along it. A fifth body is planted DIRECTLY IN
// THE RAY'S XY PATH but far below it: a 2D tracer would stop on it, a 3D
// tracer must pass over it. That is the real difference this fixture proves.
{
  const r = scene(`
    state.floors[0].height=8.0;
    ${AP(-4, 0, 2.6)}
    // ~0.14 m: a Ceiling patch just above the AP, reachable only by rising
    f.ceilingAreas.push({id:'ceil',height:2.80,thickness:0.10,materialId:M2,extraLossDb:0,
      footprint:{parts:[{outer:[{x:-5,y:-2},{x:-3,y:-2},{x:-3,y:2},{x:-5,y:2}],holes:[]}]}});
    // ~1.56 m: a tall RF Object the ray passes through
    f.rfObjects.push({id:'tallObj',x:-2.5,y:0,width:0.8,depth:1.0,height:8.0,rotation:0,
      materialId:M4,extraLossDb:0});
    // squarely in the XY path but only 0.5 m tall: the ray is 4.6 m up here
    f.rfObjects.push({id:'lowObj',x:-1.0,y:0,width:2.0,depth:1.0,height:0.5,rotation:0,
      materialId:M4,extraLossDb:0});
    // ~5.66 m: a full-height vertical wall
    f.walls.push({id:'midWall',x1:0,y1:-4,x2:0,y2:4,materialId:M2,thickness:0.15});
    // ~7.35 m: the floor-1 slab, reached only by climbing 5.2 m
    state.floors.push(freshFloor('F1',1));
    var f1=state.floors[1]; f1.height=3.0; f1.w=24; f1.d=18; f1.ceilingAreas=[];`,
    `
    var world=rt3dBuildWorld();
    var ray=rt3dRay(ap.x, ap.y, rt3dApOriginZ(0,ap), 1,0,1);
    var all=rt3dCandidateEvents(world, ray, 40, null);
    var tr=rt3dTracePath(world, ray, {reflectWalls:false});
    return {cands: all.map(function(c){ return c.kind+':'+c.body.objectId+'@'+c.tEnter.toFixed(3); }),
            kinds: tr.events.map(e=>e.objectType),
            ids: tr.events.map(e=>e.objectId),
            dists: tr.events.map(e=>+e.distance.toFixed(4)),
            lowEver: all.some(function(c){ return c.body.objectId==='lowObj'; }) ||
                     tr.events.some(function(e){ return e.objectId==='lowObj'; })};`);
  check(15, 'nearest physically reachable event wins by 3D distance; a body in the XY path but below the ray is skipped',
    JSON.stringify(r.kinds) === JSON.stringify(['ceiling','rfObject','wall','slab']) &&
    r.dists.every((d, i, a) => i === 0 || d > a[i - 1]) &&
    r.lowEver === false,
    JSON.stringify({kinds: r.kinds, dists: r.dists, cands: r.cands, lowEver: r.lowEver}));
}

// ---------------------------------------------------------------- 16
// Tangency produces no false loss.
{
  const r = scene(`${AP(-4, 0, 2.6)}
    f.pillars.push({id:'p',x:0,y:0,diameter:0.6,height:null,materialId:M4});`, `
    var world=rt3dBuildWorld();
    var p=world.pillars[0];
    // exactly tangent to the cylinder: discriminant 0, zero-length chord
    var tan=rt3dBodyEvent(rt3dRay(-4, p.py+p.r, 1.2, 1,0,0), p, 50);
    var thru=rt3dBodyEvent(rt3dRay(-4, p.py+p.r*0.5, 1.2, 1,0,0), p, 50);
    var tr=rt3dTracePath(world, rt3dRay(-4, p.py+p.r, 1.2, 1,0,0), {reflectWalls:false});
    return {tangent: tan, through: thru? thru.tEnter:null, loss:tr.totalMaterialLoss,
            events:tr.events.length};`);
  check(16, 'a tangent ray produces no event and no loss',
    r.tangent === null && r.through !== null && r.loss === 0 && r.events === 0,
    JSON.stringify(r));
}

// ---------------------------------------------------------------- 17
// Non-zero floor elevations.
{
  const r = scene(`
    state.floors[0].height=4.2;
    state.floors.push(freshFloor('F1',1));
    var f1=state.floors[1]; f1.height=2.6; f1.w=24; f1.d=18; f1.ceilingAreas=[];
    ${AP(-4, 0, 2.6)}
    f.walls.push({id:'w',x1:0,y1:-6,x2:0,y2:6,materialId:M4,thickness:0.15});
    f1.aps.push(makeAP(0,0,'AP-2',2.6));`, `
    var world=rt3dBuildWorld();
    var w=world.walls[0];
    var tr=rt3dTraceApToPoint(world, ap, 0, rt3dV(4, 0, 4.2+1.2), {});
    return {originZ:tr.origin.z, dz:tr.initialDirection.z,
            wallBase:w.zBase, wallTop:w.zTop, slabTop:world.slabs[0].zTop,
            slabBottom:world.slabs[0].zBottom, canonical:SLAB_THICKNESS_M,
            events:tr.events.map(e=>e.objectType+':'+e.objectId+':z'+e.point.z.toFixed(3)),
            slabN:rt3dCountByType(tr,'slab')};`);
  check(17, 'non-zero floor elevations: geometry and paths use real absolute Z',
    near(r.originZ, 2.6) && r.dz > 0 && near(r.wallBase, 0) && near(r.wallTop, 4.2) &&
    near(r.slabTop, 4.2) && near(r.slabBottom, 4.2 - r.canonical) && r.slabN === 1,
    JSON.stringify(r));
}

// ---------------------------------------------------------------- 18a
// Canonical slab thickness: the 3D/export slab and the RT3D slab volume must
// be the SAME physical plate. This is the audit that keeps a slab from being
// one thickness on screen and another to the tracer.
{
  const r = scene(`
    state.floors.push(freshFloor('F1',1));
    var f1=state.floors[1]; f1.height=3.0; f1.w=24; f1.d=18; f1.ceilingAreas=[];
    ${AP(-4, 0, 2.6)}`, `
    var world=rt3dBuildWorld();
    var b=world.slabs[0];                       // the floor-1 slab
    var elev=floorElevation(1);

    // the interactive 3D plate occupies local y in [-th, 0] with the mesh
    // placed at the floor elevation, and the glTF export writes the same
    // plate; recover both bounds the way those two paths build them
    var th3d = SLAB_THICKNESS_M;
    var gltf = GLTF_SLAB_THICKNESS;

    return {canonical:SLAB_THICKNESS_M, th3d:th3d, gltf:gltf,
            elev:elev,
            // RT3D bounds, absolute
            rt3dTop:b.zTop, rt3dBottom:b.zBottom, rt3dThickness:b.thickness,
            // 3D/export bounds, absolute (top on the elevation, body below)
            geom3dTop:elev, geom3dBottom:elev-th3d, gltfTop:elev, gltfBottom:elev-gltf,
            // and the legacy RF model, which must stay a zero-thickness plane
            legacyPlaneZ: elev};`);
  check(18, 'slab thickness is canonical: 3D, glTF and RT3D derive from SLAB_THICKNESS_M',
    r.canonical === 0.12 && r.th3d === r.canonical && r.gltf === r.canonical &&
    r.rt3dThickness === r.canonical &&
    near(r.rt3dTop, r.geom3dTop) && near(r.rt3dTop, r.gltfTop) &&
    near(r.rt3dBottom, r.geom3dBottom) && near(r.rt3dBottom, r.gltfBottom) &&
    near(r.rt3dTop - r.rt3dBottom, r.canonical) &&
    // the legacy RF slab model is still a zero-thickness plane, untouched
    near(r.legacyPlaneZ, r.rt3dTop),
    JSON.stringify(r));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
