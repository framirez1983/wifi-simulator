# RT3D migration validation harness

Zero-dependency Node scripts that validate the parallel true-3D ray kernel
(`rt3d*`) in `index.html` against the legacy 2.5D production engine.

This is **not** an application test framework and it is not part of the app.
Nothing here is loaded by `index.html`; the kernel itself is inert until a
later stage cuts the engine over.

```
node tools/rt3d/run-all.mjs      # everything below, in order
```

| script | what it proves |
|---|---|
| `run-all.mjs` | runs every check below and exits non-zero on any failure |
| `stage1.test.mjs` | the 19 required Stage-1 validations (1-18 from the plan, 19 locks the production launch-Z decision) |
| `reflection.test.mjs` | Stage 1E reflection mathematics, to full double precision |
| `oracle.mjs` | Stage 1A compatibility oracle: legacy engine vs kernel, per fixture |
| `smoke.mjs` | boots the app for real (`start()`) and traces the seeded demo room |
| `production-untouched.mjs` | the production `runRayTrace()` block is byte-identical to baseline `78876a2` and nothing in production calls the kernel |
| `bench.mjs` | Stage 1C performance of the pure intersection primitives |
| `stage2.test.mjs` | Stage 2: true-3D path tracing, transmission per positive traversal, vertical-wall reflection only |
| `stage3.test.mjs`, `stage3-paths.test.mjs`, `stage3-stress.test.mjs` | Stage 3: deterministic AABB BVH, path equivalence against the linear oracle, and a 12 000-ray differential stress run |
| `slab-thickness.test.mjs` | one canonical slab thickness shared by interactive 3D, glTF export and RT3D |
| `stage4.test.mjs` | Stage 4: deterministic 3D emission fan, receiver-plane crossing, and the sample-record budget |
| `stage5.test.mjs` | Stage 5: the `?rt3d=1` experimental browser layer — gating, live-project feeding, binning, no-interpolation and no-persistence |
| `stage5-completion.test.mjs` | Stage 5 async completion: `cursor >= total` must finalize exactly once, never strand, on a faked clock |
| `stage5-contract.test.mjs` | Stage 5 result/grid-spec contract, executed through the **real** `rt3dExpStart()` path: snapshot semantics, painting, cache consistency |
| `stage6-runner.test.mjs` | Stage 6 browser runner: phase instrumentation, time-budgeted evaluation, yields, cancellation and no-partial-publish |
| `stage6-cursor.test.mjs` | Stage 6 resumable cursor: every canonical cell is evaluated **exactly once**, asserted on the *identity* of visited `(i,j)` pairs rather than on a tally |
| `stage6.test.mjs` | Stage 6: the unified `Coverage(x,y,z)` field — every body family, the antenna model, exact first-order reflection, strongest-path aggregation, and 2D-slice equality |
| `stage65-ladder.test.mjs` | Stage 6.5 fixture ladder A–J: per geometry, whether Legacy and RT3D *should* agree, and whether they do |
| `stage65-diff.mjs` | **not a check** — drives the real `runRayTrace()` against the real Stage-6 slice and prints the full differential report; accepts an arbitrary project JSON |
| `rackclear-fuzz.mjs` | **not a check** — deterministic fixed-seed differential fuzz (400 cases) between the analytic rotated-prism traversal test and the kernel's `rt3dBodyEvent`, plus a dense brute-force cross-check. This is the evidence that the analytic clip is wrong and the kernel is authoritative |
| `bench2.mjs`, `bench3.mjs`, `bench4.mjs`, `stage5-bench.mjs` | per-stage performance harnesses (nearest query, full path, emission fan, experimental browser layer) |
| `stage6-bench.mjs` | **not a check** — measures the Stage-6 unified coverage field cost on a realistic multi-floor scene. Measures and reports only; adds no optimisation |
| `manual-scenes.mjs` | **not a check** — writes development-only diagnostic SVGs for visual inspection |

`oracle.mjs` defaults to `check`. Use `node tools/rt3d/oracle.mjs record` only
when a fixture's *legacy* fingerprint is expected to change, and only with an
explicit reason: the oracle is the migration's ground truth and must not be
weakened to make a new engine pass.

## Diagnostic SVGs (development only)

```
node tools/rt3d/manual-scenes.mjs     # writes tools/rt3d/out/*.svg
```

These are **sample-cloud scatter plots, not heatmaps**: one mark per real path
intersection with the receiver plane, coloured by received power. No grid, no
interpolation, no splatting, no smoothing and no filling of empty regions —
empty space means no path reached the plane there. Scene geometry (walls, RF
Object footprints, pillars, Ceiling footprint and holes, slab footprint and
Openings, AP positions) is drawn underneath at the same uniform scale, subdued,
so a path can be read against the body that shaped it. Titles and the numeric
annotations are generated from the actual fixture values, so a label cannot
drift from the geometry.

> **Scope.** `manual-scenes.mjs` builds **deterministic diagnostic fixtures** in
> the Node harness. It does **not** read, load or inspect the project currently
> open in a browser, and it does not connect to the running app in any way;
> running it changes nothing in the application. A real project could be fed in
> by serialising it into a fixture, but nothing like that happens automatically.

Nothing in this directory is loaded by `index.html`. The SVGs are regenerated
from scratch on every run and are not committed as reference artifacts.

## Stage 5: the `?rt3d=1` experimental browser layer

Stage 5 is the first stage whose acceptance surface is the real application in
a browser with a real loaded project. It is **not production**:

- The layer exists only when the page is opened with `?rt3d=1`. Without that
  flag it creates no DOM, stores nothing, and the single production call site
  (`rt3dExpInit()` from `start()`) returns immediately.
- `runRayTrace()` remains the default engine and is byte-identical to baseline
  `78876a2`. The experimental layer does not replace it, merge with it, or
  change what the Ray tracing button does.
- The layer reads the live `state` object through the same
  `rt3dBuildWorld()` validated in Stages 1–4. Nothing is exported to Node and
  re-imported through another representation.
- The mode is not persisted. Nothing in it is reachable from `state`, and
  `saveProject()` cannot serialise it.

```
node tools/rt3d/stage5-bench.mjs   # performance + sample coverage on a project-like scene
```

`stage5-bench.mjs` builds a PROJECT-LIKE two-floor scene with the ingredients
S4 exercises (shell, glass partition, pillars, racks at several heights, a
normal-height Ceiling with holes, a slab with Openings, APs on two floors). It is
a stand-in, not S4Optik: its timings carry the Node vm cross-context overhead
seen in the other benches and exclude rendering, so read them as an order of
magnitude.

### Engine rules, all printed in the in-app panel

| rule | value |
|---|---|
| AP inclusion | `apParticipatesInRf(ap) && ap.bands.includes(state.band)` over **all** floors; no filter by floor, height or distance |
| receiver plane | `rt3dReceiverPlaneZForFloor(state.activeFloor)` — absolute Z |
| grid | `rt3dGridSpec(activeFloor)` — the same cells as the legacy tracer |
| binning | direct cell binning; no interpolation, blur, smoothing, splat or IDW |
| aggregation | strongest single sample per cell (the legacy `depositCell` rule); never averaged, never summed, no power summation |
| no-data | unsampled cell = `-Infinity` = fully transparent |
| antenna | azimuth-only (`antennaAzGain`); the Simple/SINR vertical/downtilt model is **not** reconciled here |
| fan | Stage-4 `equalSolidAngle`, unchanged |

RT3D paints through its own canvas rather than `heatGridDisp`, because
`paintHeat()` honours the user's `heatmapSmoothing` preference and would
interpolate an RT3D grid. Colour comes from the application's own `rssiColor()`,
so there is no second colour interpretation.

## How it works

`loader.mjs` extracts the single `<script>` block from `index.html` and
evaluates it in a Node `vm` with a minimal DOM stub, so the real engine code
runs unmodified and headlessly. The oracle therefore runs the actual production
`runRayTrace()`, not a re-implementation.

`legacyprobe.mjs` and `newprobe.mjs` are debugging aids: they patch
`depositCell` **in memory only** and list every deposit that lands in one grid
cell, for the legacy engine and the new kernel respectively. The file on disk is
never modified. `griddiff.mjs` reports a full-grid diff between the two.

## Fixtures and the oracle file

`fixtures.mjs` builds project states with the app's own helpers, so the geometry
is canonical project data. `rt3d-oracle.json` is the recorded result of the
legacy engine plus the kernel for each fixture, and is required data for the
migration tests.

Each fixture launches the kernel in **horizontal compatibility mode** on the
legacy receiver plane. That is the one legacy 2.5D assumption compatibility
mode keeps on purpose, so the fixtures measure the 3D mathematics. It is not
the production semantic: the future 3D engine must launch from
`rt3dApOriginZ(af, ap)` (see the comment on that function in `index.html`).
Check 19 in `stage1.test.mjs` guards this distinction.

## Harness traps (both have bitten a suite here)

**`performance.now` cannot be assigned.** Node's `Performance.prototype.now` is a
non-writable accessor, so `performance.now = fn` is a **silent no-op** — no error,
and the "fake clock" keeps reporting real wall-clock. Every timing assertion in
that suite is then really measuring the machine. Replace the whole object:

```js
window.performance = { now: function(){ return window.__now; } };   // works
performance.now = function(){ return window.__now; };             // silently inert
```

This is worth checking whenever a timing test passes on the first try: a real
budget overrun of ~1 ms is exactly what an inert clock hides. Fixing the clock in
`stage6-runner.test.mjs` is what exposed check 3's real (bounded, legal) 1 ms
overshoot from consulting the deadline only every 8 cells.

**A tally cannot prove exactly-once.** A duplicate and a skipped cell cancel out
in a count. `stage6-cursor.test.mjs` therefore records the **identity** of every
visited cell and asserts on the set — `unique === total`, `dup === 0`,
`missing === 0`. That distinction mattered: the real S4 run reported 61 362 cells
evaluated for a 59 592-cell grid, which a duplicate-per-yield explained exactly
while skipping nothing at all, so every count-based check still agreed.

## Stage 6.5: Legacy vs RT3D RF truth audit (development only, `?rt3d=1`)

Stage 6 produced a materially different field from the legacy engine on the real
S4 project. Internal consistency is not evidence of correctness, so Stage 6.5
**gathers evidence and changes nothing**.

### Truth hierarchy — the rule the whole audit is governed by

```
real measurement / known physical geometry
              <  physically justified model
              <  legacy behaviour (runRayTrace)
```

**Legacy output is NOT truth.** `runRayTrace()` is a *compatibility oracle*: it
is the thing the migration is checked against for regression, and it is evidence
about what this application has always displayed. It is not evidence about
physics. When the two engines disagree, the default assumption must be that
legacy is wrong until the difference is explained — not that RT3D is wrong, and
not that they should be made to agree.

`rt3dAuditAttachMeasurement(x, y, z, rssiDbm, {source, measuredAt})` is the only
sanctioned way to attach a real reading. It refuses a non-finite value, flags any
reading without provenance, never invents a default, and scores only provenanced
readings. **No measurement exists in this repository.**

### What the audit may and may not do

| may | may not |
|---|---|
| decompose a path into named, per-family terms | tune, fit or select any RF parameter |
| report four counterfactual variants | write a variant to the canonical field |
| state which legacy quantities are unrecoverable | reconstruct a legacy value it did not read |
| correlate a difference with a geometric class | infer causation from that correlation |
| refuse to resolve a probe that does not exist | substitute a nearby location |

### The legacy attribution limit — read this before trusting a legacy number

`runRayTrace()` keeps exactly two things per cell: `best[k]`, the **maximum over
every deposit from every AP and every reflected branch**, and a reach flag.
Everything else is a local variable that dies with the march. So per-cell legacy
**serving AP, per-traversal wall/pillar/object loss, reflection contribution,
winning path length and traversal count are genuinely unrecoverable.** The probe
reports that list explicitly instead of re-deriving it. Inlining into the closure
would mean editing the byte-identical production engine; a re-implementation would
mean inventing a second, divergent "legacy".

Two further caveats are computed rather than glossed over:

- `best[k]` is a max over samples landing in the cell, so it is **biased upward**
  relative to the exact cell-centre field. A positive mean offset is partly an
  estimator artefact, not physics.
- Legacy leaves cells no sample reached at `-Infinity`; RT3D solved them. Those
  are counted separately and excluded from the dB statistics.

### Diagnostic counterfactuals

Same path solutions, one ingredient changed each. Never a coverage mode.

| variant | what it isolates |
|---|---|
| `canonical` | the real Stage-6 value |
| `azOnly` | the **vertical antenna model** |
| `noReflections` | the **first-order reflection** contribution |
| `losOnly` | **true-3D geometry / material crossings** |

`noReflections` still pays for every wall it crosses; `losOnly` charges no
material at all. Collapsing them would hide the geometry term the audit exists to
measure.

### Fixture ladder and probe resolution

`stage65-ladder.test.mjs` builds ten controlled scenes (A–J) with the app's own
helpers and asserts, per geometry, whether the engines *should* agree and then
whether they do. Where legacy is structurally incapable, divergence is the
correct outcome and is asserted as such.

Evidence probe locations are **resolved by rule against the live project**, never
hardcoded — the same rule that finds "near WH94-001" on S4 finds "near the second
participating AP" anywhere. A rule that cannot be satisfied returns
`resolved:false` with a reason. Inventing a coordinate would look like evidence.

### Commands

```
node tools/rt3d/run-all.mjs                      # all checks, incl. the ladder
node tools/rt3d/stage65-diff.mjs                 # differential report, 4 scenes
node tools/rt3d/stage65-diff.mjs proj.json       # the same, for a real project
node tools/rt3d/stage65-diff.mjs proj.json --floor=1
```

`stage65-diff.mjs` drives the **real** `runRayTrace()` and the **real** Stage-6
slice and prints, per scene: whole-slice difference statistics, the true-3D
distance term, reflection contribution, vertical antenna contribution, spatial
correlation, and a per-AP explanation of the four worst cells. `proj.json` is fed
through the app's own `loadProject()`, so the real migration block runs.

Timings in this output carry Node `vm` cross-context overhead and exclude
rendering. Read them as order of magnitude, never as browser numbers.

## Stage 6.5c: the comparison-snapshot cache contract

The first delta-map implementation gated on the **displayed** engine's globals
(`heatGridRssi` / `heatMeta` / `rt3dExpMeta`). A real S4/PB run failed in exactly
the sequence it was designed for — Legacy, then RT3D, then delta map — for four
independent reasons:

1. **The view destroyed the comparison source.** `rt3dExpSetView('rt3d')` sets
   `showHeat=false`, and the application clears `heatRtReach` and `heatGridRssi`
   whenever `showHeat` is false. `heatRtReach` is the *only* thing that
   distinguishes a finished `runRayTrace()` grid from a Simple heatmap, so the
   evidence that a completed Legacy run existed was destroyed by the act of
   viewing RT3D. A snapshot must be taken **at completion**, never harvested from
   live display state afterwards.
2. **`rt3dExpLastCoverage` is the slice object, not a grid.** It was being handed
   to the delta statistics, which read `.length` and got `undefined`. Even with a
   passing gate the map would have been blank.
3. **The caches were single-slot.** `rt3dExpCache` holds one `legacy` and one
   `coverage`, so running Legacy on PA destroyed PB's snapshot.
4. **Floor identity was mixed.** Caches and meta compare `floorId`; the probe and
   slice diagnostics used `state.activeFloor`, an index.

The fix is two independent stores, `rt3dAuditLegacyByFloor[floorId]` and
`rt3dAuditRt3dByFloor[floorId]`, each written only at completion and each holding
its own copy of the grid. **Availability is decided by those stores alone.**
`showHeat`, the view selector and the displayed engine are never consulted, so
switching engine cannot change whether a comparison exists.

The stock Ray tracing control cannot be hooked without editing the byte-identical
production engine, so `rt3dAuditObserveLegacy()` also notices a completed
`runRayTrace()` from evidence only that function produces, and records which
evidence qualified the snapshot. It refuses when neither holds, so a Simple or
SINR heatmap can never be silently compared as a traced grid. There is no second
Legacy implementation.

### A harness gap that hid the regression

`stage65c` initially passed 28/28 with the original defect reinstated. The harness
stubs `coverageUpdate()`, which is what nulls `heatRtReach` in a real browser — so
nothing was destroying the display state under test and the defect was invisible.
Checks 29–32 now perform that destruction **explicitly**, which is stronger than
relying on a stubbed side effect. Reinstating the defect then fails 30 and 32.

## Stage 6.5d: the per-probe comparison table

The resolver produced coordinates and the audit core produced every number, but
neither was visible in the panel: the operator saw the probe set as coordinates only.
Stage 6.5d formats the existing data — it computes no new physics.

- **Ordered by evidential weight**: `rackFront`, `rackBehind`, `rackOverhead`,
  `maxDisagreement`, then `closestAgreement` as the control, then the rest. The
  control sits immediately after the disagreements on purpose: without a point where
  the engines *do* agree, a large disagreement has nothing to be measured against.
- **Rows are collapsed by default.** Each row computes one point query when it is
  expanded, not on every render. No slice is recomputed, and building the block does
  not alter any retained snapshot.
- **Both grids come from the retained per-floor snapshots**, never from the display,
  so the table is identical whatever engine is visible. This is the Stage-6.5c defect
  not repeating itself.
- **Legacy's unrecoverable quantities stay `UNATTRIBUTABLE`.** Five of them, each
  with its reason. The table contains no Legacy material-loss rows at all, because
  inventing one would be a fabrication.

### Why a rule did not resolve

`rt3dAuditCeilingDiagnostics()` and `rt3dAuditOpeningDiagnostics()` inspect the
**loaded model** and name the check that rejected it: how many Ceiling Areas exist,
whether the `name` field is present and non-empty, whether `footprint` is an array or
a `{parts:[…]}` object, how many points the ring has, how many are finite, and
whether `cleanFootprintRing()` accepted it (≥3 points, finite x and y, non-zero
enclosed area). Nothing is repaired, defaulted or synthesised — a missing name or an
unusable polygon is a fact about the project.

This immediately found a **resolver bug, not a model defect**: the slab-Opening rule
read `op.outer` / `op.footprint.outer`, but an Opening's canonical polygon is
`op.points` — that is what `pointInOpening()` reads and what `slabPlanForFloor()`
punches as a slab hole. So **every** Opening was reported as "no usable polygon",
valid or not. The rule now reads `points` (still accepting `outer`) and reports which
field it used, the raw point count and whether the ring survived cleaning.

The "no named Ceiling Area" result is a genuine model fact: the rule resolves by name
so it can find "Cuarto Oscuro" on one project and something else on another, and it
will not guess an unnamed Ceiling or rename one.

### Slab ownership, traced from the canonical helpers

This is the invariant that the path-qualified slab probes depend on, and it is
**not** obvious from the data model — so it is recorded here rather than
rediscovered. Traced from the helpers, not inferred:

```
rt3dBuildWorld          for fi>0 -> rt3dSlabBody(state.floors[fi], fi)
rt3dSlabBody            zTop = floorElevation(fi); plan = slabPlanForFloor(f)
slabPlanForFloor        holes come from f.openings  (the OWNING floor)
slabLossBetweenPoints   pointInOpening(state.floors[slabFloor], x, y)
pointInOpening          (f.openings||[]).some(o => pointInPolygon(x, y, o.points))
```

So a slab at `floorElevation(k)` is owned by floor `k`, **and it uses floor `k`'s
Openings**, not the floor below it. Nothing may interpret that geometry a second
way. The regression is `stage65h-evidence.test.mjs` checks 1–8, on a fixture solved
analytically rather than searched: PB elevation 0, PA elevation 3.2, slab
3.2→3.08, Opening x∈[0,6] y∈[-5,5], AP Z 5.8, receiver Z 1.2, `t = 0.565217`;
RX 3.54 → crossing (2.0009, 0) inside the Opening (traversal 0, loss 0), RX −6 →
(−3.3913, 0) inside solid slab (traversal 1, effective loss 16 dB).

## Stage 6.5e: geometry-only Ceiling probe, and rack clearance

**Named vs geometry-only Ceiling.** The named rule stays as it was — it exists so
"Cuarto Oscuro" is found on S4. A second rule locates a Ceiling by **geometry only**:
any area whose canonical `ceilPlan()` yields a usable outer ring is probeable at its
ring centroid on the receiver plane, named or not. The two are reported separately
and never merged. An unnamed Ceiling still attenuates RF, so in a physical audit it
must remain discoverable. If the geometry rule resolves and the named rule does not,
the finding is a **resolver/name limitation**, never "the project has no Ceiling
Area". Nothing is renamed or mutated; a Ceiling at or below the receiver plane is
refused, because no receiver-height probe lies beneath it.

**Rack clearance.** The three rack probes are the decisive evidence for the true-3D
obstacle-height claim, so the geometry is printed rather than inferred from a dB
difference: AP Z, receiver Z, the Z of the path across the rack footprint, the rack's
own Z interval, and what RT3D actually charged. The footprint interval is solved from
the object's own width/depth/rotation and then **cross-checked against the kernel's
own traversal event**.

Two defects this surfaced, both of which had been producing *silently absent* rather
than wrong evidence:

- `rt3dAuditProbeAt` always forced `z = floorElevation + receiverHeight()`, so the
  **above-rack probe measured at the receiver height instead of above the rack** and
  proved nothing. An explicit `opts.z` is now honoured; the receiver plane remains
  the default.
- The clearance block referenced `r.point` where the variable was `rec`, and the
  surrounding `try/catch` swallowed the `ReferenceError`, so the whole block
  disappeared without a trace. The catch now reports.

A related cross-check bug worth recording: "the footprints overlap in plan" and "the
kernel emitted a traversal event" are **not** the same predicate. A path can pass over
a rack footprint while clearing it in Z, and then correctly produce no event at all.
Comparing the two directly reported a permanent, meaningless disagreement.

**Classification is never driven by magnitude.** `RT3D IMPLEMENTATION BUG` requires a
failed internal invariant or a probe/canonical mismatch — both positive evidence. A
120 dB difference with all invariants intact is `PHYSICALLY UNRESOLVED`; a 0.2 dB
difference with a failed invariant is `RT3D IMPLEMENTATION BUG`. Both directions are
asserted.
