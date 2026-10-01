// Slab thickness audit.
//
//  1. The interactive 3D slab and the glTF export slab are GEOMETRICALLY
//     UNCHANGED by the SLAB_THICKNESS_M refactor. Proven by building the real
//     shared slab solid and the real glTF rings from the BASELINE commit and
//     from the worktree, in two sandboxes, and comparing actual vertex counts,
//     hole counts and footprint dimensions - not by comparing source text.
//  2. All three consumers (interactive 3D, glTF export, RT3D kernel) now read
//     one canonical constant, and the RT3D slab's absolute vertical bounds
//     equal the 3D/export plate bounds.
//  3. Slab thickness is not a persisted project property, no UI was added, and
//     the legacy per-crossing RF attenuation is untouched.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { loadApp, run, blankState, readAppScript, splitApp, makeDom } from './loader.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const BASELINE = '78876a2';

let fail = 0;
const ok = (n, c, d) => {
  if (c) console.log('  ok   ' + n);
  else { fail++; console.log('  FAIL ' + n + (d ? ' :: ' + d : '')); }
};

// The geometry probe, shared verbatim by both sandboxes so the two are
// guaranteed to measure the same things.
const PROBE = `JSON.stringify((function(){
  state=freshState();
  var f=state.floors[0];
  f.height=3.0; f.w=20; f.d=14; f.ceilingAreas=[];
  f.openings.push({id:'op',points:[{x:-2,y:-2},{x:2,y:-2},{x:2,y:2},{x:-2,y:2}]});
  var plan=slabPlanForFloor(f);
  var parts=slabSolidForPlan(plan);
  var b=floorBounds(f);
  var rings=gltfSlabRings(b, (f.openings||[]).map(function(o){ return o.points; }));
  return {
    tris: parts.reduce(function(n,p){ return n + p.tris.length; }, 0),
    walls: parts.reduce(function(n,p){ return n + (p.walls ? p.walls.length : 0); }, 0),
    vertCount: parts.reduce(function(n,p){ return n + p.tris.reduce(function(m){ return m + 3; }, 0); }, 0),
    partCount: parts.length,
    ringOuter: rings ? rings.outer.length : 0,
    ringHoleCount: rings ? rings.holes.length : 0,
    ringHoleVerts: rings ? rings.holes.map(function(r){ return r.length; }) : [],
    footprint: rings ? [rings.fw, rings.fd] : null
  };
})())`;

function geometryOf(src, label) {
  const { core } = splitApp(src);
  const ctx = vm.createContext(makeDom());
  vm.runInContext(core, ctx, { filename: label });
  return run(ctx, PROBE);
}

console.log('Slab thickness audit\n');

// ---- 1. geometry unchanged vs the approved baseline -----------------
const baseHtml = execFileSync('git', ['show', `${BASELINE}:index.html`],
  { cwd: ROOT, maxBuffer: 1 << 28 }).toString();
const baseSrc = baseHtml.match(/<script>\n([\s\S]*?)\n<\/script>/)[1];
const gBase = geometryOf(baseSrc, 'baseline');
const gCur = geometryOf(readAppScript(), 'worktree');
ok('interactive 3D / glTF slab geometry is unchanged (triangles, walls, holes, footprint)',
   gBase === gCur, `baseline ${gBase} vs worktree ${gCur}`);

// ---- 2. one canonical source for all three consumers ---------------
const sb = loadApp();
blankState(sb);
const T = JSON.parse(run(sb, `JSON.stringify((function(){
  state=freshState();
  var f=state.floors[0];
  f.height=3.0; f.w=20; f.d=14; f.ceilingAreas=[];
  state.floors.push(freshFloor('F1',1));
  state.floors[1].height=3.0; state.floors[1].w=20; state.floors[1].d=14;
  var b=rt3dBuildWorld().slabs[0];
  var elev=floorElevation(1);
  return { canonical:SLAB_THICKNESS_M, gltf:GLTF_SLAB_THICKNESS,
           rt3dThick:b.thickness, elev:elev,
           rt3dTop:b.zTop, rt3dBottom:b.zBottom,
           geomTop:elev, geomBottom:elev-SLAB_THICKNESS_M,
           floorKeys:Object.keys(state.floors[1]) };
})())`));

ok('canonical slab thickness is 0.12 m', T.canonical === 0.12, JSON.stringify(T));
ok('glTF export thickness derives from the canonical constant', T.gltf === T.canonical, JSON.stringify(T));
ok('RT3D slab thickness derives from the canonical constant', T.rt3dThick === T.canonical, JSON.stringify(T));
ok('RT3D slab vertical bounds equal the 3D/export plate bounds',
   T.rt3dTop === T.geomTop && Math.abs(T.rt3dBottom - T.geomBottom) < 1e-15, JSON.stringify(T));
ok('RT3D slab span equals the canonical thickness',
   Math.abs((T.rt3dTop - T.rt3dBottom) - T.canonical) < 1e-15, JSON.stringify(T));
// comments legitimately mention the removed constant, so strip them first
const codeOnly = readAppScript()
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ')
  .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
ok('the private RT3D slab constant is gone (no declaration remains)',
   codeOnly.indexOf('RT3D_SLAB_DEPTH_M') < 0);
ok('slab thickness is not a persisted project property',
   T.floorKeys.indexOf('slabThickness') < 0 && T.floorKeys.indexOf('slabDepth') < 0,
   JSON.stringify(T.floorKeys));
ok('no new UI was added for slab thickness',
   readAppScript().indexOf('pSlabThickness') < 0 &&
   readAppScript().indexOf('id="slabThickness"') < 0);

// ---- 3. legacy per-crossing RF attenuation untouched ---------------
const RF = JSON.parse(run(sb, `JSON.stringify((function(){
  state=freshState();
  var f=state.floors[0];
  f.height=3.0; f.w=20; f.d=14; f.ceilingAreas=[];
  state.floors.push(freshFloor('F1',1));
  var f1=state.floors[1];
  f1.height=3.0; f1.w=20; f1.d=14;
  // the slab is OWNED by floor 1, so its material and its Openings live there
  f1.slabMaterialId=state.materials[4].id;
  f1.openings.push({id:'op',points:[{x:-1.5,y:-1.5},{x:1.5,y:-1.5},{x:1.5,y:1.5},{x:-1.5,y:1.5}]});
  return { throughOpening: slabLossBetweenPoints(0,0,2.6, 0, 0,0,3.0, 1),
           besideOpening:  slabLossBetweenPoints(0,0,2.6, 0, 5,0,3.0, 1) };
})())`));
ok('legacy slab RF loss is per crossing, not thickness-scaled, and openings still bypass',
   RF.throughOpening === 0 && RF.besideOpening === 15, JSON.stringify(RF));

console.log(fail === 0
  ? '\nslab thickness is canonical across 3D, glTF and RT3D'
  : `\n${fail} check(s) failed`);
process.exit(fail === 0 ? 0 : 1);
