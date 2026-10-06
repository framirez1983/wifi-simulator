// Stage 6 resumable-cursor regression: every canonical cell evaluated EXACTLY once.
//
// A real S4 run reported 61 362 cells evaluated for a 156 x 382 = 59 592 grid,
// with 61 362 x 5 = 306 810 direct paths. Both numbers were internally
// consistent, which is what made it look like a display typo. It was not.
//
// The cause was an off-by-one at the budget break: the for-statement's column
// increment ran AFTER the deadline test, so a yield left the cursor on the cell
// that had just been evaluated and the resume counted it again. Nothing was
// skipped, so the set of visited cells was still complete — but the COUNT was
// inflated by one cell per yield, and directTested, being evaluated x APs, was
// inflated with it.
//
// A tally alone cannot catch this class of bug, because a duplicate and a skip
// can cancel out. So these tests record the IDENTITY of every visited cell and
// assert on the set, not the count.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeDom, run } from './loader.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, '..', '..', 'index.html'), 'utf8')
  .match(/<script>\n([\s\S]*?)\n<\/script>/)[1];

let pass = 0, fail = 0;
const failures = [];
function check(id, name, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${String(id).padStart(2)}. ${name}`); }
  else {
    fail++; failures.push(`${id}. ${name}${detail ? ' :: ' + detail : ''}`);
    console.log(`  FAIL ${String(id).padStart(2)}. ${name}${detail ? ' :: ' + detail : ''}`);
  }
}

// The coverage query is wrapped so it records WHICH CELL it was asked for. A
// slice evaluates cell centres, so the point coordinate identifies the cell
// exactly, and every visit is attributable.
function makeSandbox({ apCount = 3 }) {
  const win = makeDom();
  win.location = { search: '?rt3d=1' };
  const ctx = vm.createContext(win);
  vm.runInContext(SRC, ctx, { filename: 'index.html<script>' });
  run(ctx, `
    paintHeat=function(){}; computeHeatSimple=function(){}; draw2d=function(){};
    coverageUpdate=function(){}; showToast=function(){}; refresh3dHeat=function(){};
    scheduleHeat=function(){}; clearTimeout(heatTimer);
    state=freshState();
    var f=state.floors[0];
    f.name='PB'; f.height=3.2; f.w=26; f.d=17; f.ceilingAreas=[];
    for(var i=0;i<${apCount};i++){
      var ap=makeAP(-9+i*4, 0, 'AP-'+(i+1), 3.2); ap.mount=2.6; f.aps.push(ap);
    }
    state.activeFloor=0;
    window.__visited = [];
    window.__t = 0;
    // Node's Performance.prototype.now is a non-writable accessor, so assigning to
    // performance.now is a SILENT no-op. These tests would then really be running
    // on wall-clock while claiming to be deterministic. Replace the whole object.
    window.performance = { now: function(){ return window.__t; } };
    var __orig = rt3dCoverageAt;
    rt3dCoverageAt = function(world, p, o){
      window.__visited.push(p.x + ',' + p.y);
      window.__t += 1;                    // 1 ms of "work" per query
      return __orig.call(this, world, p, o);
    };
    window.__spec = function(cols, rows){
      return { cols:cols, rows:rows, cell:0.16, cw:1, ch:1,
               b:{ minx:0, miny:0, maxx:cols, maxy:rows } };
    };
    window.__fresh = function(){ return { j:0, i:0, best:null, apBest:null, valid:null, acc:null }; };
    window.__analyse = function(spec){
      var seen={}, dup=[], n=window.__visited.length;
      for(var q=0;q<n;q++){ var k=window.__visited[q];
        if(seen[k]) dup.push(k); else seen[k]=1; }
      var missing=[];
      for(var j=0;j<spec.rows;j++) for(var i=0;i<spec.cols;i++){
        var x=spec.b.minx+(i+0.5)*spec.cw, y=spec.b.miny+(j+0.5)*spec.ch;
        if(!seen[x+','+y]) missing.push(i+','+j);
      }
      return { visited:n, unique:Object.keys(seen).length, dup:dup.length,
               dupSample:dup.slice(0,3), missing:missing.length, missSample:missing.slice(0,3) };
    };
  `);
  return ctx;
}

console.log('Stage 6 resumable-cursor regression\n');

// ---------------------------------------------------------------- 1, 2, 3
// The invariant across budgets chosen to land yields at every awkward place:
// no budget, a budget smaller than the check interval, mid-interval, exactly on
// the interval, and a budget so large that the last batch is uneven.
// 156 columns is deliberately NOT a multiple of the 8-cell check interval
// (156 = 19*8 + 4), so the row boundary and the check boundary disagree.
{
  const COLS = 156, ROWS = 24, APS = 3, TOTAL = COLS * ROWS;
  const budgets = [
    { n: 'no budget, one pass', b: null },
    { n: 'budget 0, yield at every check', b: 0 },
    { n: 'budget 1', b: 1 },
    { n: 'budget 7, mid-interval', b: 7 },
    { n: 'budget 8, exactly on the interval', b: 8 },
    { n: 'budget 13', b: 13 },
    { n: 'budget 2000, uneven final batch', b: 2000 },
    { n: 'budget 10 000, uneven final batch', b: 10000 },
  ];
  for (let c = 0; c < budgets.length; c++) {
    const sb = makeSandbox({ apCount: APS });
    const r = JSON.parse(run(sb, `JSON.stringify((function(){
      var world=rt3dBuildWorld();
      var spec=window.__spec(${COLS}, ${ROWS});
      var cursor=window.__fresh();
      window.__visited=[]; window.__t=0;
      var budget=${budgets[c].b === null ? 'null' : budgets[c].b};
      var frames=0, last=null, withinRow=0, rowEnds=0;
      for(;;){
        last=rt3dCoverageSlice(world, spec, 1.2, { cursor:cursor, timeBudgetMs:budget });
        frames++;
        if(last.complete) break;
        if(frames>400000) break;
        if(cursor.i>0 && cursor.i<${COLS}) withinRow++;   // yielded mid-row
        if(cursor.i===0 && cursor.j>0) rowEnds++;       // yielded exactly at a row end
        window.__t += 1;                              // the frame gap
      }
      var an=window.__analyse(spec);
      var before=last.evaluatedCells;
      var again=rt3dCoverageSlice(world, spec, 1.2, { cursor:cursor, timeBudgetMs:budget });
      return { frames:frames, total:${TOTAL}, evaluated:last.evaluatedCells,
               directTested:last.diagnostics.directPathsTested,
               aps:last.diagnostics.participatingAps, complete:last.complete,
               withinRow:withinRow, rowEnds:rowEnds, an:an,
               resumeAdded:again.evaluatedCells-before,
               resumeComplete:again.complete };
    })())`));
    const label = `${budgets[c].n}  [${r.frames} frame(s), ${r.withinRow} mid-row, ${r.rowEnds} row-end]`;
    check(`1.${c + 1}`, `${label}: every (i,j) visited exactly once, none skipped`,
      r.an.visited === r.total && r.an.unique === r.total &&
      r.an.dup === 0 && r.an.missing === 0,
      JSON.stringify({ total: r.total, ...r.an }));
    check(`2.${c + 1}`, `${label}: evaluated === cols*rows on completion`,
      r.complete && r.evaluated === r.total,
      JSON.stringify({ evaluated: r.evaluated, total: r.total, complete: r.complete }));
    check(`3.${c + 1}`, `${label}: directTested === evaluated * AP count, and a completed cursor cannot resume`,
      r.directTested === r.total * APS && r.aps === APS &&
      r.resumeAdded === 0 && r.resumeComplete,
      JSON.stringify({ directTested: r.directTested, expect: r.total * APS,
                       aps: r.aps, resumeAdded: r.resumeAdded }));
  }
}

// ---------------------------------------------------------------- 4, 5
// A grid whose column count is NOT a multiple of the 8-cell deadline interval,
// where a row therefore ends between two checks.
{
  const COLS = 13, ROWS = 5, APS = 2, TOTAL = COLS * ROWS;   // 13 = 8 + 5
  const sb = makeSandbox({ apCount: APS });
  const r = JSON.parse(run(sb, `JSON.stringify((function(){
    var world=rt3dBuildWorld();
    var spec=window.__spec(${COLS}, ${ROWS});
    var cursor=window.__fresh();
    window.__visited=[]; window.__t=0;
    var frames=0, last=null;
    for(;;){
      last=rt3dCoverageSlice(world, spec, 1.2, { cursor:cursor, timeBudgetMs:1 });
      frames++; if(last.complete) break; if(frames>100000) break; window.__t+=1;
    }
    return { frames:frames, total:${TOTAL}, evaluated:last.evaluatedCells, an:window.__analyse(spec) };
  })())`));
  check(4, 'a column count not divisible by the check interval still visits every cell exactly once',
    r.an.visited === r.total && r.an.unique === r.total && r.an.dup === 0 && r.an.missing === 0,
    JSON.stringify({ colsMod8: 13 % 8, total: r.total, ...r.an }));
  check(5, 'row boundaries that fall between deadline checks do not lose or repeat a cell',
    r.evaluated === r.total && r.frames > 1,
    JSON.stringify({ evaluated: r.evaluated, total: r.total, frames: r.frames }));
}

// ---------------------------------------------------------------- 6, 7, 8
// The three yield placements named in the brief.
//
// A row-end yield and a mid-row yield are MUTUALLY EXCLUSIVE under one fixed
// 8-cell check interval: the deadline is only ever consulted at i = 7, 15, 23…,
// so it can coincide with a row's last cell only when cols is a multiple of 8,
// and it can land mid-row only when cols is not. So each shape gets the grid it
// actually needs, rather than pretending one grid can show both.
{
  // (6) row-end yield: cols = 8, so the check at i = 7 IS the row's last cell.
  //     The cursor must resume at the first cell of the next row.
  const COLS = 8, ROWS = 4, APS = 2;
  const sbA = makeSandbox({ apCount: APS });
  const a = JSON.parse(run(sbA, `JSON.stringify((function(){
    var world=rt3dBuildWorld();
    var spec=window.__spec(${COLS}, ${ROWS});
    var c=window.__fresh(); window.__visited=[]; window.__t=0;
    var s=rt3dCoverageSlice(world, spec, 1.2, { cursor:c, timeBudgetMs:7 });
    return { j:c.j, i:c.i, evaluated:s.evaluatedCells, complete:s.complete, oneRow:${COLS} };
  })())`));
  check(6, 'a yield exactly at the end of a row resumes on the first cell of the next row',
    a.j === 1 && a.i === 0 && a.evaluated === a.oneRow && a.complete === false,
    JSON.stringify(a));

  // (7) several yields WITHIN one row: cols = 156 is not a multiple of 8, so the
  //     deadline is always reached part-way through a row.
  const WIDE = 156, WROWS = 12;
  const sbB = makeSandbox({ apCount: APS });
  const b = JSON.parse(run(sbB, `JSON.stringify((function(){
    var world=rt3dBuildWorld();
    var spec=window.__spec(${WIDE}, ${WROWS});
    var c=window.__fresh(); window.__visited=[]; window.__t=0;
    var frames=0, withinRow=0, rowEnds=0, s=null;
    for(;;){
      s=rt3dCoverageSlice(world, spec, 1.2, { cursor:c, timeBudgetMs:1 });
      frames++; if(s.complete) break; if(frames>200000) break;
      if(c.i>0 && c.i<${WIDE}) withinRow++;
      if(c.i===0 && c.j>0) rowEnds++;
      window.__t+=1;
    }
    return { frames:frames, withinRow:withinRow, rowEnds:rowEnds,
             evaluated:s.evaluatedCells, total:${WIDE}*${WROWS},
             an:window.__analyse(spec) };
  })())`));
  check(7, 'several yields within a single row visit distinct cells and lose none',
    b.withinRow > 1 && b.rowEnds === 0 &&
    b.evaluated === b.total && b.an.visited === b.total &&
    b.an.unique === b.total && b.an.dup === 0 && b.an.missing === 0,
    JSON.stringify({ ...b, colsMod8: 156 % 8 }));

  // (8) yield exactly at the final cell of the whole grid: the deadline trips on
  //     the last cell and the run completes on the following pass.
  const FROWS = 4;
  const sbC = makeSandbox({ apCount: APS });
  const c = JSON.parse(run(sbC, `JSON.stringify((function(){
    var world=rt3dBuildWorld();
    var spec=window.__spec(${COLS}, ${FROWS});
    var total=${COLS}*${FROWS};
    var cur=window.__fresh(); window.__visited=[]; window.__t=0;
    var f=0, s=null;
    for(;;){ s=rt3dCoverageSlice(world, spec, 1.2, { cursor:cur, timeBudgetMs:total-1 });
      f++; if(s.complete) break; if(f>50) break; window.__t+=1; }
    return { frames:f, complete:s.complete, evaluated:s.evaluatedCells, total:total,
             an:window.__analyse(spec) };
  })())`));
  check(8, 'a yield exactly at the final cell completes on the next pass with no duplicate and no skip',
    c.complete && c.evaluated === c.total &&
    c.an.visited === c.total && c.an.unique === c.total &&
    c.an.dup === 0 && c.an.missing === 0,
    JSON.stringify(c));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
