// library.js — word list with search + filter
import { loadWords, loadState, isDue, formatDue, playAudio } from './app.js';

let words = [];
let state = {};
let currentFilter = 'all';
let currentSearch = '';

async function init() {
  const data = await loadWords();
  words = data.words;
  state = loadState();

  document.getElementById('total-count').textContent = words.length;
  document.getElementById('stat-total').textContent = words.length;
  document.getElementById('stat-last').textContent = data.generated_at ? data.generated_at.slice(0, 10) : '—';

  renderCounts();
  render();

  document.getElementById('search-input').addEventListener('input', (e) => {
    currentSearch = e.target.value.toLowerCase();
    render();
  });

  document.querySelectorAll('.filter').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.filter').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      currentFilter = b.dataset.filter;
      render();
    });
  });
}

function renderCounts() {
  const now = new Date();
  const counts = { all: 0, due: 0, learning: 0, mature: 0 };
  for (const w of words) {
    const cs = state[w.id];
    counts.all++;
    if (isDue(cs, now)) counts.due++;
    if (!cs || cs.state === 'learning' || cs.state === 'new') counts.learning++;
    if (cs && cs.state === 'mature') counts.mature++;
  }
  document.getElementById('count-all').textContent = counts.all;
  document.getElementById('count-due').textContent = counts.due;
  document.getElementById('count-learning').textContent = counts.learning;
  document.getElementById('count-mature').textContent = counts.mature;
  document.getElementById('due-count').textContent = counts.due;
}

function filterWord(w) {
  // Filter
  const cs = state[w.id];
  const now = new Date();
  if (currentFilter === 'due' && !isDue(cs, now)) return false;
  if (currentFilter === 'learning' && !(!cs || cs.state === 'learning' || cs.state === 'new')) return false;
  if (currentFilter === 'mature' && !(cs && cs.state === 'mature')) return false;

  // Search
  if (currentSearch) {
    const hay = `${w.word} ${w.meaning_zh || ''} ${w.example || ''}`.toLowerCase();
    if (!hay.includes(currentSearch)) return false;
  }
  return true;
}

function render() {
  const filtered = words.filter(filterWord);
  const body = document.getElementById('tbl-body');
  body.innerHTML = filtered.map(renderRow).join('');
  document.getElementById('tbl-foot').textContent = `Showing ${filtered.length} of ${words.length}`;

  body.querySelectorAll('[data-play]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.play;
      const w = words.find(x => x.id === id);
      if (w) playAudio(w);
    });
  });
}

function renderRow(w) {
  const cs = state[w.id];
  const now = new Date();
  const dueText = cs ? formatDue(cs.due, now) : 'NEW';
  const dueClass = cs && isDue(cs, now) ? 'due-now' : '';
  const diffStars = w.difficulty ? '⭐'.repeat(w.difficulty) : '—';

  return `
    <div class="tbl-row">
      <div class="word-cell">${w.word}${w.phonetic ? `<span class="phonetic">${w.phonetic}</span>` : ''}</div>
      <div class="meaning-cell">${w.meaning_zh || ''}${w.example ? ` · <em style="color:var(--ink-faint)">${w.example}</em>` : ''}</div>
      <div class="diff-cell">${diffStars}</div>
      <div class="due-cell ${dueClass}">${dueText}</div>
      <div class="play-cell">
        <button data-play="${w.id}" title="Pronounce">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 10v4h3l5 4V6L7 10H4z"/>
            <path d="M16 8.5c1.2 1 1.2 6 0 7" opacity="0.7"/>
          </svg>
        </button>
      </div>
    </div>`;
}

init().catch(err => {
  document.getElementById('tbl-foot').textContent = `Error: ${err.message}`;
});
