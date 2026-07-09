// DOM overlays: intro screen (username claiming, personal best) and the
// onchain leaderboard. The game itself stays pure canvas; these are menus.

import * as onchain from './onchain.ts';
import { drawDrink } from './drinks.ts';

const BADGE_TIERS = [5, 6, 7, 8, 9];

interface UiOptions {
  getBest: () => number;
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

let opts: UiOptions;

export function initUi(options: UiOptions): void {
  opts = options;

  $('play-btn').addEventListener('click', () => {
    $('intro').hidden = true;
  });

  $('board-btn').addEventListener('click', showLeaderboard);
  $('board-close').addEventListener('click', () => {
    $('board').hidden = true;
  });

  $('connect-btn').addEventListener('click', () => onchain.toggleWallet());
  $('claim-btn').addEventListener('click', claim);
  $('name-input').addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') claim();
  });

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

function claim(): void {
  const input = $<HTMLInputElement>('name-input');
  onchain.claimUsername(input.value);
}

export function showLeaderboard(): void {
  onchain.refreshLeaderboard();
  $('board').hidden = false;
  renderBoard();
}

function render(): void {
  const s = onchain.state;

  // personal best (local + onchain)
  const best = Math.max(opts.getBest(), Number(s.myBest ?? 0n));
  $('intro-best').textContent = best > 0 ? `Your best: ${best.toLocaleString()} — beat it!` : 'First shift behind the bar — good luck!';

  // wallet section only exists when a contract is configured
  $('wallet-section').hidden = !s.enabled;
  if (!s.enabled) return;

  const connectBtn = $<HTMLButtonElement>('connect-btn');
  if (s.address) {
    connectBtn.textContent = `Connected: ${s.address.slice(0, 6)}…${s.address.slice(-4)} (tap to disconnect)`;
  } else {
    connectBtn.textContent = s.status === 'connecting' ? 'Connecting…' : 'Connect Wallet';
  }

  const nameLine = $('name-line');
  const claimRow = $('claim-row');
  const nameStatus = $('name-status');
  const claimBtn = $<HTMLButtonElement>('claim-btn');

  if (!s.address) {
    nameLine.hidden = true;
    claimRow.hidden = true;
    nameStatus.textContent = 'Connect to claim a username & join the leaderboard';
    nameStatus.classList.remove('error');
    return;
  }

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

  if (s.username && s.nameStatus !== 'error') {
    nameLine.hidden = false;
    nameLine.textContent = `Playing as @${s.username}`;
    claimRow.hidden = true;
    nameStatus.textContent =
      s.nameStatus === 'success' ? 'Username minted onchain ✓' : 'Scores you serve will carry this name';
    nameStatus.classList.remove('error');
    return;
  }

  nameLine.hidden = true;
  claimRow.hidden = false;
  const labels: Record<string, string> = {
    idle: 'Claim',
    connecting: '…',
    switching: '…',
    signing: 'Sign…',
    confirming: 'Minting…',
    success: 'Done ✓',
    error: 'Retry',
  };
  claimBtn.textContent = labels[s.nameStatus];
  claimBtn.disabled =
    s.nameStatus === 'signing' || s.nameStatus === 'confirming' || s.nameStatus === 'connecting';
  nameStatus.classList.toggle('error', s.nameStatus === 'error');
  nameStatus.textContent =
    s.nameStatus === 'error'
      ? (s.nameError ?? 'Something went wrong')
      : 'Claim a username onchain (you pay the gas) — it shows on the leaderboard';

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
  if (s.leaderboard === null) {
    list.innerHTML = `<li class="empty">${s.boardLoading ? 'Pouring the standings…' : 'Leaderboard unavailable — check your connection'}</li>`;
    return;
  }
  if (s.leaderboard.length === 0) {
    list.innerHTML = '<li class="empty">No scores served yet — be the first! 🍹</li>';
    return;
  }
  s.leaderboard.forEach((e, i) => {
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
