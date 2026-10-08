// Stage 7A fixture geometry — the single definition shared by the numerical
// oracle and the Worker equivalence suite.
//
// It lives here rather than inside either suite so the two cannot drift: both
// prove things about the SAME thirteen scenes. Both suites also require these
// AP ids to be deterministic. makeAP() is production code and calls uid('ap'),
// which is Math.random()-based; that is correct for the editor and is
// deliberately NOT changed for tests. The ids are pinned HERE, in the fixture,
// so an identical scene yields an identical fingerprint across independent
// builds and across execution contexts.
// One floor, 24 x 18 m, ceiling height 3.2 m, receiver plane at 1.2 m.
const BASE = `
  state=freshState(); state.floors.length=1;
  var f=state.floors[0];
  f.id='flr_a'; f.name='FA'; f.w=24; f.d=18; f.height=3.2;
  f.walls=[]; f.pillars=[]; f.rfObjects=[]; f.ceilingAreas=[]; f.openings=[]; f.aps=[];
  state.activeFloor=0; state.receiverHeight=1.2;
`;
// An AP on floor 0; mount defaults to clampApMount(2.6, floorHeight).
//
// The AP id is an EXPLICIT FIXTURE VALUE, assigned after makeAP(). makeAP() is
// production code and calls uid('ap'), which is Math.random()-based; that is
// correct for the editor and is deliberately NOT touched here. But this oracle
// compares whole fingerprints, including apId and servingApId, across
// independent builds and across execution contexts, so a random identity makes
// two identical scenes compare unequal for a reason that has nothing to do with
// physics. Pinning the id in the fixture keeps production identity semantics
// exactly as they are and makes the comparison depend on RF values alone.
const apOn = (id, x, y, name, mount, mountType, antenna) => `
  var a=makeAP(${x},${y},'${name}',f.height);
  a.id='${id}';
  a.mount=${mount}; a.mountType='${mountType}';
  a.antenna=${JSON.stringify(antenna)};
  f.aps.push(a);`;

// 13 probe points on a fixed lattice; identical for every fixture so the
// comparison is across fixtures as well as across runs.
const POINTS = [[0,0],[3,0],[-3,0],[6,0],[-6,0],[0,4],[0,-4],[6,6],[-6,-6],[9,0],[0,8],[-9,3]];

// A small fixed slice so the grid fingerprint is cheap but still exercises the
// cursor across several rows and a partial-row resume.
const GRID = { cols: 24, rows: 18, cell: 0.5, minx: -6, miny: -4.5 };

const FIXTURES = [
  { id: 'emptyLos', title: 'empty LOS: one ceiling omni, nothing in the way',
    scene: `${BASE}${apOn('ap_a', 0, 0, 'AP-A', 2.6, 'ceiling', { type: 'omni', az: 0, tilt: 0, gain: 3 })}` },

  { id: 'walls', title: 'walls: a partition with one door Opening, both sides probed',
    scene: `${BASE}
      f.walls.push({id:'w1',x1:-8,y1:0,x2:8,y2:0,height:3.2,
        materialId:state.materials[4].id, thickness:DEFAULT_WALL_THICKNESS_M});
      f.openings.push({id:'op1',points:[{x:-1,y:-0.9},{x:1,y:-0.9},{x:1,y:0.9},{x:-1,y:0.9}]});
      ${apOn('ap_a', 0, -5, 'AP-A', 2.6, 'ceiling', { type: 'omni', az: 0, tilt: 0, gain: 3 })}` },

  { id: 'rotatedRfObject', title: 'rotated RF Object: a 30-degree prism, footprint spans probed',
    scene: `${BASE}
      f.rfObjects.push({id:'rk1',x:0,y:0,width:3,depth:2,height:2.0,rotation:30,
        materialId:state.materials[4].id, extraLossDb:0});
      ${apOn('ap_a', -6, -6, 'AP-A', 2.6, 'ceiling', { type: 'omni', az: 0, tilt: 0, gain: 3 })}` },

  { id: 'pillars', title: 'pillars: two 0.4 m prisms straddling the path',
    scene: `${BASE}
      f.pillars.push({id:'p1',x:-2,y:0,r:0.2,height:3.2,
        materialId:state.materials[4].id, extraLossDb:0});
      f.pillars.push({id:'p2',x:2,y:0,r:0.2,height:3.2,
        materialId:state.materials[4].id, extraLossDb:0});
      ${apOn('ap_a', -6, 0, 'AP-A', 2.6, 'ceiling', { type: 'omni', az: 0, tilt: 0, gain: 3 })}` },

  { id: 'slabSolid', title: 'slab solid traversal: two floors, receiver below a solid slab',
    scene: `${BASE}
      var pa=JSON.parse(JSON.stringify(f));
      pa.id='flr_b'; pa.name='FB'; pa.openings=[]; pa.ceilingAreas=[];
      pa.aps=[];
      state.floors.push(pa); state.activeFloor=1;
      ${apOn('ap_b', 0, 0, 'AP-B', 2.6, 'ceiling', { type: 'omni', az: 0, tilt: 0, gain: 3 })}` },

  { id: 'slabOpening', title: 'slab Opening bypass: the same slab, holed on the owning floor',
    scene: `${BASE}
      var pa=JSON.parse(JSON.stringify(f));
      pa.id='flr_b'; pa.name='FB'; pa.ceilingAreas=[];
      pa.openings=[{id:'op1',points:[{x:-9,y:-9},{x:9,y:-9},{x:9,y:9},{x:-9,y:9}]}];
      pa.aps=[];
      state.floors.push(pa); state.activeFloor=1;
      ${apOn('ap_b', 0, 0, 'AP-B', 2.6, 'ceiling', { type: 'omni', az: 0, tilt: 0, gain: 3 })}` },

  { id: 'ceilingTraversal', title: 'Ceiling traversal: a solid Ceiling Area above the receiver',
    // The AP is mounted at 2.9 m, ABOVE the 2.6 m ceiling. It has to be: an AP
    // mounted below the ceiling never crosses it, so a ray from 2.4 m down to the
    // 1.2 m receiver plane is unobstructed and this fixture would freeze a
    // zero it claims is a traversal.
    scene: `${BASE}
      f.ceilingAreas.push({id:'cl1',height:2.6,thickness:0.10,
        materialId:state.materials[4].id, extraLossDb:0,
        footprint:{parts:[{outer:[{x:-12,y:-9},{x:12,y:-9},{x:12,y:9},{x:-12,y:9}],
                           holes:[]}]}});
      ${apOn('ap_a', 0, 0, 'AP-A', 2.9, 'ceiling', { type: 'omni', az: 0, tilt: 0, gain: 3 })}` },

  { id: 'ceilingHoleBypass', title: 'Ceiling hole bypass: a hole the straight path passes through',
    // Same 2.9 m mount as ceilingTraversal, so the only difference between the two
    // fixtures is the hole. Anything else would make this fixture pass without
    // ever reaching the ceiling.
    scene: `${BASE}
      f.ceilingAreas.push({id:'cl1',height:2.6,thickness:0.10,
        materialId:state.materials[4].id, extraLossDb:0,
        footprint:{parts:[{outer:[{x:-12,y:-9},{x:12,y:-9},{x:12,y:9},{x:-12,y:9}],
                           holes:[[{x:-6,y:-6},{x:6,y:-6},{x:6,y:6},{x:-6,y:6}]]}]}});
      ${apOn('ap_a', 0, 0, 'AP-A', 2.9, 'ceiling', { type: 'omni', az: 0, tilt: 0, gain: 3 })}` },

  { id: 'reflectionWinner', title: 'first-order reflection wins over the direct path',
    // WHY THIS GEOMETRY. A reflection can only win if its two legs cross FEWER
    // attenuating bodies than the direct ray, because it always pays
    // RT3D_REFLECTION_LOSS_DB (5 dB) on top and is always the longer path. A
    // single FULL-width blocker therefore cannot be beaten: with the AP and the
    // receiver on opposite sides of one continuous wall, whichever leg reaches
    // the specular point, the other crosses the wall exactly once, so the
    // reflected path is charged the same 15 dB and loses on both counts. The
    // previous version of this fixture used precisely that wall and could never
    // elect a reflection at any probe point.
    //
    // So the blocker is PARTIAL: 'block' spans y=-9..3, which the direct ray to
    // the probes at y=0 crosses, while the specular point on 'refl' (y=8) sits
    // clear of it and BOTH legs pass above its top edge. The reflected path is
    // charged 0 dB of material and wins purely on geometry.
    //
    // The crossing points are checked, not assumed: for the probes where a
    // reflection wins -- (3,0), (6,0), (9,0) -- the direct ray meets x=0 at
    // y = 0.67 / 1.0 / 1.2, i.e. at least 1.8 m inside the blocker's y=-9..3
    // span. Nothing here depends on a grazing or knife-edge intersection.
    scene: `${BASE}
      f.walls.push({id:'block',x1:0,y1:-9,x2:0,y2:3,height:3.2,
        materialId:state.materials[4].id, thickness:DEFAULT_WALL_THICKNESS_M});
      f.walls.push({id:'refl',x1:-12,y1:8,x2:12,y2:8,height:3.2,
        materialId:state.materials[4].id, thickness:DEFAULT_WALL_THICKNESS_M});
      ${apOn('ap_a', -6, 2, 'AP-A', 2.6, 'ceiling', { type: 'omni', az: 0, tilt: 0, gain: 3 })}` },

  { id: 'multiApServing', title: 'multiple AP serving selection: three APs, the strongest wins',
    scene: `${BASE}
      ${apOn('ap_a', -7, -5, 'AP-A', 2.6, 'ceiling', { type: 'omni', az: 0, tilt: 0, gain: 3 })}
      ${apOn('ap_b', 7, -5, 'AP-B', 2.6, 'ceiling', { type: 'omni', az: 0, tilt: 0, gain: 3 })}
      ${apOn('ap_c', 0, 7, 'AP-C', 2.6, 'ceiling', { type: 'omni', az: 0, tilt: 0, gain: 3 })}` },

  { id: 'wallOmniVertical', title: 'wall-mounted omni: the vertical model applies',
    scene: `${BASE}
      ${apOn('ap_a', 0, 0, 'AP-A', 1.4, 'wall', { type: 'omni', az: 0, tilt: 0, gain: 3 })}` },

  { id: 'ceilingOmniBypass', title: 'ceiling omni: the vertical model is bypassed',
    scene: `${BASE}
      ${apOn('ap_a', 0, 0, 'AP-A', 2.6, 'ceiling', { type: 'omni', az: 0, tilt: 0, gain: 3 })}
      ${apOn('ap_b', 0, 0, 'AP-B', 2.6, 'ceiling', { type: 'omni', az: 0, tilt: 0, gain: 3 })}` },

  { id: 'crossFloor', title: 'cross-floor: AP above, receiver below, both floors have APs',
    scene: `${BASE}
      var pa=JSON.parse(JSON.stringify(f));
      pa.id='flr_b'; pa.name='FB'; pa.openings=[]; pa.ceilingAreas=[];
      pa.walls=[{id:'w2',x1:-9,y1:3,x2:9,y2:3,height:3.2,
        materialId:state.materials[4].id, thickness:DEFAULT_WALL_THICKNESS_M}];
      pa.aps=[];
      state.floors.push(pa); state.activeFloor=1;
      ${apOn('ap_a', 0, -6, 'AP-A', 2.6, 'ceiling', { type: 'omni', az: 0, tilt: 0, gain: 3 })}
      var pb=state.floors[0];
      var b=makeAP(0,6,'AP-B',pb.height); b.id='ap_b'; b.mount=2.6; b.mountType='ceiling';
      b.antenna={type:'omni',az:0,tilt:0,gain:3}; pb.aps.push(b);` },
];

export { BASE, apOn, POINTS, GRID, FIXTURES };
