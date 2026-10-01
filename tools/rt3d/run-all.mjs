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
