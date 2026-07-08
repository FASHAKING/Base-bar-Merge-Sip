// Deploy DrinkTally with viem — a no-Foundry alternative to `forge create`.
//
//   node scripts/compile-contract.mjs
//   PRIVATE_KEY=0x... node scripts/deploy.mjs [--network base-sepolia|base|local]
//
// For local testing, `npx ganache --chain.chainId 84532` and use --network local
// (any of ganache's printed private keys works as PRIVATE_KEY).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWalletClient, createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifact = JSON.parse(
  fs.readFileSync(path.join(root, 'contracts/out/DrinkTally.json'), 'utf8'),
);

const networkArg = process.argv.includes('--network')
  ? process.argv[process.argv.indexOf('--network') + 1]
  : 'base-sepolia';

const networks = {
  'base-sepolia': { chain: baseSepolia, url: 'https://sepolia.base.org' },
  base: { chain: base, url: 'https://mainnet.base.org' },
  local: { chain: { ...baseSepolia, name: 'Local' }, url: 'http://127.0.0.1:8545' },
};
const net = networks[networkArg];
if (!net) throw new Error(`unknown network: ${networkArg}`);

const pk = process.env.PRIVATE_KEY;
if (!pk) throw new Error('Set PRIVATE_KEY env var (never commit it)');

const account = privateKeyToAccount(pk);
const wallet = createWalletClient({ account, chain: net.chain, transport: http(net.url) });
const client = createPublicClient({ chain: net.chain, transport: http(net.url) });

console.log(`Deployer: ${account.address}`);
const hash = await wallet.deployContract({
  abi: artifact.abi,
  bytecode: artifact.bytecode,
});
console.log(`Transaction hash: ${hash}`);
const receipt = await client.waitForTransactionReceipt({ hash });
console.log(`Deployed to: ${receipt.contractAddress}`);

const total = await client.readContract({
  address: receipt.contractAddress,
  abi: artifact.abi,
  functionName: 'totalServed',
});
console.log(`totalServed() = ${total}  (expected 0)`);
console.log(`\nNext: paste the address into DEPLOYED_ADDRESS in src/config/tally.ts`);
