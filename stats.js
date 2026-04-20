// stats.js — dashboard
import { loadWords, loadState, isDue } from './app.js';

async function init() {
  const data = await loadWords();
  const words = data.words;
  const state = loadState();
  const now = new Date();

  // Aggregate
  const counts = { total: words.length, due: 0, mastered: 0, reviews: 0, correct: 0 };
  const byDiff = { 1: 0, 2: 0, 3: 0 };
  const bySource = {};

  for (const w of words) {
    const cs = state[w.id];
    if (isDue(cs, now)) counts.due++;
    if (cs && cs.state === 'mature') counts.mastered++;
    if (cs) {
      counts.reviews += cs.reps;
      counts.correct += Math.max(0, cs.reps - cs.lapses);
    }
    byDiff[w.difficulty || 1] = (byDiff[w.difficulty || 1] || 0) + 1;
    const src = w.source || 'Unknown';
    bySource[src] = (bySource[src] || 0) + 1;
  }

  // Metrics
  document.getElementById('m-total').textContent = counts.total.toLocaleString();
  document.getElementById('m-due').textContent = counts.due;
  document.getElementById('m-mastered').textContent = counts.mastered.toLocaleString();
  document.getElementById('m-mastered-total').textContent = `/${counts.total}`;
  const acc = counts.reviews ? Math.round((counts.correct / counts.reviews) * 100) : 0;
  document.getElementById('m-accuracy').textContent = acc;
  document.getElementById('total-reviews').textContent = counts.reviews.toLocaleString();
  document.getElementById('due-count').textContent = counts.due;

  // Streak (simplified - count consecutive days with reviews)
  document.getElementById('streak').textContent = computeStreak(state);

  // Difficulty rows
  const diffLabels = { 1: ['Easy', '⭐'], 2: ['Medium', '⭐⭐'], 3: ['Hard', '⭐⭐⭐'] };
  const diffRows = document.getElementById('diff-rows');
  const total = counts.total;
  diffRows.innerHTML = Object.entries(byDiff).map(([k, v]) => {
    const pct = total ? Math.round(v / total * 100) : 0;
    const primary = k === '3' ? 'primary' : '';
    return `
      <div class="diff-row ${primary}">
        <div class="diff-name">${diffLabels[k][0]} <span class="code">${diffLabels[k][1]}</span></div>
        <div class="diff-bar"><span style="width:${pct}%"></span></div>
        <div class="diff-count">${v}</div>
        <div class="diff-pct">${pct}%</div>
      </div>`;
  }).join('');

  // Source rows
  const sourceRows = document.getElementById('source-rows');
  const sortedSources = Object.entries(bySource).sort((a, b) => b[1] - a[1]);
  sourceRows.innerHTML = sortedSources.map(([src, count], i) => {
    const pct = total ? Math.round(count / total * 100) : 0;
    const primary = i === 0 ? 'primary' : '';
    return `
      <div class="diff-row ${primary}">
        <div class="diff-name">${src.slice(0, 30)}</div>
        <div class="diff-bar"><span style="width:${pct}%"></span></div>
        <div class="diff-count">${count}</div>
        <div class="diff-pct">${pct}%</div>
      </div>`;
  }).join('');
}

function computeStreak(state) {
  const days = new Set();
  for (const id in state) {
    const cs = state[id];
    if (cs.lastReview) days.add(cs.lastReview.slice(0, 10));
  }
  if (days.size === 0) return 0;
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 365; i++) {
    const d = new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10);
    if (days.has(d)) streak++;
    else if (i > 0) break;
  }
  return streak;
}

init().catch(err => {
  document.getElementById('m-total').textContent = '!';
  console.error(err);
});
