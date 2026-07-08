// DrinkTally contract config.
//
// Production targets Base MAINNET. Deploy contracts/src/DrinkTally.sol (see
// README) and paste the address into ADDRESSES.base. While the active
// network's address is the zero address, all onchain UI stays hidden and the
// game is fully playable offchain.
//
// Network selection (first match wins):
//   1. localStorage 'merge-sip-network' = 'base' | 'base-sepolia'  (testing)
//   2. build env    VITE_TALLY_NETWORK  = 'base' | 'base-sepolia'  (staging builds)
//   3. default: 'base' (mainnet)

import { base, baseSepolia } from '@wagmi/core/chains';

const ADDRESSES = {
  base: '0x0000000000000000000000000000000000000000',
  'base-sepolia': '0x0000000000000000000000000000000000000000',
} as const;

type Network = keyof typeof ADDRESSES;

function isNetwork(v: unknown): v is Network {
  return v === 'base' || v === 'base-sepolia';
}

const ls = (key: string): string | null =>
  typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;

const lsNetwork = ls('merge-sip-network');
const envNetwork = import.meta.env.VITE_TALLY_NETWORK as string | undefined;

export const TALLY_NETWORK: Network = isNetwork(lsNetwork)
  ? lsNetwork
  : isNetwork(envNetwork)
    ? envNetwork
    : 'base';

export const TALLY_CHAIN = TALLY_NETWORK === 'base' ? base : baseSepolia;

// Local override for testing without editing code:
//   localStorage.setItem('merge-sip-tally-address', '0x...')
const addrOverride = ls('merge-sip-tally-address');

export const TALLY_ADDRESS = ((addrOverride && /^0x[0-9a-fA-F]{40}$/.test(addrOverride)
  ? addrOverride
  : ADDRESSES[TALLY_NETWORK]) as `0x${string}`);

export const tallyEnabled =
  TALLY_ADDRESS !== '0x0000000000000000000000000000000000000000';

// Optional RPC override for local testing (e.g. a ganache/anvil node running
// with --chain.chainId 84532):
//   localStorage.setItem('merge-sip-rpc-url', 'http://127.0.0.1:8545')
const rpcOverride = ls('merge-sip-rpc-url');

export const TALLY_RPC_URL =
  rpcOverride && /^https?:\/\//.test(rpcOverride) ? rpcOverride : undefined;

export const tallyAbi = [
  {
    type: 'function',
    name: 'totalServed',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'bestScore',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'bestTier',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'serveScore',
    inputs: [
      { name: 'score', type: 'uint256' },
      { name: 'tier', type: 'uint8' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;
