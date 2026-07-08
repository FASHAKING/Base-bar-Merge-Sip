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
    if (body.error) throw new Error(body.error.message);
    return body.result;
  }
  window.ethereum = {
    request: async ({ method, params }) => {
      switch (method) {
        case 'eth_requestAccounts': connected = true; return ['${ACCOUNT}'];
        case 'eth_accounts': return connected ? ['${ACCOUNT}'] : [];
        case 'wallet_getCapabilities': throw new Error('Method not supported');
        case 'wallet_switchEthereumChain': return null;
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

// connect
const chip = await page.evaluate(() => window.__game.btnWallet);
await page.mouse.click(chip.x + chip.w / 2, chip.y + chip.h / 2);
await page.waitForTimeout(1500);

// force game over with a score, then serve it onchain
await page.evaluate(() => {
  const g = window.__game;
  g.bodies.push({ id: 999, tier: 2, x: 200, y: g.lineY + 40, vx: 0, vy: 0, r: 25, wobble: 0, spin: 0 });
  g.score = 9876;
  g.maxTierMade = 8;
  g.state = 'settle';
  g.settleTimer = 5;
});
await page.waitForTimeout(800);
const serve = await page.evaluate(() => window.__game.btnServe);
await page.mouse.click(serve.x + serve.w / 2, serve.y + serve.h / 2);

// wait for success
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
console.log('final state:', final);
await page.screenshot({ path: `${shots}/e2e-saved.png` });
console.log('page errors:', errors.length ? errors : 'none');
await browser.close();
if (final?.status !== 'success') process.exit(1);
