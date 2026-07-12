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
  getPublicClient,
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
import { encodeFunctionData, parseAbiItem, keccak256, namehash, encodePacked, stringToBytes } from 'viem';
import { base, baseSepolia } from '@wagmi/core/chains';
import {
  TALLY_ADDRESS,
  TALLY_CHAIN,
  TALLY_RPC_URL,
  TALLY_DEPLOY_BLOCK,
  WEEK_OF_BLOCKS,
  tallyAbi,
} from './config/tally.ts';
import { isMiniApp } from './base.ts';
import type { OnchainState, LeaderboardEntry } from './onchain.ts';

// ERC-8021 builder-code suffix ("bc_desdbo0u", from base.dev): appended to
// every transaction's calldata so onchain activity is attributed to the app
// for Base builder rewards. Solidity ignores the extra calldata bytes.
const BUILDER_CODE_SUFFIX =
  '0x62635f64657364626f30750b0080218021802180218021802180218021' as const;

const withBuilderCode = (data: `0x${string}`): `0x${string}` =>
  (data + BUILDER_CODE_SUFFIX.slice(2)) as `0x${string}`;

// Both Base networks are configured so wallets on either can connect and be
// switched; the tally contract itself lives on TALLY_CHAIN. The RPC override
// (local testing) only applies to the active tally chain.
const config = createConfig({
  chains: [base, baseSepolia],
  connectors: [farcasterMiniApp(), injected(), baseAccount({ appName: 'Merge Sip' })],
  transports: {
    [base.id]: http(TALLY_CHAIN.id === base.id ? TALLY_RPC_URL : undefined),
    [baseSepolia.id]: http(TALLY_CHAIN.id === baseSepolia.id ? TALLY_RPC_URL : undefined),
  },
});

export function init(state: OnchainState): void {
  void reconnect(config);
  watchAccount(config, {
    onChange(account) {
      state.address = account.address ?? null;
      if (account.address) {
        void refreshMyBest(state);
        void refreshUsername(state);
        void refreshBadges(state);
        void refreshBasename(state);
        void detectCapabilities(state);
      } else {
        state.myBest = null;
        state.username = null;
        state.usernameChecked = false;
        state.badges = null;
        state.basename = null;
        state.supportsBatching = null;
      }
    },
  });
  void refreshTally(state);
  void refreshLeaderboard(state);
  setInterval(() => void refreshTally(state), 45_000);
}

// ---------------------------------------------------------------- basenames
//
// Basenames (Base's ENS names) resolve via reverse records on Base mainnet's
// L2Resolver. ENSIP-19: node = keccak(reverseNamespaceNode ‖ labelhash(addr)),
// where the namespace is "<coinType-hex>.reverse" and Base's coinType is
// 0x80000000 | 8453 = 0x80002105.

const BASENAME_L2_RESOLVER = '0xC6d566A56A1aFf6508b41f6c90ff131615583BCD';
const BASE_REVERSE_NODE = namehash('80002105.reverse');

/** Resolve the connected wallet's Basename (e.g. "alice.base.eth"), if any. */
async function refreshBasename(state: OnchainState): Promise<void> {
  const addr = state.address;
  if (!addr) return;
  try {
    const label = keccak256(stringToBytes(addr.toLowerCase().slice(2)));
    const node = keccak256(encodePacked(['bytes32', 'bytes32'], [BASE_REVERSE_NODE, label]));
    const name = await readContract(config, {
      address: BASENAME_L2_RESOLVER,
      abi: [
        {
          type: 'function',
          name: 'name',
          inputs: [{ name: 'node', type: 'bytes32' }],
          outputs: [{ name: '', type: 'string' }],
          stateMutability: 'view',
        },
      ] as const,
      functionName: 'name',
      args: [node],
      chainId: base.id,
    });
    state.basename = name || null;
  } catch {
    state.basename = null; // no basename / non-mainnet build — show the address
  }
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

async function refreshUsername(state: OnchainState): Promise<void> {
  const addr = state.address;
  if (!addr) return;
  try {
    const name = await readContract(config, {
      address: TALLY_ADDRESS,
      abi: tallyAbi,
      functionName: 'usernameOf',
      args: [addr],
      chainId: TALLY_CHAIN.id,
    });
    state.username = name || null;
  } catch {
    /* ignore */
  } finally {
    state.usernameChecked = true;
  }
}

async function refreshBadges(state: OnchainState): Promise<void> {
  const addr = state.address;
  if (!addr) return;
  try {
    state.badges = await readContract(config, {
      address: TALLY_ADDRESS,
      abi: tallyAbi,
      functionName: 'badges',
      args: [addr],
      chainId: TALLY_CHAIN.id,
    });
  } catch {
    /* ignore */
  }
}

export async function refreshLeaderboard(state: OnchainState): Promise<void> {
  if (state.boardLoading) return;
  state.boardLoading = true;
  try {
    const [players, scores, tiers, names] = await readContract(config, {
      address: TALLY_ADDRESS,
      abi: tallyAbi,
      functionName: 'getLeaderboard',
      chainId: TALLY_CHAIN.id,
    });
    state.leaderboard = players.map(
      (p, i): LeaderboardEntry => ({
        player: p,
        score: scores[i],
        tier: Number(tiers[i]),
        name: names[i],
      }),
    );
  } catch {
    /* keep the previous board */
  } finally {
    state.boardLoading = false;
  }
}

// ------------------------------------------------------------- weekly board
//
// The contract only stores the all-time top 10, so "this week" is rebuilt
// client-side from ScoreServed events. Scanned block ranges are cached in
// localStorage so subsequent opens only fetch the delta.

const scoreServedEvent = parseAbiItem(
  'event ScoreServed(address indexed player, uint256 score, uint8 tier, uint256 totalServed)',
);
const WEEKLY_CACHE_KEY = 'merge-sip-weekly';
const LOG_CHUNK = 10_000n; // public-RPC friendly getLogs range

interface WeeklyCache {
  to: string; // last block scanned (inclusive)
  events: [player: string, score: string, tier: number, block: string][];
}

function readWeeklyCache(): WeeklyCache | null {
  try {
    const raw = localStorage.getItem(WEEKLY_CACHE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as WeeklyCache;
    return typeof v.to === 'string' && Array.isArray(v.events) ? v : null;
  } catch {
    return null;
  }
}

export async function refreshWeekly(state: OnchainState): Promise<void> {
  if (state.weeklyLoading) return;
  state.weeklyLoading = true;
  try {
    const client = getPublicClient(config, { chainId: TALLY_CHAIN.id });
    if (!client) return;
    const latest = await client.getBlockNumber();
    const windowStart =
      latest > TALLY_DEPLOY_BLOCK + WEEK_OF_BLOCKS ? latest - WEEK_OF_BLOCKS : TALLY_DEPLOY_BLOCK;

    // reuse the cached scan when it overlaps this week's window
    const cache = readWeeklyCache();
    const cachedTo = cache ? BigInt(cache.to) : -1n;
    const events: WeeklyCache['events'] =
      cache && cachedTo >= windowStart
        ? cache.events.filter((e) => BigInt(e[3]) >= windowStart)
        : [];
    let from = cache && cachedTo >= windowStart ? cachedTo + 1n : windowStart;

    while (from <= latest) {
      const to = from + LOG_CHUNK - 1n > latest ? latest : from + LOG_CHUNK - 1n;
      const logs = await client.getLogs({
        address: TALLY_ADDRESS,
        event: scoreServedEvent,
        fromBlock: from,
        toBlock: to,
      });
      for (const log of logs) {
        if (log.args.player && log.args.score !== undefined) {
          events.push([
            log.args.player,
            log.args.score.toString(),
            Number(log.args.tier ?? 0),
            (log.blockNumber ?? to).toString(),
          ]);
        }
      }
      from = to + 1n;
    }

    try {
      localStorage.setItem(WEEKLY_CACHE_KEY, JSON.stringify({ to: latest.toString(), events }));
    } catch {
      /* cache is an optimization only */
    }

    // best score per player inside the window
    const best = new Map<string, { score: bigint; tier: number }>();
    for (const [player, score, tier] of events) {
      const key = player.toLowerCase();
      const s = BigInt(score);
      const cur = best.get(key);
      if (!cur || s > cur.score) best.set(key, { score: s, tier });
    }
    const top = [...best.entries()]
      .sort((a, b) => (b[1].score > a[1].score ? 1 : b[1].score < a[1].score ? -1 : 0))
      .slice(0, 10);

    // usernames: reuse the all-time board's, fetch the rest
    const known = new Map(
      (state.leaderboard ?? []).map((e) => [e.player.toLowerCase(), e.name]),
    );
    const entries = await Promise.all(
      top.map(async ([player, v]): Promise<LeaderboardEntry> => {
        let name = known.get(player) ?? '';
        if (!name) {
          try {
            name = await readContract(config, {
              address: TALLY_ADDRESS,
              abi: tallyAbi,
              functionName: 'usernameOf',
              args: [player as `0x${string}`],
              chainId: TALLY_CHAIN.id,
            });
          } catch {
            /* fall back to the address */
          }
        }
        return { player: player as `0x${string}`, score: v.score, tier: v.tier, name };
      }),
    );
    state.weekly = entries;
  } catch (e) {
    console.warn('[merge-sip] weekly board scan failed:', e);
    /* keep the previous view */
  } finally {
    state.weeklyLoading = false;
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
 * Send a contract write, walking the shared path: connect → switch chain →
 * capability detection → batched call (smart wallets, EIP-5792) or a plain
 * transaction (EOAs). The user pays their own gas either way. Progress is
 * reported through the given status setter.
 */
async function sendWrite(
  state: OnchainState,
  setStatus: (s: OnchainState, v: OnchainState['status']) => void,
  data: `0x${string}`,
  write: () => Promise<`0x${string}`>,
): Promise<void> {
  // 1. connect if needed
  if (!getAccount(config).address) {
    setStatus(state, 'connecting');
    await connect(config, { connector: pickConnector() });
  }

  // 2. make sure the wallet is on the contract's chain
  if (getAccount(config).chainId !== TALLY_CHAIN.id) {
    setStatus(state, 'switching');
    await switchChain(config, { chainId: TALLY_CHAIN.id });
  }

  // 3. capability detection (EIP-5792)
  if (state.supportsBatching === null) await detectCapabilities(state);

  setStatus(state, 'signing');
  if (state.supportsBatching) {
    const { id } = await sendCalls(config, {
      calls: [{ to: TALLY_ADDRESS, data: withBuilderCode(data) }],
    });
    setStatus(state, 'confirming');
    // waitForCallsStatus returns { status, receipts } — it does NOT throw on
    // revert. Check the outcome and any receipt statuses ourselves so a
    // reverted bundle doesn't silently pass as 'success'.
    const result = await waitForCallsStatus(config, { id });
    const bundleStatus = String(result?.status ?? '').toLowerCase();
    const receipts: Array<{ status?: string | number }> = Array.isArray(result?.receipts)
      ? result.receipts
      : [];
    const allSucceeded = receipts.every((r) => {
      const s = String(r?.status ?? '').toLowerCase();
      return s === 'success' || s === '0x1' || s === '1';
    });
    const bundleOk = bundleStatus === 'success' || bundleStatus === 'confirmed';
    if (!bundleOk || (receipts.length > 0 && !allSucceeded)) {
      throw new Error('Transaction reverted');
    }
  } else {
    const hash = await write();
    setStatus(state, 'confirming');
    const receipt = await waitForTransactionReceipt(config, {
      hash,
      chainId: TALLY_CHAIN.id,
    });
    if (receipt.status !== 'success') throw new Error('Transaction reverted');
  }
  setStatus(state, 'success');
}

/** Record the finished game onchain (win or lose). */
export async function serveScore(
  state: OnchainState,
  score: number,
  tier: number,
): Promise<void> {
  if (busy(state) || state.status === 'success') return;
  state.error = null;
  const args = [BigInt(score), tier] as const;
  try {
    await sendWrite(
      state,
      (s, v) => (s.status = v),
      encodeFunctionData({ abi: tallyAbi, functionName: 'serveScore', args }),
      () =>
        writeContract(config, {
          address: TALLY_ADDRESS,
          abi: tallyAbi,
          functionName: 'serveScore',
          args,
          chainId: TALLY_CHAIN.id,
          dataSuffix: BUILDER_CODE_SUFFIX,
        }),
    );
    void refreshTally(state);
    void refreshMyBest(state);
    void refreshBadges(state);
    void refreshLeaderboard(state);
  } catch (e) {
    state.status = 'error';
    state.error = shortError(e);
  }
}

/** Mint the player's current best as an onchain-SVG score-card NFT. */
export async function mintScoreCard(state: OnchainState): Promise<void> {
  if (
    state.mintStatus === 'connecting' ||
    state.mintStatus === 'switching' ||
    state.mintStatus === 'signing' ||
    state.mintStatus === 'confirming' ||
    state.mintStatus === 'success'
  ) {
    return;
  }
  state.mintError = null;
  try {
    await sendWrite(
      state,
      (s, v) => (s.mintStatus = v),
      encodeFunctionData({ abi: tallyAbi, functionName: 'mintScoreCard' }),
      () =>
        writeContract(config, {
          address: TALLY_ADDRESS,
          abi: tallyAbi,
          functionName: 'mintScoreCard',
          chainId: TALLY_CHAIN.id,
          dataSuffix: BUILDER_CODE_SUFFIX,
        }),
    );
  } catch (e) {
    state.mintStatus = 'error';
    state.mintError = shortError(e);
  }
}

/** Claim (or change) the player's leaderboard username. */
export async function claimUsername(state: OnchainState, name: string): Promise<void> {
  if (
    state.nameStatus === 'connecting' ||
    state.nameStatus === 'switching' ||
    state.nameStatus === 'signing' ||
    state.nameStatus === 'confirming'
  ) {
    return;
  }
  state.nameError = null;
  const clean = name.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,16}$/.test(clean)) {
    state.nameStatus = 'error';
    state.nameError = '3-16 chars: a-z, 0-9, _';
    return;
  }
  try {
    await sendWrite(
      state,
      (s, v) => (s.nameStatus = v),
      encodeFunctionData({ abi: tallyAbi, functionName: 'claimUsername', args: [clean] }),
      () =>
        writeContract(config, {
          address: TALLY_ADDRESS,
          abi: tallyAbi,
          functionName: 'claimUsername',
          args: [clean],
          chainId: TALLY_CHAIN.id,
          dataSuffix: BUILDER_CODE_SUFFIX,
        }),
    );
    state.username = clean;
    void refreshLeaderboard(state);
  } catch (e) {
    state.nameStatus = 'error';
    state.nameError = shortError(e);
  }
}

function shortError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const firstLine = msg.split('\n')[0];
  if (/rejected|denied/i.test(firstLine)) return 'Request rejected';
  return firstLine.length > 60 ? firstLine.slice(0, 57) + '…' : firstLine;
}
