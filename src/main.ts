import { Game } from './game.ts';
import { initMiniApp } from './base.ts';
import { initOnchain, state as onchainState } from './onchain.ts';
import { initUi } from './ui.ts';
import { inject } from '@vercel/analytics';

// Initialize Vercel Web Analytics
inject();

// Warm up the display font so canvas text picks it up as soon as it loads
// (frames render continuously, so late arrival is seamless).
try {
  void document.fonts.load("600 16px 'Fredoka'");
  void document.fonts.load("bold 16px 'Fredoka'");
} catch {
  /* font API unavailable — system fallback is fine */
}

const canvas = document.getElementById('game') as HTMLCanvasElement;
const game = new Game(canvas);
// for debugging/tests
(window as unknown as { __game: Game }).__game = game;
(window as unknown as { __onchain: typeof onchainState }).__onchain = onchainState;

initUi({
  getBest: () => game.bestScore,
  startDaily: () => game.setMode('daily'),
});

// While a fullscreen overlay (intro / leaderboard) covers the canvas, the
// game is idle behind a blur — skip update+render to save battery and CPU,
// but keep one frame painted underneath. The rAF keeps ticking cheaply.
const intro = document.getElementById('intro') as HTMLElement;
const board = document.getElementById('board') as HTMLElement;
const overlayUp = (): boolean => !intro.hidden || !board.hidden;

let last = performance.now();
let paintedIdle = false;
function loop(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (overlayUp() && !document.hidden) {
    // paint a single frame so the blurred backdrop isn't blank, then idle
    if (!paintedIdle) {
      game.render();
      paintedIdle = true;
    }
  } else if (!document.hidden) {
    paintedIdle = false;
    game.update(dt);
    game.render();
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Tell the Base App / Farcaster host we're ready (hides the splash screen),
// then bring up the onchain layer (no-op until a contract is configured).
void initMiniApp()
  .then(() => initOnchain())
  .catch((e) => console.error('[merge-sip] init failed:', e));
