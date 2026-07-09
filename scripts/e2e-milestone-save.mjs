// Regression: a game-over run that DOES NOT beat the score but unlocks a new
// milestone badge must still auto-save (fix for Codex review #3).
import { chromium } from 'playwright';

const TALLY = process.argv[2];
if (!TALLY) throw new Error('usage: node scripts/e2e-milestone-save.mjs <contract-address>');
// Use a clean deterministic account (index #2) with no earlier history
const ACCOUNT = '0xE11BA2b4D45Eaed5996Cd0823791E0C93114882d';

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
const mcCode = await rpc('https://sepolia.base.org', 'eth_getCode', [
  '0xcA11bde05977b3631167028862bE2a173976CA11', 'latest',
]);
await rpc('http://127.0.0.1:8545', 'evm_setAccountCode', [
  '0xcA11bde05977b3631167028862bE2a173976CA11', mcCode,
]);

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

// This account has no history: onchain best = 0, no badges. First we serve a
// modest high-score run (tier 5, score 10_000) so it has a nontrivial best
// and one badge, then we test a MILESTONE-ONLY follow-up: score 500 (well
// below the best) but tier 6 (a new badge). The auto-serve must trigger
// because a new badge is unlockable, even though the score doesn't beat.
const preBest = 10_000;
await page.click('#play-btn');
await page.waitForTimeout(500);
await page.evaluate((score) => {
  const g = window.__game;
  g.bodies.push({ id: 999, tier: 2, x: 200, y: g.lineY + 40, vx: 0, vy: 0, r: 25, wobble: 0, spin: 0 });
  g.score = score;
  g.maxTierMade = 5;
  g.state = 'settle';
  g.settleTimer = 5;
}, preBest);
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(500);
  const s = await page.evaluate(() => window.__onchain.status);
  if (s === 'success' || s === 'error') break;
}
await page.evaluate(() => {
  window.__game.reset();
});
await page.waitForTimeout(1000);

const pre = await page.evaluate(() => ({
  myBest: window.__onchain.myBest?.toString(),
  badges: window.__onchain.badges?.toString(2) ?? null,
}));
console.log('before milestone-only run:', pre);

// Milestone-only run: score is way under the best, tier 6 (a new badge)
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
console.log('after milestone-only run:', result);
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
if (result?.status !== 'success') {
  console.error('FAIL: milestone-only run was not auto-saved');
  process.exit(1);
}
console.log('OK: milestone-only run auto-saved');
