// Onchain implementation for Merge Sip, following the "Build an app on Base"
// guide (wagmi + viem) with @wagmi/core actions instead of React hooks, since
// the game is a plain-canvas app. Lazy-loaded via src/onchain.ts.
//
// Covers: wallet connection (Base App in-app wallet, Base Account, injected),
// contract reads/writes, EIP-5792 capability detection, and batched calls
// with a graceful fallback to a plain transaction for EOAs.

import {
  createConfig,
  http,
  connect,
  disconnect,
  reconnect,
  getAccount,
  watchAccount,
  readContract,
  writeContract,
  waitForTransactionReceipt,
  switchChain,
  injected,
} from '@wagmi/core';
import {
  getCapabilities,
  sendCalls,
  waitForCallsStatus,
} from '@wagmi/core/experimental';
import { baseAccount } from '@wagmi/connectors';
import { farcasterMiniApp } from '@farcaster/miniapp-wagmi-connector';
import { encodeFunctionData } from 'viem';
import { TALLY_ADDRESS, TALLY_CHAIN, TALLY_RPC_URL, tallyAbi } from './config/tally.ts';
import { isMiniApp } from './base.ts';
import type { OnchainState } from './onchain.ts';

const config = createConfig({
  chains: [TALLY_CHAIN],
  connectors: [farcasterMiniApp(), injected(), baseAccount({ appName: 'Merge Sip' })],
  transports: {
    [TALLY_CHAIN.id]: http(TALLY_RPC_URL),
  },
});

export function init(state: OnchainState): void {
  void reconnect(config);
  watchAccount(config, {
    onChange(account) {
      state.address = account.address ?? null;
      if (account.address) {
        void refreshMyBest(state);
        void detectCapabilities(state);
      } else {
        state.myBest = null;
        state.supportsBatching = null;
      }
    },
  });
  void refreshTally(state);
  setInterval(() => void refreshTally(state), 45_000);
}

// ------------------------------------------------------------------- reads

async function refreshTally(state: OnchainState): Promise<void> {
  try {
    state.totalServed = await readContract(config, {
      address: TALLY_ADDRESS,
      abi: tallyAbi,
      functionName: 'totalServed',
      chainId: TALLY_CHAIN.id,
    });
  } catch (e) {
    /* keep the last known value (may be null) — never break the game */
    console.warn('[merge-sip] tally read failed:', e);
  }
}

async function refreshMyBest(state: OnchainState): Promise<void> {
  const addr = state.address;
  if (!addr) return;
  try {
    state.myBest = await readContract(config, {
      address: TALLY_ADDRESS,
      abi: tallyAbi,
      functionName: 'bestScore',
      args: [addr],
      chainId: TALLY_CHAIN.id,
    });
  } catch {
    /* ignore */
  }
}

// EIP-5792: smart wallets report an "atomic" capability per chain; EOAs
// typically throw on wallet_getCapabilities. Check against the chain the
// contract is deployed on, not whatever chain the wallet happens to be on.
async function detectCapabilities(state: OnchainState): Promise<void> {
  try {
    const caps = await getCapabilities(config);
    const atomic = (caps as Record<number, { atomic?: { status?: string } }>)[
      TALLY_CHAIN.id
    ]?.atomic;
    state.supportsBatching = atomic?.status === 'ready' || atomic?.status === 'supported';
  } catch {
    state.supportsBatching = false;
  }
}

// ------------------------------------------------------------------ wallet

function pickConnector() {
  const connectors = config.connectors;
  if (isMiniApp()) {
    return connectors.find((c) => c.id === 'farcaster') ?? connectors[0];
  }
  const hasInjected = typeof (window as { ethereum?: unknown }).ethereum !== 'undefined';
  if (hasInjected) {
    return connectors.find((c) => c.id === 'injected') ?? connectors[0];
  }
  return connectors.find((c) => c.id === 'baseAccount') ?? connectors[0];
}

function busy(state: OnchainState): boolean {
  return (
    state.status === 'connecting' ||
    state.status === 'switching' ||
    state.status === 'signing' ||
    state.status === 'confirming'
  );
}

export async function toggleWallet(state: OnchainState): Promise<void> {
  if (busy(state)) return;
  if (state.address) {
    await disconnect(config);
    return;
  }
  state.status = 'connecting';
  state.error = null;
  try {
    await connect(config, { connector: pickConnector() });
    state.status = 'idle';
  } catch (e) {
    state.status = 'idle';
    state.error = shortError(e);
  }
}

// ------------------------------------------------------------------- write

/**
 * Record the finished game onchain. Handles connect → switch chain →
 * capability detection → batched call (smart wallets) or plain write (EOAs).
 */
export async function serveScore(
  state: OnchainState,
  score: number,
  tier: number,
): Promise<void> {
  if (busy(state) || state.status === 'success') return;
  state.error = null;

  try {
    // 1. connect if needed
    if (!getAccount(config).address) {
      state.status = 'connecting';
      await connect(config, { connector: pickConnector() });
    }

    // 2. make sure the wallet is on the contract's chain
    if (getAccount(config).chainId !== TALLY_CHAIN.id) {
      state.status = 'switching';
      await switchChain(config, { chainId: TALLY_CHAIN.id });
    }

    // 3. capability detection (EIP-5792)
    if (state.supportsBatching === null) await detectCapabilities(state);

    state.status = 'signing';
    const args = [BigInt(score), tier] as const;

    if (state.supportsBatching) {
      // Smart wallet path: submit as an atomic batch of calls.
      const { id } = await sendCalls(config, {
        calls: [
          {
            to: TALLY_ADDRESS,
            data: encodeFunctionData({ abi: tallyAbi, functionName: 'serveScore', args }),
          },
        ],
      });
      state.status = 'confirming';
      await waitForCallsStatus(config, { id });
    } else {
      // EOA fallback: a single ordinary transaction.
      const hash = await writeContract(config, {
        address: TALLY_ADDRESS,
        abi: tallyAbi,
        functionName: 'serveScore',
        args,
        chainId: TALLY_CHAIN.id,
      });
      state.status = 'confirming';
      await waitForTransactionReceipt(config, { hash, chainId: TALLY_CHAIN.id });
    }

    state.status = 'success';
    void refreshTally(state);
    void refreshMyBest(state);
  } catch (e) {
    state.status = 'error';
    state.error = shortError(e);
  }
}

function shortError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const firstLine = msg.split('\n')[0];
  if (/rejected|denied/i.test(firstLine)) return 'Request rejected';
  return firstLine.length > 60 ? firstLine.slice(0, 57) + '…' : firstLine;
}
