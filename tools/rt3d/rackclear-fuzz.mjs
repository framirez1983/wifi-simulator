// Differential fuzz: does the analytic rotated-prism check agree with the kernel?
//
// Two INDEPENDENT determinations of "does the straight segment AP->receiver
// traverse this finite rotated prism?", on identical geometry:
//   A  analytic rotated-rect XY clip + Z interval   (the audit's own checker)
//   B  rt3dBodyEvent on the exact bounded ray        (the kernel)
// plus rt3dSegmentLoss, which is what the audit actually read.
//
// Deterministic: a fixed-seed LCG, no randomness in the harness itself.
import vm from 'node:vm';
import fs from 'node:fs';
import { makeDom, run } from './loader.mjs';

const SRC = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
  .match(/<script>\n([\s\S]*?)\n<\/script>/)[1];

const win = makeDom();
win.location = { search: '?rt3d=1' };
const ctx = vm.createContext(win);
vm.runInContext(SRC, ctx, { filename: 'index.html<script>' });
run(ctx, `paintHeat=function(){};computeHeatSimple=function(){};draw2d=function(){};
  coverageUpdate=function(){};showToast=function(){};refresh3dHeat=function(){};
  scheduleHeat=function(){};clearTimeout(heatTimer);`);

const raw = run(ctx, `JSON.stringify((function(){
  var seed=20260202;
  function rnd(){ seed=(seed*1103515245+12345)&0x7fffffff; return seed/0x7fffffff; }
  var H=1.5;
  function build(apX,apY,apZ,ox,oy,w,d,rot){
    state=freshState(); state.floors.length=1;
    var f=state.floors[0];
    f.name='PB'; f.w=60; f.d=50; f.height=10; f.ceilingAreas=[]; f.pillars=[];
    f.walls=[]; f.openings=[];
    f.rfObjects.push({id:'rk',x:ox,y:oy,width:w,depth:d,height:H,rotation:rot,
      materialId:state.materials[4].id, extraLossDb:0});
    var ap=makeAP(apX,apY,'AP',10); ap.mount=apZ; ap.mountType='ceiling';
    ap.antenna={type:'omni',az:0,tilt:0,gain:3}; f.aps=[ap];
    state.activeFloor=0;
    return rt3dBuildWorld();
  }
  function analytic(o, p, obj){
    var th=(obj.rotation||0)*Math.PI/180, c=Math.cos(th), s=Math.sin(th);
    var ax=o.x-obj.x, ay=o.y-obj.y;
    var lax=ax*c+ay*s, lay=-ax*s+ay*c;
    var bx=p.x-o.x, by=p.y-o.y;
    var ldx=(bx-ax)*c+(by-ay)*s, ldy=-(bx-ax)*s+(by-ay)*c;
    var t0=0, t1=1, ok=true;
    function clip(start,dv,half){
      if(Math.abs(dv)<1e-12){ if(start<-half-1e-9||start>half+1e-9){ ok=false; } return; }
      var u1=(-half-start)/dv, u2=(half-start)/dv;
      if(u1>u2){ var q=u1; u1=u2; u2=q; }
      if(u1>t0) t0=u1; if(u2<t1) t1=u2;
      if(t0>t1+1e-9) ok=false;
    }
    clip(lax,ldx,obj.width/2);
    clip(lay,ldy,obj.depth/2);
    if(!ok) return { inXY:false, enters:false };
    var zAt=function(t){ return o.z+t*(p.z-o.z); };
    var za=zAt(t0), zb=zAt(t1);
    var zLo=Math.min(za,zb), zHi=Math.max(za,zb);
    return { inXY:true, t0:t0, t1:t1, zEntry:za, zExit:zb, zLo:zLo, zHi:zHi,
             enters: (zHi > 0 && zLo < H) };
  }
  function kernel(o, p){
    var world=build(o.x,o.y,o.z, _obj.x,_obj.y,_obj.w,_obj.d,_obj.rot);
    var ray=rt3dRayBetween(o,p);
    var len=rt3dLen(rt3dSub(p,o));
    var body=null;
    for(const b of rt3dAllBodies(world)) if(b.kind==='rfObject'&&b.objectId==='rk') body=b;
    var ev = (ray&&body) ? rt3dBodyEvent(ray, body, len) : null;
    var seg = rt3dSegmentLoss(world, o, p, null, {});
    var loss=0, list=[];
    for(const e of seg.events) if(e.objectType==='rfObject'&&e.objectId==='rk'){ loss+=e.loss; list.push(e.tEnter); }
    return { event:!!ev, tEnter: ev?ev.tEnter:null, tExit: ev?ev.tExit:null, loss:loss, list:list };
  }
  var _obj={};
  var rows=[], mismatch=0, total=400;
  for(var n=0;n<total;n++){
    var apX=(rnd()-0.5)*24, apY=(rnd()-0.5)*24, apZ=2.0+rnd()*3;
    var rxX=(rnd()-0.5)*24, rxY=(rnd()-0.5)*24, rxZ=0.2+rnd()*3.5;
    var ox=(rnd()-0.5)*24, oy=(rnd()-0.5)*24;
    var w=0.4+rnd()*3, dd=0.4+rnd()*3, rot=rnd()*360;
    var o={x:apX,y:apY,z:apZ}, p={x:rxX,y:rxY,z:rxZ};
    var obj={x:ox,y:oy,width:w,depth:dd,height:H,rotation:rot};
    _obj=obj;
    var A=analytic(o,p,obj), K=kernel(o,p);
    // GROUND TRUTH, independent of BOTH the audit clip and the kernel: dense
    // sampling of the segment, testing the DEFINITION of the rotated prism
    // (local-frame |x|<=w/2, |y|<=d/2) and the Z interval. If brute force sides
    // with the audit clip the audit geometry is wrong (B); if it sides with the
    // kernel the kernel is wrong (C).
    var inside=0, N=200000;
    for(var q=0;q<N;q++){
      var tt=(q+0.5)/N;
      var wx=o.x+tt*(p.x-o.x), wy=o.y+tt*(p.y-o.y), wz=o.z+tt*(p.z-o.z);
      var th2=(obj.rotation||0)*Math.PI/180, c2=Math.cos(th2), s2=Math.sin(th2);
      var qx=wx-obj.x, qy=wy-obj.y;
      var lx=qx*c2+qy*s2, ly=-qx*s2+qy*c2;
      if(Math.abs(lx)<=obj.width/2 && Math.abs(ly)<=obj.depth/2 && wz>=0 && wz<=H) inside++;
    }
    var brute = inside>0;
    if(A.enters!==K.event || (A.enters!==(K.loss>0))){
      mismatch++;
      if(mismatch<=8) rows.push({
        n:n,
        apXYZ:[+apX.toFixed(4),+apY.toFixed(4),+apZ.toFixed(4)],
        rxXYZ:[+rxX.toFixed(4),+rxY.toFixed(4),+rxZ.toFixed(4)],
        obj:{ centreXY:[+ox.toFixed(4),+oy.toFixed(4)], width:+w.toFixed(4),
              depth:+dd.toFixed(4), rotationDeg:+rot.toFixed(3),
              zInterval:[0,H] },
        analytic:{ inXY:A.inXY, enters:A.enters,
                   t0:A.t0!=null?+A.t0.toFixed(6):null, t1:A.t1!=null?+A.t1.toFixed(6):null,
                   zEntry:A.zEntry!=null?+A.zEntry.toFixed(6):null,
                   zExit:A.zExit!=null?+A.zExit.toFixed(6):null,
                   zLo:A.zLo!=null?+A.zLo.toFixed(6):null,
                   zHi:A.zHi!=null?+A.zHi.toFixed(6):null },
        bruteForceEnters: brute, bruteForceInsideSamples: inside,
        kernel:{ bodyEvent:K.event, tEnter:K.tEnter!=null?+K.tEnter.toFixed(6):null,
                 tExit:K.tExit!=null?+K.tExit.toFixed(6):null,
                 directLossDb:K.loss, traversalList:K.list.map(function(v){return +v.toFixed(6);}) }
      });
    }
  }
  return { total:total, mismatches:mismatch, samples:rows };
})())`);

const r = JSON.parse(raw);
console.log(`cases ${r.total}  mismatches ${r.mismatches}`);
console.log(JSON.stringify(r.samples, null, 1));