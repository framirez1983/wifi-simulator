// Full-grid diff between the production engine and the new kernel, for one
// fixture. Prints the number of differing cells, the largest delta and a few
// examples, so a mismatch can be located instead of guessed at.
import { loadApp, run, blankState } from './loader.mjs';
import { FIXTURES, install } from './fixtures.mjs';
import { runOldEngine } from './engines.mjs';

const which = process.argv[2] || 'wall-reflection';
const sb = loadApp();
blankState(sb);
const f = FIXTURES.find((x) => x.name === which);
if (!f) { console.error('unknown fixture: ' + which); process.exit(2); }
install(sb, f);

// Re-run the old engine, but keep the whole grid this time.
await runOldEngine(sb);
const oldGrid = JSON.parse(run(sb, `JSON.stringify((function(){
  var g=heatGridRssi, m=heatMeta, a=[];
  for(var k=0;k<g.length;k++) a.push(g[k]);
  return a;
})())`));

const newGrid = JSON.parse(run(sb, `JSON.stringify((function(){
  var world=rt3dBuildWorld();
  var t=rt3dHorizontalTrace(world, state.floors[state.activeFloor||0]);
  return Array.prototype.slice.call(t.best);
})())`));

const meta = JSON.parse(run(sb, 'JSON.stringify(heatMeta)'));
console.log(`fixture ${which}: grid ${meta.cols}x${meta.rows}  cells=${oldGrid.length}/${newGrid.length}`);

let diff = 0, maxAbs = 0, worst = null;
const examples = [];
for (let k = 0; k < Math.min(oldGrid.length, newGrid.length); k++) {
  const a = oldGrid[k], b = newGrid[k];
  const fa = Number.isFinite(a), fb = Number.isFinite(b);
  if (fa !== fb) {
    diff++;
    if (examples.length < 8) examples.push({ k, i: k % meta.cols, j: Math.floor(k / meta.cols), old: a, new: b, why: 'reach' });
    continue;
  }
  if (!fa) continue;
  const d = Math.abs(a - b);
  if (d > 1e-6) {
    diff++;
    if (d > maxAbs) { maxAbs = d; worst = { k, i: k % meta.cols, j: Math.floor(k / meta.cols), old: a, new: b }; }
    if (examples.length < 8) examples.push({ k, i: k % meta.cols, j: Math.floor(k / meta.cols), old: +a.toFixed(4), new: +b.toFixed(4), d: +d.toFixed(4) });
  }
}
console.log(`differing cells: ${diff} / ${oldGrid.length}   maxAbsDelta=${maxAbs.toFixed(6)}`);
if (worst) console.log('worst:', JSON.stringify(worst));
examples.forEach((e) => console.log('  ', JSON.stringify(e)));
