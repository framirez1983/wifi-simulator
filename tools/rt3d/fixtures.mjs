// Stage 1A — deterministic fixtures for the migration oracle.
//
// Each fixture is a project-state BUILDER expressed in the app's own
// terms, so the geometry it produces is canonical project data and not a
// mock. Builders run INSIDE the sandbox, where `freshState()` and the
// real material table are in scope.
//
// Coverage required by the migration plan:
//   direct ray, one wall transmission, one wall reflection,
//   multiple wall interactions, pillar, RF Object, opening/slab,
//   two APs, and different active-floor elevations.
import { run } from './loader.mjs';

const M = 'state.materials[4].id';   // a solid, lossy material
const G = 'state.materials[2].id';   // glass

// A single floor, 20x14, one AP offset from the origin. Every builder
// receives its OWN fresh state as `s`, so fixtures can never contaminate
// each other. The AP is deliberately NOT at (0,0): walls that pass through
// the launch point are degenerate for BOTH engines and would test nothing.
const BASE = `
  const s=state;
  const f=s.floors[0];
  f.height=3.0; f.w=20; f.d=14;
  const ap=makeAP(-3,-3,'AP-1', 3.0);
  f.aps.push(ap);
`;

export const FIXTURES = [
  {
    // 1. direct ray — no obstacles at all
    name: 'direct',
    build: new Function(`
      ${BASE}
      return s;
    `),
  },
  {
    // 2. one wall transmission
    name: 'wall-transmission',
    build: new Function(`
      ${BASE}
      f.walls.push({id:'w1',x1:-5,y1:1,x2:5,y2:1,materialId:${M},thickness:0.15});
      return s;
    `),
  },
  {
    // 3. one wall reflection — a wall the rays hit face-on
    name: 'wall-reflection',
    build: new Function(`
      ${BASE}
      f.walls.push({id:'w1',x1:1,y1:-7,x2:1,y2:7,materialId:${M},thickness:0.15});
      return s;
    `),
  },
  {
    // 4. multiple wall interactions — a corridor
    name: 'multi-wall',
    build: new Function(`
      ${BASE}
      f.walls.push({id:'w1',x1:1,y1:-7,x2:1,y2:7,materialId:${M},thickness:0.15});
      f.walls.push({id:'w2',x1:-7,y1:2,x2:7,y2:2,materialId:${M},thickness:0.15});
      f.walls.push({id:'w3',x1:-4,y1:2,x2:-4,y2:6,materialId:${G},thickness:0.15});
      f.walls.push({id:'w4',x1:4,y1:-6,x2:4,y2:2,materialId:${M},thickness:0.15});
      return s;
    `),
  },
  {
    // 5. pillar
    name: 'pillar',
    build: new Function(`
      ${BASE}
      f.pillars.push({id:'p1',x:1.5,y:1.5,diameter:0.6,height:null,materialId:${M}});
      f.pillars.push({id:'p2',x:0,y:-1,diameter:0.4,height:null,materialId:${G}});
      return s;
    `),
  },
  {
    // 6. RF Object
    name: 'rf-object',
    build: new Function(`
      ${BASE}
      f.rfObjects.push({id:'o1',x:2.0,y:2.0,width:2.0,depth:1.2,height:2.2,rotation:30,materialId:${M},extraLossDb:1.5});
      f.rfObjects.push({id:'o2',x:0.0,y:-1.0,width:1.0,depth:3.0,height:1.8,rotation:-15,materialId:${G},extraLossDb:0});
      return s;
    `),
  },
  {
    // 7. opening / slab — two floors with a real Opening on floor 1's slab
    name: 'opening-slab',
    build: new Function(`
      ${BASE}
      s.floors.push(freshFloor('Floor 1', 1));
      const f1=s.floors[1];
      f1.height=3.0; f1.w=20; f1.d=14;
      f1.openings.push({id:'op1',points:[{x:-1.5,y:-1.5},{x:1.5,y:-1.5},{x:1.5,y:1.5},{x:-1.5,y:1.5}]});
      f1.slabMaterialId=${M};
      s.activeFloor=1;
      const ap2=makeAP(-3,-3,'AP-1', 3.0);
      f1.aps.push(ap2);
      return s;
    `),
  },
  {
    // 8. two APs
    name: 'two-aps',
    build: new Function(`
      ${BASE}
      const ap2=makeAP(4,3,'AP-2', 3.0);
      ap2.channels={'2.4':6,'5':44,'6':53};
      f.aps.push(ap2);
      f.walls.push({id:'w1',x1:1,y1:-6,x2:1,y2:6,materialId:${M},thickness:0.15});
      return s;
    `),
  },
  {
    // 9. non-zero floor elevation — the active floor is raised, so every
    //    AP/receiver Z and the slab plane sit above zero
    name: 'floor-elevation',
    build: new Function(`
      ${BASE}
      s.floors[0].height=4.2;
      s.floors.push(freshFloor('Floor 1', 1));
      const f1=s.floors[1];
      f1.height=2.6; f1.w=20; f1.d=14;
      s.activeFloor=1;
      f1.aps.push(makeAP(-3,-3,'AP-1', 2.6));
      f1.walls.push({id:'w1',x1:1,y1:-5,x2:1,y2:5,materialId:${M},thickness:0.15});
      return s;
    `),
  },
];

export function buildFixture() {
  return FIXTURES;
}

// Install a fixture as the live state, inside the sandbox. A fresh state is
// assigned FIRST, because the builder reads the lexical `state` binding and
// would otherwise mutate whatever the previous fixture left behind.
export function install(sb, f) {
  return run(sb, `state=freshState(); (${f.build.toString()})(); state`);
}
