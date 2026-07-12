// DOM overlays: intro screen (wallet gate + onchain username registration,
// personal best) and the onchain leaderboard. The game itself stays pure
// canvas; these are menus.

import * as onchain from './onchain.ts';
import { drawDrink } from './drinks.ts';
import { getStreak, dailyNumber, getDailyBest, parseChallenge } from './modes.ts';

const BADGE_TIERS = [5, 6, 7, 8, 9];

interface UiOptions {
  getBest: () => number;
  /** Start the seeded daily-challenge run (also hides the intro). */
  startDaily?: () => void;
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

let opts: UiOptions;

// When the contract is live, registration IS the onchain claimUsername
// transaction and nothing is playable until the wallet is connected and a
// username is minted. Without a contract (zero address / local dev), the
// username is only stored locally so the game still works fully offchain.
// The local copy also caches the claimed onchain name for share cards.
const USERNAME_KEY = 'merge-sip-username';
const USERNAME_RE = /^[a-z0-9_]{3,16}$/;

function loadUsername(): string | null {
  try {
    const v = localStorage.getItem(USERNAME_KEY);
    return v && USERNAME_RE.test(v) ? v : null;
  } catch {
    return null;
  }
}

let localUsername: string | null = loadUsername();
// player tapped "change" on their claimed name; shows the register row again
let editingName = false;

/** The player's username: the claimed onchain name, or the local fallback. */
export function getUsername(): string | null {
  return onchain.state.username ?? localUsername;
}

/** Whether the player may start a game. */
function unlocked(): boolean {
  const s = onchain.state;
  return s.enabled ? Boolean(s.address && s.username) : Boolean(localUsername);
}

export function initUi(options: UiOptions): void {
  opts = options;

  $('play-btn').addEventListener('click', () => {
    if (!unlocked()) return;
    $('intro').hidden = true;
  });

  $('daily-btn').addEventListener('click', () => {
    if (!unlocked()) return;
    opts.startDaily?.();
    $('intro').hidden = true;
  });

  // challenge banner when the app was opened from a shared score link
  const challenge = parseChallenge();
  if (challenge) {
    const line = $('challenge-line');
    line.hidden = false;
    line.textContent = `🎯 @${challenge.by} challenged you — beat ${challenge.score.toLocaleString()}!`;
  }

  $('connect-btn').addEventListener('click', () => onchain.toggleWallet());
  $('register-btn').addEventListener('click', registerUsername);
  $('username-input').addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') registerUsername();
  });
  // Tap the "Playing as @name" line to change it (a new onchain claim when
  // the contract is live).
  $('username-line').addEventListener('click', () => {
    editingName = true;
    const input = $<HTMLInputElement>('username-input');
    input.value = getUsername() ?? '';
    render();
    input.focus();
  });

  $('board-btn').addEventListener('click', showLeaderboard);
  $('board-close').addEventListener('click', () => {
    $('board').hidden = true;
  });
  $('tab-all').addEventListener('click', () => setBoardView('all'));
  $('tab-week').addEventListener('click', () => setBoardView('week'));

  // milestone badge icons (drawn once with the game's own art)
  const icons = $('badge-icons');
  for (const tier of BADGE_TIERS) {
    const c = document.createElement('canvas');
    c.width = 88;
    c.height = 88;
    c.dataset.tier = String(tier);
    c.title = `First ${tier + 1}-tier mix`;
    drawDrink(c.getContext('2d')!, tier, 44, 46, 30);
    icons.appendChild(c);
  }

  render();
  setInterval(render, 400);
}

function registerUsername(): void {
  const input = $<HTMLInputElement>('username-input');

  // contract live: registering IS the onchain claim (wallet signs, pays gas)
  if (onchain.state.enabled) {
    onchain.claimUsername(input.value);
    return;
  }

  // offchain fallback: validate and store locally
  const status = $('register-status');
  const clean = input.value.trim().toLowerCase();
  if (!USERNAME_RE.test(clean)) {
    status.classList.add('error');
    status.textContent = '3-16 chars: a-z, 0-9, _';
    return;
  }
  localUsername = clean;
  editingName = false;
  try {
    localStorage.setItem(USERNAME_KEY, clean);
  } catch {
    // sandboxed iframe / private browsing — keep it in memory for this session
  }
  render();
}

/**
 * Drive the intro gate. Contract live: connect wallet → claim username
 * onchain → play unlocks. No contract: register locally → play unlocks.
 */
function renderGate(): void {
  const s = onchain.state;
  const connectBtn = $<HTMLButtonElement>('connect-btn');
  const registerRow = $('register-row');
  const registerBtn = $<HTMLButtonElement>('register-btn');
  const usernameLine = $('username-line');
  const status = $('register-status');
  const playBtn = $<HTMLButtonElement>('play-btn');
  const dailyBtn = $<HTMLButtonElement>('daily-btn');

  const setStatus = (text: string, error = false): void => {
    status.textContent = text;
    status.classList.toggle('error', error);
  };
  const lock = (locked: boolean): void => {
    playBtn.disabled = locked;
    dailyBtn.disabled = locked;
  };

  if (!s.enabled) {
    // offchain build: local username gate
    connectBtn.hidden = true;
    registerBtn.textContent = 'Register';
    registerBtn.disabled = false;
    if (localUsername && !editingName) {
      registerRow.hidden = true;
      usernameLine.hidden = false;
      usernameLine.textContent = `Playing as @${localUsername} — tap to change`;
      if (!status.classList.contains('error')) setStatus('');
      lock(false);
    } else {
      registerRow.hidden = false;
      usernameLine.hidden = true;
      lock(!localUsername); // editing an existing local name doesn't re-lock
      if (!status.classList.contains('error')) setStatus('Register a username to start playing');
    }
    return;
  }

  // ---- onchain gate ----
  connectBtn.hidden = false;
  if (s.address) {
    // prefer the Basename when the wallet has one
    const who = s.basename ?? `${s.address.slice(0, 6)}…${s.address.slice(-4)}`;
    connectBtn.textContent = `Connected: ${who} (tap to disconnect)`;
  } else {
    connectBtn.textContent = s.status === 'connecting' ? 'Connecting…' : '🔵 Connect Wallet';
  }

  // cache the claimed name locally (share cards) and leave edit mode
  if (s.username && localUsername !== s.username) {
    localUsername = s.username;
    editingName = false;
    try {
      localStorage.setItem(USERNAME_KEY, s.username);
    } catch {
      /* best effort */
    }
  }

  if (!s.address) {
    registerRow.hidden = true;
    usernameLine.hidden = true;
    lock(true);
    setStatus(
      s.error ? `Connection failed: ${s.error}` : 'Connect your wallet to get started',
      Boolean(s.error),
    );
    return;
  }

  if (!s.usernameChecked && !s.username) {
    // connected, first usernameOf read still in flight
    registerRow.hidden = true;
    usernameLine.hidden = true;
    lock(true);
    setStatus('Checking your bar tab…');
    return;
  }

  if (s.username && !editingName) {
    registerRow.hidden = true;
    usernameLine.hidden = false;
    usernameLine.textContent = `Playing as @${s.username} — tap to change`;
    setStatus(s.nameStatus === 'success' ? 'Username minted onchain ✓' : '');
    lock(false);
    return;
  }

  // connected but no username yet (or changing it): register = onchain claim
  registerRow.hidden = false;
  usernameLine.hidden = true;
  lock(!s.username); // changing an existing name doesn't re-lock the game
  const labels: Record<string, string> = {
    idle: 'Register',
    connecting: '…',
    switching: '…',
    signing: 'Sign…',
    confirming: 'Minting…',
    success: 'Done ✓',
    error: 'Retry',
  };
  registerBtn.textContent = labels[s.nameStatus];
  registerBtn.disabled =
    s.nameStatus === 'signing' ||
    s.nameStatus === 'confirming' ||
    s.nameStatus === 'connecting' ||
    s.nameStatus === 'switching';
  if (s.nameStatus === 'error') {
    setStatus(s.nameError ?? 'Something went wrong', true);
  } else if (s.nameStatus === 'confirming') {
    setStatus('Minting your username onchain…');
  } else {
    setStatus('Pick a username — registered onchain (you pay the gas)');
  }
}

let boardView: 'all' | 'week' = 'all';

function setBoardView(view: 'all' | 'week'): void {
  boardView = view;
  $('tab-all').classList.toggle('active', view === 'all');
  $('tab-week').classList.toggle('active', view === 'week');
  if (view === 'week') onchain.refreshWeekly();
  renderBoard();
}

export function showLeaderboard(): void {
  onchain.refreshLeaderboard();
  if (boardView === 'week') onchain.refreshWeekly();
  $('board').hidden = false;
  renderBoard();
}

function render(): void {
  const s = onchain.state;

  // personal best (local + onchain) + play streak
  const best = Math.max(opts.getBest(), Number(s.myBest ?? 0n));
  const streak = getStreak();
  const streakTxt = streak >= 2 ? ` · 🔥 ${streak}-day streak` : '';
  $('intro-best').textContent =
    (best > 0 ? `Your best: ${best.toLocaleString()} — beat it!` : 'First shift behind the bar — good luck!') + streakTxt;

  // daily challenge status
  const dailyBest = getDailyBest();
  $('daily-btn').textContent = `🌞  Daily Mix #${dailyNumber()}`;
  $('daily-status').textContent =
    dailyBest > 0
      ? `Today's daily best: ${dailyBest.toLocaleString()}`
      : 'Same drinks for everyone, once a day — set the mark!';

  renderGate();

  // wallet extras (badges, leaderboard) only exist when a contract is live
  $('wallet-section').hidden = !s.enabled;
  if (!s.enabled) return;

  $<HTMLButtonElement>('board-btn').disabled = !s.address;

  // badges: shown once connected, lit when earned
  const badgeRow = $('badge-row');
  badgeRow.hidden = !s.address || s.badges === null;
  if (!badgeRow.hidden) {
    for (const c of $('badge-icons').querySelectorAll('canvas')) {
      const tier = BigInt(c.dataset.tier ?? 0);
      const earned = ((s.badges! >> tier) & 1n) === 1n;
      c.classList.toggle('locked', !earned);
    }
  }

  if (!$('board').hidden) renderBoard();
}

function renderBoard(): void {
  const s = onchain.state;
  const list = $('board-list');
  list.innerHTML = '';

  if (!s.enabled) {
    list.innerHTML = '<li class="empty">Leaderboard goes live once the contract is deployed</li>';
    return;
  }
  const board = boardView === 'week' ? s.weekly : s.leaderboard;
  const loading = boardView === 'week' ? s.weeklyLoading : s.boardLoading;
  if (board === null) {
    list.innerHTML = `<li class="empty">${loading ? 'Pouring the standings…' : 'Leaderboard unavailable — check your connection'}</li>`;
    return;
  }
  if (board.length === 0) {
    list.innerHTML =
      boardView === 'week'
        ? '<li class="empty">No scores served this week — set the pace! 🍹</li>'
        : '<li class="empty">No scores served yet — be the first! 🍹</li>';
    return;
  }
  board.forEach((e, i) => {
    const li = document.createElement('li');
    const rank = document.createElement('span');
    rank.className = 'rank';
    rank.textContent = ['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`;
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = e.name ? `@${e.name}` : `${e.player.slice(0, 6)}…${e.player.slice(-4)}`;
    if (onchain.state.address && e.player.toLowerCase() === onchain.state.address.toLowerCase()) {
      who.textContent += ' (you)';
    }
    const pts = document.createElement('span');
    pts.className = 'pts';
    pts.textContent = e.score.toLocaleString();
    li.append(rank, who, pts);
    list.appendChild(li);
  });
}
