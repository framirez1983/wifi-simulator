# wifi-simulator fork — agent notes

Conservative fork of https://github.com/nevva/wifi-simulator.
Goal: practical WiFi planning with a stable, evidence-driven RF model and improved usability.

## Layout

Single-file vanilla app, no build / tests / lint / CI:

- `index.html` (~4400 lines) — the entire app: CSS, i18n dicts, RF engine, UI
- `Dockerfile` + `nginx.conf` + `docker-compose.yml` — serve via `nginx:alpine`
- No `package.json`, no framework, no bundler. Keep it that way: no React/Vue/backend/deps unless explicitly requested.

## Commands

```bash
docker compose up -d --build   # build + run, serves on :8080
docker logs wifi-simulator     # logs
```

No test suite — verify by rebuilding and loading the page (check 2D + 3D views).
3D needs internet: Three.js r128 loads from the cdnjs CDN (script tag in `<head>`).

## RF engine — do not touch

RF code lives in `index.html` (`rssiFromAP`, `sinrAt`, `computeHeatSimple`,
`computeIndoorFine`, ray-tracing section). Never modify RF math,
material/inter-floor losses, auto-channel/placement, or 3D RF representation
unless explicitly instructed. UI-only changes must produce identical RF results
for the same scene and parameters. RF behavior may only change when explicitly
requested, after reproducing and validating the physical/model issue.

## Saved-project compatibility (`loadProject`)

Old `.wifiproj.json` files must keep loading. New state fields must be optional
with `==null` defaults added in the migration block, following the existing
pattern (e.g. `if(s.noiseFloor==null)s.noiseFloor=-95`). Same for per-floor and
per-AP fields. Never silently change RF parameters of old projects.

## State vs preferences

- Persist in `.wifiproj.json` only intrinsic project/planning state.
- Pure editor/view preferences use the existing editor/localStorage pattern
  (like `wifiSimulator.uiLanguage`) and stay out of project JSON and undo
  history unless explicitly required otherwise.

## i18n (exists — use it)

`translations` dict in `index.html` with `es` (default), `en`, `sv`;
language persists in localStorage `wifiSimulator.uiLanguage`, falls back to `es`.
Every new visible string needs a key in all three dicts, wired via `data-i18n`
attributes (or `t()` / `setUiText()` for dynamic text). Do not translate user
data (names, values) or technical terms: RSSI, SINR, GHz, dBm, ray tracing.

## AP manufacturer/model

Free-text fields on each AP (`ap.manufacturer`, `ap.model`), not a preset
system. If adding presets, they only populate existing AP controls, stay
editable, stay out of RF math, and old APs without preset ids keep exact
parameters.

## Background floor plans

Usability around the existing background-image support only. No OCR, AI image
analysis, perspective correction, or image editing.

## Working rules

- Implement exactly one feature or narrowly scoped fix at a time.
- Validate it automatically.
- Stop and report how to test it manually.
- Do not commit until the user explicitly approves the implementation.
- After explicit approval, create one focused commit and push the current feature branch to its configured remote.
- Never merge unless explicitly requested.
- Never force-push or rewrite history.
- After commit + push, stop before starting the next feature unless asked to continue.
- Small, localized diffs; no broad refactors unasked.
- Keep unrelated formatting out of the patch; review the diff before finishing.
- Edit the Git working tree (`/opt/wifi-simulator`) — never files inside the container.
- `docker-compose.override.yml` is local-only (git-excluded); don't commit it.
- Small focused commits (`feat:`/`fix:` style) on feature branches.
- Never use destructive Git commands unless explicitly requested.
- Never commit secrets or `*.wifiproj.json` files.
