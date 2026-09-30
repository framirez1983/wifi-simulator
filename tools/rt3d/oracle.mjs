// Stage 1A — the compatibility oracle.
//
// Runs the PRODUCTION engine (runRayTrace, untouched) and the new Stage-1
// 3D kernel in horizontal compatibility mode over the same fixtures, and
// records both. The recorded file is the migration oracle: it is compared
// on every later run, so neither the old engine nor the new kernel can
// drift silently.
import { loadApp, run, blankState } from './loader.mjs';
import { FIXTURES, install } from './fixtures.mjs';
import { runOldEngine, runNewEngine } from './engines.mjs';
import { readOracle, writeOracle } from './oracle-file.mjs';

const sb = loadApp();
blankState(sb);

const out = {};
for (const f of FIXTURES) {
  install(sb, f);
  const activeFloor = run(sb, 'state.activeFloor||0');
  const old = await runOldEngine(sb);
  const neu = await runNewEngine(sb, activeFloor);
  out[f.name] = { activeFloor, old, new: neu };
  const match = old.grid.fingerprint === neu.gridFingerprint;
  const okOld = old.grid.fingerprint;
  const okNew = neu.fingerprint;
  console.log(
    `${f.name.padEnd(18)} old.fp=${okOld} new.fp=${neu.gridFingerprint} ` +
    `rays=${old.stats ? old.stats.initialRays : '?'}/${neu.initialRays} ` +
    `branch=${old.stats ? old.stats.processedBranches : '?'}/${neu.processedBranches} ` +
    (match ? 'MATCH' : 'DIFFER'));
}

const mode = process.argv[2] || 'check';
if (mode === 'record') {
  writeOracle(out);
  console.log(`\nrecorded ${Object.keys(out).length} fixtures`);
} else {
  const prev = readOracle();
  if (!prev) { console.log('no oracle file yet; run with "record"'); process.exit(2); }
  let bad = 0;
  for (const [k, v] of Object.entries(out)) {
    const p = prev[k];
    if (!p) { console.log(`  MISSING in oracle: ${k}`); bad++; continue; }
    const a = p.old.grid.fingerprint, b = v.old.grid.fingerprint;
    const c = p.new.gridFingerprint, d = v.new.gridFingerprint;
    if (a !== b) { console.log(`  OLD ENGINE DRIFT ${k}: ${a} -> ${b}`); bad++; }
    if (c !== d) { console.log(`  NEW KERNEL DRIFT ${k}: ${c} -> ${d}`); bad++; }
  }
  console.log(bad === 0
    ? `\noracle stable: ${Object.keys(out).length} fixtures reproduce exactly`
    : `\n${bad} drift(s)`);
  process.exit(bad === 0 ? 0 : 1);
}
