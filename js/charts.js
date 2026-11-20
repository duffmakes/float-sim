// Minimal canvas charts (line + heatmap) with a hover crosshair/tooltip layer.
// Colours: validated dark-mode reference palette (dataviz skill) on the #18233a chart surface.
export const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#0ca30c', '#9085e9', '#e66767'];
// ordinal single-hue ramp (light → dark), validated for ordered categories (e.g. wave headings)
export const ORDINAL = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf'];
const INK = { primary: '#dfe7f3', secondary: '#8a9ab5', grid: '#26344f', axis: '#4b5d80', surface: '#18233a' };

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export function rampColor(t, ramp = ORDINAL) {
  t = Math.max(0, Math.min(1, t));
  const f = t * (ramp.length - 1), i = Math.min(ramp.length - 2, Math.floor(f)), u = f - i;
  const a = hex(ramp[i]), b = hex(ramp[i + 1]);
  return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * u)).join(',')})`;
}
// sequential (heatmap) on a dark surface: near-zero recedes toward the surface
const SEQ = ['#0d366b', '#184f95', '#256abf', '#3987e5', '#6da7ec', '#9ec5f4', '#cde2fb'];

const nice = (lo, hi, n = 5) => {
  const span = hi - lo || 1, step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) || 10 * mag;
  const ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9 * span; v += step) ticks.push(+v.toPrecision(10));
  return ticks;
};
const fmt = (v) => (Math.abs(v) >= 1e5 || (Math.abs(v) < 0.01 && v !== 0) ? v.toExponential(1) : (+v.toPrecision(3)).toLocaleString());

function setup(canvas, height) {
  const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
  const W = canvas.clientWidth || 360, H = height;
  canvas.style.height = `${H}px`;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  return { ctx, W, H };
}

function tooltip(canvas) {
  let tip = canvas.parentElement.querySelector(':scope > .chart-tip');
  if (!tip) {
    tip = document.createElement('div'); tip.className = 'chart-tip';
    canvas.parentElement.style.position = 'relative';
    canvas.parentElement.appendChild(tip);
  }
  return tip;
}

// series: [{ name, color, x: [], y: [], width?, dash? }] — one shared y unit (never dual axis)
export function lineChart(canvas, { series, height = 170, xLabel = '', yLabel = '', vlines = [], yMin = null, yMax = null, legend = true, xFmt = fmt }) {
  const { ctx, W, H } = setup(canvas, height);
  const all = series.flatMap((s) => s.y.filter(Number.isFinite));
  const xs = series.flatMap((s) => s.x);
  if (!all.length) { canvas._hover = null; return; }
  let lo = yMin ?? Math.min(0, ...all), hi = yMax ?? Math.max(...all);
  if (hi - lo < 1e-12) hi = lo + 1;
  const pad = (hi - lo) * 0.08; if (yMax === null) hi += pad; if (yMin === null && lo < 0) lo -= pad;
  const x0 = 44, x1 = W - 10, y0 = legend && series.length > 1 ? 22 : 10, y1 = H - 26;
  const xa = Math.min(...xs), xb = Math.max(...xs);
  const X = (v) => x0 + (x1 - x0) * (v - xa) / (xb - xa || 1), Y = (v) => y1 - (y1 - y0) * (v - lo) / (hi - lo);
  ctx.font = '10px system-ui'; ctx.lineWidth = 1;
  // recessive grid + axes
  for (const t of nice(lo, hi, 4)) {
    ctx.strokeStyle = INK.grid; ctx.beginPath(); ctx.moveTo(x0, Y(t)); ctx.lineTo(x1, Y(t)); ctx.stroke();
    ctx.fillStyle = INK.secondary; ctx.textAlign = 'right'; ctx.fillText(fmt(t), x0 - 4, Y(t) + 3);
  }
  for (const t of nice(xa, xb, 6)) {
    ctx.fillStyle = INK.secondary; ctx.textAlign = 'center'; ctx.fillText(xFmt(t), X(t), H - 12);
  }
  if (lo < 0 && hi > 0) { ctx.strokeStyle = INK.axis; ctx.beginPath(); ctx.moveTo(x0, Y(0)); ctx.lineTo(x1, Y(0)); ctx.stroke(); }
  ctx.fillStyle = INK.secondary; ctx.textAlign = 'right'; ctx.fillText(xLabel, x1, H - 1);
  ctx.save(); ctx.translate(10, (y0 + y1) / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText(yLabel, 0, 0); ctx.restore();
  // reference lines (neutral ink, labelled)
  for (const v of vlines) {
    if (!(v.x >= xa && v.x <= xb)) continue;
    ctx.setLineDash([3, 3]); ctx.strokeStyle = INK.axis; ctx.beginPath(); ctx.moveTo(X(v.x), y0); ctx.lineTo(X(v.x), y1); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = INK.secondary; ctx.textAlign = 'left'; ctx.fillText(v.label, X(v.x) + 3, y0 + 9 + (v.row || 0) * 11);
  }
  // series: 2px lines
  for (const s of series) {
    ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 2; ctx.setLineDash(s.dash || []);
    ctx.beginPath(); let pen = false;
    for (let i = 0; i < s.x.length; i++) {
      if (!Number.isFinite(s.y[i])) { pen = false; continue; }
      const px = X(s.x[i]), py = Y(Math.max(lo, Math.min(hi, s.y[i])));
      pen ? ctx.lineTo(px, py) : ctx.moveTo(px, py); pen = true;
    }
    ctx.stroke(); ctx.setLineDash([]);
  }
  // legend (always for ≥ 2 series), text in ink colours with a colour swatch
  if (legend && series.length > 1) {
    let lx = x0; ctx.textAlign = 'left'; ctx.font = '11px system-ui';
    for (const s of series) {
      ctx.fillStyle = s.color; ctx.fillRect(lx, 7, 12, 3);
      ctx.fillStyle = INK.primary; ctx.fillText(s.name, lx + 16, 12);
      lx += 24 + ctx.measureText(s.name).width;
      if (lx > x1 - 40) break;
    }
  }
  // hover layer: crosshair + tooltip with every series' value at the nearest x
  const tip = tooltip(canvas);
  const base = ctx.getImageData(0, 0, canvas.width, canvas.height);
  canvas.onmousemove = (e) => {
    const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left;
    if (mx < x0 || mx > x1) { canvas.onmouseleave(); return; }
    const xv = xa + (mx - x0) / (x1 - x0) * (xb - xa);
    ctx.putImageData(base, 0, 0);
    ctx.setTransform(Math.min(globalThis.devicePixelRatio || 1, 2), 0, 0, Math.min(globalThis.devicePixelRatio || 1, 2), 0, 0);
    ctx.strokeStyle = INK.secondary; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(mx, y0); ctx.lineTo(mx, y1); ctx.stroke();
    const rows = series.map((s) => {
      let best = 0, bd = Infinity;
      for (let i = 0; i < s.x.length; i++) { const d = Math.abs(s.x[i] - xv); if (d < bd) { bd = d; best = i; } }
      const yv = s.y[best];
      if (Number.isFinite(yv)) {
        ctx.fillStyle = s.color; ctx.strokeStyle = INK.surface; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(X(s.x[best]), Y(Math.max(lo, Math.min(hi, yv))), 4, 0, 7); ctx.fill(); ctx.stroke();
      }
      return `<div><i style="background:${s.color}"></i>${s.name}<b>${Number.isFinite(yv) ? fmt(yv) : '—'}</b></div>`;
    });
    tip.innerHTML = `<div class="th">${xLabel ? xLabel.split(' (')[0] + ' ' : ''}${xFmt(xv)}</div>${rows.join('')}`;
    tip.style.display = 'block';
    tip.style.left = `${Math.min(mx + 12, W - tip.offsetWidth - 4)}px`; tip.style.top = `${y0}px`;
  };
  canvas.onmouseleave = () => { ctx.putImageData(base, 0, 0); tip.style.display = 'none'; };
}

// rows × cols grid of values (e.g. heading × frequency) with a sequential ramp and per-cell tooltip
export function heatmap(canvas, { rows, cols, values, height = 170, rowLabel, colLabel, rowFmt = fmt, colFmt = fmt, valueLabel = '' }) {
  const { ctx, W, H } = setup(canvas, height);
  const x0 = 44, x1 = W - 54, y0 = 8, y1 = H - 26;
  const vmax = Math.max(1e-12, ...values.flat().filter(Number.isFinite));
  const cw = (x1 - x0) / cols.length, rh = (y1 - y0) / rows.length;
  for (let r = 0; r < rows.length; r++) for (let c = 0; c < cols.length; c++) {
    const v = values[r][c];
    ctx.fillStyle = Number.isFinite(v) ? rampColor(v / vmax, SEQ) : INK.surface;
    ctx.fillRect(x0 + c * cw, y1 - (r + 1) * rh, Math.ceil(cw), Math.ceil(rh));
  }
  ctx.font = '10px system-ui'; ctx.fillStyle = INK.secondary;
  ctx.textAlign = 'right';
  const rstep = Math.max(1, Math.ceil(rows.length / 6));
  for (let r = 0; r < rows.length; r += rstep) ctx.fillText(rowFmt(rows[r]), x0 - 4, y1 - (r + 0.5) * rh + 3);
  ctx.textAlign = 'center';
  for (const t of nice(cols[0], cols[cols.length - 1], 6)) {
    const c = (t - cols[0]) / (cols[cols.length - 1] - cols[0] || 1);
    ctx.fillText(colFmt(t), x0 + c * (x1 - x0), H - 12);
  }
  ctx.textAlign = 'right'; ctx.fillText(colLabel, x1, H - 1);
  ctx.save(); ctx.translate(10, (y0 + y1) / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText(rowLabel, 0, 0); ctx.restore();
  // colour bar
  for (let i = 0; i < 60; i++) { ctx.fillStyle = rampColor(i / 59, SEQ); ctx.fillRect(x1 + 12, y1 - (i + 1) * (y1 - y0) / 60, 10, Math.ceil((y1 - y0) / 60)); }
  ctx.fillStyle = INK.secondary; ctx.textAlign = 'left';
  ctx.fillText(fmt(vmax), x1 + 25, y0 + 8); ctx.fillText('0', x1 + 25, y1);
  const tip = tooltip(canvas);
  canvas.onmousemove = (e) => {
    const rc = canvas.getBoundingClientRect(), mx = e.clientX - rc.left, my = e.clientY - rc.top;
    const c = Math.floor((mx - x0) / cw), r = Math.floor((y1 - my) / rh);
    if (c < 0 || c >= cols.length || r < 0 || r >= rows.length) { tip.style.display = 'none'; return; }
    tip.innerHTML = `<div class="th">${rowLabel.split(' (')[0]} ${rowFmt(rows[r])} · ${colLabel.split(' (')[0]} ${colFmt(cols[c])}</div><div>${valueLabel}<b>${fmt(values[r][c])}</b></div>`;
    tip.style.display = 'block';
    tip.style.left = `${Math.min(mx + 12, W - tip.offsetWidth - 4)}px`; tip.style.top = `${Math.max(0, my - 40)}px`;
  };
  canvas.onmouseleave = () => { tip.style.display = 'none'; };
}
