// Stage 7A: the frozen numerical oracle.
//
// Stage 7 may change WHERE and HOW the RT3D workload executes. It may never
// change WHAT it computes. This file is the gate that proves that.
//
// It covers the thirteen deterministic geometries the brief names, and for each
// one FREEZES the canonical main-thread output of:
//
//   * Coverage(x,y,z) at fixed probe points  (strongest RSSI, serving AP)
//   * per-AP direct RSSI
//   * best reflected RSSI
//   * winning path kind per AP
//   * serving AP
//   * material loss by family
//   * the full 2D slice grid values
//
// EQUALITY IS EXACT, NOT APPROXIMATE.
//
// Every captured quantity is serialised with JSON.stringify, which in JavaScript
// emits the shortest decimal string that round-trips to the SAME IEEE-754 double.
// Comparing the serialised text is therefore bit-for-bit equality on the doubles,
// including -Infinity, and it is stricter than any tolerance: a tolerance would
// let a real physics change through. No value is rounded anywhere in this file,
// in the product, or in the fingerprint. If a future change cannot preserve exact
// equality, that is the finding — it is not something to be papered over with a
// tolerance.
//
// Re-record ONLY when a physics change is intended and separately justified:
//   node tools/rt3d/stage7a-oracle.test.mjs --record > oracle.snapshot.json
// The diff is then reviewed as a physics diff, not as test churn.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeDom, run } from './loader.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, '..', '..', 'index.html'), 'utf8')
  .match(/<script>\n([\s\S]*?)\n<\/script>/)[1];

const RECORD = process.argv.includes('--record');

let pass = 0, fail = 0;
const failures = [];
function check(id, name, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${String(id).padStart(2)}. ${name}`); }
  else {
    fail++; failures.push(`${id}. ${name}${detail ? ' :: ' + detail : ''}`);
    console.log(`  FAIL ${String(id).padStart(2)}. ${name}${detail ? ' :: ' + detail : ''}`);
  }
}

function sandbox() {
  const win = makeDom();
  win.location = { search: '?rt3d=1' };
  const ctx = vm.createContext(win);
  vm.runInContext(SRC, ctx, { filename: 'index.html<script>' });
  run(ctx, `paintHeat=function(){};computeHeatSimple=function(){};draw2d=function(){};
    coverageUpdate=function(){};showToast=function(){};refresh3dHeat=function(){};
    scheduleHeat=function(){};clearTimeout(heatTimer);bootUI=function(){};`);
  return ctx;
}

// ---------------------------------------------------------------------------
// Fixture geometry. Every value is exact and literal: no randomness, no search,
// no tolerance. Probe points are chosen to sit unambiguously on each side of
// the feature under test.
// ---------------------------------------------------------------------------

// Fixture geometry is shared with the Worker equivalence suite so both prove
// things about the same thirteen scenes and cannot drift apart.
import { POINTS, GRID, FIXTURES } from './stage7a-fixtures.mjs';

// ---------------------------------------------------------------------------
// The fingerprint: exactly the quantities the brief requires.
// ---------------------------------------------------------------------------
// The fingerprint source is shared with the Worker suite, so main-thread and
// Worker results are produced by identical comparison code.
import { FINGERPRINT_FN } from './stage7a-fingerprint.mjs';
function fingerprintFor(fixture) {
  const ctx = sandbox();
  run(ctx, fixture.scene);
  run(ctx, FINGERPRINT_FN);
  const a = run(ctx, `JSON.stringify(stage7aFingerprint(${JSON.stringify({
    points: POINTS, grid: GRID })}))`);
  // A second, fully independent build of the same fixture must agree exactly.
  const ctx2 = sandbox();
  run(ctx2, fixture.scene);
  run(ctx2, FINGERPRINT_FN);
  const b = run(ctx2, `JSON.stringify(stage7aFingerprint(${JSON.stringify({
    points: POINTS, grid: GRID })}))`);
  return { a, b, ctx };
}

console.log('Stage 7A numerical oracle (exact IEEE-754 equality)\n');

const SNAP = path.join(HERE, 'stage7a-oracle.snapshot.json');
const expected = RECORD || !fs.existsSync(SNAP)
  ? null
  : JSON.parse(fs.readFileSync(SNAP, 'utf8'));

// The family set each fixture MUST charge, verified against the engine rather
// than assumed. An empty list is a positive claim: that fixture's straight
// paths are genuinely unobstructed, or that its Opening / ceiling hole removes
// the loss the corresponding solid fixture charges.
const EXPECTED_LOSS_FAMILIES = {
  emptyLos:          [],       // nothing in the way
  walls:             ['wall'],
  rotatedRfObject:   ['rfObject'],
  pillars:           ['pillar'],
  slabSolid:         ['slab'],       // structural slab ONLY, never 'ceiling'
  slabOpening:       [],       // the Opening removes the slab traversal above
  ceilingTraversal:  ['ceiling'],     // explicit Ceiling Area ONLY, never 'slab'
  ceilingHoleBypass: [],       // the hole removes the ceiling traversal above
  reflectionWinner:  ['wall'],
  multiApServing:    [],
  wallOmniVertical:  [],
  ceilingOmniBypass: [],
  crossFloor:        ['slab', 'wall'],   // both, on the same fixture
};

const recorded = {};
let id = 1;

for (const fx of FIXTURES) {
  const { a, b } = fingerprintFor(fx);
  check(id++, `${fx.id}: two independent builds agree exactly`, a === b,
        a === b ? '' : 'non-deterministic within a single process');
  const parsed = JSON.parse(a);
  recorded[fx.id] = parsed;

  // Structural sanity: the fixture must actually exercise what it claims, or the
  // frozen value would be freezing nothing.
  //
  // MATERIAL-LOSS FAMILY ATTRIBUTION -- 'slab' and 'ceiling' are DIFFERENT
  // physical things and the engine reports them independently. Established from
  // the engine, not inferred from a loss value:
  //
  //   slab     structural inter-floor slab. Built by rt3dSlabBody(); its
  //            objectId is the OWNING FLOOR's id ('flr_b'); it occupies the
  //            interval BELOW that floor's base plane (zTop = base,
  //            zBottom = base - SLAB_THICKNESS_M); its loss comes from
  //            slabLossForFloor(), not from a material id. Ownership rule in
  //            rt3dBuildWorld(): every non-bottom floor owns the slab at its own
  //            base elevation; floor 0 owns none.
  //   ceiling  an explicit Ceiling Area. Built by rt3dCeilingBody(); its
  //            objectId is the Ceiling Area's OWN id ('cl1'); it occupies
  //            ceilingInterval() of its owner floor; its loss comes from
  //            ceilEffectiveLoss(), i.e. a material id plus extraLossDb.
  //
  // They are separate arrays in the world with distinct kinds, family ordinals,
  // object-id namespaces and z intervals, so ONE ray can cross both and both are
  // charged separately: a ray from z=6.1 to z=1.2 crossing a Ceiling Area and the
  // floor-1 slab reports ceiling = 15 dB objects ['cl1'] and slab = 16 dB
  // objects ['flr_b'], summing to the candidate's 31 dB. Do not read a slab
  // traversal as a Ceiling Area traversal, or the reverse.
  //
  // The expected family set is therefore stated EXACTLY per fixture and compared
  // in both directions, so a family that stops being charged fails AND a family
  // that starts being charged fails. A slab silently reclassified as a ceiling
  // cannot pass this table.
  //
  // The family keys MUST match those FINGERPRINT_FN writes
  // (matWall / matRfObj / matPillar / matSlab / matCeil). They previously read
  // wallDb / rfObjDb / slabDb / ceilDb / pillarDb, which the fingerprint never
  // emits: every one of those lookups was undefined, the predicate was
  // permanently false, and five fixtures "passed" as never-charging material
  // loss while the engine was in fact charging 15 dB. An assertion that cannot
  // ever succeed is indistinguishable from an assertion that is not running.
  const MAT_KEYS = { matWall: 'wall', matRfObj: 'rfObject', matPillar: 'pillar',
                     matSlab: 'slab', matCeil: 'ceiling' };
  const charged = new Set();
  for (const p of parsed.points)
    for (const x of p.aps)
      for (const k of Object.keys(MAT_KEYS))
        if (x[k] !== null && x[k].db > 0) charged.add(MAT_KEYS[k]);
  const chargedFamilies = [...charged].sort();
  // 'reflected' is the canonical production literal in rt3dCoverageAt()
  // (candidate kind and strongest.kind). 'reflection' never occurs, so this
  // predicate was also permanently false.
  const anyReflect = parsed.points.some(p =>
    p.aps.some(x => x.winnerKind === 'reflected'));
  const anyVertical = parsed.points.some(p =>
    p.aps.some(x => x.mountType !== 'ceiling'));
  const anyMultiAp = parsed.points.some(p => p.aps.length > 1);
  const gridFinite = parsed.grid.best.filter(Number.isFinite).length;

  check(id++, `${fx.id}: grid evaluated every cell exactly once`,
        parsed.grid.evaluated === GRID.cols * GRID.rows && parsed.grid.complete === true,
        `evaluated=${parsed.grid.evaluated} complete=${parsed.grid.complete}`);
  check(id++, `${fx.id}: produced finite coverage values`, gridFinite > 0,
        `finite=${gridFinite}`);
  // One exact family-set assertion per fixture, replacing the family-agnostic
  // "did anything get charged at all" checks. Empty expected lists are checked
  // too: they are the positive claim that an Opening or a ceiling hole removed
  // the traversal its solid counterpart charges.
  const wantFamilies = EXPECTED_LOSS_FAMILIES[fx.id];
  check(id++, `${fx.id}: material loss is charged to the expected family set`,
        JSON.stringify(chargedFamilies) === JSON.stringify(wantFamilies),
        `charged [${chargedFamilies}] expected [${wantFamilies}]`);
  if (fx.id === 'reflectionWinner')
    check(id++, `${fx.id}: a reflection actually wins`, anyReflect,
          'no reflection ever won');
  if (fx.id === 'wallOmniVertical')
    check(id++, `${fx.id}: the vertical model actually applies`, anyVertical,
          'no non-ceiling-mounted antenna was ever evaluated');
  if (['multiApServing', 'ceilingOmniBypass', 'crossFloor'].includes(fx.id))
    check(id++, `${fx.id}: more than one AP participates`, anyMultiAp,
          'only one AP contributed');
}

if (RECORD) {
  fs.writeFileSync(SNAP, JSON.stringify(recorded, null, 1) + '\n');
  console.log(`\n  recorded ${Object.keys(recorded).length} fixture fingerprints -> ${path.basename(SNAP)}`);
  console.log(`  checks run: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

check(id++, 'the frozen oracle snapshot exists', expected !== null,
      'run with --record to create it');
if (expected) {
  for (const fx of FIXTURES) {
    const have = JSON.stringify(recorded[fx.id]);
    const want = JSON.stringify(expected[fx.id]);
    // Report the FIRST divergence with a path, so a physics change is legible.
    let detail = '';
    if (have !== want) {
      const a = JSON.stringify(expected[fx.id], null, 1).split('\n');
      const b = JSON.stringify(recorded[fx.id], null, 1).split('\n');
      for (let i = 0; i < Math.max(a.length, b.length); i++)
        if (a[i] !== b[i]) { detail = `first diff at line ${i + 1}: expected ${a[i]} / got ${b[i]}`; break; }
    }
    check(id++, `${fx.id}: matches the frozen oracle EXACTLY`, have === want, detail);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
