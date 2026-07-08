// Headless test of the onchain UI using a mock EIP-1193 provider (EOA-style:
// no EIP-5792 capabilities, plain eth_sendTransaction).
import { chromium } from 'playwright';

const shots = process.env.SHOTS_DIR || '/tmp';
const ADDR = '0x1111111111111111111111111111111111111111';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.addInitScript(`
  localStorage.setItem('merge-sip-tally-address', '0x2222222222222222222222222222222222222222');
  let connected = false;
  const listeners = {};
  window.ethereum = {
    isMetaMask: true,
    request: async ({ method, params }) => {
      switch (method) {
        case 'eth_requestAccounts': connected = true; return ['${ADDR}'];
        case 'eth_accounts': return connected ? ['${ADDR}'] : [];
        case 'eth_chainId': return '0x14a34';
        case 'wallet_getCapabilities': throw new Error('Method not supported');
        case 'eth_sendTransaction': return '0x' + 'ab'.repeat(32);
        case 'wallet_switchEthereumChain': return null;
        default: throw new Error('mock: unhandled ' + method);
      }
    },
    on: (ev, fn) => { (listeners[ev] ||= []).push(fn); },
    removeListener: () => {},
  };
`);

await page.goto('http://localhost:5173/');
await page.waitForTimeout(2500); // let lazy wallet chunk load
await page.screenshot({ path: `${shots}/onchain-1-chip.png` });

// click the Connect chip
const chip = await page.evaluate(() => window.__game.btnWallet);
console.log('wallet chip rect:', chip);
await page.mouse.click(chip.x + chip.w / 2, chip.y + chip.h / 2);
await page.waitForTimeout(1500);
const st1 = await page.evaluate(async () => {
  const m = await import('/src/onchain.ts');
  return { address: m.state.address, batching: m.state.supportsBatching };
});
console.log('after connect:', st1);

// force game over and use the serve button
await page.evaluate(() => {
  const g = window.__game;
  g.bodies.push({ id: 999, tier: 2, x: 200, y: g.lineY + 40, vx: 0, vy: 0, r: 25, wobble: 0, spin: 0 });
  g.score = 1234;
  g.maxTierMade = 5;
  g.state = 'settle';
  g.settleTimer = 5;
});
await page.waitForTimeout(800);
await page.screenshot({ path: `${shots}/onchain-2-over.png` });

const serve = await page.evaluate(() => window.__game.btnServe);
await page.mouse.click(serve.x + serve.w / 2, serve.y + serve.h / 2);
await page.waitForTimeout(2500);
const st2 = await page.evaluate(async () => {
  const m = await import('/src/onchain.ts');
  return { status: m.state.status, error: m.state.error };
});
console.log('after serve click:', st2); // expect confirming (fake tx never mines)
await page.screenshot({ path: `${shots}/onchain-3-serving.png` });

console.log('page errors:', errors.length ? errors : 'none');
await browser.close();
