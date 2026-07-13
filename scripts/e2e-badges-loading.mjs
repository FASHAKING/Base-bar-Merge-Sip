// Every finished round auto-serves onchain (no tap): even a below-best,
// non-milestone run fires serveScore so the global tally always grows. This
// verifies that behavior with the badge cache null (read pending/failed).
//
// Self-contained: deploys a fresh DrinkTally so it is deterministic.
import { chromium } from 'playwright';
import { createWalletClient, createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import fs from 'node:fs';

const RPC = 'http://127.0.0.1:8545';
const ACCOUNT = '0xE11BA2b4D45Eaed5996Cd0823791E0C93114882d'; // deterministic #2

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

const { abi, bytecode } = JSON.parse(fs.readFileSync('contracts/out/DrinkTally.json', 'utf8'));
const pub = createPublicClient({ chain: baseSepolia, transport: http(RPC) });
const deployer = createWalletClient({
  account: privateKeyToAccount('0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d'),
  chain: baseSepolia,
  transport: http(RPC),
});
const dh = await deployer.deployContract({ abi, bytecode });
const TALLY = (await pub.waitForTransactionReceipt({ hash: dh })).contractAddress;
console.log('fresh contract:', TALLY);

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
  localStorage.setItem('merge-sip-rpc-url', 'http://127.0.0.1:8545');
  let connected = false; let id = 1;
  async function rpc(m, p) {
    const res = await fetch('http://127.0.0.1:8545', {
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
        case 'eth_requestAccounts': connected = true; return ['${ACCOUNT}'];
        case 'eth_accounts': return connected ? ['${ACCOUNT}'] : [];
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

// the game is locked until a username is registered (onchain claim)
if (!(await page.evaluate(() => window.__onchain.username))) {
  await page.fill('#username-input', 'tester_' + Math.floor(Math.random() * 10000));
  await page.click('#register-btn');
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(500);
    const s = await page.evaluate(() => window.__onchain.nameStatus);
    if (s === 'success' || s === 'error') break;
  }
}

// Establish a best of 5000 first, so the later run's low score can't be the
// reason it saves — a badge would be the only trigger.
await page.click('#play-btn');
await page.waitForTimeout(400);
await page.evaluate(() => {
  const g = window.__game;
  g.bodies.push({ id: 999, tier: 2, x: 200, y: g.lineY + 40, vx: 0, vy: 0, r: 25, wobble: 0, spin: 0 });
  g.score = 5000;
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
await page.waitForTimeout(1500);

// simulate the badge read never resolving
await page.evaluate(() => { window.__onchain.badges = null; });

// below-best (300 << 5000) tier-6 game over — with badges unknown
await page.evaluate(() => {
  const g = window.__game;
  g.bodies.push({ id: 999, tier: 2, x: 200, y: g.lineY + 40, vx: 0, vy: 0, r: 25, wobble: 0, spin: 0 });
  g.score = 300;
  g.maxTierMade = 6;
  g.state = 'settle';
  g.settleTimer = 5;
  window.__onchain.badges = null; // keep it null through settle
});

// let the turn resolve into game over; re-null badges in case a refresh landed
await page.waitForTimeout(2500);
await page.evaluate(() => { window.__onchain.badges = null; });
await page.waitForTimeout(600);

// wait for the auto-serve transaction to resolve
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(500);
  const s = await page.evaluate(() => window.__onchain.status);
  if (s === 'success' || s === 'error') break;
}
const res = await page.evaluate(() => ({
  status: window.__onchain.status,
  error: window.__onchain.error,
  servedByMe: window.__onchain.servedByMe,
}));
console.log('null-badges below-best tier-6 run:', res);

const autoServed = res.status === 'success' && res.servedByMe > 0;
console.log('auto-served every round (success):', autoServed);
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
if (!autoServed) {
  console.error('FAIL');
  process.exit(1);
}
console.log('OK: every finished round auto-serves onchain regardless of best/badge');
