// Thin facade over the onchain layer. The game reads `state` every frame,
// while the heavy wagmi/viem implementation (src/wallet.ts) is lazy-loaded so
// the game paints instantly and sdk.actions.ready() fires without waiting on
// a large bundle.

import { tallyEnabled } from './config/tally.ts';

export type TxStatus =
  | 'idle'
  | 'connecting'
  | 'switching'
  | 'signing'
  | 'confirming'
  | 'success'
  | 'error';

export interface LeaderboardEntry {
  player: `0x${string}`;
  score: bigint;
  tier: number;
  name: string;
}

export interface OnchainState {
  enabled: boolean;
  address: `0x${string}` | null;
  basename: string | null; // Basename of the connected address (reverse lookup)
  status: TxStatus;
  error: string | null;
  totalServed: bigint | null;
  myBest: bigint | null;
  supportsBatching: boolean | null; // null = unknown yet
  username: string | null; // claimed leaderboard name
  usernameChecked: boolean; // onchain usernameOf lookup finished at least once
  nameStatus: TxStatus; // claimUsername transaction state
  nameError: string | null;
  leaderboard: LeaderboardEntry[] | null; // null = not fetched yet
  boardLoading: boolean;
  weekly: LeaderboardEntry[] | null; // this week's top scores (from events)
  fullBoard: LeaderboardEntry[] | null; // every player, ranked (from events)
  weeklyLoading: boolean;
  badges: bigint | null; // milestone bitmask (bit N = tier-N first mixed)
  mintStatus: TxStatus; // mintScoreCard transaction state
  mintError: string | null;
}

export const state: OnchainState = {
  enabled: tallyEnabled,
  address: null,
  basename: null,
  status: 'idle',
  error: null,
  totalServed: null,
  myBest: null,
  supportsBatching: null,
  username: null,
  usernameChecked: false,
  nameStatus: 'idle',
  nameError: null,
  leaderboard: null,
  boardLoading: false,
  weekly: null,
  fullBoard: null,
  weeklyLoading: false,
  badges: null,
  mintStatus: 'idle',
  mintError: null,
};

type Impl = typeof import('./wallet.ts');
let impl: Impl | null = null;

export async function initOnchain(): Promise<void> {
  if (!state.enabled) return;
  impl = await import('./wallet.ts');
  impl.init(state);
}

export function toggleWallet(): void {
  void impl?.toggleWallet(state);
}

export function serveScore(score: number, tier: number): void {
  void impl?.serveScore(state, score, tier);
}

export function claimUsername(name: string): void {
  void impl?.claimUsername(state, name);
}

export function mintScoreCard(): void {
  void impl?.mintScoreCard(state);
}

export function refreshLeaderboard(): void {
  void impl?.refreshLeaderboard(state);
}

export function refreshBoards(): void {
  void impl?.refreshBoards(state);
}

/** Called on every new game so the next run can be served again. */
export function resetTx(): void {
  const busy = (s: TxStatus) =>
    s === 'connecting' || s === 'switching' || s === 'signing' || s === 'confirming';
  if (!busy(state.status)) {
    state.status = 'idle';
    state.error = null;
  }
  if (!busy(state.mintStatus)) {
    state.mintStatus = 'idle';
    state.mintError = null;
  }
}
