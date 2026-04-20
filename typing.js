// typing.js — type the word given its meaning
import { loadWords, loadState, setCardState, schedule, isDue, playAudio, previewIntervals } from './app.js';

let words = [];
let queue = [];
let idx = 0;
let app, frame, target, submitted = false;

async function init() {
  const data = await loadWords();
  words = data.words;
  const state = loadState();
  const now = new Date();

  queue = words.filter(w => isDue(state[w.id], now));
  if (queue.length === 0) return renderEmpty();

  app = document.getElementById('app');
  frame = document.getElementById('card-frame');
  renderCard();
}

function renderEmpty() {
  document.getElementById('card-frame').innerHTML = `
    <div class="empty" style="margin-top:100px">
      <h2>All caught up<span class="amber-accent">.</span></h2>
      <p>No cards due. Head back to the <a href="index.html" style="color:var(--amber)">review page</a>.</p>
    </div>`;
}

function renderCard() {
  if (idx >= queue.length) return renderDone();
  submitted = false;
  app.classList.remove('state-ok', 'state-bad');
  target = queue[idx];
  document.getElementById('session-progress').textContent = `${idx + 1} / ${queue.length}`;
  document.getElementById('target-meta').textContent = `Target · ${target.word}`;

  frame.innerHTML = `
    <div class="card-chrome">
      <div class="lang-tag">
        <span class="swatch"></span>
        <span class="code">EN</span>
        <span class="sep">—</span>
        <span>Typing · Recall</span>
      </div>
      <button class="speaker" id="btn-speak">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 10v4h3l5 4V6L7 10H4z"/><path d="M16 8.5c1.2 1 1.2 6 0 7" opacity="0.7"/>
        </svg>
      </button>
    </div>

    <p class="prompt">${target.meaning_zh || target.example || '—'}</p>
    <div class="prompt-sub">
      <span class="tick"></span>
      <span>${target.phonetic || ''}</span>
      <span class="tick"></span>
    </div>

    <div class="answer-wrap">
      <span class="answer-label">Type the word</span>
      <span class="answer-hint"><span class="kbd">↵</span>Submit</span>
      <input id="answerInput" class="answer" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="…">
    </div>

    <div class="result" id="result"></div>
  `;

  document.getElementById('btn-speak').addEventListener('click', () => playAudio(target));
  const input = document.getElementById('answerInput');
  input.focus();
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !submitted) {
      submit(input.value.trim());
    } else if (e.key === 'Tab') {
      e.preventDefault();
      next();
    }
  });
}

function submit(attempt) {
  submitted = true;
  const correct = attempt.toLowerCase() === target.word.toLowerCase();
  const result = document.getElementById('result');

  if (correct) {
    app.classList.add('state-ok');
    result.innerHTML = `
      <span class="status">
        <span style="display:inline-block;width:18px;height:18px;border-radius:50%;border:1px solid currentColor;display:inline-flex;align-items:center;justify-content:center">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:10px;height:10px"><path d="M5 12l4 4 10-10"/></svg>
        </span>
        <span>Correct</span>
      </span>`;
    setTimeout(() => autoGrade(3), 800);
  } else {
    app.classList.add('state-bad');
    result.innerHTML = `
      <span class="status">
        <span style="display:inline-block;width:18px;height:18px;border-radius:50%;border:1px solid currentColor;display:inline-flex;align-items:center;justify-content:center">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:10px;height:10px"><path d="M6 6l12 12M18 6 6 18"/></svg>
        </span>
        <span>Wrong</span>
      </span>
      <span class="reveal">${target.word}</span>
      <span class="diff">${attempt || '—'} &nbsp;→&nbsp; ${target.word}</span>`;
    setTimeout(() => autoGrade(1), 1500);
  }
}

function autoGrade(rating) {
  const state = loadState();
  const prev = state[target.id];
  setCardState(target.id, schedule(prev, rating));
  idx++;
  setTimeout(renderCard, 400);
}

function next() {
  idx++;
  renderCard();
}

function renderDone() {
  frame.innerHTML = `
    <div class="empty" style="margin-top:100px">
      <h2>Session complete<span class="amber-accent">.</span></h2>
      <p>${queue.length} words reviewed.</p>
    </div>`;
}

init().catch(err => {
  document.getElementById('card-frame').innerHTML = `<p>Error: ${err.message}</p>`;
});
