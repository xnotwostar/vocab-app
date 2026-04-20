// home.js — dashboard
import { loadWords, loadState, getTodayPlan, isDue, computeRetention14d } from './app.js';

const WEEKDAYS_ZH = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

async function init() {
  const data = await loadWords();
  const words = data.words;
  const state = loadState();

  // Date strip
  const now = new Date();
  const weekday = WEEKDAYS_ZH[now.getDay()];
  const dateStr = `${now.getFullYear()}年 ${now.getMonth() + 1}月 ${now.getDate()}日`;
  document.getElementById('date-strip').textContent = weekday;
  document.getElementById('date-big').textContent = dateStr;

  // Compute plan
  const plan = getTodayPlan(words, state);
  const total = plan.due_ids.length + plan.new_ids.length;
  const done = plan.completed_ids.filter(id =>
    plan.due_ids.includes(id) || plan.new_ids.includes(id)
  ).length;

  document.getElementById('date-sub').innerHTML = plan.retention_14d != null
    ? `Based on your <span class="num">${Math.round(plan.retention_14d * 100)}%</span> retention · 14d`
    : `Bootstrap mode — first session`;

  renderPlan(plan, total, done);

  // Week stats
  document.getElementById('streak').textContent = computeStreak(state);
  document.getElementById('stat-streak').textContent = computeStreak(state);
  document.getElementById('stat-reviews').textContent = countReviewsThisWeek(state);
  const ret = computeRetention14d(state);
  document.getElementById('stat-retention').textContent = ret != null ? Math.round(ret * 100) : '—';
  const mastered = words.filter(w => state[w.id]?.state === 'mature').length;
  document.getElementById('stat-mastered').textContent = mastered;
  document.getElementById('stat-total').textContent = words.length;
}

function renderPlan(plan, total, done) {
  const container = document.getElementById('plan-container');
  const remaining = total - done;

  if (total === 0) {
    container.innerHTML = `
      <div class="empty-day">
        <div class="big">All caught up<span style="color:var(--amber)">.</span></div>
        <p>No cards scheduled for today.<br>Add more words or come back tomorrow.</p>
        <a class="start-btn done" href="library.html">Browse library →</a>
      </div>`;
    return;
  }

  if (remaining === 0) {
    container.innerHTML = `
      <div class="plan">
        <div class="plan-label">Today's plan · ✓ completed</div>
        <div class="plan-big">${total}<span class="unit">reviewed</span></div>
        <p class="plan-breakdown">
          Session complete. Your brain needs sleep to consolidate.
          ${plan.retention_14d != null ? `Retention this week: <span class="em">${Math.round(plan.retention_14d * 100)}%</span>.` : ''}
        </p>
        <a class="start-btn done" href="review.html">Review again</a>
      </div>`;
    return;
  }

  const pct = total ? Math.round(done / total * 100) : 0;
  const newText = plan.new_ids.length > 0
    ? `<span class="em">${plan.new_ids.length}</span> new`
    : `no new words`;

  container.innerHTML = `
    <div class="plan">
      <div class="plan-label">Today's plan</div>
      <div class="plan-big">${remaining}<span class="unit">${remaining === 1 ? 'card' : 'cards'} to review</span></div>
      <p class="plan-breakdown">
        <span class="em">${plan.due_ids.length}</span> due review${plan.due_ids.length !== 1 ? 's' : ''} · ${newText}
      </p>
      <div class="progress">
        <div class="progress-fill" style="width:${pct}%"></div>
      </div>
      <div class="progress-label">
        <span><span class="num">${done}</span> / ${total}</span>
        <span>${pct}%</span>
      </div>
      <a class="start-btn" href="review.html">
        ${done > 0 ? 'Resume' : 'Start'} Review <span class="arrow">→</span>
      </a>
    </div>`;
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

function countReviewsThisWeek(state) {
  const now = new Date();
  let count = 0;
  for (const id in state) {
    const hist = state[id]?.history || [];
    for (const h of hist) {
      if ((now - new Date(h.t)) / 86400000 < 7) count++;
    }
  }
  return count;
}

init().catch(err => {
  document.getElementById('plan-container').innerHTML = `<p style="color:var(--bad)">Error: ${err.message}</p>`;
  console.error(err);
});
