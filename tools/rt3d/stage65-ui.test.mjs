import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeDom, run } from './loader.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE,'..','..','index.html'),'utf8').match(/<script>\n([\s\S]*?)\n<\/script>/)[1];
let pass=0,fail=0;
const ck=(n,c,d)=>{ if(c){pass++;console.log('  ok   '+n);} else {fail++;console.log('  FAIL '+n+(d?' :: '+d:''));} };
// loader.run() returns the completion value; compare on trimmed strings so a
// whitespace difference can never masquerade as a wiring failure
const R=(ctx,code)=>String(run(ctx,code)).trim();

function boot(search){
  const win = makeDom(); win.location={search};

  const ctx=vm.createContext(win);
  vm.runInContext(SRC,ctx,{filename:'app'});
  run(ctx, `paintHeat=function(){};draw2d=function(){};coverageUpdate=function(){};showToast=function(){};
    refresh3dHeat=function(){};scheduleHeat=function(){};computeHeatSimple=function(){};
    clearTimeout(heatTimer); bootUI=function(){};`);
  // the loader now caches elements by id, so innerHTML survives between lookups
  // the app's own $() is querySelector, so the panel must be read back the same way
  const els = new Proxy({}, { get:(_,id)=> win.document.querySelector('#'+id) });
  return {ctx, els};
}

console.log('Stage 6.5 browser probe wiring\n');

// without the flag: nothing must happen
{
  const {ctx,els}=boot('');
  run(ctx,'rt3dExpInit();');
  ck('1. without ?rt3d=1 the panel is never populated',
    !els['rt3dExpOut'] || !els['rt3dExpOut'].innerHTML, JSON.stringify(els['rt3dExpOut']&&els['rt3dExpOut'].innerHTML));
  ck('2. without ?rt3d=1 the probe listener is never bound',
    R(ctx,'cv && cv.__rt3dAuditBound')==='undefined',
    'got '+R(ctx,'cv && cv.__rt3dAuditBound'));
}
// with the flag
{
  const {ctx,els}=boot('?rt3d=1');
  run(ctx, `state=freshState();
    var f=state.floors[0]; f.name='PB'; f.w=20; f.d=14; f.height=3.0; f.ceilingAreas=[];
    f.walls=[];f.pillars=[];f.rfObjects=[];f.openings=[];
    var W=10,H=7,pts=[[-W,-H],[W,-H],[W,H],[-W,H]];
    for(var i=0;i<4;i++){var a=pts[i],b=pts[(i+1)%4];
      f.walls.push({id:'w'+i,x1:a[0],y1:a[1],x2:b[0],y2:b[1],materialId:state.materials[2].id,
                    thickness:DEFAULT_WALL_THICKNESS_M});}
    var ap=makeAP(0,0,'AP-1',3.0); ap.mount=2.6; ap.mountType='ceiling';
    ap.antenna={type:'omni',az:0,tilt:0,gain:3}; f.aps=[ap];
    state.activeFloor=0;
    rt3dExpInit();`);
  ck('3. with ?rt3d=1 the probe listener is bound',
    R(ctx,'cv && cv.__rt3dAuditBound')==='true' && R(ctx,'cv.listenerCount("click")')==='1',
    'bound='+R(ctx,'cv && cv.__rt3dAuditBound')+' listeners='+R(ctx,'cv.listenerCount("click")'));
  const before = els['rt3dExpOut'].innerHTML;
  ck('4. the panel renders before any probe exists',
    before.length>0 && !/RF point probe/.test(before), 'probe section present with no probe');
  ck('5. the evidence probe set is listed', /evidence probe set/.test(before));
  // synthesise a click at the plan centre
  run(ctx, `(function(){
    var r=cv.getBoundingClientRect();
    var target=W2S(3,-2);
    cv.dispatchEvent({type:'click', clientX:r.left+target.x, clientY:r.top+target.y});
  })()`);
  const after = els['rt3dExpOut'].innerHTML;
  ck('6. clicking the plan produces the side-by-side probe panel',
    /RF point probe/.test(after), after.slice(0,200));
  ck('7. the panel shows legacy AND rt3d AND the delta',
    /Legacy stored RSSI/.test(after) && /RT3D Coverage\(x,y,z\)/.test(after) && /RT3D &minus; Legacy/.test(after));
  ck('8. all four diagnostic counterfactuals are listed',
    /RT3D &mdash; canonical/.test(after) && /RT3D &mdash; azOnly/.test(after) &&
    /RT3D &mdash; noReflections/.test(after) && /RT3D &mdash; losOnly/.test(after));
  ck('9. the per-AP decomposition is shown with material by family',
    /per-AP decomposition/.test(after) && /strongest:/.test(after) && /material:/.test(after));
  ck('10. the unrecoverable legacy quantities are stated',
    /legacy could NOT report/.test(after) && /serving \/ source AP/.test(after));
  ck('11. the panel states legacy is not truth',
    /legacyIsTruth = false/.test(after));
  ck('12. with no legacy grid, the panel says so instead of inventing a value',
    /no Legacy grid for this floor/.test(after));
  ck('13. the receiver Z is the canonical plane',
    /Z = floorElevation\(activeFloor\) \+ receiverHeight\(\)/.test(after) &&
    /receiver \(-?[\d.]+, -?[\d.]+, <b>[\d.]+<\/b>\)/.test(after));
  ck('14. the probe is not in project state',
    R(ctx,'JSON.stringify(Object.keys(state).filter(function(k){return /probe|audit/i.test(k);}))')==='[]');
  const pt=R(ctx,'!!rt3dAuditProbePoint');
  const rs=R(ctx,'typeof rt3dAuditProbeResult');
  ck('15. the probe point lives in a module local', pt==='true' && rs==='object',
    'pointFlag='+JSON.stringify(pt)+' resultType='+JSON.stringify(rs));
  // a legacy grid must now be compared against
  run(ctx, `(function(){
    var s=rt3dGridSpec(state.floors[state.activeFloor]);
    var n=s.cols*s.rows;
    heatGridRssi=new Float32Array(n); for(var k=0;k<n;k++) heatGridRssi[k]=-70-(k%5);
    heatRtReach=new Uint8Array(n); for(var k=0;k<n;k++) heatRtReach[k]=1;
  })()`);
  run(ctx, `rt3dAuditProbeResult=rt3dAuditProbeAt(3,-2,{legacyGrid:heatGridRssi,reachGrid:heatRtReach});
            rt3dAuditProbePoint={x:3,y:-2};
            rt3dExpOut(rt3dExpSummaryHtml(null,null));`);
  const withLegacy = els['rt3dExpOut'].innerHTML;
  ck('16. with a legacy grid the panel reports a delta',
    /RT3D &minus; Legacy/.test(withLegacy) && /no Legacy grid for this floor/.test(withLegacy)===false,
    'still refusing to compare');
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
