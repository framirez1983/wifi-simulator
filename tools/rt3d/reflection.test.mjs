// Stage 1E — mathematical proof of the reflection primitive, and
// Stage 1C — performance of the pure intersection primitives.
//
// Reflection proofs are pure mathematics and are asserted to full double
// precision. No ceiling or slab reflection is enabled anywhere: N=(0,0,1) is
// exercised only through rt3dReflect, as infrastructure proof.
import { loadApp, run, blankState } from './loader.mjs';

const sb = loadApp();
blankState(sb);
let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? ' :: ' + detail : '')); }
};
const near = (a, b, tol = 1e-12) => Math.abs(a - b) <= tol;
const V = (s) => JSON.parse(run(sb, `JSON.stringify(${s})`));

console.log('Stage 1E — reflection mathematics\n');

// --- vertical wall, horizontal ray: dz is untouched ---------------------
{
  const r = V(`(function(){
    var D=rt3dUnit(rt3dV(1,1,0));
    var N=rt3dV(-1,0,0);
    return {D:D, N:N, R:rt3dReflect(D,N)};
  })()`);
  const s = Math.SQRT1_2;
  check('vertical wall, dz=0: dz stays exactly 0',
    near(r.D.z, 0) && near(r.R.z, 0) &&
    near(r.D.x, s) && near(r.D.y, s) &&
    near(r.R.x, -s) && near(r.R.y, s),
    JSON.stringify(r));
}

// --- vertical wall, descending ray: horizontal flips, dz preserved ------
{
  const r = V(`(function(){
    var D=rt3dUnit(rt3dV(1,1,-0.25));
    var N=rt3dV(-1,0,0);
    var R=rt3dReflect(D,N);
    return {D:D,N:N,R:R,lenSq:rt3dLenSq(R), rn:rt3dDot(R,N), dn:rt3dDot(D,N)};
  })()`);
  check('vertical wall, dz!=0: horizontal direction mirrored, dz preserved',
    r.D.z < 0 &&
    near(r.R.z, r.D.z) &&                  // N.z = 0 => no vertical component removed
    near(r.R.x, -r.D.x) && near(r.R.y, r.D.y) &&
    near(r.lenSq, 1) &&                    // still a unit vector
    near(r.rn, -r.dn),                    // the normal component reverses sign
    JSON.stringify(r));
}

// --- horizontal plane: the vertical component reverses ------------------
{
  const r = V(`(function(){
    var D=rt3dUnit(rt3dV(1,1,-0.25));
    var N=rt3dV(0,0,1);
    var R=rt3dReflect(D,N);
    return {D:D,N:N,R:R,lenSq:rt3dLenSq(R)};
  })()`);
  check('horizontal plane N=(0,0,1): the vertical component reverses',
    near(r.R.z, -r.D.z) &&                 // descending becomes ascending
    near(r.R.x, r.D.x) && near(r.R.y, r.D.y) &&
    near(r.lenSq, 1),
    JSON.stringify(r));
}

// --- an oblique plane mixes the components (general formula, no special case)
{
  const r = V(`(function(){
    var D=rt3dUnit(rt3dV(1,1,-0.25));
    var N=rt3dUnit(rt3dV(1,1,1));
    var R=rt3dReflect(D,N);
    // mirror check: reflecting twice returns the original direction
    var R2=rt3dReflect(R,N);
    return {D:D,R:R,lenSq:rt3dLenSq(R), roundTrip:near2(R2,D)};
    function near2(a,b){ return Math.abs(a.x-b.x)<1e-12&&Math.abs(a.y-b.y)<1e-12&&Math.abs(a.z-b.z)<1e-12; }
  })()`);
  check('oblique plane: general 3D formula, and reflecting twice is the identity',
    r.roundTrip === true && near(r.lenSq, 1) && !near(r.R.x, r.D.x),
    JSON.stringify(r));
}

// --- a ray hitting a surface exactly head-on returns along its own path --
{
  const r = V(`(function(){
    var D=rt3dUnit(rt3dV(0,0,-1));
    var R=rt3dReflect(D, rt3dV(0,0,1));
    return {R:R};
  })()`);
  check('normal incidence reflects straight back',
    near(r.R.x, 0) && near(r.R.y, 0) && near(r.R.z, 1),
    JSON.stringify(r));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
