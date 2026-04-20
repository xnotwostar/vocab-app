// review.js — flashcard with auto-play audio + binary remember/forgot + integrated plan header
import { loadWords, loadState, setCardState, schedule, isDue, previewIntervals, playAudio, formatDue, getTodayPlan, markPlanCompleted, computeRetention14d } from './app.js';

const WEEKDAYS_ZH = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

let words = [];
let queue = [];
let plan = null;
let currentIdx = 0;
let revealed = false;

const stage = document.getElementById('stage');
const fsrsMetaEl = document.getElementById('fsrs-meta');

async function init() {
  const data = await loadWords();
  words = data.words;
  const state = loadState();

  // Use today's plan (cached per day)
  plan = getTodayPlan(words, state);
  const byId = Object.fromEntries(words.map(w => [w.id, w]));

  // Filter out already completed in today's plan
  const completed = new Set(plan.completed_ids);
  const planIds = [...plan.due_ids, ...plan.new_ids].filter(id => !completed.has(id));
  queue = planIds.map(id => byId[id]).filter(Boolean);

  // Sort: due first (by urgency), then new
  queue.sort((a, b) => {
    const aIsNew = !state[a.id];
    const bIsNew = !state[b.id];
    if (aIsNew && !bIsNew) return 1;  // new last
    if (!aIsNew && bIsNew) return -1;
    if (!aIsNew && !bIsNew) return new Date(state[a.id].due) - new Date(state[b.id].due);
    return 0;
  });

  renderPlanHeader(state);

  if (queue.length === 0) return renderEmpty();
  renderCard();
}

function renderPlanHeader(state) {
  const now = new Date();
  document.getElementById('plan-weekday').textContent = WEEKDAYS_ZH[now.getDay()];
  document.getElementById('plan-date').textContent = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;

  const total = plan.due_ids.length + plan.new_ids.length;
  const done = plan.completed_ids.filter(id =>
    plan.due_ids.includes(id) || plan.new_ids.includes(id)
  ).length;
  const remaining = total - done;
  const pct = total ? Math.round(done / total * 100) : 0;

  document.getElementById('plan-done').textContent = done;
  document.getElementById('plan-total').textContent = total;
  document.getElementById('plan-remaining').textContent = remaining === 0 ? 'done' : `${remaining} left`;
  document.getElementById('plan-progress-fill').style.width = `${pct}%`;

  // Week stats
  document.getElementById('stat-streak').textContent = computeStreak(state);

  let reviewsCount = 0;
  for (const id in state) {
    const hist = state[id]?.history || [];
    for (const h of hist) {
      if ((now - new Date(h.t)) / 86400000 < 7) reviewsCount++;
    }
  }
  document.getElementById('stat-reviews').textContent = reviewsCount;

  const ret = computeRetention14d(state);
  document.getElementById('stat-retention').textContent = ret != null ? Math.round(ret * 100) : '—';

  const mastered = words.filter(w => state[w.id]?.state === 'mature').length;
  document.getElementById('stat-mastered').textContent = mastered;
  document.getElementById('stat-total').textContent = words.length;
}

function computeStreak(state) {
  const days = new Set();
  for (const id in state) {
    if (state[id]?.lastReview) days.add(state[id].lastReview.slice(0, 10));
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

function renderEmpty() {
  stage.innerHTML = `
    <div class="empty">
      <h2>All caught up<span class="amber-accent">.</span></h2>
      <p>No cards scheduled for today. Add more words to your <a href="library.html" style="color:var(--amber)">library</a> or come back tomorrow.</p>
    </div>`;
}

function renderDone() {
  stage.innerHTML = `
    <div class="empty">
      <h2>Session complete<span class="amber-accent">.</span></h2>
      <p>${queue.length} cards reviewed. Your brain needs sleep to consolidate.</p>
      <p style="margin-top:20px"><a href="stats.html" style="color:var(--amber)">View retention curve →</a></p>
    </div>`;
}

function renderCard() {
  if (currentIdx >= queue.length) return renderDone();
  const w = queue[currentIdx];
  const state = loadState();
  const prev = state[w.id];
  const intervals = previewIntervals(prev);

  revealed = false;

  stage.innerHTML = `
    <div class="card-frame">
      <div class="card-chrome">
        <div class="lang-tag">
          <span class="swatch"></span>
          <span class="code">EN</span>
          <span class="sep">—</span>
          <span>${w.source || 'English'}</span>
        </div>
        <button class="speaker" id="btn-speak" aria-label="Pronounce" title="Replay (S)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 10v4h3l5 4V6L7 10H4z"/>
            <path d="M16 8.5c1.2 1 1.2 6 0 7" opacity="0.7"/>
            <path d="M19 6c2.2 1.8 2.2 10.2 0 12" opacity="0.45"/>
          </svg>
        </button>
      </div>

      <div class="word-wrap">
        <h1 class="word">${w.word}</h1>
        ${w.phonetic ? `<div class="phonetic">${w.phonetic}</div>` : ''}
        ${w.difficulty ? `<div class="pos"><span class="tick"></span><span>${'⭐'.repeat(w.difficulty)}</span><span class="tick"></span></div>` : ''}
      </div>

      <section class="revealed" id="revealed" style="display:none">
        <div class="divider"></div>
        <p class="meaning">${w.meaning_zh || ''}</p>
        ${w.example ? `<p class="example">"${w.example}"</p>` : ''}

        ${renderEnrichment(w)}
      </section>

      <div class="grades binary" role="group" style="display:none" id="grades">
        <button class="grade again" data-key="1">
          <span class="gkey">1</span>
          <span class="glabel">不记得</span>
          <span class="gmeta">${intervals.forgot}</span>
        </button>
        <button class="grade good primary" data-key="2">
          <span class="gkey">2</span>
          <span class="glabel">记得</span>
          <span class="gmeta">${intervals.remembered}</span>
        </button>
      </div>
    </div>`;

  document.getElementById('btn-speak').addEventListener('click', () => playAudio(w));
  document.querySelectorAll('.grade').forEach(b => {
    b.addEventListener('click', () => grade(b.dataset.key === '2'));
  });

  if (prev) {
    fsrsMetaEl.textContent = `Box ${prev.box} · ${prev.remembered}✓ ${prev.forgot}✗ · reps=${prev.reps}`;
  } else {
    fsrsMetaEl.textContent = 'NEW card';
  }

  // Auto-play audio when card shows
  setTimeout(() => playAudio(w), 200);
}

function renderEnrichment(w) {
  if (!w.enriched) return '';
  const parts = [];

  if (w.examples && w.examples.length) {
    parts.push(`
      <div class="enrich-section">
        <div class="enrich-label">Examples</div>
        <ul class="enrich-list examples-list">
          ${w.examples.map(e => `<li>${escapeHtml(e)}</li>`).join('')}
        </ul>
      </div>`);
  }

  if ((w.synonyms && w.synonyms.length) || (w.antonyms && w.antonyms.length)) {
    parts.push(`
      <div class="enrich-section side-by-side">
        ${w.synonyms && w.synonyms.length ? `<div>
          <div class="enrich-label">Synonyms</div>
          <div class="chip-row">${w.synonyms.map(s => `<span class="chip">${escapeHtml(s)}</span>`).join('')}</div>
        </div>` : ''}
        ${w.antonyms && w.antonyms.length ? `<div>
          <div class="enrich-label">Antonyms</div>
          <div class="chip-row">${w.antonyms.map(s => `<span class="chip chip-ant">${escapeHtml(s)}</span>`).join('')}</div>
        </div>` : ''}
      </div>`);
  }

  if (w.etymology) {
    parts.push(`
      <div class="enrich-section">
        <div class="enrich-label">Etymology · 词源</div>
        <div class="enrich-text">${escapeHtml(w.etymology)}</div>
      </div>`);
  }

  if (w.memory_hook) {
    parts.push(`
      <div class="enrich-section hook">
        <div class="enrich-label">Memory hook · 记忆钩子</div>
        <div class="enrich-text">${escapeHtml(w.memory_hook)}</div>
      </div>`);
  }

  if (w.collocations && w.collocations.length) {
    parts.push(`
      <div class="enrich-section">
        <div class="enrich-label">Collocations</div>
        <div class="chip-row">${w.collocations.map(s => `<span class="chip">${escapeHtml(s)}</span>`).join('')}</div>
      </div>`);
  }

  return parts.length ? `<div class="enrichment">${parts.join('')}</div>` : '';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function reveal() {
  if (revealed) return;
  revealed = true;
  document.getElementById('revealed').style.display = '';
  document.getElementById('grades').style.display = '';
}

function grade(remembered) {
  if (!revealed) return reveal();
  const w = queue[currentIdx];
  const state = loadState();
  const prev = state[w.id];
  setCardState(w.id, schedule(prev, remembered));

  // Mark as completed in today's plan (so progress bar updates)
  if (remembered) {
    markPlanCompleted(w.id);
  } else {
    // Forgot: re-queue 5 slots later, don't mark as completed yet
    const reinsertAt = Math.min(currentIdx + 5, queue.length);
    queue.splice(reinsertAt, 0, w);
  }

  currentIdx++;
  renderPlanHeader(loadState()); // live-update header
  setTimeout(renderCard, 120);
}


document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === ' ') { e.preventDefault(); reveal(); }
  if (e.key === '1') grade(false);
  if (e.key === '2') grade(true);
  if (e.key.toLowerCase() === 's') {
    const w = queue[currentIdx];
    if (w) playAudio(w);
  }
});

init().catch(err => {
  stage.innerHTML = `<div class="empty"><h2>Error loading words</h2><p>${err.message}</p></div>`;
});
