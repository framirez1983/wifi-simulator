// Stage 4 development-only visual diagnostic.
//
// Renders the receiver-plane SAMPLE CLOUD as a standalone SVG, with the
// PHYSICAL GEOMETRY THAT PRODUCED IT drawn underneath in project XY at the
// same uniform scale. Showing samples without the walls, objects and
// Ceilings that shaped them makes the picture unauditable, so the geometry is
// part of the artefact.
//
// The RF samples are still a pure scatter: one mark per real path
// intersection, coloured by received power. There is no grid, no
// interpolation, no splatting, no smoothing and no filling of empty regions.
// Geometry is drawn as subdued vector outlines precisely so it cannot be
// mistaken for, or compete with, the samples.
//
// Nothing here is loaded by index.html. It is a harness tool only and changes
// no RT3D physics, fan generation or sample calculation.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Deterministic power ramp, blue (weak) -> green -> yellow -> red (strong).
// Fixed stops, so two runs of the same cloud are pixel-identical.
const RAMP = [
  [-95, [40, 70, 160]],
  [-80, [30, 140, 190]],
  [-70, [40, 175, 120]],
  [-60, [150, 195, 60]],
  [-50, [235, 195, 45]],
  [-40, [235, 110, 40]],
  [-30, [215, 50, 50]],
];
export function rampColor(dbm) {
  if (dbm <= RAMP[0][0]) return RAMP[0][1];
  for (let i = 0; i < RAMP.length - 1; i++) {
    const [a, ca] = RAMP[i], [b, cb] = RAMP[i + 1];
    if (dbm <= b) {
      const t = (dbm - a) / (b - a);
      return [0, 1, 2].map((k) => Math.round(ca[k] + t * (cb[k] - ca[k])));
    }
  }
  return RAMP[RAMP.length - 1][1];
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const trim = (n) => (Math.abs(n) < 1e-9 ? '0' : String(Math.round(n * 1e6) / 1e6));
const f2 = (n) => (typeof n === 'number' && Number.isFinite(n) ? n.toFixed(2) : '—');

// --- subdued geometry palette, all low-contrast against the samples ------
const G = {
  wallBody:   { fill: '#3d5568', stroke: '#6f93ad', op: 0.55 },
  wallLine:   { stroke: '#9fc4dc', op: 0.45 },
  object:     { fill: '#4a4f7a', stroke: '#8f95c9', op: 0.60 },
  pillar:     { fill: '#5a4a63', stroke: '#a58bb4', op: 0.60 },
  ceilSolid:  { fill: '#2f4a3f', stroke: '#63a389', op: 0.50 },
  ceilHole:   { fill: '#111820', stroke: '#d9b45a', op: 0.95 },
  slab:       { fill: '#243642', stroke: '#4d6a7d', op: 0.30 },
  opening:    { fill: '#0f151b', stroke: '#e07a4a', op: 0.95 },
  frame:      { stroke: '#2a3542', op: 1 },
  grid:       { stroke: '#1b232c', op: 1 },
};

const poly = (pts, X, Y) => pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(2)} ${Y(p.y).toFixed(2)}`).join(' ') + ' Z';

// Rotated rectangle footprint for an RF Object, from its derived body.
// Uses the body's own cos/sin so the drawn angle is exactly the body's
// rotation, with no trig round-trip to disagree with the tracer.
function objectCorners(o) {
  const c = o.c, s = o.s;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
    const lx = sx * o.hw, ly = sy * o.hd;
    return { x: o.cx + lx * c - ly * s, y: o.cy + lx * s + ly * c };
  });
}
function objectPath(o, X, Y) {
  return poly(objectCorners(o), X, Y);
}

/**
 * Render one sample cloud plus its geometry.
 *
 * cloud:  { samples, receiverPlaneZ, apOrigin, backend, diagnostics, geometry, bounds }
 * opts:   { title, subtitle, notes, annotations, width, height, emphasise }
 */
export function renderCloudSvg(cloud, opts = {}) {
  const geom = cloud.geometry || {};
  const W = opts.width || 1180;
  const H = opts.height || 760;
  const M = { l: 68, r: 210, t: 92, b: 74 };   // right margin holds the legend
  const iw = W - M.l - M.r, ih = H - M.t - M.b;

  // ---- extents: geometry AND samples, so the plot frame is stable -------
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  const acc = (x, y) => {
    if (x < minx) minx = x; if (x > maxx) maxx = x;
    if (y < miny) miny = y; if (y > maxy) maxy = y;
  };
  for (const w of geom.walls || []) { acc(w.x1, w.y1); acc(w.x2, w.y2); }
  for (const o of geom.rfObjects || []) for (const q of objectCorners(o)) acc(q.x, q.y);
  for (const p of geom.pillars || []) { acc(p.px - p.r, p.py - p.r); acc(p.px + p.r, p.py + p.r); }
  for (const c of geom.ceilings || []) forEachRing(c.plan, acc);
  for (const s of geom.slabs || []) forEachRing(s.plan, acc);
  for (const a of geom.aps || []) acc(a.x, a.y);
  for (const s of cloud.samples) acc(s.x, s.y);
  if (!Number.isFinite(minx)) { minx = 0; maxx = 1; miny = 0; maxy = 1; }
  const padx = (maxx - minx) * 0.05 || 0.5, pady = (maxy - miny) * 0.05 || 0.5;
  minx -= padx; maxx += padx; miny -= pady; maxy += pady;

  // ---- UNIFORM scale on both axes, so geometry is not distorted --------
  const sxr = iw / (maxx - minx || 1);
  const syr = ih / (maxy - miny || 1);
  const sc = Math.min(sxr, syr);
  const ox = M.l + (iw - (maxx - minx) * sc) / 2;
  const oy = M.t + (ih - (maxy - miny) * sc) / 2;
  const X = (x) => ox + (x - minx) * sc;
  const Y = (y) => oy + ih - (y - miny) * sc;      // flip: +y is up
  const PX = (m) => m * sc;

  let minP = Infinity, maxP = -Infinity;
  for (const s of cloud.samples) {
    if (s.receivedPower < minP) minP = s.receivedPower;
    if (s.receivedPower > maxP) maxP = s.receivedPower;
  }
  if (!Number.isFinite(minP)) { minP = -100; maxP = -30; }

  const p = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="ui-monospace,Menlo,Consolas,monospace">`);
  p.push(`<rect width="${W}" height="${H}" fill="#0f141b"/>`);

  // ---- header -----------------------------------------------------------
  p.push(`<text x="${M.l}" y="30" fill="#e6edf3" font-size="16" font-weight="600">${esc(opts.title || 'RT3D receiver-plane sample cloud')}</text>`);
  if (opts.subtitle) p.push(`<text x="${M.l}" y="50" fill="#a9b6c2" font-size="11.5">${esc(opts.subtitle)}</text>`);
  const d = cloud.diagnostics || {};
  const apn = geom.aps && geom.aps.length ? geom.aps.map((a) => `${a.name}@Z${f2(a.z)}`).join(', ') : '—';
  p.push(`<text x="${M.l}" y="67" fill="#7d8b98" font-size="10.5">receiver plane Z = ${f2(cloud.receiverPlaneZ)} m   |   AP ${esc(apn)}   |   ` +
         `samples ${cloud.samples.length}   |   direct ${d.directSamples || 0} / reflected ${d.reflectedSamples || 0}   |   backend ${cloud.backend}</text>`);
  p.push(`<text x="${M.l}" y="82" fill="#6e7c8c" font-size="9.5">antenna: ${esc(d.antennaModel || 'n/a')}</text>`);

  // ---- plot frame + 1 m grid -------------------------------------------
  p.push(`<rect x="${ox.toFixed(2)}" y="${oy.toFixed(2)}" width="${((maxx - minx) * sc).toFixed(2)}" height="${((maxy - miny) * sc).toFixed(2)}" fill="#0b1016" stroke="${G.frame.stroke}" stroke-opacity="${G.frame.op}"/>`);
  const stepX = niceStep(maxx - minx), stepY = niceStep(maxy - miny);
  for (let gx = Math.ceil(minx / stepX) * stepX; gx <= maxx; gx += stepX) {
    p.push(`<line x1="${X(gx).toFixed(2)}" y1="${oy.toFixed(2)}" x2="${X(gx).toFixed(2)}" y2="${(oy + ih).toFixed(2)}" stroke="${G.grid.stroke}" stroke-width="0.6"/>`);
  }
  for (let gy = Math.ceil(miny / stepY) * stepY; gy <= maxy; gy += stepY) {
    p.push(`<line x1="${ox.toFixed(2)}" y1="${Y(gy).toFixed(2)}" x2="${(ox + (maxx - minx) * sc).toFixed(2)}" y2="${Y(gy).toFixed(2)}" stroke="${G.grid.stroke}" stroke-width="0.6"/>`);
  }

  // ---- geometry UNDERLAY, subdued --------------------------------------
  // slab footprint (large, very faint) then its Openings
  for (const s of geom.slabs || []) {
    p.push(`<path d="${planPath(s.plan, X, Y)}" fill="${G.slab.fill}" fill-opacity="${G.slab.op}" fill-rule="evenodd" stroke="${G.slab.stroke}" stroke-opacity="${G.slab.op}" stroke-width="0.8"/>`);
  }
  for (const s of geom.slabs || []) {
    for (const h of allHoles(s.plan)) {
      p.push(`<path d="${poly(h, X, Y)}" fill="${G.opening.fill}" fill-opacity="0.85" stroke="${G.opening.stroke}" stroke-opacity="${G.opening.op}" stroke-width="1.6" stroke-dasharray="6 3"/>`);
    }
  }
  // Ceiling footprint, with holes knocked out
  for (const c of geom.ceilings || []) {
    p.push(`<path d="${planPath(c.plan, X, Y)}" fill="${G.ceilSolid.fill}" fill-opacity="${G.ceilSolid.op}" fill-rule="evenodd" stroke="${G.ceilSolid.stroke}" stroke-opacity="${G.ceilSolid.op}" stroke-width="1"/>`);
  }
  // Ceiling holes drawn explicitly, so a bypass is visible rather than implied
  for (const c of geom.ceilings || []) {
    for (const h of allHoles(c.plan)) {
      p.push(`<path d="${poly(h, X, Y)}" fill="${G.ceilHole.fill}" fill-opacity="0.9" stroke="${G.ceilHole.stroke}" stroke-opacity="${G.ceilHole.op}" stroke-width="1.6" stroke-dasharray="5 3"/>`);
    }
  }
  // wall bodies then centrelines
  for (const w of geom.walls || []) {
    p.push(`<line x1="${X(w.x1).toFixed(2)}" y1="${Y(w.y1).toFixed(2)}" x2="${X(w.x2).toFixed(2)}" y2="${Y(w.y2).toFixed(2)}" stroke="${G.wallBody.stroke}" stroke-opacity="${G.wallBody.op}" stroke-width="${Math.max(2.5, PX((w.halfThickness || 0.075) * 2)).toFixed(2)}" stroke-linecap="round"/>`);
    p.push(`<line x1="${X(w.x1).toFixed(2)}" y1="${Y(w.y1).toFixed(2)}" x2="${X(w.x2).toFixed(2)}" y2="${Y(w.y2).toFixed(2)}" stroke="${G.wallLine.stroke}" stroke-opacity="${G.wallLine.op}" stroke-width="0.7" stroke-dasharray="3 3"/>`);
  }
  // pillar footprints
  for (const pl of geom.pillars || []) {
    p.push(`<circle cx="${X(pl.px).toFixed(2)}" cy="${Y(pl.py).toFixed(2)}" r="${Math.max(2, PX(pl.r)).toFixed(2)}" fill="${G.pillar.fill}" fill-opacity="${G.pillar.op}" stroke="${G.pillar.stroke}" stroke-opacity="${G.pillar.op}" stroke-width="1.2"/>`);
  }
  // RF Object footprints (rotated rectangles)
  for (const o of geom.rfObjects || []) {
    p.push(`<path d="${objectPath(o, X, Y)}" fill="${G.object.fill}" fill-opacity="${G.object.op}" stroke="${G.object.stroke}" stroke-opacity="${G.object.op}" stroke-width="1.3"/>`);
  }
  // emphasised bodies for the scenario under inspection
  for (const e of opts.emphasise || []) {
    if (e.kind === 'rfObject') p.push(`<path d="${objectPath(e.body, X, Y)}" fill="none" stroke="#ffd479" stroke-width="2.2"/>`);
    if (e.kind === 'wall') p.push(`<line x1="${X(e.body.x1).toFixed(2)}" y1="${Y(e.body.y1).toFixed(2)}" x2="${X(e.body.x2).toFixed(2)}" y2="${Y(e.body.y2).toFixed(2)}" stroke="#ffd479" stroke-width="3.4" stroke-linecap="round" opacity="0.9"/>`);
    if (e.kind === 'ring') p.push(`<path d="${poly(e.ring, X, Y)}" fill="none" stroke="#ffd479" stroke-width="2.2" stroke-dasharray="6 3"/>`);
  }

  // ---- RF samples ON TOP: pure scatter, never rasterised ---------------
  for (const s of cloud.samples) {
    const c = rampColor(s.receivedPower);
    const fill = `rgb(${c[0]},${c[1]},${c[2]})`;
    const tx = X(s.x).toFixed(2), ty = Y(s.y).toFixed(2);
    if (s.reflectionCount > 0) {
      p.push(`<circle cx="${tx}" cy="${ty}" r="3.4" fill="#0b1016" fill-opacity="0.55" stroke="${fill}" stroke-width="1.5"/>`);
    } else {
      p.push(`<circle cx="${tx}" cy="${ty}" r="2.1" fill="${fill}" fill-opacity="0.9"/>`);
    }
  }

  // ---- AP markers -------------------------------------------------------
  for (const a of geom.aps || []) {
    const ax = X(a.x), ay = Y(a.y);
    p.push(`<path d="M ${ax.toFixed(2)} ${(ay - 8).toFixed(2)} L ${(ax + 6.5).toFixed(2)} ${(ay + 5.5).toFixed(2)} L ${ax.toFixed(2)} ${(ay + 2.5).toFixed(2)} L ${(ax - 6.5).toFixed(2)} ${(ay + 5.5).toFixed(2)} Z" fill="#ffffff" stroke="#0b1016" stroke-width="1.1"/>`);
    p.push(`<text x="${(ax + 10).toFixed(2)}" y="${(ay - 5).toFixed(2)}" fill="#ffffff" font-size="9.5">${esc(a.name)}</text>`);
    p.push(`<text x="${(ax + 10).toFixed(2)}" y="${(ay + 5).toFixed(2)}" fill="#9fb0c0" font-size="8.5">Z=${f2(a.z)} m</text>`);
  }

  // ---- axis ticks -------------------------------------------------------
  for (let gx = Math.ceil(minx / stepX) * stepX; gx <= maxx; gx += stepX) {
    p.push(`<text x="${X(gx).toFixed(2)}" y="${(oy + ih + 16).toFixed(2)}" fill="#6e7c8c" font-size="9.5" text-anchor="middle">${trim(gx)}</text>`);
  }
  for (let gy = Math.ceil(miny / stepY) * stepY; gy <= maxy; gy += stepY) {
    p.push(`<text x="${(ox - 7).toFixed(2)}" y="${(Y(gy) + 3).toFixed(2)}" fill="#6e7c8c" font-size="9.5" text-anchor="end">${trim(gy)}</text>`);
  }
  p.push(`<text x="${(ox + (maxx - minx) * sc / 2).toFixed(2)}" y="${H - 14}" fill="#8b98a5" font-size="10.5" text-anchor="middle">x (m)  — uniform scale</text>`);
  p.push(`<text x="20" y="${(oy + ih / 2).toFixed(2)}" fill="#8b98a5" font-size="10.5" text-anchor="middle" transform="rotate(-90 20 ${(oy + ih / 2).toFixed(2)})">y (m)</text>`);

  // ---- legend + annotations (right margin) ------------------------------
  const lx = W - M.r + 14;
  let ly = M.t + 4;
  p.push(`<text x="${lx}" y="${ly}" fill="#a9b6c2" font-size="10.5" font-weight="600">RF samples</text>`);
  ly += 16;
  p.push(`<circle cx="${lx + 6}" cy="${ly - 3}" r="2.1" fill="#9fb0c0"/><text x="${lx + 18}" y="${ly}" fill="#8b98a5" font-size="9.5">direct sample</text>`);
  ly += 14;
  p.push(`<circle cx="${lx + 6}" cy="${ly - 3}" r="3.4" fill="#0b1016" stroke="#9fb0c0" stroke-width="1.5"/><text x="${lx + 18}" y="${ly}" fill="#8b98a5" font-size="9.5">reflected sample</text>`);
  ly += 10;
  for (let k = 0; k <= 40; k++) {
    const c = rampColor(minP + (maxP - minP) * (k / 40));
    p.push(`<rect x="${lx + k * 2.6}" y="${ly}" width="2.8" height="9" fill="rgb(${c[0]},${c[1]},${c[2]})"/>`);
  }
  ly += 12;
  p.push(`<text x="${lx}" y="${ly}" fill="#6e7c8c" font-size="8.5">${minP.toFixed(0)} dBm</text>`);
  p.push(`<text x="${lx + 106}" y="${ly}" fill="#6e7c8c" font-size="8.5" text-anchor="end">${maxP.toFixed(0)} dBm</text>`);

  ly += 26;
  p.push(`<text x="${lx}" y="${ly}" fill="#a9b6c2" font-size="10.5" font-weight="600">Scene geometry (XY)</text>`);
  ly += 15;
  const legend = [
    ['wall body / centreline', () => `<line x1="${lx + 2}" y1="${ly - 3}" x2="${lx + 18}" y2="${ly - 3}" stroke="${G.wallBody.stroke}" stroke-width="5" stroke-linecap="round"/><line x1="${lx + 2}" y1="${ly - 3}" x2="${lx + 18}" y2="${ly - 3}" stroke="${G.wallLine.stroke}" stroke-width="0.7" stroke-dasharray="3 3"/>`],
    ['RF Object footprint', () => `<rect x="${lx + 2}" y="${ly - 7}" width="16" height="9" fill="${G.object.fill}" fill-opacity="${G.object.op}" stroke="${G.object.stroke}" stroke-width="1.3"/>`],
    ['pillar footprint', () => `<circle cx="${lx + 10}" cy="${ly - 3}" r="4.5" fill="${G.pillar.fill}" fill-opacity="${G.pillar.op}" stroke="${G.pillar.stroke}" stroke-width="1.2"/>`],
    ['Ceiling solid', () => `<rect x="${lx + 2}" y="${ly - 7}" width="16" height="9" fill="${G.ceilSolid.fill}" fill-opacity="${G.ceilSolid.op}" stroke="${G.ceilSolid.stroke}" stroke-width="1"/>`],
    ['Ceiling hole', () => `<rect x="${lx + 2}" y="${ly - 7}" width="16" height="9" fill="${G.ceilHole.fill}" stroke="${G.ceilHole.stroke}" stroke-width="1.6" stroke-dasharray="5 3"/>`],
    ['slab Opening', () => `<rect x="${lx + 2}" y="${ly - 7}" width="16" height="9" fill="${G.opening.fill}" stroke="${G.opening.stroke}" stroke-width="1.6" stroke-dasharray="6 3"/>`],
    ['slab footprint', () => `<rect x="${lx + 2}" y="${ly - 7}" width="16" height="9" fill="${G.slab.fill}" fill-opacity="${G.slab.op}" stroke="${G.slab.stroke}" stroke-width="0.8"/>`],
    ['emphasised for this scene', () => `<rect x="${lx + 2}" y="${ly - 7}" width="16" height="9" fill="none" stroke="#ffd479" stroke-width="2.2"/>`],
  ];
  for (const [label, draw] of legend) {
    p.push(draw());
    p.push(`<text x="${lx + 26}" y="${ly}" fill="#8b98a5" font-size="9">${esc(label)}</text>`);
    ly += 14;
  }

  if (opts.annotations && opts.annotations.length) {
    ly += 14;
    p.push(`<text x="${lx}" y="${ly}" fill="#a9b6c2" font-size="10.5" font-weight="600">Values</text>`);
    ly += 15;
    for (const a of opts.annotations) {
      p.push(`<text x="${lx}" y="${ly}" fill="#6e7c8c" font-size="9">${esc(a[0])}</text>`);
      p.push(`<text x="${lx}" y="${ly + 11}" fill="#d7e1ea" font-size="9.5">${esc(a[1])}</text>`);
      ly += 24;
    }
  }

  if (opts.notes && opts.notes.length) {
    const ny = M.t + ih + 34;
    let yy = ny;
    for (const n of opts.notes) {
      p.push(`<text x="${M.l}" y="${yy}" fill="#6e7c8c" font-size="9">${esc(n)}</text>`);
      yy += 12;
    }
  }

  p.push('</svg>');
  return p.join('\n');
}

function forEachRing(plan, acc) {
  if (!plan || !plan.parts) return;
  for (const part of plan.parts) {
    for (const q of part.outer || []) acc(q.x, q.y);
    for (const h of part.holes || []) for (const q of h) acc(q.x, q.y);
  }
}

// A "nice" tick step (1, 2, 5 x 10^n) giving roughly 4-8 labels per axis,
// chosen from the data extent so a narrow span is not left with one label.
function niceStep(extent) {
  if (!(extent > 0)) return 1;
  const raw = extent / 5;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  const mult = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return mult * mag;
}
function allHoles(plan) {
  const out = [];
  if (!plan || !plan.parts) return out;
  for (const part of plan.parts) for (const h of part.holes || []) out.push(h);
  return out;
}
function planPath(plan, X, Y) {
  if (!plan || !plan.parts) return '';
  let d = '';
  for (const part of plan.parts) {
    d += poly(part.outer || [], X, Y);
    for (const h of part.holes || []) d += poly(h, X, Y);
  }
  return d;
}

export function writeCloudSvg(cloud, outPath, opts) {
  const svg = renderCloudSvg(cloud, opts);
  fs.writeFileSync(outPath, svg);
  return { path: outPath, bytes: svg.length, samples: cloud.samples.length };
}
export { HERE };
