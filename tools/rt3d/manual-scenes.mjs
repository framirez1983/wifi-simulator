// Stage 4 manual smoke path.
//
// Produces standalone SVGs of the receiver-plane SAMPLE CLOUD with the scene
// GEOMETRY drawn underneath, so a human can see both where real RT3D paths met
// the plane and what shaped them.
//
//   node tools/rt3d/manual-scenes.mjs
//
// SCOPE, stated plainly because it matters:
//   This script builds DETERMINISTIC DIAGNOSTIC FIXTURES in the Node harness.
//   It does NOT read, load or inspect the project currently open in a browser,
//   and it does not connect to the running app in any way. Running it changes
//   nothing in the application. A real project could be fed in by serialising
//   it into a fixture, but nothing like that happens automatically here.
//
// The RF samples are a pure scatter: one mark per real path intersection,
// coloured by received power. No grid, no interpolation, no splatting, no
// smoothing, no filling of empty space. Geometry is a subdued vector outline so
// it cannot be mistaken for a sample.
//
// Nothing in this file changes RT3D physics, fan generation or sample
// calculation: it only calls the existing kernel and redraws the result.
//
// Every cloud is produced twice, once per broadphase backend, and the two are
// asserted identical, so a picture can never hide a divergence.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadApp, run, blankState } from './loader.mjs';
import { writeCloudSvg } from './render-cloud.mjs';
import { lossTally, describeKinds, chargedShare } from './loss-tally.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
fs.mkdirSync(OUT, { recursive: true });

const sb = loadApp();
blankState(sb);
const V = (s) => JSON.parse(run(sb, `JSON.stringify(${s})`));

const FAN = { azimuthSamples: 72, elevationSamples: 33 };
const MAXD = 60;
const f2 = (n) => (typeof n === 'number' && Number.isFinite(n) ? n.toFixed(2) : '—');
function ringBox(ring) {
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  for (const q of ring) {
    minx = Math.min(minx, q.x); maxx = Math.max(maxx, q.x);
    miny = Math.min(miny, q.y); maxy = Math.max(maxy, q.y);
  }
  return { minx, maxx, miny, maxy };
}

// Extract the scene geometry the renderer draws, straight from the derived
// world, so the picture cannot disagree with the bodies the tracer used.
const GEOMETRY_BODY = (floorIdx) => `
  var wg=rt3dBuildWorld();
  var gp=function(l,fn){ return (l||[]).map(fn); };
  var geometry={
    walls: gp(wg.walls, function(b){ return {id:b.objectId, floorIndex:b.floorIndex,
      x1:b.x1,y1:b.y1,x2:b.x2,y2:b.y2, halfThickness:b.halfThickness,
      zBottom:b.zBase, zTop:b.zTop, loss:b.loss}; }),
    rfObjects: gp(wg.rfObjects, function(b){ return {id:b.objectId, floorIndex:b.floorIndex,
      cx:b.cx, cy:b.cy, hw:b.hw, hd:b.hd, c:b.c, s:b.s,
      zBottom:b.zBase, zTop:b.zTop, loss:b.loss}; }),
    pillars: gp(wg.pillars, function(b){ return {id:b.objectId, floorIndex:b.floorIndex,
      px:b.px, py:b.py, r:b.r, zBottom:b.zBase, zTop:b.zTop, loss:b.loss}; }),
    ceilings: gp(wg.ceilings, function(b){ return {id:b.objectId, floorIndex:b.floorIndex,
      plan:b.plan, zBottom:b.zBottom, zTop:b.zTop, loss:b.loss}; }),
    slabs: gp(wg.slabs, function(b){ return {id:b.objectId, floorIndex:b.floorIndex,
      plan:b.plan, zBottom:b.zBottom, zTop:b.zTop, loss:b.loss}; }),
    aps: gp(state.floors[${floorIdx}].aps, function(a){
      return {name:a.name, x:a.x, y:a.y, z:rt3dApOriginZ(${floorIdx}, a)}; })
  };`;

const SCENES = [
  {
    id: 'ap-over-rf-object',
    note: 'Two APs over one RF Object: the high AP clears it, the low AP does not.',
    plane: 'rt3dReceiverPlaneZForFloor(0)',
    build: `
      state=freshState();
      var f=state.floors[0];
      f.height=4.0; f.w=40; f.d=40; f.ceilingAreas=[];
      var M4=state.materials[4].id;
      var ap=makeAP(0,0,'AP-high',4.0); ap.mount=2.6; f.aps.push(ap);
      f.rfObjects.push({id:'low',x:0,y:0,width:3,depth:3,height:1.5,rotation:0,
        materialId:M4,extraLossDb:0});
      var ap2=makeAP(0,-4,'AP-low',4.0); ap2.mount=1.0; f.aps.push(ap2);`,
    describe(g) {
      const o = g.geom.rfObjects[0];
      const others = g.geom.aps.filter((a) => a.name !== g.ap.name);
      return {
        title: g.ap.z > (o ? o.zTop : 0)
      ? `AP ABOVE the RF Object — ${g.ap.name} at ${f2(g.ap.z)} m vs object top ${f2(o ? o.zTop : 0)} m`
      : `AP INSIDE the RF Object Z band — ${g.ap.name} at ${f2(g.ap.z)} m vs object top ${f2(o ? o.zTop : 0)} m`,
        annotations: [
          ['receiver plane Z', `${f2(g.cloud.receiverPlaneZ)} m (floor 0)`],
          ['AP Z (this fan)', `${f2(g.ap.z)} m`],
          ...(others.length ? [['other AP Z', others.map((a) => `${a.name} ${f2(a.z)} m`).join(', ')]] : []),
          ['RF Object Z interval', `${f2(o ? o.zBottom : 0)} .. ${f2(o ? o.zTop : 0)} m`],
          ['RF Object footprint', o ? `x ${f2(o.cx - o.hw)}..${f2(o.cx + o.hw)}, y ${f2(o.cy - o.hd)}..${f2(o.cy + o.hd)} m` : '—'],
          ['RF Object loss if crossed', `${f2(o ? o.loss : 0)} dB`],
          ['RF Object crossings', g.tally.rfObject.n ? `${g.tally.rfObject.n} samples, ${f2(g.tally.rfObject.lossSum / g.tally.rfObject.n)} dB each` : '0 — every path cleared the object'],
          ['bodies charged', describeKinds(g.tally)],
          ['samples paying any loss', `${chargedShare(g.tally)} / ${g.tally._samples}`],
        ],
        emphasise: o ? [{ kind: 'rfObject', body: o }] : [],
        notes: [
          'The RF Object footprint is outlined in amber.',
          'Samples beyond the amber footprint carry 0 dB of object loss: the path passed OVER the object.',
          'Samples whose crossing XY falls inside the footprint paid the full object loss.',
          'A 2.5D engine marches on the 1.20 m receiver plane, below the object top, and would charge both populations.',
          // Data-driven: an AP below the sampling plane can only be reached by
          // upward rays, which is why such a cloud is narrow. Say so rather than
          // let the sparse picture look like a fault.
          ...(g.ap.z < g.cloud.receiverPlaneZ
            ? [`NOTE: this AP at ${f2(g.ap.z)} m sits BELOW the ${f2(g.cloud.receiverPlaneZ)} m receiver plane, so only upward rays can reach the plane. The narrow cloud is correct, not a fault.`]
            : []),
        ],
      };
    },
  },
  {
    id: 'slab-opening',
    note: 'The floor-1 slab is solid except for one Opening. Crossing inside it costs 0 dB.',
    plane: 'rt3dReceiverPlaneZForFloor(1)',
    build: `
      state=freshState();
      var f=state.floors[0];
      f.height=3.0; f.w=40; f.d=40; f.ceilingAreas=[];
      var M4=state.materials[4].id;
      // Directly UNDER the Opening: steep rays cross the plane inside it and
      // pay 0 dB, while shallow rays travel far and hit solid slab.
      var ap=makeAP(0,0,'AP-1',3.0); ap.mount=2.6; f.aps.push(ap);
      state.floors.push(freshFloor('F1',1));
      var f1=state.floors[1];
      f1.height=3.0; f1.w=40; f1.d=40; f1.ceilingAreas=[];
      f1.slabMaterialId=M4;
      f1.openings.push({id:'op',points:[{x:-6,y:-6},{x:6,y:-6},{x:6,y:6},{x:-6,y:6}]});`,
    describe(g) {
      const s = g.geom.slabs[0];
      const hole = s && s.plan && s.plan.parts && s.plan.parts[0] && s.plan.parts[0].holes[0];
      const bb = hole ? ringBox(hole) : null;
      return {
        title: `Floor-1 slab Opening at ${f2(s ? s.zBottom : 0)}–${f2(s ? s.zTop : 0)} m — crossing inside it pays 0 dB, missing it pays ${f2(s ? s.loss : 0)} dB`,
        annotations: [
          ['receiver plane Z', `${f2(g.cloud.receiverPlaneZ)} m (floor 1)`],
          ['AP Z', `${f2(g.ap.z)} m (floor 0)`],
          ['slab Z interval', `${f2(s ? s.zBottom : 0)} .. ${f2(s ? s.zTop : 0)} m`],
          ['slab Opening', bb ? `x ${f2(bb.minx)}..${f2(bb.maxx)}, y ${f2(bb.miny)}..${f2(bb.maxy)} m` : '—'],
          ['slab loss when crossed', `${f2(s ? s.loss : 0)} dB`],
          ['slab crossings', g.tally.slab.n ? `${g.tally.slab.n} samples, ${f2(g.tally.slab.lossSum / g.tally.slab.n)} dB each` : '0'],
          ['samples inside the Opening', `${g.tally._samples - g.tally.slab.n} of ${g.tally._samples}`],
          ['bodies charged', describeKinds(g.tally)],
        ],
        emphasise: hole ? [{ kind: 'ring', ring: hole }] : [],
        notes: [
          'The slab Opening is drawn as an orange dashed rectangle, with the slab footprint faintly behind it.',
          'Samples whose crossing XY lands inside the Opening are stronger by exactly the slab loss.',
        ],
      };
    },
  },
  {
    id: 'ceiling-attenuation',
    note: 'A Ceiling at true architectural height, with the slab Opening wider than the Ceiling hole.',
    plane: 'rt3dReceiverPlaneZForFloor(1)',
    build: `
      state=freshState();
      var f=state.floors[0];
      f.height=3.0; f.w=40; f.d=40; f.ceilingAreas=[];
      var M2=state.materials[2].id, M4=state.materials[4].id;
      var ap=makeAP(0,0,'AP-high',3.0); ap.mount=2.6; f.aps.push(ap);
      var ap2=makeAP(0,0,'AP-low',3.0); ap2.mount=1.2; f.aps.push(ap2);
      f.ceilingAreas.push({id:'cHole',height:3.00,thickness:0.10,materialId:M2,extraLossDb:0,
        footprint:{parts:[{outer:[{x:-20,y:-20},{x:20,y:-20},{x:20,y:20},{x:-20,y:20}],
                            holes:[[{x:-4,y:-4},{x:4,y:-4},{x:4,y:4},{x:-4,y:4}]]}]}});
      state.floors.push(freshFloor('F1',1));
      var f1=state.floors[1];
      f1.height=3.0; f1.w=40; f1.d=40; f1.ceilingAreas=[];
      f1.slabMaterialId=M4;
      f1.openings.push({id:'op',points:[{x:-8,y:-8},{x:8,y:-8},{x:8,y:8},{x:-8,y:8}]});`,
    describe(g) {
      const c = g.geom.ceilings[0], s = g.geom.slabs[0];
      const ch = c && c.plan && c.plan.parts && c.plan.parts[0] && c.plan.parts[0].holes[0];
      const sh = s && s.plan && s.plan.parts && s.plan.parts[0] && s.plan.parts[0].holes[0];
      const cb = ch ? ringBox(ch) : null, sb2 = sh ? ringBox(sh) : null;
      return {
        title: `Ceiling at ${f2(c ? c.zBottom : 0)}–${f2(c ? c.zTop : 0)} m attenuating upward paths — ${g.ap.name} at ${f2(g.ap.z)} m`,
        annotations: [
          ['receiver plane Z', `${f2(g.cloud.receiverPlaneZ)} m (floor 1)`],
          ['AP Z (this fan)', `${f2(g.ap.z)} m`],
          ['Ceiling Z interval', `${f2(c ? c.zBottom : 0)} .. ${f2(c ? c.zTop : 0)} m`],
          ['Ceiling thickness', `${f2(c ? c.zTop - c.zBottom : 0)} m`],
          ['Ceiling hole', cb ? `x ${f2(cb.minx)}..${f2(cb.maxx)}, y ${f2(cb.miny)}..${f2(cb.maxy)} m` : '—'],
          ['slab Z interval', `${f2(s ? s.zBottom : 0)} .. ${f2(s ? s.zTop : 0)} m`],
          ['slab Opening', sb2 ? `x ${f2(sb2.minx)}..${f2(sb2.maxx)}, y ${f2(sb2.miny)}..${f2(sb2.maxy)} m` : '—'],
          ['Ceiling loss / crossing', `${f2(c ? c.loss : 0)} dB`],
          ['slab loss / crossing', `${f2(s ? s.loss : 0)} dB`],
          ['Ceiling crossings', g.tally.ceiling.n ? `${g.tally.ceiling.n} samples, ${f2(g.tally.ceiling.lossSum / g.tally.ceiling.n)} dB each` : '0'],
          ['slab crossings', g.tally.slab.n ? `${g.tally.slab.n} samples, ${f2(g.tally.slab.lossSum / g.tally.slab.n)} dB each` : '0 — every upward path found the Opening'],
        ],
        emphasise: ch ? [{ kind: 'ring', ring: ch }] : [],
        notes: [
          'Green = Ceiling solid, gold dashed = Ceiling hole. The floor-0 height is 3.00 m, so the Ceiling sits at its true 2.90..3.00 and is NOT lowered.',
          'Outside the hole but inside the wider slab Opening band, the path crosses the Ceiling AND bypasses the slab: those samples carry exactly the Ceiling loss.',
          'AP-high sits only 0.4 m under the Ceiling, so its upward rays are decided almost entirely by the hole. AP-low has 1.8 m of vertical travel and shows the split clearly.',
        ],
      };
    },
  },
  {
    id: 'wall-reflections',
    note: 'Reflected paths that still cross the horizontal receiver plane.',
    plane: 'rt3dReceiverPlaneZForFloor(0)',
    build: `
      state=freshState();
      var f=state.floors[0];
      f.height=4.0; f.w=40; f.d=40; f.ceilingAreas=[];
      var M4=state.materials[4].id;
      var ap=makeAP(0,0,'AP-1',4.0); ap.mount=2.6; f.aps.push(ap);
      f.walls.push({id:'w1',x1:-8,y1:-20,x2:-8,y2:20,materialId:M4,thickness:0.15});
      f.walls.push({id:'w2',x1:8,y1:-20,x2:8,y2:20,materialId:M4,thickness:0.15});
      f.rfObjects.push({id:'blk',x:0,y:10,width:2,depth:2,height:1.0,rotation:0,
        materialId:M4,extraLossDb:0});`,
    describe(g) {
      const wl = g.geom.walls;
      return {
        title: `Reflected paths reaching the receiver plane at ${f2(g.cloud.receiverPlaneZ)} m — ${g.cloud.diagnostics.reflectedSamples} reflected of ${g.cloud.samples.length} samples`,
        annotations: [
          ['receiver plane Z', `${f2(g.cloud.receiverPlaneZ)} m (floor 0)`],
          ['AP Z', `${f2(g.ap.z)} m`],
          ['reflecting walls', wl.length ? wl.map((w) => `x=${f2(w.x1)}`).join(', ') + ' m' : '—'],
          ['wall Z interval', wl.length ? `${f2(wl[0].zBottom)} .. ${f2(wl[0].zTop)} m` : '—'],
          ['direct / reflected', `${g.cloud.diagnostics.directSamples} / ${g.cloud.diagnostics.reflectedSamples}`],
          ['reflection loss each', `${f2(g.cloud.diagnostics.reflectionLossDb)} dB`],
          ['wall crossings before the plane', g.tally.wall.n ? `${g.tally.wall.n} samples, ${f2(g.tally.wall.lossSum / g.tally.wall.n)} dB each` : '0'],
          ['bodies charged', describeKinds(g.tally)],
        ],
        emphasise: wl.map((w) => ({ kind: 'wall', body: w })),
        notes: [
          'Hollow rings = reflected samples, filled dots = direct. The reflecting walls are outlined in amber.',
          'A vertical-wall reflection preserves dz exactly, so a reflected path is still vertically monotonic, still crosses the plane, and carries the reflection budget accumulated before the crossing.',
        ],
      };
    },
  },
];

const REAL_PROJECT = `
  state=freshState();
  var f=state.floors[0];
  f.height=3.0; f.w=18; f.d=14; f.ceilingAreas=[];
  var M4=state.materials[4].id, M2=state.materials[2].id, M0=state.materials[0].id;
  var W=9,H=7, pts=[[-W,-H],[W,-H],[W,H],[-W,H]];
  for(var i=0;i<4;i++){ var a=pts[i], b=pts[(i+1)%4];
    f.walls.push({id:'w'+i,x1:a[0],y1:a[1],x2:b[0],y2:b[1],materialId:M4,
                  thickness:DEFAULT_WALL_THICKNESS_M}); }
  f.walls.push({id:'gp',x1:0,y1:-7,x2:0,y2:2,materialId:M0,thickness:DEFAULT_WALL_THICKNESS_M});
  f.pillars.push({id:'p1',x:-3,y:2,diameter:0.5,materialId:M4});
  f.rfObjects.push({id:'rack',x:4,y:3,width:1.0,depth:2.2,height:2.0,rotation:0,
    materialId:M4,extraLossDb:2});
  var ap1=makeAP(-5,0,'AP-1',3.0); f.aps.push(ap1);
  var ap2=makeAP(5,0,'AP-2',3.0); ap2.channels={'2.4':6,'5':44,'6':53}; f.aps.push(ap2);
  f.ceilingAreas.push({id:'c1',height:2.95,thickness:0.10,materialId:M2,extraLossDb:0,
    footprint:{parts:[{outer:[{x:-9,y:-7},{x:9,y:-7},{x:9,y:7},{x:-9,y:7}],
                        holes:[[{x:-2,y:-2},{x:2,y:-2},{x:2,y:2},{x:-2,y:2}]]}]}});`;

// Run one scene: for each AP, the BVH cloud, the linear cloud, an equality
// assert between them, and the harness-side loss tally.
function runScene(buildSrc, planeExpr, apFloorIdx) {
  const fans = V(`(function(){
    ${buildSrc}
    var world=rt3dBuildWorld();
    var planeZ=${planeExpr};
    var F=JSON.parse(JSON.stringify(${JSON.stringify(FAN)}));
    var o={maxDistance:${MAXD}};
    var out=[];
    state.floors[${apFloorIdx}].aps.forEach(function(ap){
      var a=rt3dTraceFan(world, ap, ${apFloorIdx}, planeZ, Object.assign({backend:'linear'}, F, o));
      var b=rt3dTraceFan(world, ap, ${apFloorIdx}, planeZ, Object.assign({backend:'bvh'},    F, o));
      out.push({ap:ap.name, cloud:b,
                identical: JSON.stringify(a.samples)===JSON.stringify(b.samples)});
    });
    return out;
  })()`);
  const geom = V(`(function(){ ${buildSrc}\n${GEOMETRY_BODY(apFloorIdx)}\n    return geometry; })()`);
  for (const e of fans) {
    e.tally = lossTally(sb, { buildSrc, apName: e.ap, floorIdx: apFloorIdx,
                             planeExpr, fan: FAN, maxDistance: MAXD });
    if (!e.tally || !e.tally._samples) {
      console.error('FAIL tally empty for ' + e.ap + ': ' + JSON.stringify(e.tally));
      process.exitCode = 1;
    }
  }
  return { fans, geom };
}

function emit(sceneId, buildSrc, planeExpr, apFloorIdx, describeFn, subtitle, extraNotes) {
  const { fans, geom } = runScene(buildSrc, planeExpr, apFloorIdx);
  const out = [];
  for (const e of fans) {
    if (!e.identical) {
      console.error(`FAIL ${sceneId}/${e.ap}: BVH and linear sample clouds differ`);
      process.exitCode = 1;
    }
    const ap = geom.aps.find((a) => a.name === e.ap);
    const g = { geom, ap, cloud: e.cloud, tally: e.tally };
    let desc;
    if (describeFn) desc = describeFn(g);
    else {
      desc = {
        title: `Project-like scene — ${e.ap} at Z ${f2(ap.z)} m, receiver plane ${f2(e.cloud.receiverPlaneZ)} m`,
        annotations: [
          ['receiver plane Z', `${f2(e.cloud.receiverPlaneZ)} m (floor ${apFloorIdx})`],
          ['AP Z', `${f2(ap.z)} m`],
          ['direct / reflected', `${e.cloud.diagnostics.directSamples} / ${e.cloud.diagnostics.reflectedSamples}`],
          ['bodies charged (n x mean dB)', describeKinds(e.tally)],
          ['samples paying any loss', `${chargedShare(e.tally)} / ${e.tally._samples}`],
          ['avg events per ray', String(e.cloud.diagnostics.averageEventsPerRay)],
          ['avg path length', `${e.cloud.diagnostics.averagePathDistance} m`],
        ],
        emphasise: [],
        notes: [
          'Same code path as the fixtures. This is a scatter of real path intersections, not a coverage map.',
          'No grid, no interpolation, no splatting: empty space means no path reached the plane there.',
          ...(extraNotes || []),
        ],
      };
    }
    const file = path.join(OUT, `${sceneId}--${e.ap}.svg`);
    writeCloudSvg({ ...e.cloud, geometry: geom }, file, {
      title: desc.title,
      subtitle,
      annotations: desc.annotations,
      emphasise: desc.emphasise,
      notes: desc.notes,
    });
    out.push({ id: `${sceneId}/${e.ap}`, file, title: desc.title, identical: e.identical,
               d: e.cloud.diagnostics });
  }
  return out;
}

const results = [];
for (const sc of SCENES) results.push(...emit(sc.id, sc.build, sc.plane, 0, sc.describe, sc.note));
results.push(...emit('real-project', REAL_PROJECT, 'rt3dReceiverPlaneZForFloor(0)', 0, null,
  'Deterministic diagnostic fixture: outer shell, glass partition, pillar, rack, Ceiling with a hole, two APs. ' +
  'NOT the project open in a browser.'));

console.log('Stage 4 manual smoke — receiver-plane sample clouds WITH scene geometry\n');
console.log('SCOPE: these are DETERMINISTIC DIAGNOSTIC FIXTURES built in the Node');
console.log('harness. This script does NOT read or load the project currently open');
console.log('in a browser, and does not touch the running app.\n');
console.log('Scatter plots of real path intersections — NOT heatmaps: no grid, no');
console.log('interpolation, no splatting, no smoothing, no filling of empty space.\n');
for (const r of results) {
  console.log(`${r.id}`);
  console.log(`   ${r.title}`);
  console.log(`   emitted ${r.d.totalEmittedRays} rays -> ${r.d.raysReachingPlane} reached the plane, ` +
              `${r.d.raysTerminatedBeforePlane} did not`);
  console.log(`   direct/refl ${r.d.directSamples} / ${r.d.reflectedSamples}, ` +
              `${r.d.averageEventsPerRay} avg events/ray, ${r.d.averagePathDistance} m avg path`);
  console.log(`   backends agree ${r.identical}`);
  console.log(`   svg            ${r.file}`);
  console.log('');
}
console.log(`Wrote ${results.length} SVG files to ${OUT}`);
console.log('Open them in a browser. Amber outlines mark the body each scene is about.');
console.log('Hollow rings = reflected samples, filled dots = direct. Colour = dBm.');
