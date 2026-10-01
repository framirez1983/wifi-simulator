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
| `bench2.mjs`, `bench3.mjs`, `bench4.mjs`, `stage5-bench.mjs` | per-stage performance harnesses (nearest query, full path, emission fan, experimental browser layer) |
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
