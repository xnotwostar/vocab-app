// review.js — flashcard with auto-play audio + binary remember/forgot + integrated plan header
import {
  loadWords, loadState, setCardState, schedule, previewIntervals,
  playAudio, getTodayPlan, markPlanCompleted, computeRetention14d,
  forgotRequeueOffset, escapeHtml
} from './app.js';

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
  words = data.words || [];
  const state = loadState();

  plan = getTodayPlan(words, state);
  const byId = Object.fromEntries(words.map(w => [w.id, w]));

  const completed = new Set(plan.completed_ids);
  const planIds = [...plan.due_ids, ...plan.new_ids].filter(id => !completed.has(id));
  queue = planIds.map(id => byId[id]).filter(Boolean);

  // Sort: due first (by urgency), then new
  queue.sort((a, b) => {
    const aIsNew = !state[a.id];
    const bIsNew = !state[b.id];
    if (aIsNew && !bIsNew) return 1;
    if (!aIsNew && bIsNew) return -1;
    if (!aIsNew && !bIsNew) {
      try { return new Date(state[a.id].due) - new Date(state[b.id].due); }
      catch { return 0; }
    }
    return 0;
  });

  renderPlanHeader(state);

  if (queue.length === 0) return renderEmpty();
  renderCard();
}

function renderPlanHeader(state) {
  const now = new Date();
  document.getElementById('plan-weekday').textContent = WEEKDAYS_ZH[now.getDay()];
  document.getElementById('plan-date').textContent =
    `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;

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

  document.getElementById('stat-streak').textContent = computeStreak(state);

  let reviewsCount = 0;
  for (const id in state) {
    const hist = state[id]?.history || [];
    for (const h of hist) {
      if (!h?.t) continue;
      const t = new Date(h.t);
      if (!isNaN(t) && (now - t) / 86400000 < 7) reviewsCount++;
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
    const lr = state[id]?.lastReview;
    if (typeof lr === 'string' && lr.length >= 10) days.add(lr.slice(0, 10));
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

  const isLeech = prev?.state === 'leech';
  const leechBadge = isLeech ? `<span class="leech-badge" title="Commonly forgotten">LEECH</span>` : '';

  stage.innerHTML = `
    <div class="card-frame">
      <div class="card-chrome">
        <div class="lang-tag">
          <span class="swatch"></span>
          <span class="code">EN</span>
          <span class="sep">—</span>
          <span>${escapeHtml(w.source || 'English')}</span>
          ${leechBadge}
        </div>
        <button class="speaker" id="btn-speak" aria-label="Pronounce ${escapeHtml(w.word)}" title="Replay (S)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 10v4h3l5 4V6L7 10H4z"/>
            <path d="M16 8.5c1.2 1 1.2 6 0 7" opacity="0.7"/>
            <path d="M19 6c2.2 1.8 2.2 10.2 0 12" opacity="0.45"/>
          </svg>
        </button>
      </div>

      <div class="word-wrap" id="word-wrap">
        <h1 class="word">${escapeHtml(w.word)}</h1>
        ${w.phonetic ? `<div class="phonetic">${escapeHtml(w.phonetic)}</div>` : ''}
        ${w.difficulty ? `<div class="pos"><span class="tick"></span><span>${'⭐'.repeat(w.difficulty)}</span><span class="tick"></span></div>` : ''}
        <div class="tap-hint" id="tap-hint">点一下屏幕或按 <kbd class="kbd-inline">Space</kbd> 查看释义</div>
      </div>

      <section class="revealed" id="revealed" style="display:none" aria-hidden="true">
        <div class="divider"></div>
        <p class="meaning">${escapeHtml(w.meaning_zh || '')}</p>
        ${w.example ? `<p class="example">"${escapeHtml(w.example)}"</p>` : ''}
        ${renderEnrichment(w)}
      </section>

      <div class="grades binary" role="group" aria-label="Grade this card" style="display:none" id="grades">
        <button class="grade again" data-key="1" aria-label="Forgot · 不记得 · ${intervals.forgot}">
          <span class="gkey">1</span>
          <span class="glabel">不记得</span>
          <span class="gmeta">${intervals.forgot}</span>
        </button>
        <button class="grade good primary" data-key="2" aria-label="Remembered · 记得 · ${intervals.remembered}">
          <span class="gkey">2</span>
          <span class="glabel">记得</span>
          <span class="gmeta">${intervals.remembered}</span>
        </button>
      </div>
    </div>`;

  document.getElementById('btn-speak').addEventListener('click', (e) => {
    e.stopPropagation();
    playAudio(w);
  });
  document.querySelectorAll('.grade').forEach(b => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      grade(b.dataset.key === '2');
    });
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

function reveal() {
  if (revealed) return;
  revealed = true;
  const r = document.getElementById('revealed');
  const g = document.getElementById('grades');
  const hint = document.getElementById('tap-hint');
  if (r) { r.style.display = ''; r.setAttribute('aria-hidden', 'false'); }
  if (g) g.style.display = '';
  if (hint) hint.style.display = 'none';
}

function grade(remembered) {
  if (!revealed) return reveal();
  const w = queue[currentIdx];
  const state = loadState();
  const prev = state[w.id];
  setCardState(w.id, schedule(prev, remembered));

  if (remembered) {
    markPlanCompleted(w.id);
    if (!plan.completed_ids.includes(w.id)) plan.completed_ids.push(w.id);
  } else {
    // Adaptive re-queue: leech → sooner; new forget → further out
    const offset = forgotRequeueOffset(prev, queue.length, currentIdx);
    const reinsertAt = Math.min(currentIdx + offset, queue.length);
    queue.splice(reinsertAt, 0, w);
  }

  currentIdx++;
  renderPlanHeader(loadState());
  setTimeout(renderCard, 120);
}

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === ' ') { e.preventDefault(); reveal(); }
  else if (e.key === '1') grade(false);
  else if (e.key === '2') grade(true);
  else if (e.key.toLowerCase() === 's') {
    const w = queue[currentIdx];
    if (w) playAudio(w);
  }
});

// Tap anywhere (except buttons, links, nav) to reveal — works across whole viewport
document.addEventListener('click', (e) => {
  if (revealed) return;
  // Don't steal clicks from interactive elements
  if (e.target.closest('button, a, input, textarea, .topbar, .shortcuts')) return;
  reveal();
});

init().catch(err => {
  console.error('init failed:', err);
  const title = document.createElement('h2');
  title.textContent = 'Error loading words';
  const msg = document.createElement('p');
  msg.textContent = err.message || 'Unknown error';
  const wrapper = document.createElement('div');
  wrapper.className = 'empty';
  wrapper.append(title, msg);
  stage.innerHTML = '';
  stage.appendChild(wrapper);
});
