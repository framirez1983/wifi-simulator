// Debug aid: patch the new kernel's depositCell IN MEMORY (index.html on disk
// is untouched) and report the deposits that land in one target cell.
import vm from 'node:vm';
import { readAppScript, splitApp, makeDom, run } from './loader.mjs';
import { FIXTURES } from './fixtures.mjs';

const which = process.argv[2] || 'wall-reflection';
const cellI = Number(process.argv[3] ?? 75);
const cellJ = Number(process.argv[4] ?? 88);
const cellI2 = Number(process.argv[5] ?? cellI);
const cellJ2 = Number(process.argv[6] ?? cellJ);
const minR = Number(process.argv[7] ?? -Infinity);

const { core } = splitApp(readAppScript());
const patched = core.replace(
  'const depositCell=(x,y,rssi)=>{',
  `const depositCell=(x,y,rssi)=>{ if(window.__dbg) window.__dbg(x,y,rssi);`
);
if (patched === core) throw new Error('patch did not apply');

const win = makeDom();
const ctx = vm.createContext(win);
vm.runInContext(patched, ctx, { filename: 'index.html<script>+probe' });

const f = FIXTURES.find((x) => x.name === which);
run(ctx, `
  state=freshState();
  (${f.build.toString()})();
  var __m=rt3dGridSpec(floor()), __b=__m.b;
  window.__cands=[];
  window.__dbg=function(x,y,rssi){
    var i=Math.floor((x-__b.minx)/__m.cw), j=Math.floor((y-__b.miny)/__m.ch);
    if(i>=${cellI} && i<=${cellI2} && j>=${cellJ} && j<=${cellJ2} && rssi>${minR}) window.__cands.push([x,y,rssi]);
  };
  var world=rt3dBuildWorld();
  rt3dHorizontalTrace(world, state.floors[state.activeFloor||0]);
`);
const hits = JSON.parse(run(ctx, `JSON.stringify(window.__cands.map(function(a){
  return {x:+a[0].toFixed(4), y:+a[1].toFixed(4), rssi:+a[2].toFixed(4)};
}).sort(function(p,q){ return q.rssi-p.rssi; }))`));
console.log(`NEW deposits into box(${cellI}..${cellI2}, ${cellJ}..${cellJ2}) of ${which}: ${hits.length}`);
hits.forEach((h) => console.log('  ', JSON.stringify(h)));
