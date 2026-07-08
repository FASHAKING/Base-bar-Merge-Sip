// DrinkTally contract config.
// Deploy contracts/src/DrinkTally.sol (see README) and paste the address here.
// While the address is the zero address, all onchain UI stays hidden and the
// game is fully playable offchain.

import { baseSepolia } from '@wagmi/core/chains';

const DEPLOYED_ADDRESS = '0x0000000000000000000000000000000000000000';

// The chain the tally contract lives on. Switch to `base` for mainnet.
export const TALLY_CHAIN = baseSepolia;

// Local override for testing without editing code:
//   localStorage.setItem('merge-sip-tally-address', '0x...')
const override =
  typeof localStorage !== 'undefined' ? localStorage.getItem('merge-sip-tally-address') : null;

export const TALLY_ADDRESS = ((override && /^0x[0-9a-fA-F]{40}$/.test(override)
  ? override
  : DEPLOYED_ADDRESS) as `0x${string}`);

export const tallyEnabled =
  TALLY_ADDRESS !== '0x0000000000000000000000000000000000000000';

// Optional RPC override for local testing (e.g. a ganache/anvil node running
// with --chain.chainId 84532):
//   localStorage.setItem('merge-sip-rpc-url', 'http://127.0.0.1:8545')
const rpcOverride =
  typeof localStorage !== 'undefined' ? localStorage.getItem('merge-sip-rpc-url') : null;

export const TALLY_RPC_URL = rpcOverride && /^https?:\/\//.test(rpcOverride) ? rpcOverride : undefined;

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
