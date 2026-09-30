// Debug aid: extract the PRODUCTION runRayTrace source from index.html, patch
// ONLY its depositCell in memory to log candidates for one target cell, and
// run it in a throwaway sandbox. The file on disk is never modified; this is
// the real legacy engine, so the logged deposits are the oracle's own.
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

// pull out the runRayTrace function source by brace matching
const startIdx = core.indexOf('function runRayTrace(onDone){');
if (startIdx < 0) throw new Error('runRayTrace not found');
let depth = 0, end = -1;
for (let i = core.indexOf('{', startIdx); i < core.length; i++) {
  const c = core[i];
  if (c === '{') depth++;
  else if (c === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
}
const fnSrc = core.slice(startIdx, end);

const patched = fnSrc
  .replace('function runRayTrace(onDone){', 'function runRayTraceDbg(onDone){')
  .replace('function depositCell(x,y,rssi){',
    'function depositCell(x,y,rssi){ if(window.__dbg) window.__dbg(x,y,rssi);');
if (!patched.includes('window.__dbg(x,y,rssi)')) throw new Error('patch did not apply');

const win = makeDom();
const ctx = vm.createContext(win);
vm.runInContext(core, ctx, { filename: 'index.html<script>' });
vm.runInContext(patched, ctx, { filename: 'runRayTrace.patched' });

const f = FIXTURES.find((x) => x.name === which);
if (!f) throw new Error('unknown fixture ' + which);

run(ctx, `
  state=freshState();
  (${f.build.toString()})();
  paintHeat=function(){}; draw2d=function(){}; coverageUpdate=function(){};
  showToast=function(){}; refresh3dHeat=function(){};
  var __m=rt3dGridSpec(floor()), __b=__m.b;
  window.__cands=[];
  window.__dbg=function(x,y,rssi){
    var i=Math.floor((x-__b.minx)/__m.cw), j=Math.floor((y-__b.miny)/__m.ch);
    if(i>=${cellI} && i<=${cellI2} && j>=${cellJ} && j<=${cellJ2} && rssi>${minR}) window.__cands.push([x,y,rssi]);
  };
`);

await run(ctx, `new Promise(function(res){
  var done=false;
  runRayTraceDbg(function(){ done=true; });
  var g=0;
  (function tick(){
    if(done) return res(true);
    if(++g>500000) return res(false);
    setTimeout(tick, 0);
  })();
})`);

const hits = JSON.parse(run(ctx, `JSON.stringify(window.__cands.map(function(a){
  return {x:+a[0].toFixed(4), y:+a[1].toFixed(4), rssi:+a[2].toFixed(4)};
}).sort(function(p,q){ return q.rssi-p.rssi; }))`));
console.log(`LEGACY deposits into box(${cellI}..${cellI2}, ${cellJ}..${cellJ2}) of ${which}: ${hits.length}`);
hits.forEach((h) => console.log('  ', JSON.stringify(h)));
