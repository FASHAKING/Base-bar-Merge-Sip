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

export interface OnchainState {
  enabled: boolean;
  address: `0x${string}` | null;
  status: TxStatus;
  error: string | null;
  totalServed: bigint | null;
  myBest: bigint | null;
  supportsBatching: boolean | null; // null = unknown yet
}

export const state: OnchainState = {
  enabled: tallyEnabled,
  address: null,
  status: 'idle',
  error: null,
  totalServed: null,
  myBest: null,
  supportsBatching: null,
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

/** Called on every new game so the next run can be served again. */
export function resetTx(): void {
  const busy =
    state.status === 'connecting' ||
    state.status === 'switching' ||
    state.status === 'signing' ||
    state.status === 'confirming';
  if (!busy) {
    state.status = 'idle';
    state.error = null;
  }
}
