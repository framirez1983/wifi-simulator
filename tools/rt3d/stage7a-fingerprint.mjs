// The frozen Stage-7 fingerprint, as source text.
//
// It is shared by the numerical oracle and the Worker equivalence suite, and it
// is shipped as TEXT because it is evaluated inside whichever execution context
// is under test: the main thread's sandbox, or a Worker environment that has
// evaluated the application's own source. That is deliberate -- the comparison
// has to be made with the same code in both places, and it has to be the code
// that calls the canonical engine functions rather than a reimplementation of
// them.
const FINGERPRINT_FN = `
function stage7aFingerprint(opts){
  var world = rt3dBuildWorld();
  var fi = state.activeFloor;
  var fl = state.floors[fi];
  var planeZ = rt3dReceiverPlaneZForFloor(fi);
  var sources = rt3dCoverageSources();
  var out = { planeZ: planeZ, sources: [], points: [], grid: null };
  for (var i=0;i<sources.length;i++)
    out.sources.push({ apId: sources[i].ap.id, apName: sources[i].ap.name,
                       floorIndex: sources[i].floorIndex });

  // ---- point queries -------------------------------------------------------
  // rt3dCoverageAt is the canonical field query and owns per-AP candidates.
  // rt3dAuditProbeAt is the canonical material-loss-by-family decomposition of
  // the SAME kernel result; it is read here rather than recomputed, because
  // re-deriving a per-family split would be a second geometry interpretation.
  for (var k=0;k<opts.points.length;k++){
    var pt = { x: opts.points[k][0], y: opts.points[k][1], z: planeZ };
    var r = rt3dCoverageAt(world, pt, { sources: sources, stats: rt3dNewStats() });
    var fam = rt3dAuditProbeAt(pt.x, pt.y, { world: world, sources: sources, z: pt.z });
    var famByAp = {};
    var fa = (fam && fam.rt3d) ? fam.rt3d.aps : [];
    for (var q=0;q<fa.length;q++) famByAp[fa[q].apId] = fa[q].winningLossByFamily || {};
    var row = {
      x: pt.x, y: pt.y, z: pt.z,
      strongestRssi: r.strongestRssi,
      anyValid: r.anyValid,
      servingApId: r.servingApId,
      servingApIndex: r.servingApIndex,
      aps: []
    };
    for (var a=0;a<r.aps.length;a++){
      var A = r.aps[a];
      var dir=null, bestRefl=null, nReflValid=0;
      for (var c=0;c<A.candidates.length;c++){
        var C = A.candidates[c];
        if (C.kind==='direct' && dir===null) dir = C;
        if (C.kind==='reflected' && C.valid){
          nReflValid++;
          if (bestRefl===null || C.receivedPower>bestRefl.receivedPower) bestRefl = C;
        }
      }
      var F = famByAp[A.apId] || {};
      // winningLossByFamily entries carry {lossDb, traversals, events, objects}.
      // 'traversals' is the production field name; reading a non-existent 'count'
      // silently yielded null and froze nothing.
      var fk = function(name){
        var e = F[name];
        return (e && e.lossDb!=null) ? { db: e.lossDb, n: (e.traversals!=null?e.traversals:null) } : null;
      };
      row.aps.push({
        apId: A.apId,
        apX: A.apX, apY: A.apY, apZ: A.apZ,
        antennaType: A.antennaType, mountType: A.mountType, channel: A.channel,
        horizontalDistance: A.horizontalDistance,
        directDistance: A.directDistance,
        antennaGainDb: A.antennaGainDb,
        directRssi: dir ? dir.receivedPower : null,
        directValid: dir ? !!dir.valid : false,
        directTransmissionCount: dir ? dir.transmissionCount : null,
        directPathDistance: dir ? dir.pathDistance : null,
        reflectedBestRssi: bestRefl ? bestRefl.receivedPower : null,
        reflectedValidCount: nReflValid,
        reflectedPathDistance: bestRefl ? bestRefl.pathDistance : null,
        winnerKind: A.strongest.kind,
        strongestRssi: A.strongestRssi,
        winningPathDistance: A.strongest.pathDistance,
        winningMaterialLossDb: A.strongest.materialLossDb,
        winningTransmissionCount: A.strongest.transmissionCount,
        winningReflectionCount: A.strongest.reflectionCount,
        winningValidCandidates: A.validCandidates,
        matWall:   fk('wall'),
        matRfObj:  fk('rfObject'),
        matSlab:   fk('slab'),
        matCeil:   fk('ceiling'),
        matPillar: fk('pillar')
      });
    }
    out.points.push(row);
  }

  // ---- the 2D slice, driven through the resumable cursor ------------------
  var spec = { b:{minx:opts.grid.minx,miny:opts.grid.miny,
                   maxx:opts.grid.minx+opts.grid.cols*opts.grid.cell,
                   maxy:opts.grid.miny+opts.grid.rows*opts.grid.cell},
               cell: opts.grid.cell, cols: opts.grid.cols, rows: opts.grid.rows,
               cw: opts.grid.cell, ch: opts.grid.cell,
               raySpacing: opts.grid.cell };
  var cursor = { j:0, i:0, best:null, apBest:null, valid:null, acc:null };
  var sl = rt3dCoverageSlice(world, spec, planeZ,
                { cursor: cursor, stats: rt3dNewStats(), sources: sources });
  var best = [], apBest = [], valid = [];
  for (var c2=0;c2<spec.cols*spec.rows;c2++){
    best.push(sl.best[c2]);
    apBest.push(sl.apBest[c2]);
    valid.push(sl.valid[c2]);
  }
  // diagnostics is taken as an EXPLICIT WHITELIST, not copied wholesale.
  // rt3dCoverageSlice().diagnostics carries totalMs and cellsPerSec, which are
  // wall-clock measurements: they differ between two runs of the SAME build, so
  // freezing them made every fixture report as non-deterministic and would have
  // masked a real divergence behind timing noise. Everything kept below is a
  // deterministic function of the geometry and the RF model, so it belongs in a
  // physics oracle; the timings are performance evidence and belong to the
  // benchmark harness instead.
  var d = sl.diagnostics;
  out.grid = { cols: sl.cols, rows: sl.rows, cw: spec.cw, ch: spec.ch,
               evaluated: sl.evaluatedCells, complete: sl.complete,
               validCells: sl.validCells, noSignalCells: sl.noSignalCells,
               best: best, apBest: apBest, valid: valid,
               diagnostics: {
                 receiverPlaneZ: d.receiverPlaneZ,
                 cellsEvaluated: d.cellsEvaluated,
                 participatingAps: d.participatingAps,
                 ownerFloors: d.ownerFloors,
                 directPathsTested: d.directPathsTested,
                 validReflectedPaths: d.validReflectedPaths,
                 worldBodies: d.worldBodies,
                 bvhCandidatesTested: d.bvhCandidatesTested
               } };
  return out;
}`;


export { FINGERPRINT_FN };
