import { Game } from './game.ts';
import { initMiniApp } from './base.ts';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const game = new Game(canvas);
(window as unknown as { __game: Game }).__game = game; // for debugging/tests

let last = performance.now();
function loop(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  game.update(dt);
  game.render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Tell the Base App / Farcaster host we're ready (hides the splash screen).
void initMiniApp();
