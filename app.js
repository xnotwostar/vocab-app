// app.js — shared logic: data loading, state persistence, FSRS wrapper

// ---------- Data loading ----------
let _wordsPromise = null;
export async function loadWords() {
  if (!_wordsPromise) {
    _wordsPromise = fetch('words.json').then(r => r.json());
  }
  return _wordsPromise;
}

// ---------- State (localStorage) ----------
// Schema: { [wordId]: { due, stability, difficulty, reps, lapses, lastReview, state } }
const STATE_KEY = 'lexicon_state_v1';

export function loadState() {
  try { return JSON.parse(localStorage.getItem(STATE_KEY)) || {}; }
  catch { return {}; }
}

export function saveState(state) {
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
}

export function getCardState(wordId) {
  const s = loadState();
  return s[wordId] || null;
}

export function setCardState(wordId, cardState) {
  const s = loadState();
  s[wordId] = cardState;
  saveState(s);
}

// ---------- FSRS algorithm (simplified, inline) ----------
// Based on https://github.com/open-spaced-repetition/fsrs4anki
// Rating: 1=Again, 2=Hard, 3=Good, 4=Easy
const FSRS_W = [0.4072, 1.1829, 3.1262, 15.4722, 7.2102, 0.5316, 1.0651, 0.0234,
                1.616, 0.1544, 1.0824, 1.9813, 0.0953, 0.2975, 2.2042, 0.2407, 2.9466];
const DECAY = -0.5;
const FACTOR = Math.pow(0.9, 1 / DECAY) - 1;

function retrievability(elapsedDays, stability) {
  return Math.pow(1 + FACTOR * elapsedDays / stability, DECAY);
}
function nextInterval(stability, requestRetention = 0.9) {
  return stability / FACTOR * (Math.pow(requestRetention, 1 / DECAY) - 1);
}

function initStability(rating) {
  return Math.max(FSRS_W[rating - 1], 0.1);
}

function initDifficulty(rating) {
  return Math.min(Math.max(FSRS_W[4] - (rating - 3) * FSRS_W[5], 1), 10);
}

function meanReversion(init, current) {
  return FSRS_W[7] * init + (1 - FSRS_W[7]) * current;
}

function nextDifficulty(difficulty, rating) {
  const nextD = difficulty - FSRS_W[6] * (rating - 3);
  return Math.min(Math.max(meanReversion(FSRS_W[4], nextD), 1), 10);
}

function nextStability(difficulty, stability, retrievability, rating) {
  if (rating === 1) {
    // Again — forgetting curve
    return FSRS_W[11] * Math.pow(difficulty, -FSRS_W[12]) * (Math.pow(stability + 1, FSRS_W[13]) - 1) * Math.exp((1 - retrievability) * FSRS_W[14]);
  }
  // Hard/Good/Easy
  const hardPenalty = rating === 2 ? FSRS_W[15] : 1;
  const easyBonus = rating === 4 ? FSRS_W[16] : 1;
  return stability * (1 + Math.exp(FSRS_W[8]) * (11 - difficulty) * Math.pow(stability, -FSRS_W[9]) * (Math.exp((1 - retrievability) * FSRS_W[10]) - 1) * hardPenalty * easyBonus);
}

/**
 * Schedule next review after grading.
 * @param {object|null} prev - previous card state, or null if new
 * @param {number} rating - 1/2/3/4
 * @returns {object} new card state
 */
export function schedule(prev, rating) {
  const now = new Date();
  let stability, difficulty, reps, lapses;

  if (!prev) {
    // First review
    stability = initStability(rating);
    difficulty = initDifficulty(rating);
    reps = 1;
    lapses = rating === 1 ? 1 : 0;
  } else {
    const elapsedDays = Math.max(0, (now - new Date(prev.lastReview)) / (1000 * 60 * 60 * 24));
    const r = retrievability(elapsedDays, prev.stability);
    stability = nextStability(prev.difficulty, prev.stability, r, rating);
    difficulty = nextDifficulty(prev.difficulty, rating);
    reps = prev.reps + 1;
    lapses = prev.lapses + (rating === 1 ? 1 : 0);
  }

  const interval = Math.max(1, nextInterval(stability));
  const dueDate = new Date(now.getTime() + interval * 86400000);

  return {
    stability,
    difficulty,
    reps,
    lapses,
    lastReview: now.toISOString(),
    due: dueDate.toISOString(),
    state: classifyState(stability, reps, lapses)
  };
}

function classifyState(stability, reps, lapses) {
  if (reps === 0) return 'new';
  if (stability >= 21) return 'mature';
  if (lapses >= 3) return 'leech';
  return 'learning';
}

// ---------- Due filtering ----------
export function isDue(cardState, now = new Date()) {
  if (!cardState) return true; // new card is always due
  return new Date(cardState.due) <= now;
}

// ---------- Preview next intervals (for button labels) ----------
export function previewIntervals(prev) {
  return {
    again: formatInterval(nextInterval(initStability(1))),
    hard:  formatInterval(nextInterval(prev ? nextStability(prev.difficulty, prev.stability, 0.9, 2) : initStability(2))),
    good:  formatInterval(nextInterval(prev ? nextStability(prev.difficulty, prev.stability, 0.9, 3) : initStability(3))),
    easy:  formatInterval(nextInterval(prev ? nextStability(prev.difficulty, prev.stability, 0.9, 4) : initStability(4)))
  };
}

function formatInterval(days) {
  if (days < 1/24) return `< 1 min`;
  if (days < 1/24/60 * 60) return `${Math.round(days * 24 * 60)} min`;
  if (days < 1) return `${Math.round(days * 24)} h`;
  if (days < 30) return `${Math.round(days)} d`;
  if (days < 365) return `${Math.round(days / 30)} mo`;
  return `${Math.round(days / 365)} y`;
}

// ---------- Relative time for "due" column ----------
export function formatDue(dueIso, now = new Date()) {
  if (!dueIso) return 'NEW';
  const due = new Date(dueIso);
  const diff = (due - now) / 1000; // seconds
  if (diff <= 0) {
    const past = -diff;
    if (past < 3600) return 'NOW';
    if (past < 86400) return `${Math.floor(past / 3600)}H AGO`;
    return `${Math.floor(past / 86400)}D AGO`;
  }
  if (diff < 3600) return `${Math.floor(diff / 60)} MIN`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} H`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} D`;
  if (diff < 86400 * 365) return `${Math.floor(diff / 86400 / 30)} MO`;
  return `${Math.floor(diff / 86400 / 365)} Y`;
}

// ---------- TTS fallback (for words without audio file) ----------
export function speakWord(word) {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(word);
  u.lang = 'en-US';
  u.rate = 0.9;
  speechSynthesis.speak(u);
}

// ---------- Play audio (prefer file, fallback to TTS) ----------
export function playAudio(word) {
  const audioPath = `audio/${word.audio_file || ''}`;
  if (word.audio_file) {
    const a = new Audio(audioPath);
    a.play().catch(() => speakWord(word.word));
  } else {
    speakWord(word.word);
  }
}
