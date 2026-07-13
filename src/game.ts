// Merge Sip — beach-bar shuffleboard merge game.
// Flick drinks up the sand board; identical drinks merge into the next tier.

import { DRINKS, MAX_TIER, drawDrink, drawWild, WILD_TIER, WILD_RADIUS_FRAC } from './drinks.ts';
import { sfx } from './sfx.ts';
import { haptic, shareScore, openExternal } from './base.ts';
import { TALLY_EXPLORER } from './config/tally.ts';
import * as onchain from './onchain.ts';
import { showLeaderboard, getUsername } from './ui.ts';
import { shareToX } from './share.ts';
import {
  bumpStreak,
  dailyNumber,
  dailyRng,
  getDailyBest,
  setDailyBest,
  parseChallenge,
  type Challenge,
} from './modes.ts';

interface Body {
  id: number;
  tier: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  wobble: number;
  spin: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

interface FloatText {
  x: number;
  y: number;
  text: string;
  life: number;
  color: string;
}

interface Ring {
  x: number;
  y: number;
  r: number;
  maxR: number;
  life: number;
  color: string;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type State = 'aim' | 'settle' | 'over';

// Display font for all canvas text (webfont with system fallback).
const FONT = "'Fredoka', 'Trebuchet MS', sans-serif";

const SPAWN_WEIGHTS = [28, 24, 18, 13, 9]; // tiers 0..4, always available
const BEST_KEY = 'merge-sip-best';
// Widest the stage may get relative to window height (phone-portrait feel).
const MAX_STAGE_AR = 0.62;
// Chain merges within this window multiply points (capped at COMBO_MAX).
const COMBO_WINDOW = 2.2;
const COMBO_MAX = 5;
// Wildcard shaker odds per hand, once the player has mixed a tier-3 drink.
const WILD_CHANCE = 0.04;
// Serving a to-go order has the barback clear this many small drinks.
const ORDER_CLEARS = 3;

export class Game {
  private ctx: CanvasRenderingContext2D;
  private W = 0; // stage width (<= window width on wide screens)
  private H = 0;
  private fullW = 0; // real window width, for background/letterboxing
  private offX = 0; // horizontal offset centering the stage in the window

  // pre-rendered static layers, rebuilt only on resize (see buildLayers).
  // Blitting these each frame avoids re-running expensive gradients, 60
  // sand-grain arcs, and a large shadowBlur every single frame.
  private bgLayer: HTMLCanvasElement | null = null;
  private boardLayer: HTMLCanvasElement | null = null;
  private vignetteLayer: HTMLCanvasElement | null = null;

  // board geometry (CSS px)
  private inner: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private frame: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private lineY = 0;
  private launchY = 0;

  private bodies: Body[] = [];
  private particles: Particle[] = [];
  private floats: FloatText[] = [];
  private rings: Ring[] = [];
  private nextId = 1;

  private state: State = 'aim';
  private currentTier = 0;
  private nextTier = 0;
  private aimX = 0;
  private settleTimer = 0;

  private score = 0;
  private best = 0;
  private maxTierMade = 0;
  private orderTier = 3;
  private orderFlash = 0;
  private launches = 0;
  private comboCount = 0;
  private comboTimer = 0;

  // free play or the seeded daily challenge
  private mode: 'free' | 'daily' = 'free';
  private rng: () => number = Math.random;
  // score to beat when the app was opened from a challenge link
  private challenge: Challenge | null = parseChallenge();

  // input
  private dragging = false;

  // button hit areas
  private btnRestart: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private btnShare: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private btnServe: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private btnWallet: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private btnBoard: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private btnShareX: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private btnMint: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private btnActivity: Rect = { x: 0, y: 0, w: 0, h: 0 };

  /** Personal best (this device), shown as the milestone to beat. */
  get bestScore(): number {
    return this.best;
  }

  /**
   * Switch between free play and the seeded daily challenge. Picking the
   * daily always deals a fresh (deterministic) run; returning to free play
   * only resets when actually leaving the daily.
   */
  setMode(mode: 'free' | 'daily'): void {
    const changed = this.mode !== mode;
    this.mode = mode;
    this.rng = mode === 'daily' ? dailyRng() : Math.random;
    if (mode === 'daily' || changed) this.reset();
  }

  private time = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.best = Number(safeGet(BEST_KEY) || 0);
    this.resize();
    this.reset();

    window.addEventListener('resize', () => this.resize());
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointercancel', () => (this.dragging = false));
  }

  // ---------------------------------------------------------------- layout

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const oldInner = { ...this.inner };
    // The game is portrait-first (phone mini app). On wide screens, clamp the
    // stage to a phone-like column centered in the window; everything is
    // drawn/hit-tested in stage coordinates and shifted right by offX.
    this.fullW = w;
    const stageW = Math.min(w, Math.max(h * MAX_STAGE_AR, 380));
    this.offX = (w - stageW) / 2;
    this.W = stageW;
    this.H = h;

    const hudH = Math.max(100, h * 0.13);
    const chainH = Math.max(54, h * 0.075);
    const margin = Math.max(8, stageW * 0.025);
    const frameT = Math.max(10, stageW * 0.035);

    this.frame = { x: margin, y: hudH, w: stageW - margin * 2, h: h - hudH - chainH - 8 };
    this.inner = {
      x: this.frame.x + frameT,
      y: this.frame.y + frameT,
      w: this.frame.w - frameT * 2,
      h: this.frame.h - frameT * 2,
    };
    this.lineY = this.inner.y + this.inner.h * 0.7;
    this.launchY = this.inner.y + this.inner.h * 0.86;

    // remap existing bodies into the new inner rect
    if (oldInner.w > 0 && this.bodies.length) {
      for (const b of this.bodies) {
        b.x = this.inner.x + ((b.x - oldInner.x) / oldInner.w) * this.inner.w;
        b.y = this.inner.y + ((b.y - oldInner.y) / oldInner.h) * this.inner.h;
        b.r = this.radius(b.tier);
      }
    }
    this.aimX = this.inner.x + this.inner.w / 2;
    this.buildLayers();
  }

  /** Bake the static scene layers to offscreen canvases (once per resize). */
  private buildLayers(): void {
    if (this.W <= 0 || this.H <= 0) return;
    this.bgLayer = makeLayer(this.fullW, this.H, (c) => this.renderBackdropStatic(c));
    this.boardLayer = makeLayer(this.W, this.H, (c) => this.renderBoardStatic(c));
    this.vignetteLayer = makeLayer(this.fullW, this.H, (c) => {
      const v = c.createRadialGradient(
        this.fullW / 2,
        this.H * 0.45,
        Math.min(this.fullW, this.H) * 0.45,
        this.fullW / 2,
        this.H * 0.45,
        Math.max(this.fullW, this.H) * 0.75,
      );
      v.addColorStop(0, 'rgba(70, 40, 10, 0)');
      v.addColorStop(1, 'rgba(70, 40, 10, 0.14)');
      c.fillStyle = v;
      c.fillRect(0, 0, this.fullW, this.H);
    });
  }

  private radius(tier: number): number {
    const frac = tier === WILD_TIER ? WILD_RADIUS_FRAC : DRINKS[tier].radiusFrac;
    return frac * this.inner.w;
  }

  /** Draw either a regular drink or the wildcard shaker. */
  private drawPiece(
    ctx: CanvasRenderingContext2D,
    tier: number,
    x: number,
    y: number,
    r: number,
    wobble = 0,
  ): void {
    if (tier === WILD_TIER) drawWild(ctx, x, y, r, wobble, this.time);
    else drawDrink(ctx, tier, x, y, r, wobble);
  }

  private reset(): void {
    // every daily attempt replays the same deterministic hand
    if (this.mode === 'daily') this.rng = dailyRng();
    this.bodies = [];
    this.particles = [];
    this.floats = [];
    this.rings = [];
    this.score = 0;
    this.maxTierMade = 0;
    this.orderTier = 3;
    this.orderFlash = 0;
    this.launches = 0;
    this.comboCount = 0;
    this.comboTimer = 0;
    this.currentTier = this.spawnTier();
    this.nextTier = this.spawnTier();
    this.aimX = this.inner.x + this.inner.w / 2;
    this.state = 'aim';
    onchain.resetTx();
  }

  private spawnTier(): number {
    // Rare wildcard shaker, once the player knows the ropes (mixed tier 3+).
    if (this.maxTierMade >= 3 && this.rng() < WILD_CHANCE) return WILD_TIER;

    // The dealer gets meaner as you progress: once you've mixed high tiers,
    // big drinks start showing up in your hand — they crowd the board and
    // force awkward gaps.
    const weights = [...SPAWN_WEIGHTS];
    if (this.maxTierMade >= 5) weights.push(8); // tier 5 (Blueberry Breeze)
    if (this.maxTierMade >= 6) weights.push(6); // tier 6 (Mojito Royale)
    if (this.maxTierMade >= 8) weights.push(4); // tier 7 (Berry Colada)

    const total = weights.reduce((a, b) => a + b, 0);
    let roll = this.rng() * total;
    for (let i = 0; i < weights.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return i;
    }
    return 0;
  }

  // ---------------------------------------------------------------- input

  private pos(e: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.x - this.offX, y: e.clientY - rect.y };
  }

  private onDown(e: PointerEvent): void {
    const p = this.pos(e);
    if (onchain.state.enabled && hit(this.btnWallet, p)) {
      void onchain.toggleWallet();
      return;
    }
    if (this.state === 'over') {
      if (hit(this.btnRestart, p)) this.reset();
      else if (hit(this.btnShare, p)) {
        void shareScore(this.score, DRINKS[this.maxTierMade].name, {
          by: onchain.state.username ?? getUsername(),
          daily: this.mode === 'daily' ? dailyNumber() : null,
        });
      } else if (hit(this.btnShareX, p)) {
        void shareToX(
          this.score,
          this.maxTierMade,
          onchain.state.username ?? getUsername(),
          this.mode === 'daily' ? dailyNumber() : null,
        );
      } else if (onchain.state.enabled && hit(this.btnMint, p)) {
        onchain.mintScoreCard();
      } else if (onchain.state.enabled && hit(this.btnServe, p)) {
        onchain.serveScore(this.score, this.maxTierMade);
      } else if (onchain.state.enabled && hit(this.btnActivity, p) && onchain.state.address) {
        const tx = onchain.state.lastServeTx;
        openExternal(
          tx ? `${TALLY_EXPLORER}/tx/${tx}` : `${TALLY_EXPLORER}/address/${onchain.state.address}`,
        );
      } else if (onchain.state.enabled && hit(this.btnBoard, p)) {
        showLeaderboard();
      }
      return;
    }
    if (this.state !== 'aim') return;
    this.dragging = true;
    try {
      this.canvas.setPointerCapture(e.pointerId); // keep the drag when the pointer leaves the window
    } catch {
      /* not supported */
    }
    this.moveAim(p.x);
  }

  private onMove(e: PointerEvent): void {
    if (!this.dragging || this.state !== 'aim') return;
    this.moveAim(this.pos(e).x);
  }

  private moveAim(px: number): void {
    const r = this.radius(this.currentTier);
    this.aimX = clamp(px, this.inner.x + r, this.inner.x + this.inner.w - r);
  }

  private onUp(e: PointerEvent): void {
    if (!this.dragging || this.state !== 'aim') {
      this.dragging = false;
      return;
    }
    this.dragging = false;
    this.moveAim(this.pos(e).x);

    // release to pour: launch straight up at a fixed speed
    const speed = this.inner.h * 1.9;
    const body: Body = {
      id: this.nextId++,
      tier: this.currentTier,
      x: this.aimX,
      y: this.launchY,
      vx: 0,
      vy: -speed,
      r: this.radius(this.currentTier),
      wobble: 0,
      spin: (Math.random() - 0.5) * 2,
    };
    this.bodies.push(body);
    this.state = 'settle';
    this.settleTimer = 0;
    this.launches++;
    if (this.launches === 1) bumpStreak(); // playing today extends the streak
    sfx.launch();
    haptic('light');
  }

  // ---------------------------------------------------------------- update

  update(dt: number): void {
    this.time += dt;
    dt = Math.min(dt, 1 / 30);

    const steps = 3;
    for (let i = 0; i < steps; i++) this.physics(dt / steps);

    // particles & floats
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.96;
      p.vy *= 0.96;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const f of this.floats) {
      f.y -= 34 * dt;
      f.life -= dt;
    }
    this.floats = this.floats.filter((f) => f.life > 0);
    for (const r of this.rings) {
      r.r += (r.maxR - r.r) * Math.min(1, dt * 9);
      r.life -= dt * 2.4;
    }
    this.rings = this.rings.filter((r) => r.life > 0);
    if (this.orderFlash > 0) this.orderFlash -= dt;
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.comboCount = 0;
    }

    // turn resolution
    if (this.state === 'settle') {
      this.settleTimer += dt;
      const maxSpeed = this.bodies.reduce((m, b) => Math.max(m, Math.hypot(b.vx, b.vy)), 0);
      if ((maxSpeed < 14 && this.settleTimer > 0.45) || this.settleTimer > 6) {
        for (const b of this.bodies) {
          b.vx = 0;
          b.vy = 0;
        }
        if (this.bodies.some((b) => b.y > this.lineY)) {
          this.gameOver();
        } else {
          this.currentTier = this.nextTier;
          this.nextTier = this.spawnTier();
          this.state = 'aim';
        }
      }
    }
  }

  private physics(dt: number): void {
    const friction = 2.1; // sand drag, exponential decay per second
    const decay = Math.exp(-friction * dt);
    const { x: ix, y: iy, w: iw, h: ih } = this.inner;

    for (const b of this.bodies) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.vx *= decay;
      b.vy *= decay;
      const sp = Math.hypot(b.vx, b.vy);
      if (sp < 10) {
        b.vx = 0;
        b.vy = 0;
      } else {
        b.wobble = Math.sin(this.time * 14 + b.id) * 0.04 * Math.min(1, sp / 400) * b.spin;
      }

      // walls
      const rest = 0.5;
      if (b.x - b.r < ix) {
        b.x = ix + b.r;
        b.vx = Math.abs(b.vx) * rest;
      } else if (b.x + b.r > ix + iw) {
        b.x = ix + iw - b.r;
        b.vx = -Math.abs(b.vx) * rest;
      }
      if (b.y - b.r < iy) {
        b.y = iy + b.r;
        b.vy = Math.abs(b.vy) * rest;
      } else if (b.y + b.r > iy + ih) {
        b.y = iy + ih - b.r;
        b.vy = -Math.abs(b.vy) * rest;
      }
    }

    // collisions + merges
    for (let i = 0; i < this.bodies.length; i++) {
      for (let j = i + 1; j < this.bodies.length; j++) {
        const a = this.bodies[i];
        const b = this.bodies[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        const minDist = a.r + b.r;
        if (dist >= minDist || dist === 0) continue;

        if (mergeResult(a, b) !== null) {
          this.merge(a, b);
          j = this.bodies.length; // pair list changed; finish this i
          continue;
        }

        const nx = dx / dist;
        const ny = dy / dist;
        const overlap = minDist - dist;
        const ma = a.r * a.r;
        const mb = b.r * b.r;
        const total = ma + mb;
        a.x -= nx * overlap * (mb / total);
        a.y -= ny * overlap * (mb / total);
        b.x += nx * overlap * (ma / total);
        b.y += ny * overlap * (ma / total);

        const rvx = b.vx - a.vx;
        const rvy = b.vy - a.vy;
        const rel = rvx * nx + rvy * ny;
        if (rel < 0) {
          const restitution = 0.35;
          const imp = (-(1 + restitution) * rel) / (1 / ma + 1 / mb);
          a.vx -= (imp / ma) * nx;
          a.vy -= (imp / ma) * ny;
          b.vx += (imp / mb) * nx;
          b.vy += (imp / mb) * ny;
          if (-rel > 120) sfx.bump(Math.min(1, -rel / 900));
        }
      }
    }
  }

  private merge(a: Body, b: Body): void {
    const tier = mergeResult(a, b)!;
    const wild = a.tier === WILD_TIER || b.tier === WILD_TIER;
    const ma = a.r * a.r;
    const mb = b.r * b.r;
    const total = ma + mb;
    const merged: Body = {
      id: this.nextId++,
      tier,
      x: (a.x * ma + b.x * mb) / total,
      y: (a.y * ma + b.y * mb) / total,
      vx: ((a.vx * ma + b.vx * mb) / total) * 0.4,
      vy: ((a.vy * ma + b.vy * mb) / total) * 0.4,
      r: this.radius(tier),
      wobble: 0,
      spin: (Math.random() - 0.5) * 2,
    };
    this.bodies = this.bodies.filter((x) => x !== a && x !== b);
    this.bodies.push(merged);

    // chain-merge combo: quick successive merges multiply the points
    this.comboCount = this.comboTimer > 0 ? this.comboCount + 1 : 1;
    this.comboTimer = COMBO_WINDOW;
    const mult = Math.min(this.comboCount, COMBO_MAX);
    const pts = DRINKS[tier].score * mult;
    this.score += pts;
    this.maxTierMade = Math.max(this.maxTierMade, tier);
    this.burst(merged.x, merged.y, DRINKS[tier].liquid, merged.r);
    this.rings.push({
      x: merged.x,
      y: merged.y,
      r: merged.r * 0.6,
      maxR: merged.r * 2.1,
      life: 1,
      color: DRINKS[tier].liquid,
    });
    const comboColors = ['#ffffff', '#ffe66d', '#ffb347', '#ff8fc7', '#ff6b6b'];
    this.floats.push({
      x: merged.x,
      y: merged.y - merged.r,
      text: mult > 1 ? `+${pts} ×${mult}!` : `+${pts}`,
      life: mult > 1 ? 1.4 : 1.1,
      color: comboColors[mult - 1],
    });
    if (wild) {
      this.floats.push({
        x: merged.x,
        y: merged.y - merged.r * 1.8,
        text: 'WILD! 🍸',
        life: 1.4,
        color: '#c77dff',
      });
    }
    sfx.merge(tier);
    haptic(tier >= 6 ? 'medium' : 'light');

    if (tier >= this.orderTier) {
      const bonus = DRINKS[this.orderTier].score * 2;
      this.score += bonus;
      this.floats.push({
        x: this.inner.x + this.inner.w / 2,
        y: this.inner.y + this.inner.h * 0.3,
        text: `Order served! +${bonus}`,
        life: 1.6,
        color: '#ffe66d',
      });
      // the barback clears the smallest drinks off the crowded board
      const cleared = this.bodies
        .filter((x) => x !== merged && x.tier !== WILD_TIER)
        .sort((p, q) => p.tier - q.tier)
        .slice(0, ORDER_CLEARS);
      if (cleared.length > 0) {
        for (const c of cleared) this.burst(c.x, c.y, 'rgba(255,255,255,0.9)', c.r);
        this.bodies = this.bodies.filter((x) => !cleared.includes(x));
        this.floats.push({
          x: this.inner.x + this.inner.w / 2,
          y: this.inner.y + this.inner.h * 0.3 + 30,
          text: `Barback cleared ${cleared.length} 🧹`,
          life: 1.6,
          color: '#ffffff',
        });
      }
      this.orderFlash = 1.5;
      this.orderTier = this.orderTier < MAX_TIER ? this.orderTier + 1 : 6 + Math.floor(Math.random() * 4);
      sfx.order();
      haptic('heavy');
    }
  }

  private burst(x: number, y: number, color: string, r: number): void {
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 60 + Math.random() * 200;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.5 + Math.random() * 0.4,
        maxLife: 0.9,
        color: Math.random() < 0.4 ? '#ffffff' : color,
        size: r * (0.08 + Math.random() * 0.12),
      });
    }
  }

  private gameOver(): void {
    this.state = 'over';
    this.best = Math.max(this.best, this.score);
    safeSet(BEST_KEY, String(this.best));
    if (this.mode === 'daily') setDailyBest(this.score);
    sfx.gameOver();
    haptic('heavy');

    // auto-serve every finished round onchain: the wallet prompt pops
    // automatically (no button hunt). serveScore records any run — it always
    // bumps the global tally and emits ScoreServed, updating bests/badges when
    // earned — so every game the player finishes is a transaction they can see.
    const oc = onchain.state;
    if (oc.enabled && oc.address && this.score > 0) {
      onchain.serveScore(this.score, this.maxTierMade);
    }
  }

  // ---------------------------------------------------------------- render

  render(): void {
    const ctx = this.ctx;
    // static backdrop (sky/sun/gutter deco) + live sky animation on top
    if (this.bgLayer) ctx.drawImage(this.bgLayer, 0, 0, this.fullW, this.H);
    this.drawSkyAnimated(ctx);
    ctx.save();
    ctx.translate(this.offX, 0);
    // static board (frame/sand/grain) + the live danger line
    if (this.boardLayer) ctx.drawImage(this.boardLayer, 0, 0, this.W, this.H);
    this.drawDangerLine(ctx);

    // bodies (sorted so bigger drinks overlap smaller ones naturally)
    const sorted = [...this.bodies].sort((a, b) => a.y - b.y);
    for (const b of sorted) this.drawPiece(ctx, b.tier, b.x, b.y, b.r, b.wobble);

    // waiting drink + guide
    if (this.state === 'aim') this.drawAim(ctx);

    // merge shockwave rings
    for (const r of this.rings) {
      ctx.globalAlpha = Math.max(0, r.life) * 0.7;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 3 + r.life * 3;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // particles
    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // floating texts
    for (const f of this.floats) {
      ctx.globalAlpha = Math.min(1, f.life);
      ctx.font = `bold ${Math.max(16, this.W * 0.045)}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;

    this.drawHud(ctx);
    this.drawChain(ctx);
    if (this.state === 'over') this.drawGameOver(ctx);
    ctx.restore();

    // gentle vignette (pre-rendered) pulls the eye to the middle of the scene
    if (this.vignetteLayer) ctx.drawImage(this.vignetteLayer, 0, 0, this.fullW, this.H);
  }

  /** Static sky, sun, and gutter deco — baked into bgLayer once per resize. */
  private renderBackdropStatic(ctx: CanvasRenderingContext2D): void {
    const { fullW, H } = this;
    // covers the whole window, including the letterbox gutters on wide screens
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#39aee6');
    g.addColorStop(0.26, '#7fd2f2');
    g.addColorStop(0.42, '#c9edfa');
    g.addColorStop(0.452, '#0f83c9');
    g.addColorStop(0.49, '#2fa3dc');
    g.addColorStop(0.512, '#7fd0ea');
    g.addColorStop(0.53, '#ffedbd');
    g.addColorStop(0.75, '#f7dfa0');
    g.addColorStop(1, '#eac26f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, fullW, H);

    // sun: hot core + layered glow
    const sx = fullW * 0.82;
    const sy = H * 0.1;
    const sr = this.W * 0.095;
    const halo = ctx.createRadialGradient(sx, sy, sr * 0.3, sx, sy, sr * 3.4);
    halo.addColorStop(0, 'rgba(255, 245, 170, 0.95)');
    halo.addColorStop(0.35, 'rgba(255, 235, 140, 0.45)');
    halo.addColorStop(1, 'rgba(255, 235, 140, 0)');
    ctx.beginPath();
    ctx.arc(sx, sy, sr * 3.4, 0, Math.PI * 2);
    ctx.fillStyle = halo;
    ctx.fill();
    const core = ctx.createRadialGradient(sx - sr * 0.25, sy - sr * 0.25, sr * 0.1, sx, sy, sr);
    core.addColorStop(0, '#fffbe0');
    core.addColorStop(1, '#ffe45c');
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
    ctx.fillStyle = core;
    ctx.fill();

    // static beach dressing in the gutters (palms are drawn live for sway)
    if (this.offX > 130) {
      this.starfish(ctx, this.offX * 0.25, H * 0.93, this.W * 0.022);
      this.shell(ctx, fullW - this.offX * 0.3, H * 0.95, this.W * 0.02);
    }
  }

  /** Moving sky elements drawn live each frame over the baked backdrop. */
  private drawSkyAnimated(ctx: CanvasRenderingContext2D): void {
    const { fullW, H } = this;
    // drifting clouds
    for (const [speed, y, s, off, alpha] of [
      [9, 0.08, 1.0, 0, 0.95],
      [14, 0.17, 0.7, 500, 0.85],
      [6, 0.26, 1.3, 900, 0.9],
    ]) {
      const span = fullW + 360;
      const x = ((this.time * speed + off) % span) - 180;
      this.cloud(ctx, x, H * y, this.W * 0.055 * s, alpha);
    }

    // sea: animated crest lines + a scalloped foam edge on the shore
    const seaTop = H * 0.452;
    ctx.strokeStyle = 'rgba(255,255,255,0.65)';
    ctx.lineWidth = 2.5;
    for (let band = 0; band < 2; band++) {
      const y0 = seaTop + band * H * 0.02 + H * 0.008;
      ctx.beginPath();
      for (let x = 0; x <= fullW; x += 14) {
        const y =
          y0 + Math.sin(x * 0.02 + this.time * (1.2 + band * 0.5) + band * 2) * (2.4 + band);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // foam where the water meets the sand
    const shoreY = H * 0.517;
    ctx.beginPath();
    ctx.moveTo(0, shoreY + 14);
    for (let x = 0; x <= fullW; x += 10) {
      ctx.lineTo(x, shoreY + Math.sin(x * 0.035 + this.time * 0.8) * 3.5);
    }
    ctx.lineTo(fullW, shoreY + 14);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fill();
    ctx.beginPath();
    for (let x = 0; x <= fullW; x += 10) {
      const y = shoreY + 9 + Math.sin(x * 0.028 - this.time * 0.6 + 2) * 3;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 3;
    ctx.stroke();

    // swaying palms in the letterbox gutters on wide screens
    if (this.offX > 130) {
      this.palm(ctx, this.offX * 0.45, H * 0.6, this.offX * 0.3, 1);
      this.palm(ctx, fullW - this.offX * 0.45, H * 0.64, this.offX * 0.26, -1);
    }
  }

  private cloud(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    alpha: number,
  ): void {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(x, y, r * 1.55, r * 0.6, 0, 0, Math.PI * 2);
    ctx.ellipse(x - r * 1.05, y + r * 0.22, r * 0.85, r * 0.42, 0, 0, Math.PI * 2);
    ctx.ellipse(x + r * 1.05, y + r * 0.2, r * 0.95, r * 0.46, 0, 0, Math.PI * 2);
    ctx.ellipse(x - r * 0.3, y - r * 0.42, r * 0.75, r * 0.45, 0, 0, Math.PI * 2);
    ctx.ellipse(x + r * 0.45, y - r * 0.3, r * 0.65, r * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private palm(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    lean: number,
  ): void {
    const sway = Math.sin(this.time * 0.7 + lean) * 0.025;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(sway);

    // trunk: dark base stroke + lighter core, with ring ridges
    const topX = lean * size * 0.32;
    const topY = -size * 0.55;
    const trunk = (width: number, color: string): void => {
      ctx.beginPath();
      ctx.moveTo(-size * 0.06, size * 0.92);
      ctx.quadraticCurveTo(lean * size * 0.28, size * 0.3, topX, topY);
      ctx.lineWidth = width;
      ctx.strokeStyle = color;
      ctx.lineCap = 'round';
      ctx.stroke();
    };
    trunk(Math.max(9, size * 0.15), '#8a5a2c');
    trunk(Math.max(5, size * 0.09), '#b07a42');
    ctx.strokeStyle = 'rgba(90, 55, 20, 0.4)';
    ctx.lineWidth = 2;
    for (let i = 1; i <= 5; i++) {
      const t = i / 6;
      const px = (1 - t) * (1 - t) * (-size * 0.06) + 2 * (1 - t) * t * (lean * size * 0.28) + t * t * topX;
      const py = (1 - t) * (1 - t) * size * 0.92 + 2 * (1 - t) * t * size * 0.3 + t * t * topY;
      ctx.beginPath();
      ctx.arc(px, py, size * 0.055, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
    }

    // fronds: dark under-layer then a brighter top layer (filled leaf shapes)
    const frond = (a: number, len: number, color: string): void => {
      const tipX = topX + Math.cos(a) * len;
      const tipY = topY + Math.sin(a) * len * 0.7 + size * 0.1;
      const bulge = 0.28 * len;
      const nx = -Math.sin(a);
      const ny = Math.cos(a) * 0.7;
      ctx.beginPath();
      ctx.moveTo(topX, topY);
      ctx.quadraticCurveTo(
        (topX + tipX) / 2 + nx * bulge,
        (topY + tipY) / 2 + ny * bulge - len * 0.18,
        tipX,
        tipY,
      );
      ctx.quadraticCurveTo(
        (topX + tipX) / 2 - nx * bulge * 0.3,
        (topY + tipY) / 2 - ny * bulge * 0.3 - len * 0.02,
        topX,
        topY,
      );
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    };
    for (let i = 0; i < 7; i++) {
      const a = -Math.PI + (i / 6) * Math.PI + sway * 2;
      frond(a, size * (0.72 + (i % 2) * 0.16), '#2c8a4b');
    }
    for (let i = 0; i < 7; i++) {
      const a = -Math.PI + (i / 6) * Math.PI + sway * 2 + 0.06;
      frond(a, size * (0.6 + (i % 2) * 0.14), '#46c068');
    }

    // coconuts
    for (const [cx, cy] of [
      [-0.1, 0.04],
      [0.08, 0.08],
      [-0.01, 0.13],
    ]) {
      const nx = topX + cx * size;
      const ny = topY + cy * size;
      ctx.beginPath();
      ctx.arc(nx, ny, size * 0.08, 0, Math.PI * 2);
      ctx.fillStyle = '#6f4320';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(nx - size * 0.025, ny - size * 0.025, size * 0.025, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fill();
    }

    // grass tuft at the base
    ctx.strokeStyle = '#3da05f';
    ctx.lineWidth = Math.max(2.5, size * 0.045);
    ctx.lineCap = 'round';
    for (const [dx, tilt] of [
      [-0.14, -0.5],
      [-0.05, -0.15],
      [0.05, 0.2],
      [0.15, 0.55],
    ]) {
      ctx.beginPath();
      ctx.moveTo(dx * size, size * 0.94);
      ctx.quadraticCurveTo(
        dx * size + tilt * size * 0.12,
        size * 0.82,
        dx * size + tilt * size * 0.22,
        size * 0.74,
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  private starfish(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(0.35);
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const rr = i % 2 === 0 ? r : r * 0.5;
      if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fillStyle = '#ff7a4d';
    ctx.fill();
    ctx.strokeStyle = '#e05528';
    ctx.lineWidth = Math.max(1.5, r * 0.12);
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();
  }

  private shell(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.arc(0, 0, r, Math.PI, 0);
    ctx.closePath();
    ctx.fillStyle = '#ffdfb8';
    ctx.fill();
    ctx.strokeStyle = '#d8a06a';
    ctx.lineWidth = Math.max(1.2, r * 0.1);
    ctx.stroke();
    for (const a of [-0.6, -0.2, 0.2, 0.6]) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(-Math.PI / 2 + a) * r * 0.95, Math.sin(-Math.PI / 2 + a) * r * 0.95);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Frame, sand, grain, doodles — baked into boardLayer once per resize. */
  private renderBoardStatic(ctx: CanvasRenderingContext2D): void {
    const { frame, inner } = this;

    // drop shadow so the board sits above the beach
    ctx.save();
    ctx.shadowColor = 'rgba(60, 30, 5, 0.35)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 8;
    roundRect(ctx, frame.x - 4, frame.y - 4, frame.w + 8, frame.h + 8, 18);
    ctx.fillStyle = '#7a4a21';
    ctx.fill();
    ctx.restore();

    roundRect(ctx, frame.x, frame.y, frame.w, frame.h, 14);
    const wood = ctx.createLinearGradient(frame.x, frame.y, frame.x + frame.w, frame.y);
    wood.addColorStop(0, '#a5642a');
    wood.addColorStop(0.5, '#c8813c');
    wood.addColorStop(1, '#a5642a');
    ctx.fillStyle = wood;
    ctx.fill();

    // plank seams along the frame
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = 'rgba(90, 52, 16, 0.35)';
    ctx.lineWidth = 2;
    for (let i = 1; i < 6; i++) {
      const px = frame.x + (frame.w * i) / 6;
      ctx.beginPath();
      ctx.moveTo(px, frame.y);
      ctx.lineTo(px, frame.y + frame.h);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255, 230, 190, 0.25)';
    ctx.beginPath();
    ctx.moveTo(frame.x, frame.y + 3);
    ctx.lineTo(frame.x + frame.w, frame.y + 3);
    ctx.stroke();
    ctx.restore();

    // sand surface
    roundRect(ctx, inner.x, inner.y, inner.w, inner.h, 10);
    const sand = ctx.createLinearGradient(0, inner.y, 0, inner.y + inner.h);
    sand.addColorStop(0, '#f7e2b4');
    sand.addColorStop(0.5, '#fdeecb');
    sand.addColorStop(1, '#f4dca6');
    ctx.fillStyle = sand;
    ctx.fill();
    ctx.save();
    ctx.clip();

    // fine sand grain (deterministic scatter)
    for (let i = 0; i < 60; i++) {
      const fx = ((i * 2654435761) % 1000) / 1000;
      const fy = ((i * 1597334677) % 1000) / 1000;
      ctx.beginPath();
      ctx.arc(inner.x + inner.w * fx, inner.y + inner.h * fy, 1.4, 0, Math.PI * 2);
      ctx.fillStyle = i % 3 ? 'rgba(199, 168, 120, 0.25)' : 'rgba(255, 255, 255, 0.4)';
      ctx.fill();
    }

    // sand doodles
    ctx.fillStyle = 'rgba(214, 186, 140, 0.5)';
    const seeds = [
      [0.2, 0.45],
      [0.75, 0.35],
      [0.55, 0.6],
      [0.3, 0.78],
      [0.85, 0.72],
    ];
    for (const [fx, fy] of seeds) {
      ctx.beginPath();
      ctx.arc(inner.x + inner.w * fx, inner.y + inner.h * fy, inner.w * 0.02, 0, Math.PI * 2);
      ctx.fill();
    }

    // soft inner shadow below the frame's top edge
    const innerShadow = ctx.createLinearGradient(0, inner.y, 0, inner.y + 20);
    innerShadow.addColorStop(0, 'rgba(90, 52, 16, 0.22)');
    innerShadow.addColorStop(1, 'rgba(90, 52, 16, 0)');
    ctx.fillStyle = innerShadow;
    ctx.fillRect(inner.x, inner.y, inner.w, 20);
    ctx.restore(); // close the sand clip
  }

  /** Dashed danger line, drawn live — pulses red as the pile creeps up. */
  private drawDangerLine(ctx: CanvasRenderingContext2D): void {
    const { inner } = this;
    const danger =
      this.state !== 'over' &&
      this.bodies.some((b) => b.vx === 0 && b.vy === 0 && b.y + b.r * 2.4 > this.lineY);
    const pulse = danger ? 0.55 + 0.45 * Math.abs(Math.sin(this.time * 5)) : 0.95;
    ctx.save();
    roundRect(ctx, inner.x, inner.y, inner.w, inner.h, 10);
    ctx.clip();
    ctx.setLineDash([inner.w * 0.03, inner.w * 0.02]);
    ctx.lineWidth = danger ? 4 : 3;
    ctx.strokeStyle =
      this.state === 'over'
        ? 'rgba(220, 60, 60, 0.9)'
        : danger
          ? `rgba(240, 90, 70, ${pulse})`
          : 'rgba(255, 255, 255, 0.95)';
    ctx.beginPath();
    ctx.moveTo(inner.x, this.lineY);
    ctx.lineTo(inner.x + inner.w, this.lineY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  private drawAim(ctx: CanvasRenderingContext2D): void {
    const r = this.radius(this.currentTier);
    const bob = Math.sin(this.time * 3) * 2;

    // vertical guide with marching dashes
    ctx.save();
    ctx.setLineDash([8, 8]);
    ctx.lineDashOffset = -this.time * 40;
    ctx.lineWidth = this.dragging ? 3 : 2;
    ctx.strokeStyle = this.dragging ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.moveTo(this.aimX, this.launchY - r);
    ctx.lineTo(this.aimX, this.inner.y + 6);
    ctx.stroke();
    ctx.restore();

    // glow under the waiting drink
    const glow = ctx.createRadialGradient(this.aimX, this.launchY, r * 0.2, this.aimX, this.launchY, r * 1.6);
    glow.addColorStop(0, 'rgba(255,255,255,0.35)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.beginPath();
    ctx.arc(this.aimX, this.launchY, r * 1.6, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();

    this.drawPiece(ctx, this.currentTier, this.aimX, this.launchY + bob, r);

    // first-launch hint
    if (this.launches === 0) {
      const cx = this.inner.x + this.inner.w / 2;
      const y = this.lineY + (this.launchY - this.lineY) * 0.1;
      ctx.font = `bold ${Math.max(15, this.W * 0.042)}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.strokeText('Touch & drag to aim · release to pour!', cx, y);
      ctx.fillStyle = '#ffffff';
      ctx.fillText('Touch & drag to aim · release to pour!', cx, y);
    }
  }

  private drawHud(ctx: CanvasRenderingContext2D): void {
    const pad = Math.max(10, this.W * 0.03);
    const pillH = Math.max(34, this.H * 0.045);
    const topY = pad;

    // score pill (top-left)
    const scoreTxt = this.score.toLocaleString();
    ctx.font = `bold ${pillH * 0.52}px ${FONT}`;
    const tw = ctx.measureText(scoreTxt).width;
    const pillW = tw + pillH * 1.6;
    roundRect(ctx, pad, topY, pillW, pillH, pillH / 2);
    ctx.fillStyle = 'rgba(80, 45, 15, 0.75)';
    ctx.fill();
    const coinX = pad + pillH * 0.55;
    const coinY = topY + pillH / 2;
    const coinR = pillH * 0.33;
    ctx.beginPath();
    ctx.arc(coinX, coinY, coinR, 0, Math.PI * 2);
    const coin = ctx.createRadialGradient(
      coinX - coinR * 0.35,
      coinY - coinR * 0.35,
      coinR * 0.15,
      coinX,
      coinY,
      coinR,
    );
    coin.addColorStop(0, '#fff3b0');
    coin.addColorStop(0.6, '#ffd54f');
    coin.addColorStop(1, '#e8a825');
    ctx.fillStyle = coin;
    ctx.fill();
    ctx.strokeStyle = '#c99b1f';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(scoreTxt, pad + pillH * 1.1, topY + pillH / 2 + 1);

    // personal best — the milestone to beat (kept clear of the order card)
    const bestVal = Math.max(this.best, Number(onchain.state.myBest ?? 0n));
    const bestY = topY + pillH + 9;
    const bestMaxW = Math.max(70, this.W / 2 - Math.min(this.W * 0.4, 190) / 2 - pad - 8);
    ctx.font = `bold ${pillH * 0.38}px ${FONT}`;
    ctx.fillStyle =
      this.score > bestVal && bestVal > 0 ? '#2eb872' : 'rgba(90, 52, 16, 0.9)';
    ctx.fillText(
      bestVal > 0
        ? this.score > bestVal
          ? `New best! (was ${bestVal.toLocaleString()})`
          : `Best: ${bestVal.toLocaleString()}`
        : 'Set your first best score!',
      pad + 4,
      bestY,
      bestMaxW,
    );

    // wallet chip + global tally (only when a contract is configured)
    if (onchain.state.enabled) {
      const oc = onchain.state;
      const wh = pillH * 0.76;
      const wy = bestY + pillH * 0.32;
      const label = oc.address
        ? (oc.basename ?? `${oc.address.slice(0, 5)}…${oc.address.slice(-3)}`)
        : oc.status === 'connecting'
          ? 'Connecting…'
          : 'Connect';
      ctx.font = `bold ${wh * 0.48}px ${FONT}`;
      const ww = ctx.measureText(label).width + wh * 1.3;
      this.btnWallet = { x: pad, y: wy, w: ww, h: wh };
      roundRect(ctx, pad, wy, ww, wh, wh / 2);
      ctx.fillStyle = oc.address ? 'rgba(46, 184, 114, 0.9)' : 'rgba(79, 109, 245, 0.9)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(pad + wh * 0.5, wy + wh / 2, wh * 0.18, 0, Math.PI * 2);
      ctx.fillStyle = oc.address ? '#c8ffe3' : '#dbe2ff';
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, pad + wh * 0.9, wy + wh / 2 + 1);

      if (oc.totalServed !== null) {
        ctx.font = `${wh * 0.44}px ${FONT}`;
        ctx.fillStyle = 'rgba(90, 52, 16, 0.85)';
        ctx.fillText(
          `🍹 ${oc.totalServed.toLocaleString()} served`,
          pad + ww + 8,
          wy + wh / 2 + 1,
        );
      }
    } else {
      this.btnWallet = { x: 0, y: 0, w: 0, h: 0 };
    }

    // NEXT preview (top-right)
    const nr = pillH * 0.9;
    const nx = this.W - pad - nr;
    const ny = topY + nr + 2;
    ctx.beginPath();
    ctx.arc(nx, ny, nr, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#e8b04a';
    ctx.stroke();
    if (this.state !== 'over') this.drawPiece(ctx, this.nextTier, nx, ny, nr * 0.55);
    ctx.font = `bold ${pillH * 0.36}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#5a3410';
    ctx.fillText('NEXT', nx, ny + nr + pillH * 0.28);

    // order card (top-center)
    const ocW = Math.min(this.W * 0.4, 190);
    const ocH = pillH * 1.6;
    const ocX = this.W / 2 - ocW / 2;
    const ocY = topY - 2;
    const flash = this.orderFlash > 0 && Math.sin(this.time * 16) > 0;
    roundRect(ctx, ocX, ocY, ocW, ocH, 12);
    ctx.fillStyle = flash ? '#fff3c4' : 'rgba(255,252,245,0.94)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#e2984a';
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.font = `bold ${pillH * 0.32}px ${FONT}`;
    ctx.fillStyle = '#c0392b';
    ctx.fillText('TO-GO ORDER', this.W / 2, ocY + ocH * 0.24);
    drawDrink(ctx, this.orderTier, ocX + ocW * 0.16, ocY + ocH * 0.66, ocH * 0.24);
    ctx.font = `${pillH * 0.3}px ${FONT}`;
    ctx.fillStyle = '#6b4a22';
    ctx.fillText(
      DRINKS[this.orderTier].name,
      ocX + ocW * 0.6,
      ocY + ocH * 0.66,
    );
    ctx.textBaseline = 'alphabetic';

    // mode/challenge tags floating at the top of the sand
    let tagY = this.inner.y + pillH * 0.55;
    ctx.font = `bold ${pillH * 0.32}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (this.mode === 'daily') {
      ctx.fillStyle = '#e8801a';
      ctx.fillText(`🌞 DAILY MIX #${dailyNumber()}`, this.W / 2, tagY);
      tagY += pillH * 0.42;
    }
    if (this.challenge) {
      const beaten = this.score > this.challenge.score;
      ctx.fillStyle = beaten ? '#2eb872' : '#c0392b';
      ctx.fillText(
        beaten
          ? `🏆 @${this.challenge.by} beaten!`
          : `🎯 Beat @${this.challenge.by}: ${this.challenge.score.toLocaleString()}`,
        this.W / 2,
        tagY,
      );
    }
    ctx.textBaseline = 'alphabetic';
  }

  private drawChain(ctx: CanvasRenderingContext2D): void {
    const barH = Math.max(50, this.H * 0.07);
    const y = this.H - barH - 4;
    roundRect(ctx, 8, y, this.W - 16, barH, barH / 2);
    const barG = ctx.createLinearGradient(0, y, 0, y + barH);
    barG.addColorStop(0, 'rgba(146, 92, 44, 0.92)');
    barG.addColorStop(1, 'rgba(104, 61, 25, 0.92)');
    ctx.fillStyle = barG;
    ctx.fill();
    roundRect(ctx, 8, y, this.W - 16, barH, barH / 2);
    ctx.strokeStyle = 'rgba(255, 226, 180, 0.25)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const n = DRINKS.length;
    const cell = (this.W - 32) / n;
    for (let i = 0; i < n; i++) {
      const cx = 16 + cell * i + cell / 2;
      const cy = y + barH / 2;
      const rr = Math.min(cell * 0.36, barH * 0.34);
      if (i <= this.maxTierMade || i <= 4) {
        drawDrink(ctx, i, cx, cy, rr);
      } else {
        ctx.beginPath();
        ctx.arc(cx, cy, rr, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fill();
        ctx.font = `bold ${rr}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.fillText('?', cx, cy + 1);
        ctx.textBaseline = 'alphabetic';
      }
      if (i < n - 1) {
        ctx.font = `${rr * 0.8}px sans-serif`;
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.textAlign = 'center';
        ctx.fillText('›', 16 + cell * (i + 1), y + barH / 2 + rr * 0.28);
      }
    }
  }

  private drawGameOver(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = 'rgba(30, 20, 10, 0.6)';
    // dim the whole window, not just the centered stage
    ctx.fillRect(-this.offX, 0, this.fullW, this.H);

    const onchainRows = onchain.state.enabled ? 1 : 0;
    const pw = Math.min(this.W * 0.86, 390);
    const ph = Math.min(this.H * (0.52 + onchainRows * 0.12), 420 + onchainRows * 110);
    const px = this.W / 2 - pw / 2;
    const py = this.H / 2 - ph / 2;
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 10;
    roundRect(ctx, px, py, pw, ph, 22);
    const panel = ctx.createLinearGradient(0, py, 0, py + ph);
    panel.addColorStop(0, '#fffdf6');
    panel.addColorStop(0.6, '#fff4e0');
    panel.addColorStop(1, '#fdeccd');
    ctx.fillStyle = panel;
    ctx.fill();
    ctx.restore();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(224, 160, 91, 0.7)';
    ctx.stroke();
    // awning stripes along the panel top
    ctx.save();
    roundRect(ctx, px, py, pw, ph, 22);
    ctx.clip();
    const stripeW = pw / 9;
    for (let i = 0; i < 9; i++) {
      ctx.fillStyle = i % 2 ? '#fff3df' : '#ff6f61';
      ctx.fillRect(px + i * stripeW, py, stripeW + 1, 12);
    }
    ctx.fillStyle = 'rgba(60, 30, 5, 0.12)';
    ctx.fillRect(px, py + 12, pw, 4);
    ctx.restore();

    const oc = onchain.state;
    // upper section compresses when the onchain rows are present
    const f = oc.enabled
      ? { title: 0.1, drink: 0.22, drinkR: 0.085, bestDrink: 0.33, score: 0.42, best: 0.48, rows: 0.54 }
      : { title: 0.13, drink: 0.29, drinkR: 0.1, bestDrink: 0.44, score: 0.54, best: 0.61, rows: 0.68 };

    ctx.textAlign = 'center';
    ctx.fillStyle = '#c0392b';
    ctx.font = `bold ${pw * 0.09}px ${FONT}`;
    ctx.fillText('Bar is backed up!', this.W / 2, py + ph * f.title);

    drawDrink(ctx, this.maxTierMade, this.W / 2, py + ph * f.drink, pw * f.drinkR);

    ctx.fillStyle = '#5a3410';
    ctx.font = `${pw * 0.055}px ${FONT}`;
    ctx.fillText(`Best drink: ${DRINKS[this.maxTierMade].name}`, this.W / 2, py + ph * f.bestDrink);
    ctx.font = `bold ${pw * 0.085}px ${FONT}`;
    ctx.fillText(`Score: ${this.score.toLocaleString()}`, this.W / 2, py + ph * f.score);
    ctx.font = `${pw * 0.05}px ${FONT}`;
    ctx.fillStyle = '#8a6a3a';
    ctx.fillText(`Best: ${this.best.toLocaleString()}`, this.W / 2, py + ph * f.best);

    // one context line: challenge result beats the daily tag when both apply
    const extraY = py + ph * f.best + pw * 0.055;
    if (this.challenge) {
      const beaten = this.score > this.challenge.score;
      ctx.fillStyle = beaten ? '#2eb872' : '#c0392b';
      ctx.font = `bold ${pw * 0.048}px ${FONT}`;
      ctx.fillText(
        beaten
          ? `🏆 You beat @${this.challenge.by}!`
          : `@${this.challenge.by} still leads with ${this.challenge.score.toLocaleString()}`,
        this.W / 2,
        extraY,
      );
    } else if (this.mode === 'daily') {
      ctx.fillStyle = '#e8801a';
      ctx.font = `bold ${pw * 0.048}px ${FONT}`;
      ctx.fillText(
        `🌞 Daily Mix #${dailyNumber()} — today's best: ${getDailyBest().toLocaleString()}`,
        this.W / 2,
        extraY,
      );
    }

    const bw = pw * 0.42;
    const bh = Math.max(40, ph * (oc.enabled ? 0.082 : 0.1));
    const rowGap = 10;
    let by = py + ph * f.rows;

    // row 1: play again + recast (Farcaster)
    this.btnRestart = { x: this.W / 2 - bw - 6, y: by, w: bw, h: bh };
    this.btnShare = { x: this.W / 2 + 6, y: by, w: bw, h: bh };
    button(ctx, this.btnRestart, '#2eb872', 'Play Again');
    button(ctx, this.btnShare, '#7c65c1', 'Recast 💜');
    by += bh + rowGap;

    // row 2: share to X (+ mint when onchain is live)
    if (oc.enabled) {
      this.btnShareX = { x: this.W / 2 - bw - 6, y: by, w: bw, h: bh };
      this.btnMint = { x: this.W / 2 + 6, y: by, w: bw, h: bh };
      button(ctx, this.btnShareX, '#1d2229', 'Share on 𝕏');
      const mintLabels: Record<string, [string, string]> = {
        idle: ['Mint Card 🎴', '#f2811d'],
        connecting: ['Confirm…', '#8a6a3a'],
        switching: ['Switching…', '#8a6a3a'],
        signing: ['Confirm…', '#8a6a3a'],
        confirming: ['Minting…', '#8a6a3a'],
        success: ['Minted ✓', '#2eb872'],
        error: ['Retry Mint', '#c0392b'],
      };
      const [mLabel, mColor] = mintLabels[oc.mintStatus];
      button(ctx, this.btnMint, mColor, mLabel);
      by += bh + rowGap;

      // onchain serve status — every finished round auto-fires serveScore, so
      // this line narrates the transaction the player is already signing.
      let serveText: string;
      let serveTappable = false;
      let serveColor = '#8a6a3a';
      if (!oc.address) {
        serveText = '⛓ Tap to connect & serve this round onchain';
        serveTappable = true;
        serveColor = '#f2811d';
      } else {
        switch (oc.status) {
          case 'connecting':
          case 'switching':
          case 'signing':
            serveText = 'Confirm in your wallet to serve this round…';
            break;
          case 'confirming':
            serveText = 'Serving this round onchain…';
            break;
          case 'success':
            serveText = 'Round served onchain ✓';
            serveColor = '#2eb872';
            break;
          case 'error':
            serveText = `Serve failed — tap to retry (${oc.error ?? ''})`;
            serveTappable = true;
            serveColor = '#c0392b';
            break;
          default:
            serveText = '🍹 Tap to serve this round onchain';
            serveTappable = this.score > 0;
        }
      }
      ctx.font = `${serveTappable ? 'bold ' : ''}${pw * 0.042}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = serveColor;
      ctx.fillText(serveText, this.W / 2, by + pw * 0.035);
      this.btnServe = serveTappable
        ? { x: px + 10, y: by - pw * 0.01, w: pw - 20, h: pw * 0.08 }
        : { x: 0, y: 0, w: 0, h: 0 };
      if (oc.mintStatus === 'error' && oc.mintError) {
        ctx.fillStyle = '#c0392b';
        ctx.fillText(oc.mintError, this.W / 2, by + pw * 0.085);
      }
      by += pw * 0.1;

      // proof-of-play: link out to the player's onchain rounds on BaseScan
      if (oc.address) {
        const rounds = oc.servedByMe > 0 ? ` (${oc.servedByMe} this session)` : '';
        ctx.font = `${pw * 0.042}px ${FONT}`;
        ctx.fillStyle = '#2c7be5';
        ctx.fillText(`🔗 View your onchain rounds${rounds}`, this.W / 2, by + pw * 0.03);
        const acW = pw * 0.8;
        this.btnActivity = { x: this.W / 2 - acW / 2, y: by - pw * 0.02, w: acW, h: pw * 0.075 };
        by += pw * 0.075;
      } else {
        this.btnActivity = { x: 0, y: 0, w: 0, h: 0 };
      }

      // leaderboard link
      ctx.font = `bold ${pw * 0.05}px ${FONT}`;
      ctx.fillStyle = '#4f6df5';
      ctx.fillText('🏆 View Leaderboard', this.W / 2, by + pw * 0.05);
      const lbW = pw * 0.6;
      this.btnBoard = { x: this.W / 2 - lbW / 2, y: by, w: lbW, h: pw * 0.08 };
    } else {
      const sw = bw * 2 + 12;
      this.btnShareX = { x: this.W / 2 - sw / 2, y: by, w: sw, h: bh };
      button(ctx, this.btnShareX, '#1d2229', 'Share on 𝕏');
      this.btnServe = { x: 0, y: 0, w: 0, h: 0 };
      this.btnMint = { x: 0, y: 0, w: 0, h: 0 };
      this.btnBoard = { x: 0, y: 0, w: 0, h: 0 };
      this.btnActivity = { x: 0, y: 0, w: 0, h: 0 };
    }
  }
}

// ------------------------------------------------------------------ helpers

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Render `draw` into an offscreen canvas at device resolution for later blit. */
function makeLayer(
  w: number,
  h: number,
  draw: (c: CanvasRenderingContext2D) => void,
): HTMLCanvasElement {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * dpr));
  c.height = Math.max(1, Math.round(h * dpr));
  const cx = c.getContext('2d')!;
  cx.scale(dpr, dpr);
  draw(cx);
  return c;
}

/**
 * Tier produced when two bodies touch, or null when they don't merge.
 * Equal tiers merge up; the wildcard shaker merges with anything below the
 * Tiki (two shakers mix a Lemon Fizz).
 */
function mergeResult(a: Body, b: Body): number | null {
  const aw = a.tier === WILD_TIER;
  const bw = b.tier === WILD_TIER;
  if (aw && bw) return 1;
  if (aw || bw) {
    const other = aw ? b.tier : a.tier;
    return other < MAX_TIER ? other + 1 : null;
  }
  return a.tier === b.tier && a.tier < MAX_TIER ? a.tier + 1 : null;
}

// storage can throw in sandboxed iframes and private browsing
function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* best score just won't persist */
  }
}

function hit(r: Rect, p: { x: number; y: number }): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Shift a #rrggbb color toward white (amt > 0) or black (amt < 0). */
function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number): number =>
    Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `rgb(${r}, ${g}, ${b})`;
}

function button(ctx: CanvasRenderingContext2D, r: Rect, color: string, label: string): void {
  ctx.save();
  ctx.shadowColor = 'rgba(60, 30, 5, 0.3)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;
  roundRect(ctx, r.x, r.y, r.w, r.h, r.h / 2);
  const g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
  g.addColorStop(0, shade(color, 0.22));
  g.addColorStop(1, shade(color, -0.12));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
  // top highlight
  roundRect(ctx, r.x, r.y, r.w, r.h, r.h / 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = `600 ${r.h * 0.42}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 1);
  ctx.textBaseline = 'alphabetic';
}
