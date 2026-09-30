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

`oracle.mjs` defaults to `check`. Use `node tools/rt3d/oracle.mjs record` only
when a fixture's *legacy* fingerprint is expected to change, and only with an
explicit reason: the oracle is the migration's ground truth and must not be
weakened to make a new engine pass.

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
