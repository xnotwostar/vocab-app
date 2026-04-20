// app.js — shared: data loading, state persistence, Leitner scheduling, retention

// ---------- Data loading ----------
let _wordsPromise = null;
export async function loadWords() {
  if (!_wordsPromise) {
    _wordsPromise = fetch('words.json?v=' + Date.now())
      .then(r => {
        if (!r.ok) throw new Error(`words.json fetch failed: ${r.status}`);
        return r.json();
      });
  }
  return _wordsPromise;
}

// ---------- State (localStorage) ----------
// Schema: { [wordId]: { box, due, reps, remembered, forgot, lastReview, history: [{t, ok}], state } }
const STATE_KEY = 'lexicon_state_v2';
const LEGACY_STATE_KEYS = ['lexicon_state_v1'];

/**
 * Normalize a card state so downstream code can assume complete schema.
 */
function normalizeCardState(card) {
  if (!card || typeof card !== 'object') return null;
  return {
    box: Number.isFinite(card.box) ? card.box : 0,
    due: typeof card.due === 'string' ? card.due : new Date().toISOString(),
    reps: Number.isFinite(card.reps) ? card.reps : 0,
    remembered: Number.isFinite(card.remembered) ? card.remembered : 0,
    forgot: Number.isFinite(card.forgot) ? card.forgot : 0,
    lastReview: typeof card.lastReview === 'string' ? card.lastReview : null,
    history: Array.isArray(card.history) ? card.history : [],
    state: typeof card.state === 'string' ? card.state : 'new',
  };
}

/**
 * Migrate legacy FSRS v1 state → v2 Leitner state.
 * v1 fields: { stability, difficulty, reps, lapses, lastReview, due, state }
 * v2 fields: { box, reps, remembered, forgot, lastReview, due, history, state }
 */
function migrateV1(v1State) {
  const migrated = {};
  for (const id in v1State) {
    const c = v1State[id];
    if (!c) continue;
    // Map stability → box approximately
    const stability = Number(c.stability) || 0;
    let box = 0;
    if (stability >= 128) box = 8;
    else if (stability >= 64) box = 7;
    else if (stability >= 32) box = 6;
    else if (stability >= 16) box = 5;
    else if (stability >= 8) box = 4;
    else if (stability >= 4) box = 3;
    else if (stability >= 2) box = 2;
    else if (stability >= 1) box = 1;
    const reps = Number(c.reps) || 0;
    const lapses = Number(c.lapses) || 0;
    migrated[id] = {
      box,
      due: c.due || new Date().toISOString(),
      reps,
      remembered: Math.max(reps - lapses, 0),
      forgot: lapses,
      lastReview: c.lastReview || null,
      history: [],  // can't reconstruct
      state: c.state || 'learning',
    };
  }
  return migrated;
}

let _stateCache = null;  // in-memory cache

export function loadState() {
  if (_stateCache) return _stateCache;

  // Try current version
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        // Normalize every card
        const normalized = {};
        for (const id in parsed) {
          const n = normalizeCardState(parsed[id]);
          if (n) normalized[id] = n;
        }
        _stateCache = normalized;
        return _stateCache;
      }
    }
  } catch (e) {
    console.warn('Failed to parse state, starting fresh:', e);
  }

  // Try legacy migration
  for (const legacyKey of LEGACY_STATE_KEYS) {
    const raw = localStorage.getItem(legacyKey);
    if (raw) {
      try {
        const v1 = JSON.parse(raw);
        const migrated = migrateV1(v1);
        localStorage.setItem(STATE_KEY, JSON.stringify(migrated));
        localStorage.setItem(legacyKey + '_archived', raw); // keep backup
        localStorage.removeItem(legacyKey);
        console.info(`Migrated ${Object.keys(migrated).length} cards from ${legacyKey}`);
        _stateCache = migrated;
        return _stateCache;
      } catch (e) {
        console.warn(`Migration from ${legacyKey} failed:`, e);
      }
    }
  }

  _stateCache = {};
  return _stateCache;
}

/**
 * Atomic state save. Uses in-memory cache to prevent lost updates
 * when tabs race on loadState → modify → saveState.
 * Still not perfect cross-tab (no true locking), but eliminates the
 * intra-tab race.
 */
export function saveState(state) {
  _stateCache = state;
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('saveState failed:', e);
  }
}

export function getCardState(wordId) {
  const s = loadState();
  return s[wordId] || null;
}

export function setCardState(wordId, cardState) {
  const s = loadState();
  s[wordId] = normalizeCardState(cardState);
  saveState(s);
}

// Listen for cross-tab updates to invalidate the in-memory cache.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STATE_KEY) _stateCache = null;
  });
}

// ---------- Leitner scheduling ----------
// Intervals per box in days: [10min, 1d, 2d, 4d, 8d, 16d, 32d, 64d, 128d]
const BOX_INTERVALS_DAYS = [10/1440, 1, 2, 4, 8, 16, 32, 64, 128];
const MATURE_BOX = 6;  // 32+ days

/**
 * @param {object|null} prev previous card state (normalized) or null for new
 * @param {boolean} remembered
 */
export function schedule(prev, remembered) {
  const now = new Date();
  const history = (prev?.history || []).slice(-50);
  history.push({ t: now.toISOString(), ok: !!remembered });

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
    state: classifyState(box, reps, forgot),
  };
}

function classifyState(box, reps, forgot) {
  if (reps === 0) return 'new';
  // Leech: 3+ forgets and >50% forget rate
  if (forgot >= 3 && forgot / Math.max(reps, 1) > 0.5) return 'leech';
  if (box >= MATURE_BOX) return 'mature';
  return 'learning';
}

export function previewIntervals(prev) {
  const prevBox = prev?.box ?? 0;
  const okBox = Math.min(prevBox + 1, BOX_INTERVALS_DAYS.length - 1);
  return {
    forgot: formatInterval(BOX_INTERVALS_DAYS[0]),
    remembered: formatInterval(BOX_INTERVALS_DAYS[okBox]),
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
  try {
    return new Date(cardState.due) <= now;
  } catch {
    return true;
  }
}

export function formatDue(dueIso, now = new Date()) {
  if (!dueIso) return 'NEW';
  const due = new Date(dueIso);
  if (isNaN(due)) return 'NEW';
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
/** Whitelist audio filenames to prevent path injection */
function safeAudioPath(filename) {
  if (!filename || typeof filename !== 'string') return null;
  // Only allow alphanumerics, dot, dash, underscore. Must end in .mp3/.wav/.ogg.
  if (!/^[a-zA-Z0-9._-]+\.(mp3|wav|ogg)$/.test(filename)) return null;
  return `audio/${filename}`;
}

export function speakWord(word) {
  if (!('speechSynthesis' in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(String(word));
    u.lang = 'en-US';
    u.rate = 0.9;
    speechSynthesis.speak(u);
  } catch (e) { console.warn(e); }
}

export function playAudio(word) {
  const src = safeAudioPath(word.audio_file);
  if (src) {
    const a = new Audio(src);
    a.play().catch(() => speakWord(word.word));
  } else {
    speakWord(word.word);
  }
}

// ---------- Daily plan ----------
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
      if (!h || typeof h !== 'object') continue;
      const t = new Date(h.t);
      if (isNaN(t)) continue;
      if ((now - t) / 86400000 < 14) recent.push(!!h.ok);
    }
  }
  if (recent.length < 5) return null;
  return recent.filter(x => x).length / recent.length;
}

/**
 * Get or compute today's plan. Cache validated against current date.
 */
export function getTodayPlan(words, state) {
  const key = PLAN_KEY_PREFIX + todayKey();
  const cached = localStorage.getItem(key);
  if (cached) {
    try {
      const p = JSON.parse(cached);
      // Validate date matches (guard against midnight rollover)
      if (p.date === todayKey()) {
        const ids = new Set(words.map(w => w.id));
        p.due_ids = (p.due_ids || []).filter(i => ids.has(i));
        p.new_ids = (p.new_ids || []).filter(i => ids.has(i));
        p.completed_ids = p.completed_ids || [];
        return p;
      }
    } catch {}
  }

  const now = new Date();
  const reviewDue = words.filter(w => {
    const cs = state[w.id];
    return cs && isDue(cs, now);
  });
  const newWords = words.filter(w => !state[w.id]);
  const retention = computeRetention14d(state);

  const plan = {
    date: todayKey(),
    due_ids: reviewDue.map(w => w.id),
    new_ids: newWords.map(w => w.id),
    retention_14d: retention,
    completed_ids: [],
  };
  try {
    localStorage.setItem(key, JSON.stringify(plan));
  } catch (e) {
    console.warn('Failed to cache plan:', e);
  }

  // Cleanup old plans (keep last 7)
  try {
    const all = Object.keys(localStorage).filter(k => k.startsWith(PLAN_KEY_PREFIX)).sort();
    if (all.length > 7) {
      all.slice(0, all.length - 7).forEach(k => localStorage.removeItem(k));
    }
  } catch {}
  return plan;
}

export function markPlanCompleted(wordId) {
  const key = PLAN_KEY_PREFIX + todayKey();
  const cached = localStorage.getItem(key);
  if (!cached) return;
  try {
    const plan = JSON.parse(cached);
    if (plan.date !== todayKey()) return;  // day changed
    plan.completed_ids = plan.completed_ids || [];
    if (!plan.completed_ids.includes(wordId)) {
      plan.completed_ids.push(wordId);
      localStorage.setItem(key, JSON.stringify(plan));
    }
  } catch (e) { console.warn(e); }
}

// ---------- Retention curve ----------
const RETENTION_BINS = 91;  // 0..90 days inclusive

export function computeRetentionCurve(state) {
  const bins = Array.from({length: RETENTION_BINS}, () => ({ok: 0, total: 0}));
  for (const id in state) {
    const hist = state[id]?.history || [];
    for (let i = 1; i < hist.length; i++) {
      const prev = new Date(hist[i-1]?.t);
      const cur = new Date(hist[i]?.t);
      if (isNaN(prev) || isNaN(cur)) continue;
      const gap = (cur - prev) / 86400000;
      if (gap < 0) continue;
      const bin = Math.min(Math.round(gap), RETENTION_BINS - 1);
      bins[bin].total++;
      if (hist[i].ok) bins[bin].ok++;
    }
  }
  return bins.map((b, i) => ({
    day: i,
    retention: b.total ? b.ok / b.total : null,
    samples: b.total,
  }));
}

// ---------- Adaptive forgot re-queue spacing ----------
/**
 * How many slots ahead to re-queue a "forgot" card.
 * Tighter for chronic leeches (need more immediate repetition).
 */
export function forgotRequeueOffset(prev, queueLen, currentIdx) {
  const remaining = queueLen - currentIdx;
  if (remaining <= 0) return 0;
  // Repeat count so far = prev.forgot. More forgets → shorter gap.
  const forgotCount = prev?.forgot || 0;
  const base = forgotCount >= 3 ? 2 : forgotCount >= 1 ? 4 : 6;
  return Math.min(base, Math.max(1, Math.floor(remaining / 2)));
}

// ---------- Safe HTML escape ----------
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
  }[c]));
}
