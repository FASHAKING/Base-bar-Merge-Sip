import { chromium } from 'playwright';

const shots = '/tmp/claude-0/-home-user-Base-bar-Merge-Sip/df2b0d5a-26ae-5e44-80b4-d2b513fb67ad/scratchpad';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto('http://localhost:5173/');
await page.waitForTimeout(800);

// force a game-over: put a stopped drink below the line and let the turn resolve
await page.evaluate(() => {
  const g = window.__game;
  g.bodies.push({ id: 999, tier: 2, x: 200, y: g.lineY + 40, vx: 0, vy: 0, r: 25, wobble: 0, spin: 0 });
  g.score = 4321;
  g.maxTierMade = 6;
  g.state = 'settle';
  g.settleTimer = 5;
});
await page.waitForTimeout(1200);
await page.screenshot({ path: `${shots}/game-5-over.png` });

// Play Again button
const r = await page.evaluate(() => window.__game.btnRestart);
await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
await page.waitForTimeout(400);
const state = await page.evaluate(() => ({
  state: window.__game.state,
  bodies: window.__game.bodies.length,
  score: window.__game.score,
  best: window.__game.best,
}));
console.log('after restart:', state);
await page.screenshot({ path: `${shots}/game-6-restart.png` });
console.log('page errors:', errors.length ? errors : 'none');
await browser.close();
