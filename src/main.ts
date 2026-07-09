import { Game } from './game.ts';
import { initMiniApp } from './base.ts';
import { initOnchain, state as onchainState } from './onchain.ts';
import { initUi } from './ui.ts';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const game = new Game(canvas);
// for debugging/tests
(window as unknown as { __game: Game }).__game = game;
(window as unknown as { __onchain: typeof onchainState }).__onchain = onchainState;

initUi({ getBest: () => game.bestScore });

let last = performance.now();
function loop(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  game.update(dt);
  game.render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Tell the Base App / Farcaster host we're ready (hides the splash screen),
// then bring up the onchain layer (no-op until a contract is configured).
void initMiniApp()
  .then(() => initOnchain())
  .catch((e) => console.error('[merge-sip] init failed:', e));
