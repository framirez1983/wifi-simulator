// Capture the PRODUCTION engine's deterministic result for one scene.
//
// runRayTrace() is untouched legacy code. To use it as an oracle without a
// browser, this drives it in the sandbox and replaces only the rendering
// tail (paint / draw / toast), which cannot influence the RF result. The
// physics, the ray queue, the marcher and the grid are the app's own.
import { run } from './loader.mjs';

export async function runOldEngine(sb) {
  // Suppress every side effect that is not the propagation result. These are
  // reassigned inside the sandbox; the engine still runs its own code.
  run(sb, `
    window.__rtNoop = function(){};
    paintHeat=function(){};
    draw2d=function(){};
    coverageUpdate=function(){};
    showToast=function(){};
    refresh3dHeat=function(){};
    scheduleHeat=function(){};
  `);
  // Drive the rAF loop to completion. The sandbox rAF is setTimeout-backed.
  await run(sb, `new Promise(function(res){
    var done=false;
    runRayTrace(function(){ done=true; });
    var guard=0;
    var tick=function(){
      if(done) return res(true);
      if(++guard>200000) return res(false);
      setTimeout(tick, 0);
    };
    setTimeout(tick, 0);
  })`);
  return run(sb, `({
    stats: JSON.parse(JSON.stringify(lastRayTraceStats||null)),
    meta: JSON.parse(JSON.stringify(heatMeta||null)),
    grid: (function(){
      var g=heatGridRssi, m=heatMeta, out=[];
      if(!g||!m) return {cols:0,rows:0,cells:[],fingerprint:null,hash:null};
      var cols=m.cols, rows=m.rows;
      var h=0x811c9dc5;
      function put(v){ h^=v&0xff; h=Math.imul(h,0x01000193)>>>0;
                       h^=(v>>>8)&0xff; h=Math.imul(h,0x01000193)>>>0;
                       h^=(v>>>16)&0xff; h=Math.imul(h,0x01000193)>>>0; }
      for(var k=0;k<g.length;k++){
        var v=g[k];
        if(v===-Infinity||!isFinite(v)) put(0x7fffffff); else put(Math.round(v*100)|0);
      }
      // representative cells
      var pts=[[0.5,0.5],[0.25,0.25],[0.75,0.25],[0.25,0.75],[0.75,0.75],[0.5,0.2],[0.2,0.5]];
      pts.forEach(function(s){
        var i=Math.min(cols-1,Math.max(0,Math.floor(s[0]*cols)));
        var j=Math.min(rows-1,Math.max(0,Math.floor(s[1]*rows)));
        var v=g[j*cols+i];
        out.push({i:i,j:j,rssi:isFinite(v)? +v.toFixed(4): null});
      });
      return {cols:cols, rows:rows, cells:out, fingerprint:('00000000'+h.toString(16)).slice(-8)};
    })()
  })`);
}

// The new kernel, horizontal compatibility mode, same scene.
export async function runNewEngine(sb, floorIndex) {
  const raw = run(sb, `JSON.stringify((function(){
    var world = rt3dBuildWorld();
    var f = state.floors[${floorIndex}];
    var t = rt3dHorizontalTrace(world, f);
    return {
      cols:t.cols, rows:t.rows,
      initialRays:t.initialRays, processedBranches:t.processedBranches,
      cells:t.cells, fingerprint:t.fingerprint,
      // grid-only hash, computed exactly like the oracle side, so the two
      // fingerprints are directly comparable
      gridFingerprint: (function(){
        var h=0x811c9dc5;
        function put(v){ h^=v&0xff; h=Math.imul(h,0x01000193)>>>0;
                         h^=(v>>>8)&0xff; h=Math.imul(h,0x01000193)>>>0;
                         h^=(v>>>16)&0xff; h=Math.imul(h,0x01000193)>>>0; }
        for(var k=0;k<t.best.length;k++){
          var v=t.best[k];
          if(v===-Infinity||!isFinite(v)) put(0x7fffffff); else put(Math.round(v*100)|0);
        }
        return ('00000000'+h.toString(16)).slice(-8);
      })(),
      world: rt3dWorldSignature(world)
    };
  })())`);
  return JSON.parse(await Promise.resolve(raw));
}
