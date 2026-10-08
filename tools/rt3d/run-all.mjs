// Run the whole Stage 1 validation. No dependencies, no build step:
//   node tools/rt3d/run-all.mjs
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const steps = [
  ['Stage 1 validation (19 required checks)', 'stage1.test.mjs', []],
  ['Stage 1E reflection mathematics', 'reflection.test.mjs', []],
  ['Stage 2 acceptance (18 required fixtures)', 'stage2.test.mjs', []],
  ['Stage 3 acceptance (deterministic BVH)', 'stage3.test.mjs', []],
  ['Stage 3 complete-path equivalence', 'stage3-paths.test.mjs', []],
  ['Stage 3 differential stress (12000 seeded rays)', 'stage3-stress.test.mjs', []],
  ['Stage 4 acceptance (fan + receiver-plane samples)', 'stage4.test.mjs', []],
  ['Stage 5 acceptance (experimental browser layer)', 'stage5.test.mjs', []],
  ['Stage 5 completion-path regression (finalize exactly once)', 'stage5-completion.test.mjs', []],
  ['Stage 5 result/grid-spec contract (behavioural, real UI path)', 'stage5-contract.test.mjs', []],
  ['Stage 6 acceptance (unified coverage field)', 'stage6.test.mjs', []],
  ['Stage 6 browser-runner regression (phases, budgets, cancel)', 'stage6-runner.test.mjs', []],
  ['Stage 6 resumable-cursor regression (each cell exactly once)', 'stage6-cursor.test.mjs', []],
  ['Stage 6.5 fixture ladder (Legacy vs RT3D, per geometry)', 'stage65-ladder.test.mjs', []],
  ['Stage 6.5 browser probe wiring (click-driven diagnostics)', 'stage65-ui.test.mjs', []],
  ['Stage 6.5b classification, AP audit, slice diagnostics, delta map', 'stage65b-classify.test.mjs', []],
  ['Stage 6.5c comparison-snapshot cache contract (per-floor, display-independent)', 'stage65c-cache.test.mjs', []],
  ['Stage 6.5d probe comparison table, ordering and model diagnostics', 'stage65d-probetable.test.mjs', []],
  ['Stage 6.5e geometry-only Ceiling rule and rack-clearance geometry', 'stage65e-geometry.test.mjs', []],
  ['Stage 6.5f corrected above-rack rule and Legacy wording', 'stage65f-aboverack.test.mjs', []],
  ['Stage 6.5g canonical audit report and export actions', 'stage65g-export.test.mjs', []],
  ['Stage 6.5h corrected evidence rules, conservative attribution, AP-audit wording', 'stage65h-evidence.test.mjs', []],
  // Stage 7A. The oracle freezes the numerics; the worker suite proves that moving
  // the computation to a Dedicated Worker changed WHERE it runs and nothing else.
  ['Stage 7A numerical oracle (frozen exact IEEE-754 values)', 'stage7a-oracle.test.mjs', []],
  ['Stage 7A.1 Worker execution (worker/main equality, protocol, cancellation)', 'stage7a-worker.test.mjs', []],
  ['Canonical slab thickness audit', 'slab-thickness.test.mjs', []],
  ['Stage 1A compatibility oracle', 'oracle.mjs', ['check']],
  ['App smoke test (real start() + production trace on the demo room)', 'smoke.mjs', []],
  ['Production engine isolation', 'production-untouched.mjs', []],
];

let bad = 0;
for (const [title, file, args] of steps) {
  console.log('\n' + '='.repeat(72));
  console.log('  ' + title);
  console.log('='.repeat(72));
  try {
    const out = execFileSync('node', [path.join(HERE, file), ...args],
      { encoding: 'utf8', maxBuffer: 1 << 28, timeout: 1_200_000 });
    process.stdout.write(out);
  } catch (e) {
    bad++;
    process.stdout.write(e.stdout || '');
    process.stderr.write(e.stderr || '');
  }
}

console.log('\n' + '='.repeat(72));
console.log(bad === 0 ? '  ALL STAGE 1 CHECKS PASSED' : `  ${bad} STEP(S) FAILED`);
console.log('='.repeat(72));
process.exit(bad === 0 ? 0 : 1);
