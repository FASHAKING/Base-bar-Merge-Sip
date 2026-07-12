// Full end-to-end test of the onchain flow against a real local chain:
//   1. npx ganache --chain.chainId 84532 --wallet.deterministic
//   2. node scripts/compile-contract.mjs && PRIVATE_KEY=<ganache key> node scripts/deploy.mjs --network local
//   3. node scripts/e2e-local-chain.mjs <deployed-address>
//
// The mock wallet forwards every RPC request to the local node (ganache signs
// for its unlocked accounts), except capability discovery, so the game takes
// the real EOA write path end to end: connect -> sign -> confirm -> reads.
import { chromium } from 'playwright';

const TALLY = process.argv[2];
if (!TALLY) throw new Error('usage: node scripts/e2e-local-chain.mjs <contract-address>');
const shots = process.env.SHOTS_DIR || '/tmp';
const ACCOUNT = '0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1'; // ganache deterministic #0

// wagmi batches reads through Multicall3, which doesn't exist on a fresh
// ganache — copy its bytecode from real Base Sepolia to the canonical address.
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}
const mcCode = await rpc('https://sepolia.base.org', 'eth_getCode', [MULTICALL3, 'latest']);
await rpc('http://127.0.0.1:8545', 'evm_setAccountCode', [MULTICALL3, mcCode]);
console.log(`seeded Multicall3 (${(mcCode.length - 2) / 2} bytes) into local chain`);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.addInitScript(`
  localStorage.setItem('merge-sip-network', 'base-sepolia');
  localStorage.setItem('merge-sip-tally-address', '${TALLY}');
  localStorage.setItem('merge-sip-rpc-url', 'http://127.0.0.1:8545');
  let connected = false;
  let id = 1;
  async function rpc(method, params) {
    const res = await fetch('http://127.0.0.1:8545', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: id++, method, params: params ?? [] }),
    });
    const body = await res.json();
    if (body.error) {
      const err = new Error(body.error.message);
      err.code = body.error.code; // connectors switch on JSON-RPC error codes
      throw err;
    }
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
          // a real wallet estimates gas and fills fee fields itself; do the
          // same (ganache's 90k default gas limit is too low for a first
          // serveScore, and its tiny base fee rejects viem's default tip)
          const est = await rpc('eth_estimateGas', [params[0]]);
          const gas = '0x' + Math.ceil(parseInt(est, 16) * 1.2).toString(16);
          const tx = { ...params[0], gas, maxFeePerGas: '0x77359400', maxPriorityFeePerGas: '0x1' };
          return rpc(method, [tx]);
        }
        default: return rpc(method, params); // forward to the local node
      }
    },
    on: () => {},
    removeListener: () => {},
  };
`);

await page.goto('http://localhost:5173/');
await page.waitForTimeout(2500);

// tally read from chain should already show
const tally0 = await page.evaluate(() => window.__onchain.totalServed?.toString());
console.log('initial totalServed read by game:', tally0);

// intro screen: connect + claim a username (auto-connects inside the flow)
await page.click('#connect-btn');
await page.waitForTimeout(1200);
let claimed = await page.evaluate(() => ({
  status: 'success',
  username: window.__onchain.username,
  err: null,
}));
if (!claimed.username) {
  const name = 'sipper_' + Math.floor(Math.random() * 10000);
  await page.fill('#username-input', name);
  await page.click('#register-btn');
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(500);
    claimed = await page.evaluate(() => ({
      status: window.__onchain.nameStatus,
      username: window.__onchain.username,
      err: window.__onchain.nameError,
    }));
    if (claimed.status === 'success' || claimed.status === 'error') break;
  }
}
console.log('username claim:', claimed);
await page.screenshot({ path: `${shots}/e2e-intro.png` });

// start the game
await page.click('#play-btn');
await page.waitForTimeout(500);

// force game over with a NEW BEST — the save must start automatically
const prevBest = await page.evaluate(() => Number(window.__onchain.myBest ?? 0));
await page.evaluate((newScore) => {
  const g = window.__game;
  g.bodies.push({ id: 999, tier: 2, x: 200, y: g.lineY + 40, vx: 0, vy: 0, r: 25, wobble: 0, spin: 0 });
  g.score = newScore;
  g.maxTierMade = 8;
  g.state = 'settle';
  g.settleTimer = 5;
}, prevBest + 5000);

// no clicks: wait for the auto-serve to complete
let final = null;
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(500);
  final = await page.evaluate(() => ({
    status: window.__onchain.status,
    error: window.__onchain.error,
    totalServed: window.__onchain.totalServed?.toString(),
    myBest: window.__onchain.myBest?.toString(),
  }));
  if (final.status === 'success' || final.status === 'error') break;
}
console.log('auto-serve (no click):', final);
await page.screenshot({ path: `${shots}/e2e-saved.png` });

// mint the score card NFT
const mint = await page.evaluate(() => window.__game.btnMint);
await page.mouse.click(mint.x + mint.w / 2, mint.y + mint.h / 2);
let minted = null;
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(500);
  minted = await page.evaluate(() => ({
    status: window.__onchain.mintStatus,
    error: window.__onchain.mintError,
  }));
  if (minted.status === 'success' || minted.status === 'error') break;
}
console.log('mint score card:', minted);
await page.screenshot({ path: `${shots}/e2e-minted.png` });

// leaderboard from the game-over panel
const lb = await page.evaluate(() => window.__game.btnBoard);
await page.mouse.click(lb.x + lb.w / 2, lb.y + lb.h / 2);
await page.waitForTimeout(1500);
const boardText = await page.evaluate(() =>
  [...document.querySelectorAll('#board-list li')].map((li) => li.textContent),
);
console.log('leaderboard overlay:', boardText);
await page.screenshot({ path: `${shots}/e2e-leaderboard.png` });

console.log('page errors:', errors.length ? errors : 'none');
await browser.close();
if (final?.status !== 'success' || claimed?.status !== 'success' || minted?.status !== 'success') {
  process.exit(1);
}
