// review.js — flashcard review page
import { loadWords, loadState, setCardState, schedule, isDue, previewIntervals, playAudio, formatDue } from './app.js';

let words = [];
let queue = [];
let currentIdx = 0;
let revealed = false;

const stage = document.getElementById('stage');
const sessionEl = document.getElementById('session-progress');
const dueCountEl = document.getElementById('due-count');
const fsrsMetaEl = document.getElementById('fsrs-meta');

async function init() {
  const data = await loadWords();
  words = data.words;
  const state = loadState();
  const now = new Date();

  queue = words.filter(w => {
    const cs = state[w.id];
    return isDue(cs, now);
  });

  // Sort: new first, then overdue, then due
  queue.sort((a, b) => {
    const sa = state[a.id], sb = state[b.id];
    if (!sa && sb) return -1;
    if (sa && !sb) return 1;
    if (sa && sb) return new Date(sa.due) - new Date(sb.due);
    return 0;
  });

  dueCountEl.textContent = queue.length;
  if (queue.length === 0) return renderEmpty();
  renderCard();
}

function renderEmpty() {
  stage.innerHTML = `
    <div class="empty">
      <h2>All caught up<span class="amber-accent">.</span></h2>
      <p>No cards due right now. Add more words to your <a href="library.html" style="color:var(--amber)">library</a>, or come back later.</p>
    </div>`;
}

function renderCard() {
  if (currentIdx >= queue.length) return renderDone();
  const w = queue[currentIdx];
  const state = loadState();
  const prev = state[w.id];
  const intervals = previewIntervals(prev);

  sessionEl.textContent = `${currentIdx + 1} / ${queue.length}`;
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
        <button class="speaker" id="btn-speak" aria-label="Pronounce">
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
        ${w.synonyms ? `<div class="synonyms">${w.synonyms.map(s => `<span class="chip">${s}</span>`).join('')}</div>` : ''}
        ${w.etymology ? `<div class="etymology">${w.etymology}</div>` : ''}
      </section>

      <div class="grades" role="group" style="display:none" id="grades">
        <button class="grade again" data-key="1"><span class="gkey">1</span><span class="glabel">Again</span><span class="gmeta">${intervals.again}</span></button>
        <button class="grade hard"  data-key="2"><span class="gkey">2</span><span class="glabel">Hard</span><span class="gmeta">${intervals.hard}</span></button>
        <button class="grade good primary" data-key="3"><span class="gkey">3</span><span class="glabel">Good</span><span class="gmeta">${intervals.good}</span></button>
        <button class="grade easy" data-key="4"><span class="gkey">4</span><span class="glabel">Easy</span><span class="gmeta">${intervals.easy}</span></button>
      </div>
    </div>`;

  document.getElementById('btn-speak').addEventListener('click', () => playAudio(w));
  document.querySelectorAll('.grade').forEach(b => {
    b.addEventListener('click', () => grade(parseInt(b.dataset.key)));
  });

  if (prev) {
    fsrsMetaEl.textContent = `FSRS · S=${prev.stability.toFixed(1)} · D=${prev.difficulty.toFixed(1)} · reps=${prev.reps}`;
  } else {
    fsrsMetaEl.textContent = 'FSRS · new card';
  }
}

function reveal() {
  if (revealed) return;
  revealed = true;
  document.getElementById('revealed').style.display = '';
  document.getElementById('grades').style.display = '';
}

function grade(rating) {
  if (!revealed) return reveal();
  const w = queue[currentIdx];
  const state = loadState();
  const prev = state[w.id];
  const next = schedule(prev, rating);
  setCardState(w.id, next);
  currentIdx++;
  setTimeout(renderCard, 120);
}

function renderDone() {
  stage.innerHTML = `
    <div class="empty">
      <h2>Session complete<span class="amber-accent">.</span></h2>
      <p>${queue.length} cards reviewed. Come back tomorrow — your brain needs sleep to consolidate.</p>
      <p style="margin-top:20px"><a href="stats.html" style="color:var(--amber)">View stats →</a></p>
    </div>`;
  sessionEl.textContent = `${queue.length} / ${queue.length}`;
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === ' ') { e.preventDefault(); reveal(); }
  if (e.key >= '1' && e.key <= '4') grade(parseInt(e.key));
  if (e.key.toLowerCase() === 's') {
    const w = queue[currentIdx];
    if (w) playAudio(w);
  }
});

init().catch(err => {
  stage.innerHTML = `<div class="empty"><h2>Error loading words</h2><p>${err.message}</p></div>`;
});
