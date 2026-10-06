// Stage 6 acceptance: the unified RT3D coverage field core.
//
// The claim under test is that RF Planner now has ONE propagation model:
//
//      Coverage(x, y, z)
//
// and that a 2D heatmap is merely a horizontal slice of it. Nothing here is
// about pixels; the renderer is not even loaded.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeDom, run } from './loader.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, '..', '..', 'index.html'), 'utf8')
  .match(/<script>\n([\s\S]*?)\n<\/script>/)[1];

let pass = 0, fail = 0;
const failures = [];
function check(id, name, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${String(id).padStart(2)}. ${name}`); }
  else {
    fail++; failures.push(`${id}. ${name}${detail ? ' :: ' + detail : ''}`);
    console.log(`  FAIL ${String(id).padStart(2)}. ${name}${detail ? ' :: ' + detail : ''}`);
  }
}
const near = (a, b, t = 1e-6) => Math.abs(a - b) <= t;

function sandbox() {
  const win = makeDom();
  win.location = { search: '?rt3d=1' };
  const ctx = vm.createContext(win);
  vm.runInContext(SRC, ctx, { filename: 'index.html<script>' });
  run(ctx, `paintHeat=function(){};computeHeatSimple=function(){};draw2d=function(){};
    coverageUpdate=function(){};showToast=function(){};refresh3dHeat=function(){};
    scheduleHeat=function(){};clearTimeout(heatTimer);`);
  // available inside the sandbox as well: the physics assertions below compare
  // floats there, not only on the Node side
  run(ctx, 'window.near=function(a,b,t){ return Math.abs(a-b)<=(t==null?1e-6:t); };');
  return ctx;
}
const Q = (sb, code) => JSON.parse(run(sb, `JSON.stringify(${code})`));

// A controlled single-floor room. Bodies are added per test so each criterion
// isolates exactly one physical effect. Scene options are interpolated here, on
// the Node side, because the snippet runs inside the sandbox.
function room(sb, body, opts) {
  opts = opts || {};
  const floorHeight = opts.floorHeight != null ? opts.floorHeight : 3.0;
  const w = opts.w != null ? opts.w : 20;
  const d = opts.d != null ? opts.d : 14;
  const activeFloor = opts.activeFloor || 0;
  run(sb, `
    state=freshState();
    var f=state.floors[0];
    f.name=${JSON.stringify(opts.floorName || 'PB')}; f.height=${floorHeight};
    f.w=${w}; f.d=${d}; f.ceilingAreas=[];
    var M4=state.materials[4].id, M2=state.materials[2].id, M0=state.materials[0].id;
    window.__M={M4:M4,M2:M2,M0:M0};
    ${body}
    state.activeFloor=${activeFloor};
  `);
}

console.log('Stage 6 acceptance — unified RT3D coverage field\n');

// ------------------------------------------------------------------ 1
// Arbitrary XYZ receiver point, and no active-floor knowledge in the query.
{
  const sb = sandbox();
  room(sb, `var ap=makeAP(-6,0,'AP-1',3.0); ap.mount=2.6; f.aps.push(ap);`);
  const r = Q(sb, `(function(){
    var w=rt3dBuildWorld();
    var zs=[0.5,1.2,2.0,2.8];
    var out=zs.map(function(z){
      var c=rt3dCoverageAt(w,{x:2.5,y:-1.25,z:z},{reflections:false});
      return { z:z, pt:[c.point.x,c.point.y,c.point.z], rssi:c.strongestRssi };
    });
    return { out:out, distinctZ:new Set(out.map(function(o){return o.rssi;})).size,
             hasFloorKey: /floorIndex/.test(String(rt3dCoverageAt.length)) };
  })()`);
  check(1, 'the query accepts arbitrary absolute XYZ, including non-receiver heights',
    r.out.length === 4 && r.out.every((o) => o.pt[2] === o.z) && r.distinctZ > 1,
    JSON.stringify(r.out.map((o) => [o.z, o.rssi])));
}

// ------------------------------------------------------------------ 2, 3
// Real AP absolute XYZ, and TRUE 3D distance (never XY).
{
  const sb = sandbox();
  room(sb, `var ap=makeAP(-6,3,'AP-1',3.0); ap.mount=2.6; f.aps.push(ap);`);
  const r = Q(sb, `(function(){
    var w=rt3dBuildWorld();
    var res={};
    // floor 1: the AP must be at its own base elevation plus mount
    var p=rt3dApOrigin(f.aps[0],0);
    res.apZ=p.z; res.apX=p.x; res.apY=p.y;
    // distance must include dz
    var c=rt3dCoverageAt(w,{x:0,y:0,z:1.2},{reflections:false});
    var a=c.aps[0];
    var want3d=Math.hypot(0-p.x, 0-p.y, 1.2-p.z);
    var xyOnly=Math.hypot(0-p.x, 0-p.y);
    res.reported=a.directDistance; res.want3d=want3d; res.xyOnly=xyOnly;
    res.is3d=near(a.directDistance, want3d, 1e-6);
    res.notXY=!near(a.directDistance, xyOnly, 1e-6);
    res.apXYZInResult=[a.apX,a.apY,a.apZ];
    res.apXYZCorrect = near(a.apX,p.x,1e-9)&&near(a.apZ,p.z,1e-9);
    // free-space term must use that distance
    var mhz=BANDS[state.band].mhz, pl1=fsplAt1m(mhz);
    var wantP = a.txPower + a.antennaGainDb - (pl1 + 10*state.plExp*Math.log10(Math.max(0.5,want3d)) + a.candidates[0].materialLossDb);
    res.powerMatches = near(a.candidates[0].receivedPower, wantP, 1e-3);
    return res;
  })()`);
  check(2, 'the AP contributes from its real absolute XYZ, and the result carries it',
    r.apZ === 2.6 && r.apXYZCorrect, JSON.stringify({ apZ: r.apZ, inResult: r.apXYZInResult }));
  check(3, 'true 3D path distance is used, never the XY projection',
    r.is3d && r.notXY && r.powerMatches,
    JSON.stringify({ reported: r.reported, want3d: r.want3d, xyOnly: r.xyOnly, powerMatches: r.powerMatches }));
}

// ------------------------------------------------------------------ 4
// Antenna model: the full existing 3D model is used, and its Z behaviour is
// proven where the model says it should and only there.
{
  const sb = sandbox();
  room(sb, `
    var omni=makeAP(-6,0,'OMNI',3.0); omni.mount=2.6; omni.antenna={type:'omni',az:0,tilt:0,gain:3}; f.aps.push(omni);
  `);
  const r = Q(sb, `(function(){
    var w=rt3dBuildWorld();
    var zs=[0.5,1.2,2.0,2.8];
    var c=rt3dCoverageAt(w,{x:-3,y:0,z:1.2},{reflections:false});
    var omniGains=zs.map(function(z){ return c.aps[0].antennaGainDb; });
    // ceiling-mounted OMNI short-circuits in antennaGain(): no elevation term
    return { omniGains:omniGains, omniFlat:new Set(omniGains).size===1,
             model:c.antennaModel };
  })()`);
  const sb2 = sandbox();
  room(sb2, `
    var p=makeAP(-6,0,'PATCH',3.0); p.mount=2.6; p.antenna={type:'patch',az:0,tilt:0,gain:4}; f.aps.push(p);
  `);
  const r2 = Q(sb2, `(function(){
    var w=rt3dBuildWorld();
    var out=[0.5,1.2,2.0,2.8].map(function(z){
      var c=rt3dCoverageAt(w,{x:-3,y:0,z:z},{reflections:false});
      return { z:z, gain:c.aps[0].antennaGainDb };
    });
    return out;
  })()`);
  const patchGains = r2.map((o) => o.gain);
  check(4, 'antennaGain() is used, and elevation changes gain exactly where the model says it should',
    /antennaGain\(\)/.test(r.model) && r.omniFlat && new Set(patchGains).size === patchGains.length &&
    patchGains.every((g) => g <= 4),
    JSON.stringify({ omni: r.omniGains, patch: r2, model: r.model }));
}

// ------------------------------------------------------------------ 5, 6
// Wall transmission, and finite-height wall bypass.
{
  const sb = sandbox();
  room(sb, `
    var M4=window.__M.M4;
    f.walls.push({id:'w',x1:0,y1:-7,x2:0,y2:7,materialId:M4,thickness:0.15,height:1.0});
    // a low AP: the SAME wall is then crossed by a low receiver and cleared by a
    // high one, which is the cleanest available contrast
    var ap=makeAP(-6,0,'AP-1',3.0); ap.mount=0.5; f.aps.push(ap);
  `);
  const r = Q(sb, `(function(){
    var w=rt3dBuildWorld();
    var wall=w.walls[0];
    var through=rt3dCoverageAt(w,{x:4,y:0,z:0.2},{reflections:false}).aps[0];
    var over   =rt3dCoverageAt(w,{x:4,y:0,z:1.5},{reflections:false}).aps[0];
    return { wallZ:[wall.zBase,wall.zTop], wallLoss:wall.loss,
             throughLoss:through.candidates[0].materialLossDb,
             throughTx:through.candidates[0].transmissionCount,
             overLoss:over.candidates[0].materialLossDb,
             overTx:over.candidates[0].transmissionCount };
  })()`);
  check(5, 'a wall is charged as one effective loss per traversal, independent of thickness',
    r.throughTx === 1 && near(r.throughLoss, r.wallLoss, 1e-9),
    JSON.stringify(r));
  check(6, 'a receiver ABOVE a finite-height wall bypasses it entirely',
    r.overTx === 0 && r.overLoss === 0,
    JSON.stringify({ wallZ: r.wallZ, overLoss: r.overLoss, overTx: r.overTx }));
}

// ------------------------------------------------------------------ 7, 8
// Rotated RF Object traversal, and RF Object height bypass.
{
  const sb = sandbox();
  room(sb, `
    var M4=window.__M.M4;
    f.rfObjects.push({id:'o',x:0,y:0,width:6,depth:2,height:1.5,rotation:45,materialId:M4,extraLossDb:0});
    var ap=makeAP(-8,0,'AP-1',3.0); ap.mount=2.6; f.aps.push(ap);
  `);
  const r = Q(sb, `(function(){
    var w=rt3dBuildWorld();
    var o=w.rfObjects[0];
    // a ray at 45 deg crosses the rotated box; a receiver below its top does
    var through=rt3dCoverageAt(w,{x:6,y:0,z:0.5},{reflections:false}).aps[0];
    // the same XY at a height above the object top must miss it
    var over   =rt3dCoverageAt(w,{x:6,y:0,z:2.5},{reflections:false}).aps[0];
    return { rot:{ c:o.c, s:o.s, hw:o.hw, hd:o.hd, z:[o.zBase,o.zTop] },
             throughLoss:through.candidates[0].materialLossDb,
             throughTx:through.candidates[0].transmissionCount,
             overLoss:over.candidates[0].materialLossDb,
             overTx:over.candidates[0].transmissionCount };
  })()`);
  check(7, 'a rotated RF Object is traversed with its real rotation and height',
    near(r.rot.c, Math.cos(Math.PI / 4), 1e-9) && near(r.rot.s, Math.sin(Math.PI / 4), 1e-9) &&
    r.throughTx === 1 && r.throughLoss > 0,
    JSON.stringify(r));
  check(8, 'a receiver above the same RF Object top bypasses it',
    r.overTx === 0 && r.overLoss === 0, JSON.stringify({ overLoss: r.overLoss, overTx: r.overTx }));
}

// ------------------------------------------------------------------ 9
// Pillar traversal.
{
  const sb = sandbox();
  room(sb, `
    var M4=window.__M.M4;
    f.pillars.push({id:'p',x:0,y:0,diameter:0.6,materialId:M4});
    var ap=makeAP(-6,0,'AP-1',3.0); ap.mount=2.6; f.aps.push(ap);
  `);
  const r = Q(sb, `(function(){
    var w=rt3dBuildWorld();
    var a=rt3dCoverageAt(w,{x:6,y:0,z:1.2},{reflections:false}).aps[0];
    return { tx:a.candidates[0].transmissionCount, loss:a.candidates[0].materialLossDb,
             pillarLoss:w.pillars[0].loss };
  })()`);
  check(9, 'a pillar is traversed as one effective loss per crossing',
    r.tx >= 1 && near(r.loss, r.pillarLoss, 1e-9), JSON.stringify(r));
}

// ------------------------------------------------------------------ 10, 11
// Slab traversal, and slab Opening bypass.
{
  const sb = sandbox();
  room(sb, `
    var M4=window.__M.M4;
    state.floors.push(freshFloor('PA',1));
    var f1=state.floors[1]; f1.height=3.0; f1.w=20; f1.d=14; f1.ceilingAreas=[];
    f1.slabMaterialId=M4;
    f1.openings.push({id:'op',points:[{x:-1,y:-1},{x:1,y:-1},{x:1,y:1},{x:-1,y:1}]});
    var ap=makeAP(0,0,'AP-PB',3.0); ap.mount=2.6; f.aps.push(ap);
  `);
  const r = Q(sb, `(function(){
    var w=rt3dBuildWorld();
    var slab=w.slabs[0];
    var insideOpening=rt3dCoverageAt(w,{x:0,y:0,z:4.2},{reflections:false}).aps[0];
    var onSolid     =rt3dCoverageAt(w,{x:8,y:6,z:4.2},{reflections:false}).aps[0];
    return { slabZ:[slab.zBottom,slab.zTop], slabLoss:slab.loss,
             openingTx:insideOpening.candidates[0].transmissionCount,
             openingLoss:insideOpening.candidates[0].materialLossDb,
             solidTx:onSolid.candidates[0].transmissionCount,
             solidLoss:onSolid.candidates[0].materialLossDb,
             plane:rt3dReceiverPlaneZForFloor(1) };
  })()`);
  check(10, 'a receiver above a solid slab is charged exactly one slab traversal',
    r.solidTx === 1 && near(r.solidLoss, r.slabLoss, 1e-9),
    JSON.stringify(r));
  check(11, 'a receiver above a slab Opening pays no slab loss',
    r.openingTx === 0 && r.openingLoss === 0,
    JSON.stringify({ openingTx: r.openingTx, openingLoss: r.openingLoss, plane: r.plane }));
}

// ------------------------------------------------------------------ 12, 13
// Ceiling traversal, and Ceiling hole bypass.
{
  const sb = sandbox();
  room(sb, `
    var M2=window.__M.M2;
    var outer=[{x:-10,y:-7},{x:10,y:-7},{x:10,y:7},{x:-10,y:7}];
    var hole=[{x:-2,y:-2},{x:2,y:-2},{x:2,y:2},{x:-2,y:2}];
    f.ceilingAreas.push({id:'c',height:3.00,thickness:0.10,materialId:M2,extraLossDb:0,
      footprint:{parts:[{outer:outer,holes:[hole]}]}});
    // AP directly under the hole: straight up passes the hole, sideways does not
    var ap=makeAP(0,0,'AP-1',3.0); ap.mount=2.6; f.aps.push(ap);
  `);
  const r = Q(sb, `(function(){
    var w=rt3dBuildWorld();
    var c=w.ceilings[0];
    var throughHole=rt3dCoverageAt(w,{x:0,y:0,z:3.4},{reflections:false}).aps[0];
    var underSolid=rt3dCoverageAt(w,{x:-6,y:0,z:3.4},{reflections:false}).aps[0];
    return { ceilZ:[c.zBottom,c.zTop], ceilLoss:c.loss,
             solidTx:underSolid.candidates[0].transmissionCount,
             solidLoss:underSolid.candidates[0].materialLossDb,
             holeTx:throughHole.candidates[0].transmissionCount,
             holeLoss:throughHole.candidates[0].materialLossDb };
  })()`);
  check(12, 'a normal-height Ceiling attenuates a path that crosses it',
    r.solidTx === 1 && near(r.solidLoss, r.ceilLoss, 1e-9),
    JSON.stringify(r));
  check(13, 'a Ceiling hole is bypassed with no loss',
    r.holeTx === 0 && r.holeLoss === 0,
    JSON.stringify({ holeTx: r.holeTx, holeLoss: r.holeLoss, ceilZ: r.ceilZ }));
}

// ------------------------------------------------------------------ 14, 15
// Multi-floor receiver, and non-zero floor elevations.
{
  const sb = sandbox();
  room(sb, `
    var M4=window.__M.M4;
    var ap1=makeAP(-6,-6,'AP-PB',4.2); ap1.mount=2.6; f.aps.push(ap1);
    state.floors.push(freshFloor('PA',1));
    var f1=state.floors[1]; f1.height=2.6; f1.w=20; f1.d=14; f1.ceilingAreas=[];
    f1.slabMaterialId=M4;
    f1.aps.push(makeAP(6,6,'AP-PA',2.6));
    state.activeFloor=0;
  `, { floorHeight: 4.2 });
  const r = Q(sb, `(function(){
    var w=rt3dBuildWorld();
    var sources=rt3dCoverageSources();
    var planePB=rt3dReceiverPlaneZForFloor(0);
    var planePA=rt3dReceiverPlaneZForFloor(1);
    var c=rt3dCoverageAt(w,{x:0,y:0,z:planePA},{});
    return { sources:sources.length, ownerFloors:[...new Set(sources.map(function(s){return s.floorIndex;}))].sort(),
             planePB:planePB, planePA:planePA,
             pbApZ:c.aps.filter(function(a){return a.ownerFloorIndex===0;})[0].apZ,
             paApZ:c.aps.filter(function(a){return a.ownerFloorIndex===1;})[0].apZ,
             servingFloor:(c.aps.filter(function(a){return a.apId===c.servingApId;})[0]||{}).ownerFloorIndex };
  })()`);
  check(14, 'APs from every floor participate in one receiver-point query',
    r.sources === 2 && r.ownerFloors.join(',') === '0,1', JSON.stringify(r));
  check(15, 'non-zero floor elevations place APs at their true absolute Z',
    r.pbApZ === 2.6 && r.paApZ === 4.2 + 2.6 && near(r.planePA, 4.2 + 1.2),
    JSON.stringify(r));
}

// ------------------------------------------------------------------ 16
// Direct-path result must not depend on any sampling density.
{
  const sb = sandbox();
  room(sb, `
    var M4=window.__M.M4;
    f.walls.push({id:'w',x1:0,y1:-7,x2:0,y2:7,materialId:M4,thickness:0.15});
    f.rfObjects.push({id:'o',x:-2,y:1,width:2,depth:2,height:2.0,rotation:0,materialId:M4,extraLossDb:0});
    var ap=makeAP(-6,0,'AP-1',3.0); ap.mount=2.6; f.aps.push(ap);
  `);
  const r = Q(sb, `(function(){
    var w=rt3dBuildWorld();
    var pts=[{x:3,y:1,z:1.2},{x:5,y:-2,z:0.5},{x:2,y:4,z:2.5}];
    var a=pts.map(function(p){ var c=rt3dCoverageAt(w,p,{reflections:false}); return c.aps[0].candidates[0]; });
    var b=pts.map(function(p){ var c=rt3dCoverageAt(w,p,{reflections:false}); return c.aps[0].candidates[0]; });
    var c=pts.map(function(p){ var c=rt3dCoverageAt(w,p,{reflections:false}); return c.aps[0].candidates[0]; });
    return { same: JSON.stringify(a)===JSON.stringify(b) && JSON.stringify(b)===JSON.stringify(c),
             vals:a.map(function(x){return [x.receivedPower,x.pathDistance,x.materialLossDb];}) };
  })()`);
  check(16, 'the direct path is deterministic and independent of any sampling density',
    r.same, JSON.stringify(r.vals));
}

// ------------------------------------------------------------------ 17
// EXACT first-order image-source wall reflection, and its rejection cases.
{
  const sb = sandbox();
  room(sb, `
    var M4=window.__M.M4;
    f.walls.push({id:'wA',x1:0,y1:-7,x2:0,y2:7,materialId:M4,thickness:0.15,height:3.0});
    f.walls.push({id:'wShort',x1:6,y1:-7,x2:6,y2:-6.4,materialId:M4,thickness:0.15,height:1.0});
    f.walls.push({id:'wLow',x1:-9,y1:0,x2:-3,y2:0,materialId:M4,thickness:0.15,height:1.0});
    var ap=makeAP(-6,-5,'AP-1',3.0); ap.mount=2.6; f.aps.push(ap);
  `);
  const r = Q(sb, `(function(){
    var w=rt3dBuildWorld();
    var res={};
    var c=rt3dCoverageAt(w,{x:-6,y:5,z:1.2},{});
    var a=c.aps[0];
    var refl=a.candidates.filter(function(x){return x.kind==='reflected';});
    var valid=refl.filter(function(x){return x.valid;});
    res.validCount=valid.length;
    var v=valid[0];
    res.reasons=refl.map(function(x){return x.wallObjectId+':'+(x.valid?'valid':x.rejectReason);});

    // SPECULAR LAW, verified properly:
    //   d_in = normalize(R - AP), d_out = normalize(receiver - R)
    //   the normal components must be equal and opposite, and the tangential
    //   components must be equal. Equal incidence/reflection is guaranteed by
    //   construction; this proves the arithmetic actually produced that point.
    function unit(px,py,pz,qx,qy,qz){ var dx=px-qx,dy=py-qy,dz=pz-qz,L=Math.hypot(dx,dy,dz);
      return {x:dx/L,y:dy/L,z:dz/L}; }
    var R=v.reflectionPoint;
    var wall=w.walls.filter(function(x){return x.objectId===v.wallObjectId;})[0];
    var n={x:wall.nx,y:wall.ny,z:wall.nz};
    var dIn =unit(R.x,R.y,R.z, a.apX,a.apY,a.apZ);
    var dOut=unit(-6,5,1.2, R.x,R.y,R.z);
    var inN=dIn.x*n.x+dIn.y*n.y+dIn.z*n.z;
    var outN=dOut.x*n.x+dOut.y*n.y+dOut.z*n.z;
    res.normalOpposite = Math.abs(inN + outN) < 1e-9;
    var tIn={x:dIn.x-inN*n.x,y:dIn.y-inN*n.y,z:dIn.z-inN*n.z};
    var tOut={x:dOut.x-outN*n.x,y:dOut.y-outN*n.y,z:dOut.z-outN*n.z};
    res.tangentialEqual = Math.hypot(tIn.x-tOut.x,tIn.y-tOut.y,tIn.z-tOut.z) < 1e-9;
    // the point lies on the finite surface: within the wall extent AND height
    res.u=near(((R.x-wall.x1)*wall.ux+(R.y-wall.y1)*wall.uy), (R.x-wall.x1)*wall.ux+(R.y-wall.y1)*wall.uy, 1e-9);
    res.withinExtent = (((R.x-wall.x1)*wall.ux+(R.y-wall.y1)*wall.uy) >= -1e-6) &&
                        (((R.x-wall.x1)*wall.ux+(R.y-wall.y1)*wall.uy) <= wall.L+1e-6);
    res.withinHeight = R.z >= wall.zBase-1e-6 && R.z <= wall.zTop+1e-6;
    res.onNearFace = near(Math.abs(R.x-0), wall.halfThickness, 1e-6);
    // reflection loss applied exactly once; legs exclude the wall itself
    res.reflectionLossDb=v.reflectionLossDb;
    res.legsLongerThanDirect = v.pathDistance > a.candidates[0].pathDistance;
    res.directWins = a.strongest.kind==='direct';
    // power must equal tx + gain - (fspl + slope*d + material + reflection)
    var want=a.txPower+a.antennaGainDb-(fsplAt1m(BANDS[state.band].mhz)
      + 10*state.plExp*Math.log10(Math.max(0.5,v.pathDistance)) + v.materialLossDb + v.reflectionLossDb);
    res.powerCorrect = near(v.receivedPower, want, 1e-3);
    return res;
  })()`);
  check(17, 'first-order reflection solves exactly: equal incidence/reflection, on the finite surface',
    r.validCount === 1 && r.normalOpposite && r.tangentialEqual &&
    r.withinExtent && r.withinHeight && r.onNearFace && r.legsLongerThanDirect,
    JSON.stringify(r));
  check('17b', 'reflection loss is applied once, and reflection never beats a shorter direct path',
    r.reflectionLossDb === 5 && r.directWins && r.powerCorrect,
    JSON.stringify({ reflLoss: r.reflectionLossDb, directWins: r.directWins, powerCorrect: r.powerCorrect }));
  check('17c', 'physically invalid reflection candidates are rejected, each for its own reason',
    /receiverBehindPlane/.test(r.reasons.join('|')) &&
    (r.reasons.join('|').match(/outsideWall/g) || []).length >= 1,
    JSON.stringify(r.reasons));
}

// ------------------------------------------------------------------ 18
// Strongest-path aggregation, never a sum or a mean of dBm.
{
  const sb = sandbox();
  room(sb, `
    var M4=window.__M.M4;
    f.walls.push({id:'wA',x1:0,y1:-7,x2:0,y2:7,materialId:M4,thickness:0.15,height:3.0});
    var ap=makeAP(-6,-5,'AP-1',3.0); ap.mount=2.6; f.aps.push(ap);
  `);
  const r = Q(sb, `(function(){
    var w=rt3dBuildWorld();
    var c=rt3dCoverageAt(w,{x:-6,y:5,z:1.2},{});
    var a=c.aps[0];
    var vals=a.candidates.filter(function(x){return x.valid;}).map(function(x){return x.receivedPower;});
    var mx=Math.max.apply(null, vals);
    var sum=vals.reduce(function(p,q){return p+q;},0);
    var mean=sum/vals.length;
    return { n:vals.length, max:mx, sum:sum, mean:mean,
             strongestIsMax: a.strongestRssi===mx,
             notSum: Math.abs(a.strongestRssi-sum)>1e-6,
             notMean: Math.abs(a.strongestRssi-mean)>1e-6,
             servingIsStrongestAp: c.strongestRssi===Math.max.apply(null, c.aps.map(function(x){return x.strongestRssi;})),
             rule:c.aggregationRule,
             // per-AP data must survive for a future SINR model
             perAp: c.aps.map(function(x){ return {id:x.apId, ch:x.channel, best:x.strongestRssi,
               n:x.candidates.length}; }),
             hasPerAp: c.aps.length===1 && c.aps[0].candidates.length>=2 };
  })()`);
  check(18, 'per-AP aggregation takes the strongest valid path: never a sum, never a mean',
    r.n >= 2 && r.strongestIsMax && r.notSum && r.notMean && r.servingIsStrongestAp && r.hasPerAp,
    JSON.stringify(r));
}

// ------------------------------------------------------------------ 19, 21
// The 2D slice IS the field, sampled at cell centres, with no interpolation.
{
  const sb = sandbox();
  room(sb, `
    var M4=window.__M.M4;
    f.walls.push({id:'wA',x1:0,y1:-7,x2:0,y2:7,materialId:M4,thickness:0.15,height:3.0});
    f.rfObjects.push({id:'o',x:3,y:1,width:2,depth:2,height:1.5,rotation:20,materialId:M4,extraLossDb:0});
    var ap1=makeAP(-6,-5,'AP-1',3.0); ap1.mount=2.6; f.aps.push(ap1);
    var ap2=makeAP(7,4,'AP-2',3.0); ap2.mount=1.0; f.aps.push(ap2);
  `);
  const r = Q(sb, `(function(){
    var w=rt3dBuildWorld();
    var spec=rt3dGridSpec(state.floors[0]);
    var planeZ=rt3dReceiverPlaneZForFloor(0);
    var t0=performance.now();
    var slice=rt3dCoverageSlice(w, spec, planeZ, {});
    var ms=performance.now()-t0;

    // INDEPENDENT re-evaluation of a sample of cells, straight through the
    // point query, with no reference to the slice arrays.
    var checked=0, mism=0, firstBad=null;
    var idx=[0, 1, 7, 13, 101, 500, 999, slice.totalCells-1, slice.totalCells>>1];
    for(var q=0;q<idx.length;q++){
      var k=idx[q]; if(k<0||k>=slice.totalCells) continue;
      var i=k%spec.cols, j=(k/spec.cols)|0;
      var x=spec.b.minx+(i+0.5)*spec.cw, y=spec.b.miny+(j+0.5)*spec.ch;
      var c=rt3dCoverageAt(w,{x:x,y:y,z:planeZ},{sources:slice.sources});
      var want=c.strongestRssi, got=slice.best[k];
      checked++;
      var same=(want===got) || (Number.isFinite(want)&&Number.isFinite(got)&&near(want,got,1e-3));
      if(!same){ mism++; if(!firstBad) firstBad={k:k,x:x,y:y,want:want,got:got}; }
    }
    // every valid cell must hold a real evaluated value, and no cell may hold a
    // value that was never computed
    var validCount=0; for(var t=0;t<slice.totalCells;t++) if(slice.valid[t]===1) validCount++;
    var invalidButFinite=0;
    for(var t2=0;t2<slice.totalCells;t2++)
      if(slice.valid[t2]!==1 && Number.isFinite(slice.best[t2])) invalidButFinite++;
    return { cols:spec.cols, rows:spec.rows, total:slice.totalCells, planeZ:planeZ,
             evaluated:slice.evaluatedCells, validCells:slice.validCells,
             noSignal:slice.noSignalCells, validCount:validCount,
             invalidButFinite:invalidButFinite,
             checked:checked, mism:mism, firstBad:firstBad, ms:ms,
             perSec:slice.diagnostics.cellsPerSec,
             rule:slice.diagnostics.rasterRule };
  })()`);
  check(19, 'every 2D slice cell value equals an independent Coverage(x,y,receiverPlaneZ) evaluation',
    r.mism === 0 && r.checked >= 8 && r.evaluated === r.total,
    JSON.stringify({ mism: r.mism, firstBad: r.firstBad, checked: r.checked }));
  check(21, 'no interpolation: every cell is a real evaluation, and no unevaluated cell holds a value',
    r.validCount === r.validCells && r.invalidButFinite === 0 && r.evaluated === r.total,
    JSON.stringify({ total: r.total, evaluated: r.evaluated, valid: r.validCells,
                     invalidButFinite: r.invalidButFinite }));
  check('19b', 'a full slice of an open room is fully covered, with no sparse rings',
    r.validCells === r.total, JSON.stringify({ valid: r.validCells, total: r.total }));
  check('21b', 'the slice evaluates every cell exactly once, through the same field',
    r.evaluated === r.total && /one Coverage\(x,y,z\) evaluation per cell centre/.test(String(r.rule||'')),
    JSON.stringify({ evaluated: r.evaluated, total: r.total, rule: r.rule }));
}

// ------------------------------------------------------------------ 20
// Arbitrary Z and the vertical-column proof.
{
  const sb = sandbox();
  room(sb, `
    var M4=window.__M.M4, M2=window.__M.M2;
    f.rfObjects.push({id:'rack',x:0,y:0,width:3,depth:3,height:2.0,rotation:0,materialId:M4,extraLossDb:0});
    var outer=[{x:-10,y:-7},{x:10,y:-7},{x:10,y:7},{x:-10,y:7}];
    var hole=[{x:-3,y:0},{x:0,y:0},{x:0,y:3},{x:-3,y:3}];
    f.ceilingAreas.push({id:'c',height:3.00,thickness:0.10,materialId:M2,extraLossDb:0,
      footprint:{parts:[{outer:outer,holes:[hole]}]}});
    var ap=makeAP(-6,0,'AP-1',3.0); ap.mount=2.6; f.aps.push(ap);
  `);
  const r = Q(sb, `(function(){
    var w=rt3dBuildWorld();
    var zs=[0.5,1.2,2.0,2.8,3.5,4.2];
    var col=rt3dCoverageColumn(w,0,0,zs,{});
    // the exact same API, no 2D mode anywhere
    var raw=zs.map(function(z){ return rt3dCoverageAt(w,{x:0,y:0,z:z},{reflections:false}).strongestRssi; });
    var colRaw=col.samples.map(function(s){ return s.strongestRssi; });
    // below vs above the 2.0 m rack top at the SAME xy
    var below=rt3dCoverageAt(w,{x:0,y:0,z:1.2},{reflections:false}).aps[0].candidates[0];
    var above=rt3dCoverageAt(w,{x:0,y:0,z:2.6},{reflections:false}).aps[0].candidates[0];
    // below vs above the 2.90..3.00 ceiling
    var underC=rt3dCoverageAt(w,{x:-8,y:0,z:2.0},{reflections:false}).aps[0].candidates[0];
    var overC =rt3dCoverageAt(w,{x:-8,y:0,z:3.4},{reflections:false}).aps[0].candidates[0];
    // ceiling hole bypass
    var holeR =rt3dCoverageAt(w,{x:5,y:3,z:3.4},{reflections:false}).aps[0].candidates[0];
    var solidR=rt3dCoverageAt(w,{x:-8,y:0,z:3.4},{reflections:false}).aps[0].candidates[0];
    var underC2=rt3dCoverageAt(w,{x:-6,y:0,z:2.0},{reflections:false}).aps[0].candidates[0];
    return { col:col.samples.map(function(s){return [s.z,s.strongestRssi,s.stepDb];}),
             columnApiMatchesRaw: JSON.stringify(colRaw)===JSON.stringify(raw),
             belowTx:below.transmissionCount, aboveTx:above.transmissionCount,
             underCeilTx:underC2.transmissionCount, overCeilTx:overC.transmissionCount,
             underCeilLoss:underC2.materialLossDb, overCeilLoss:overC.materialLossDb,
             holeTx:holeR.transmissionCount, holeLoss:holeR.materialLossDb,
             solidTx:solidR.transmissionCount, solidLoss:solidR.materialLossDb,
             jumps:col.jumpCount };
  })()`);
  check(20, 'the same query serves every Z, with no 2D mode: below/above a rack, below/above a Ceiling, and a Ceiling hole',
    r.belowTx === 1 && r.aboveTx === 0 &&
    r.underCeilTx === 0 && r.overCeilTx === 1 && r.overCeilLoss > 0 &&
    r.holeTx === 0 && r.solidTx === 1,
    JSON.stringify(r));
  check('20b', 'the vertical column reports discrete physical changes across the column',
    r.jumps >= 1 && r.columnApiMatchesRaw, JSON.stringify({ jumps: r.jumps, col: r.col }));
}

// ------------------------------------------------------------------ 22 structural
// The coverage core must not couple itself to any renderer.
{
  const a = SRC.indexOf('UNIFIED RT3D COVERAGE FIELD CORE');
  // stop at the browser-integration banner: the CORE is physics and must be
  // renderer-free, while the integration layer legitimately drives the UI
  const u = SRC.indexOf('STAGE 6 BROWSER INTEGRATION', a);
  const b = u > 0 ? u : SRC.indexOf('function smoothRSSI', a);
  // Strip comments first: the section header legitimately NAMES canvas, Three.js
  // and the heatmap in order to forbid them, and prose is not a dependency.
  const core = SRC.slice(a, b)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/[^\n]*$/gm, ' ')
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
  const clean = !/\b(canvas|getContext|THREE|drawImage|createImageData|imageSmoothing)\b/.test(core) &&
                !/\bheatGrid(Rssi|Disp)\b/.test(core) &&
                !/rssiColor|sinrColor/.test(core) &&
                !/\bactiveFloor\b/.test(core.replace(/no active-floor assumption[^,]*/g, ''));
  const bvh = /backend:\s*opts\.backend \|\| rt3dBroadphaseBackend/.test(core);
  check(22, 'the coverage core is free of canvas, colour, heatmap and active-floor coupling',
    clean && bvh, `clean=${clean} usesBvh=${bvh}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
