// stats.js — dashboard with actual retention curve
import { loadWords, loadState, isDue, computeRetentionCurve, escapeHtml, localDateKey } from './app.js';

async function init() {
  const data = await loadWords();
  const words = data.words || [];
  const state = loadState();
  const now = new Date();

  const counts = { total: words.length, due: 0, mastered: 0, leech: 0, reviews: 0, remembered: 0 };
  const byDiff = { 1: 0, 2: 0, 3: 0 };
  const bySource = {};

  for (const w of words) {
    const cs = state[w.id];
    if (isDue(cs, now)) counts.due++;
    if (cs?.state === 'mature') counts.mastered++;
    if (cs?.state === 'leech') counts.leech++;
    if (cs) {
      counts.reviews += cs.reps || 0;
      counts.remembered += cs.remembered || 0;
    }
    byDiff[w.difficulty || 1] = (byDiff[w.difficulty || 1] || 0) + 1;
    const src = w.source || 'Unknown';
    bySource[src] = (bySource[src] || 0) + 1;
  }

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };

  set('m-total', counts.total.toLocaleString());
  set('m-due', counts.due);
  set('m-mastered', counts.mastered.toLocaleString());
  set('m-mastered-total', `/${counts.total}`);
  const acc = counts.reviews ? Math.round((counts.remembered / counts.reviews) * 100) : 0;
  set('m-accuracy', acc);
  set('total-reviews', counts.reviews.toLocaleString());
  set('due-count', counts.due);
  set('streak', computeStreak(state));

  renderRetentionChart(state);

  // Difficulty rows
  const diffLabels = { 1: ['Easy', '⭐'], 2: ['Medium', '⭐⭐'], 3: ['Hard', '⭐⭐⭐'] };
  const total = counts.total;
  const diffRows = document.getElementById('diff-rows');
  if (diffRows) diffRows.innerHTML = Object.entries(byDiff).map(([k, v]) => {
    const pct = total ? Math.round(v / total * 100) : 0;
    const primary = k === '3' ? 'primary' : '';
    const [name, stars] = diffLabels[k];
    return `
      <div class="diff-row ${primary}">
        <div class="diff-name">${escapeHtml(name)} <span class="code">${stars}</span></div>
        <div class="diff-bar"><span style="width:${pct}%"></span></div>
        <div class="diff-count">${v}</div>
        <div class="diff-pct">${pct}%</div>
      </div>`;
  }).join('');

  // Source rows
  const sortedSources = Object.entries(bySource).sort((a, b) => b[1] - a[1]);
  const sourceRows = document.getElementById('source-rows');
  if (sourceRows) sourceRows.innerHTML = sortedSources.map(([src, count], i) => {
    const pct = total ? Math.round(count / total * 100) : 0;
    const primary = i === 0 ? 'primary' : '';
    return `
      <div class="diff-row ${primary}">
        <div class="diff-name">${escapeHtml(src.slice(0, 40))}</div>
        <div class="diff-bar"><span style="width:${pct}%"></span></div>
        <div class="diff-count">${count}</div>
        <div class="diff-pct">${pct}%</div>
      </div>`;
  }).join('');
}

function renderRetentionChart(state) {
  const curve = computeRetentionCurve(state);
  const container = document.getElementById('retention-chart');
  if (!container) return;

  const dataPoints = curve.filter(p => p.retention !== null);

  // Theoretical Ebbinghaus curve, S≈20d
  const theoreticalPoints = [];
  for (let day = 0; day <= 90; day++) {
    const S = 20;
    theoreticalPoints.push({ day, r: Math.exp(-day / S) });
  }

  const width = 1200, height = 360;
  const margin = { top: 20, right: 20, bottom: 40, left: 80 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const xScale = d => margin.left + (d / 90) * innerW;
  const yScale = r => margin.top + (1 - r) * innerH;

  const theoryPath = theoreticalPoints.map((p, i) =>
    `${i === 0 ? 'M' : 'L'} ${xScale(p.day).toFixed(1)} ${yScale(p.r).toFixed(1)}`
  ).join(' ');

  const actualPath = dataPoints.length > 0 ? dataPoints.map((p, i) =>
    `${i === 0 ? 'M' : 'L'} ${xScale(p.day).toFixed(1)} ${yScale(p.retention).toFixed(1)}`
  ).join(' ') : '';

  const actualDots = dataPoints.map(p =>
    `<circle cx="${xScale(p.day).toFixed(1)}" cy="${yScale(p.retention).toFixed(1)}" r="3" fill="var(--amber)"/>`
  ).join('');

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" style="width:100%;height:100%" role="img" aria-label="Retention curve chart">
      <defs>
        <linearGradient id="amberFade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stop-color="#E9A352" stop-opacity="0.22"/>
          <stop offset="100%" stop-color="#E9A352" stop-opacity="0"/>
        </linearGradient>
      </defs>

      ${[0, 0.25, 0.5, 0.75, 1].map(r => `
        <line x1="${margin.left}" y1="${yScale(r)}" x2="${width - margin.right}" y2="${yScale(r)}" stroke="var(--hairline)" stroke-width="1"/>
        <text x="${margin.left - 12}" y="${yScale(r) + 4}" text-anchor="end" font-family="var(--mono)" font-size="10" fill="var(--ink-faint)">${Math.round(r * 100)}</text>
      `).join('')}

      <line x1="${margin.left}" y1="${yScale(0.8)}" x2="${width - margin.right}" y2="${yScale(0.8)}" stroke="var(--ink-faint)" stroke-width="1" stroke-dasharray="3 4"/>
      <text x="${width - margin.right - 4}" y="${yScale(0.8) - 6}" text-anchor="end" font-family="var(--mono)" font-size="10" letter-spacing="0.2em" fill="var(--ink-dim)">TARGET 80%</text>

      ${[0, 7, 14, 30, 60, 90].map(d => `
        <text x="${xScale(d)}" y="${height - margin.bottom + 20}" text-anchor="middle" font-family="var(--mono)" font-size="10" fill="var(--ink-faint)">${d === 0 ? 'NOW' : d + ' D'}</text>
      `).join('')}

      <path d="${theoryPath}" fill="none" stroke="var(--ink-faint)" stroke-width="1" stroke-dasharray="4 4"/>

      ${actualPath ? `<path d="${actualPath}" fill="none" stroke="var(--amber)" stroke-width="1.75"/>` : ''}
      ${actualDots}

      ${dataPoints.length === 0 ? `
        <text x="${width/2}" y="${height/2}" text-anchor="middle" font-family="var(--serif)" font-style="italic" font-size="16" fill="var(--ink-faint)">
          开始复习后，这里会显示你的真实记忆曲线
        </text>` : ''}
    </svg>`;

  const samplesEl = document.getElementById('retention-samples');
  if (samplesEl) {
    samplesEl.textContent = dataPoints.length
      ? `基于 ${dataPoints.reduce((a, p) => a + p.samples, 0)} 次复习`
      : '暂无复习数据';
  }
}

function computeStreak(state) {
  const days = new Set();
  for (const id in state) {
    const lr = state[id]?.lastReview;
    if (typeof lr === 'string') {
      try { days.add(localDateKey(new Date(lr))); } catch {}
    }
  }
  if (days.size === 0) return 0;
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 365; i++) {
    const d = new Date(today.getTime() - i * 86400000);
    if (days.has(localDateKey(d))) streak++;
    else if (i > 0) break;
  }
  return streak;
}

init().catch(err => {
  console.error(err);
  const el = document.getElementById('m-total');
  if (el) el.textContent = '!';
});
