import { chromium } from 'playwright';
import fs from 'node:fs';

const base = process.argv[2] || 'http://localhost:5173';
const outDir = '/home/user/Base-bar-Merge-Sip/public';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();
await page.goto(base + '/assetgen.html');
await page.waitForFunction('window.__done === true', { timeout: 15000 });

for (const id of ['icon', 'splash', 'hero']) {
  const data = await page.evaluate(
    (id) => document.getElementById(id).toDataURL('image/png').split(',')[1],
    id,
  );
  fs.writeFileSync(`${outDir}/${id}.png`, Buffer.from(data, 'base64'));
  console.log('wrote', id + '.png');
}
await browser.close();
