// Regression: a game-over run that DOES NOT beat the score but unlocks a new
// milestone badge must still auto-save (Codex review #3).
//
// Self-contained: deploys a fresh DrinkTally and uses a clean player account,
// so it is deterministic no matter what state the local chain already holds.
//
//   npx ganache --chain.chainId 84532 --wallet.deterministic   (running)
//   node scripts/compile-contract.mjs
//   npm run dev
//   node scripts/e2e-milestone-save.mjs
import { chromium } from 'playwright';
import { createWalletClient, createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import fs from 'node:fs';

const RPC = 'http://127.0.0.1:8545';
// deterministic #3 — a clean player with no prior best/badges
const PLAYER = '0x22d491Bde2303f2f43325b2108D26f1eAbA1e32b';

async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const b = await res.json();
  if (b.error) throw new Error(`${method}: ${b.error.message}`);
  return b.result;
}

// fresh contract deploy (from deterministic #0)
const { abi, bytecode } = JSON.parse(fs.readFileSync('contracts/out/DrinkTally.json', 'utf8'));
const t = http(RPC);
const pub = createPublicClient({ chain: baseSepolia, transport: t });
const deployer = createWalletClient({
  account: privateKeyToAccount('0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d'),
  chain: baseSepolia,
  transport: t,
});
const dh = await deployer.deployContract({ abi, bytecode });
const TALLY = (await pub.waitForTransactionReceipt({ hash: dh })).contractAddress;
console.log('fresh contract:', TALLY);

// Multicall3 for wagmi's batched reads
const mc = '0xcA11bde05977b3631167028862bE2a173976CA11';
const mcCode = await rpc('https://sepolia.base.org', 'eth_getCode', [mc, 'latest']);
await rpc(RPC, 'evm_setAccountCode', [mc, mcCode]);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.addInitScript(`
  localStorage.setItem('merge-sip-network', 'base-sepolia');
  localStorage.setItem('merge-sip-tally-address', '${TALLY}');
  localStorage.setItem('merge-sip-rpc-url', '${RPC}');
  let connected = false; let id = 1;
  async function rpc(m, p) {
    const res = await fetch('${RPC}', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: id++, method: m, params: p ?? [] }),
    });
    const body = await res.json();
    if (body.error) { const e = new Error(body.error.message); e.code = body.error.code; throw e; }
    return body.result;
  }
  window.ethereum = {
    request: async ({ method, params }) => {
      switch (method) {
        case 'eth_requestAccounts': connected = true; return ['${PLAYER}'];
        case 'eth_accounts': return connected ? ['${PLAYER}'] : [];
        case 'wallet_requestPermissions': connected = true; return [{ parentCapability: 'eth_accounts' }];
        case 'wallet_getCapabilities': throw new Error('Method not supported');
        case 'wallet_switchEthereumChain': return null;
        case 'eth_sendTransaction': {
          const est = await rpc('eth_estimateGas', [params[0]]);
          const gas = '0x' + Math.ceil(parseInt(est, 16) * 1.2).toString(16);
          const tx = { ...params[0], gas, maxFeePerGas: '0x77359400', maxPriorityFeePerGas: '0x1' };
          return rpc(method, [tx]);
        }
        default: return rpc(method, params);
      }
    },
    on: () => {}, removeListener: () => {},
  };
`);

await page.goto('http://localhost:5173/');
await page.waitForTimeout(2500);
await page.click('#connect-btn');
await page.waitForTimeout(1500);

// Establish a nontrivial best (tier 5, score 10_000) + badge 5.
await page.click('#play-btn');
await page.waitForTimeout(400);
await page.evaluate(() => {
  const g = window.__game;
  g.bodies.push({ id: 999, tier: 2, x: 200, y: g.lineY + 40, vx: 0, vy: 0, r: 25, wobble: 0, spin: 0 });
  g.score = 10000;
  g.maxTierMade = 5;
  g.state = 'settle';
  g.settleTimer = 5;
});
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(500);
  const s = await page.evaluate(() => window.__onchain.status);
  if (s === 'success' || s === 'error') break;
}
await page.evaluate(() => window.__game.reset());
await page.waitForTimeout(1000);

const pre = await page.evaluate(() => ({
  myBest: window.__onchain.myBest?.toString(),
  badges: window.__onchain.badges?.toString(2) ?? null,
}));
console.log('before milestone-only run:', pre, '(expect best 10000, badges 100000)');

// Milestone-only run: score 500 (well under best), tier 6 (a fresh badge).
await page.evaluate(() => {
  const g = window.__game;
  g.bodies.push({ id: 999, tier: 2, x: 200, y: g.lineY + 40, vx: 0, vy: 0, r: 25, wobble: 0, spin: 0 });
  g.score = 500;
  g.maxTierMade = 6;
  g.state = 'settle';
  g.settleTimer = 5;
});

let result = null;
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(500);
  result = await page.evaluate(() => ({
    status: window.__onchain.status,
    error: window.__onchain.error,
    badges: window.__onchain.badges?.toString(2) ?? null,
  }));
  if (result.status === 'success' || result.status === 'error') break;
}
console.log('after milestone-only run:', result, '(expect success, badges 1100000)');
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
if (result?.status !== 'success') {
  console.error('FAIL: milestone-only run was not auto-saved');
  process.exit(1);
}
console.log('OK: milestone-only run auto-saved');
