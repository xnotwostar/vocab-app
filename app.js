// app.js — shared: data loading, state persistence, simple Leitner-style scheduling

let _wordsPromise = null;
export async function loadWords() {
  if (!_wordsPromise) {
    _wordsPromise = fetch('words.json').then(r => r.json());
  }
  return _wordsPromise;
}

// ---------- State (localStorage) ----------
// Schema: { [wordId]: { box, due, reps, remembered, forgot, history: [{t, ok}] } }
const STATE_KEY = 'lexicon_state_v2';

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

// ---------- Leitner-like scheduling ----------
// Simple rule based on "remembered?" boolean:
//   remembered → box+1, interval doubles up to cap
//   forgot     → box resets to 0, show in same session (or 10 min)
// Intervals per box (days): [0.007 (10min), 1, 2, 4, 8, 16, 32, 64, 128]
const BOX_INTERVALS_DAYS = [10/1440, 1, 2, 4, 8, 16, 32, 64, 128];

/**
 * Schedule next review.
 * @param {object|null} prev
 * @param {boolean} remembered - true if user remembered, false if forgot
 * @returns {object} new state
 */
export function schedule(prev, remembered) {
  const now = new Date();
  const history = (prev?.history || []).slice(-50); // cap history
  history.push({ t: now.toISOString(), ok: remembered });

  const prevBox = prev?.box ?? 0;
  const box = remembered ? Math.min(prevBox + 1, BOX_INTERVALS_DAYS.length - 1) : 0;
  const intervalDays = BOX_INTERVALS_DAYS[box];
  const dueDate = new Date(now.getTime() + intervalDays * 86400 * 1000);

  const reps = (prev?.reps || 0) + 1;
  const forgot = (prev?.forgot || 0) + (remembered ? 0 : 1);
  const remembered_count = (prev?.remembered || 0) + (remembered ? 1 : 0);

  return {
    box,
    due: dueDate.toISOString(),
    reps,
    remembered: remembered_count,
    forgot,
    lastReview: now.toISOString(),
    history,
    state: classifyState(box, reps, forgot)
  };
}

function classifyState(box, reps, forgot) {
  if (reps === 0) return 'new';
  if (box >= 6) return 'mature';  // 32+ days = mastered
  if (forgot >= 3 && reps > 0 && forgot / reps > 0.5) return 'leech';
  return 'learning';
}

export function previewIntervals(prev) {
  const prevBox = prev?.box ?? 0;
  const okBox = Math.min(prevBox + 1, BOX_INTERVALS_DAYS.length - 1);
  return {
    forgot: formatInterval(BOX_INTERVALS_DAYS[0]),
    remembered: formatInterval(BOX_INTERVALS_DAYS[okBox])
  };
}

function formatInterval(days) {
  if (days < 1/24) return `${Math.round(days * 24 * 60)} min`;
  if (days < 1) return `${Math.round(days * 24)} h`;
  if (days < 30) return `${Math.round(days)} d`;
  if (days < 365) return `${Math.round(days / 30)} mo`;
  return `${Math.round(days / 365)} y`;
}

export function isDue(cardState, now = new Date()) {
  if (!cardState) return true;
  return new Date(cardState.due) <= now;
}

export function formatDue(dueIso, now = new Date()) {
  if (!dueIso) return 'NEW';
  const due = new Date(dueIso);
  const diff = (due - now) / 1000;
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

// ---------- Audio ----------
export function speakWord(word) {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(word);
  u.lang = 'en-US';
  u.rate = 0.9;
  speechSynthesis.speak(u);
}

export function playAudio(word) {
  if (word.audio_file) {
    const a = new Audio(`audio/${word.audio_file}`);
    a.play().catch(() => speakWord(word.word));
  } else {
    speakWord(word.word);
  }
}

// ---------- Daily plan (retention-driven) ----------
// Locks the day's queue so refreshing mid-session doesn't change it.
const PLAN_KEY_PREFIX = 'lexicon_plan_';

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export function computeRetention14d(state) {
  const now = new Date();
  const recent = [];
  for (const id in state) {
    const hist = state[id]?.history || [];
    for (const h of hist) {
      if ((now - new Date(h.t)) / 86400000 < 14) recent.push(h.ok);
    }
  }
  if (recent.length < 5) return null;
  return recent.filter(x => x).length / recent.length;
}

/**
 * Get or compute today's word plan.
 * Cached per-day in localStorage so it's stable within a day.
 */
export function getTodayPlan(words, state) {
  const key = PLAN_KEY_PREFIX + todayKey();
  const cached = localStorage.getItem(key);
  if (cached) {
    try {
      const p = JSON.parse(cached);
      // Validate IDs still exist
      const ids = new Set(words.map(w => w.id));
      p.due_ids = p.due_ids.filter(i => ids.has(i));
      p.new_ids = p.new_ids.filter(i => ids.has(i));
      return p;
    } catch {}
  }

  const now = new Date();
  const reviewDue = words.filter(w => {
    const cs = state[w.id];
    return cs && isDue(cs, now);
  });
  const newCandidates = words.filter(w => !state[w.id]);

  const retention = computeRetention14d(state);
  let newLimit;
  if (retention === null) newLimit = 10;
  else if (retention >= 0.85) newLimit = 8;
  else if (retention >= 0.75) newLimit = 5;
  else if (retention >= 0.60) newLimit = 3;
  else newLimit = 0;

  const todayNew = newCandidates.slice(0, newLimit);

  const plan = {
    date: todayKey(),
    due_ids: reviewDue.map(w => w.id),
    new_ids: todayNew.map(w => w.id),
    retention_14d: retention,
    new_limit: newLimit,
    completed_ids: [],
  };
  localStorage.setItem(key, JSON.stringify(plan));

  // Cleanup old plans (keep last 7)
  const all = Object.keys(localStorage).filter(k => k.startsWith(PLAN_KEY_PREFIX)).sort();
  if (all.length > 7) {
    all.slice(0, all.length - 7).forEach(k => localStorage.removeItem(k));
  }
  return plan;
}

export function markPlanCompleted(wordId) {
  const key = PLAN_KEY_PREFIX + todayKey();
  const cached = localStorage.getItem(key);
  if (!cached) return;
  const plan = JSON.parse(cached);
  if (!plan.completed_ids.includes(wordId)) {
    plan.completed_ids.push(wordId);
    localStorage.setItem(key, JSON.stringify(plan));
  }
}

// ---------- Retention curve: compute from actual history ----------
// Returns array of {day, retention}. Retention = P(remembered) at that time-since-review.
export function computeRetentionCurve(state) {
  const bins = Array.from({length: 90}, () => ({ok: 0, total: 0}));
  for (const id in state) {
    const hist = state[id]?.history || [];
    for (let i = 1; i < hist.length; i++) {
      const gap = (new Date(hist[i].t) - new Date(hist[i-1].t)) / 86400000;
      const bin = Math.min(Math.floor(gap), 89);
      bins[bin].total++;
      if (hist[i].ok) bins[bin].ok++;
    }
  }
  return bins.map((b, i) => ({
    day: i,
    retention: b.total ? b.ok / b.total : null,
    samples: b.total
  }));
}
