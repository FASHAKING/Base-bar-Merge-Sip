// Daily challenge, play streaks, and friend challenges — all local-first so
// they work offchain and in a plain browser. Dates use UTC so every player
// worldwide gets the same daily hand.

const STREAK_KEY = 'merge-sip-streak';
const DAILY_KEY = 'merge-sip-daily';
// Daily Mix #1 was this date; the number counts up from here.
const DAILY_EPOCH = Date.UTC(2026, 6, 1); // 2026-07-01

const safeGet = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const safeSet = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private browsing — feature degrades to per-session */
  }
};

/** UTC date key, e.g. "2026-07-12". */
export function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayKey(): string {
  return new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
}

// ------------------------------------------------------------------ streaks

interface StreakData {
  count: number;
  last: string;
}

function readStreak(): StreakData {
  try {
    const raw = safeGet(STREAK_KEY);
    if (raw) {
      const v = JSON.parse(raw) as StreakData;
      if (typeof v.count === 'number' && typeof v.last === 'string') return v;
    }
  } catch {
    /* corrupted — start over */
  }
  return { count: 0, last: '' };
}

/** Current streak; 0 when it's broken (no play today or yesterday). */
export function getStreak(): number {
  const s = readStreak();
  return s.last === todayKey() || s.last === yesterdayKey() ? s.count : 0;
}

/** Record a play today and return the (possibly extended) streak. */
export function bumpStreak(): number {
  const s = readStreak();
  const today = todayKey();
  if (s.last === today) return s.count;
  const count = s.last === yesterdayKey() ? s.count + 1 : 1;
  safeSet(STREAK_KEY, JSON.stringify({ count, last: today }));
  return count;
}

// ------------------------------------------------------------ daily challenge

/** Sequential number of today's Daily Mix. */
export function dailyNumber(): number {
  return Math.floor((Date.now() - DAILY_EPOCH) / 86_400_000) + 1;
}

/** Deterministic PRNG (mulberry32) — same daily hand for every player. */
export function dailyRng(): () => number {
  let seed = 0;
  for (const ch of todayKey()) seed = (seed * 31 + ch.charCodeAt(0)) | 0;
  let a = seed ^ 0x9e3779b9;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface DailyBest {
  date: string;
  best: number;
}

/** Today's best daily-challenge score on this device. */
export function getDailyBest(): number {
  try {
    const raw = safeGet(DAILY_KEY);
    if (raw) {
      const v = JSON.parse(raw) as DailyBest;
      if (v.date === todayKey() && typeof v.best === 'number') return v.best;
    }
  } catch {
    /* corrupted */
  }
  return 0;
}

export function setDailyBest(score: number): void {
  if (score > getDailyBest()) {
    safeSet(DAILY_KEY, JSON.stringify({ date: todayKey(), best: score }));
  }
}

// -------------------------------------------------------------- challenges

export interface Challenge {
  score: number;
  by: string;
}

/** Challenge carried in the link that opened the app (?c=score&by=name). */
export function parseChallenge(): Challenge | null {
  try {
    const q = new URLSearchParams(window.location.search);
    const score = Number(q.get('c'));
    const by = (q.get('by') ?? '').slice(0, 16);
    if (Number.isFinite(score) && score > 0 && /^[a-z0-9_]{1,16}$/i.test(by)) {
      return { score: Math.floor(score), by };
    }
  } catch {
    /* malformed URL */
  }
  return null;
}

/** Link that challenges friends to beat this score. */
export function challengeUrl(appUrl: string, score: number, by: string | null): string {
  const q = new URLSearchParams({ c: String(score) });
  if (by) q.set('by', by);
  return `${appUrl}?${q.toString()}`;
}
