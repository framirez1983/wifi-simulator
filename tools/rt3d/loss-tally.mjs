// Development-only diagnostic helper: tally what the samples in a receiver-
// plane cloud actually paid for, broken down by body kind.
//
// This exists so a diagnostic picture can say WHICH bodies charged the samples
// rather than leaving the reader to infer it from colour. It is a readout only:
// it re-traces the same fan with the existing kernel and reads the events that
// precede each plane crossing. It adds nothing to `index.html`, changes no
// sample, and touches no physics.
//
// Note on units: summing dB over many rays is not a physical quantity, so this
// reports a COUNT of crossings per body kind together with the MEAN loss of
// those crossings. The mean is the number to compare against the body's own
// `loss`, and it should match it exactly when the body is the only thing that
// ever charges a sample.
//
// The sandbox snippet is assembled from plain string concatenation on purpose.
// Interpolating a nested `${...}` template through a template literal is how
// this silently produced an empty tally once, which is exactly the kind of
// quiet diagnostic failure worth designing out.
import { run } from './loader.mjs';

const KINDS = ['wall', 'ceiling', 'slab', 'rfObject', 'pillar'];

export function lossTally(sb, opts) {
  const { buildSrc, apName, floorIdx, planeExpr, fan, maxDistance } = opts;
  const code = [
    '(function(){',
    buildSrc,
    'var k={_samples:0,_directions:0,_reflections:0,_transmissions:0,_lossSum:0};',
    `for(var q=0;q<${JSON.stringify(KINDS)}.length;q++){ var kd=${JSON.stringify(KINDS)}[q]; k[kd]={n:0,lossSum:0}; }`,
    'var world=rt3dBuildWorld();',
    'var planeZ=' + planeExpr + ';',
    'var ap=state.floors[' + floorIdx + '].aps.filter(function(a){',
    '  return a.name===' + JSON.stringify(apName) + '; })[0];',
    'var o=rt3dApOrigin(ap,' + floorIdx + ');',
    'var tol=RT3D_TOL.zeroLength;',
    'var dirs=rt3dFanDirections(' + JSON.stringify(fan) + ');',
    'k._directions=dirs.length;',
    'for(var i=0;i<dirs.length;i++){',
    '  var d=dirs[i];',
    '  var ray=rt3dRay(o.x,o.y,o.z,d.dx,d.dy,d.dz);',
    '  if(!ray) continue;',
    '  var tr=rt3dTracePath(world,ray,{backend:"bvh",maxDistance:' + Number(maxDistance) + ',',
    '    maxReflections:2,reflectLossDb:RT3D_REFLECTION_LOSS_DB});',
    '  var c=rt3dReceiverPlaneCrossing(tr,planeZ);',
    '  if(!c||!c.hit) continue;',
    '  k._samples++; k._lossSum+=c.materialLoss;',
    '  k._reflections+=c.reflectionCount; k._transmissions+=c.transmissionCount;',
    '  for(var j=0;j<tr.events.length;j++){',
    '    var ev=tr.events[j];',
    '    // strictly before the crossing: a later event must not contaminate it',
    '    if(ev.distance>c.pathDistance+tol) break;',
    '    if(Object.prototype.hasOwnProperty.call(k,ev.objectType)){',
    '      k[ev.objectType].n++; k[ev.objectType].lossSum+=ev.loss;',
    '    }',
    '  }',
    '}',
    'return k;',
    '})()',
  ].join('\n');
  return JSON.parse(run(sb, 'JSON.stringify(' + code + ')'));
}

// "wall: 61 crossings, 5.0 dB each" — omitted entirely when nothing crossed.
export function describeKinds(tally, only) {
  const list = only || KINDS;
  const parts = [];
  for (const kd of list) {
    const e = tally[kd];
    if (!e || !e.n) continue;
    parts.push(`${kd} ${e.n}x ${(e.lossSum / e.n).toFixed(2)} dB`);
  }
  return parts.length ? parts.join(' / ') : 'none';
}

// Share of samples that paid anything at all, e.g. "139/1152 (12.1%)".
export function chargedShare(tally) {
  const any = KINDS.reduce((a, kd) => a + (tally[kd] ? tally[kd].n : 0), 0);
  return any;
}
