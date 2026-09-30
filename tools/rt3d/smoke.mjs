// Smoke test: boot the app for real. The DOM stubs are the same ones the rest
// of the harness uses, but `start()` is invoked exactly as the browser does,
// so seedDemo(), the UI wiring and the initial heat schedule all run. Then
// the production ray trace is executed on the seeded demo scene and its stats
// are printed, which is the strongest headless evidence that the page still
// works end to end.
import { loadApp, run, blankState } from './loader.mjs';

const sb = loadApp();
blankState(sb);

const boot = run(sb, `(function(){
  try {
    start();
    return JSON.stringify({ ok:true });
  } catch(e){
    return JSON.stringify({ ok:false, err:String(e && e.stack || e) });
  }
})()`);
const b = JSON.parse(boot);
if (!b.ok) { console.error('BOOT FAILED:\n' + b.err); process.exit(1); }
console.log('start() ok — app booted, demo scene seeded');

const scene = JSON.parse(run(sb, `JSON.stringify({
  floors: state.floors.length,
  activeFloor: state.activeFloor,
  walls: state.floors[0].walls.length,
  aps: state.floors[0].aps.length,
  materials: state.materials.length,
  band: state.band
})`));
console.log('seeded scene:', JSON.stringify(scene));

// run the PRODUCTION engine on the seeded demo room
const stats = await (async () => {
  const { runOldEngine } = await import('./engines.mjs');
  const old = await runOldEngine(sb);
  return old;
})();
const s = stats.stats;
console.log('production runRayTrace on the demo room:');
console.log('  initialRays       =', s.initialRays);
console.log('  processedBranches =', s.processedBranches);
console.log('  grid              =', stats.grid.cols + 'x' + stats.grid.rows,
            `(${s.totalCells} cells, ${s.finiteCells} finite)`);
console.log('  quality           =', s.quality);
console.log('  grid fingerprint  =', stats.grid.fingerprint);
console.log('  representative    =', stats.grid.cells.slice(0, 3).map((c) => c.rssi + ' dBm').join(', '));

// the new kernel must build a world on the very same live scene
const kern = JSON.parse(run(sb, `JSON.stringify({
  world: rt3dWorldSignature(rt3dBuildWorld()),
  bounds: rt3dWorldBounds(rt3dBuildWorld())
})`));
console.log('new kernel world on the same scene:', kern.world);
console.log('world bounds:', JSON.stringify(kern.bounds));

// and its horizontal trace must reproduce the production grid exactly
const cmp = JSON.parse(run(sb, `JSON.stringify((function(){
  var t=rt3dHorizontalTrace(rt3dBuildWorld(), state.floors[state.activeFloor]);
  var h=0x811c9dc5;
  function put(v){ h^=v&0xff; h=Math.imul(h,0x01000193)>>>0;
                   h^=(v>>>8)&0xff; h=Math.imul(h,0x01000193)>>>0;
                   h^=(v>>>16)&0xff; h=Math.imul(h,0x01000193)>>>0; }
  for(var k=0;k<t.best.length;k++){ var v=t.best[k];
    if(!isFinite(v)) put(0x7fffffff); else put(Math.round(v*100)|0); }
  return { fp:('00000000'+h.toString(16)).slice(-8), rays:t.initialRays, branches:t.processedBranches };
})())`));
console.log('new kernel horizontal trace:', JSON.stringify(cmp));
console.log(stats.grid.fingerprint === cmp.fp && s.initialRays === cmp.rays &&
            s.processedBranches === cmp.branches
  ? '\nSMOKE TEST PASSED — production and new kernel agree on the demo room'
  : '\nSMOKE TEST MISMATCH');
if (!(stats.grid.fingerprint === cmp.fp && s.initialRays === cmp.rays &&
      s.processedBranches === cmp.branches)) process.exit(1);
