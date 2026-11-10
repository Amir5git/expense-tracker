'use strict';

/* ============================================================
   Charts — dependency-free SVG/CSS renderers
   ============================================================ */

/**
 * Donut chart. segments: [{ label, value, color }]
 * Renders into el (cleared). Center shows the total.
 */
function renderDonut(el, segments, { centerLabel = 'Total' } = {}) {
  el.innerHTML = '';
  const total = segments.reduce((a, s) => a + s.value, 0);

  if (!total) {
    el.innerHTML = `<div class="empty"><div class="empty-icon">📊</div><h3>Nothing here yet</h3><p>No expenses recorded for this period.</p></div>`;
    return;
  }

  const size = 200;
  const r = 76;
  const c = size / 2;
  const C = 2 * Math.PI * r;
  const gap = 1.6; // degrees-ish gap between slices (out of 360)

  let acc = 0;
  let circles = '';
  for (const seg of segments) {
    const frac = seg.value / total;
    const p = frac * 100;
    if (p <= 0) continue;
    const dash = Math.max(p - gap / 3.6, 0.2);
    const offset = acc + gap / 2;
    circles += `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${esc(seg.color)}" stroke-width="27"
      stroke-dasharray="${dash} ${100 - dash}" stroke-dashoffset="${-offset}" pathLength="100"
      stroke-linecap="butt"><title>${esc(seg.label)}: ${esc(fmtMoney(seg.value))}</title></circle>`;
    acc += p;
  }

  el.innerHTML = `
    <div class="donut-wrap">
      <div class="donut-box">
        <svg viewBox="0 0 ${size} ${size}" role="img" aria-label="Expenses by category">
          <g transform="rotate(-90 ${c} ${c})">${circles}</g>
        </svg>
        <div class="donut-center">
          <div class="v">${esc(fmtMoney(total, { compact: true }))}</div>
          <div class="l">${esc(centerLabel)}</div>
        </div>
      </div>
      <div class="legend">
        ${segments.map(s => `
          <div class="legend-row">
            <span class="legend-dot" style="background:${esc(s.color)}"></span>
            <span class="legend-name" title="${esc(s.label)}">${esc(s.label)}</span>
            <span class="legend-val">${esc(fmtMoney(s.value, { compact: true }))}</span>
            <span class="legend-pct">${Math.round((s.value / total) * 100)}%</span>
          </div>`).join('')}
      </div>
    </div>`;
}

/**
 * Grouped bar chart (income vs expense per month).
 * groups: [{ ym, income, expense }] — rendered in given order.
 */
function renderBars(el, groups) {
  el.innerHTML = '';
  if (!groups.length) {
    el.innerHTML = `<div class="empty"><div class="empty-icon">📉</div><h3>No data</h3><p>Add transactions to see the trend.</p></div>`;
    return;
  }

  const max = Math.max(1, ...groups.flatMap(g => [g.income, g.expense]));
  const bars = groups.map(g => {
    const hInc = g.income > 0 ? Math.max((g.income / max) * 100, 2) : 0;
    const hExp = g.expense > 0 ? Math.max((g.expense / max) * 100, 2) : 0;
    return `
      <div class="bar-col">
        <div class="bar-pair">
          <div class="bar income" style="height:${hInc}%" title="Income ${esc(fmtMoney(g.income))}"></div>
          <div class="bar expense" style="height:${hExp}%" title="Expenses ${esc(fmtMoney(g.expense))}"></div>
        </div>
        <span class="bar-label">${esc(monthShort(g.ym))}</span>
      </div>`;
  }).join('');

  el.innerHTML = `
    <div class="chart-legend">
      <span><span class="legend-dot" style="background:var(--income)"></span>Income</span>
      <span><span class="legend-dot" style="background:var(--expense)"></span>Expenses</span>
      <span style="margin-left:auto">${esc(fmtMoney(max, { compact: true }))} max</span>
    </div>
    <div class="bars">${bars}</div>`;
}
