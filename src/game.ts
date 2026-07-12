// Merge Sip — beach-bar shuffleboard merge game.
// Flick drinks up the sand board; identical drinks merge into the next tier.

import { DRINKS, MAX_TIER, drawDrink } from './drinks.ts';
import { sfx } from './sfx.ts';
import { haptic, shareScore } from './base.ts';
import * as onchain from './onchain.ts';
import { showLeaderboard, getUsername } from './ui.ts';
import { shareToX } from './share.ts';

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

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type State = 'aim' | 'settle' | 'over';

const SPAWN_WEIGHTS = [28, 24, 18, 13, 9]; // tiers 0..4, always available
const BEST_KEY = 'merge-sip-best';
// Widest the stage may get relative to window height (phone-portrait feel).
const MAX_STAGE_AR = 0.62;

export class Game {
  private ctx: CanvasRenderingContext2D;
  private W = 0; // stage width (<= window width on wide screens)
  private H = 0;
  private fullW = 0; // real window width, for background/letterboxing
  private offX = 0; // horizontal offset centering the stage in the window

  // board geometry (CSS px)
  private inner: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private frame: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private lineY = 0;
  private launchY = 0;

  private bodies: Body[] = [];
  private particles: Particle[] = [];
  private floats: FloatText[] = [];
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

  /** Personal best (this device), shown as the milestone to beat. */
  get bestScore(): number {
    return this.best;
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
  }

  private radius(tier: number): number {
    return DRINKS[tier].radiusFrac * this.inner.w;
  }

  private reset(): void {
    this.bodies = [];
    this.particles = [];
    this.floats = [];
    this.score = 0;
    this.maxTierMade = 0;
    this.orderTier = 3;
    this.orderFlash = 0;
    this.launches = 0;
    this.currentTier = this.spawnTier();
    this.nextTier = this.spawnTier();
    this.aimX = this.inner.x + this.inner.w / 2;
    this.state = 'aim';
    onchain.resetTx();
  }

  private spawnTier(): number {
    // The dealer gets meaner as you progress: once you've mixed high tiers,
    // big drinks start showing up in your hand — they crowd the board and
    // force awkward gaps.
    const weights = [...SPAWN_WEIGHTS];
    if (this.maxTierMade >= 5) weights.push(8); // tier 5 (Blueberry Breeze)
    if (this.maxTierMade >= 6) weights.push(6); // tier 6 (Mojito Royale)
    if (this.maxTierMade >= 8) weights.push(4); // tier 7 (Berry Colada)

    const total = weights.reduce((a, b) => a + b, 0);
    let roll = Math.random() * total;
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
        void shareScore(this.score, DRINKS[this.maxTierMade].name);
      } else if (hit(this.btnShareX, p)) {
        void shareToX(this.score, this.maxTierMade, onchain.state.username ?? getUsername());
      } else if (onchain.state.enabled && hit(this.btnMint, p)) {
        onchain.mintScoreCard();
      } else if (onchain.state.enabled && hit(this.btnServe, p)) {
        onchain.serveScore(this.score, this.maxTierMade);
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
    if (this.orderFlash > 0) this.orderFlash -= dt;

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

        if (a.tier === b.tier && a.tier < MAX_TIER) {
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
    const tier = a.tier + 1;
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

    const pts = DRINKS[tier].score;
    this.score += pts;
    this.maxTierMade = Math.max(this.maxTierMade, tier);
    this.burst(merged.x, merged.y, DRINKS[tier].liquid, merged.r);
    this.floats.push({
      x: merged.x,
      y: merged.y - merged.r,
      text: `+${pts}`,
      life: 1.1,
      color: '#ffffff',
    });
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
    sfx.gameOver();
    haptic('heavy');

    // auto-serve: a connected player's run is saved without a button press
    // (the wallet still asks for the signature) whenever the run beats their
    // onchain best OR unlocks a new milestone badge. Conservative when the
    // badge cache hasn't loaded — never fire an unsolicited wallet prompt on
    // a guess.
    const oc = onchain.state;
    if (oc.enabled && oc.address && this.score > 0 && this.runWorthSaving(false)) {
      onchain.serveScore(this.score, this.maxTierMade);
    }
  }

  /**
   * Whether a finished run is worth writing onchain: it beats the player's
   * onchain best, OR it may unlock a milestone badge (reached tier 5+ that
   * isn't already earned).
   *
   * `assumeMilestoneWhenBadgesUnknown` decides the badge-cache-missing case:
   * the manual save button passes `true` (user-initiated, and `serveScore`
   * safely ignores already-earned badges, so don't block the save just
   * because the read is pending/failed); auto-serve passes `false`.
   */
  private runWorthSaving(assumeMilestoneWhenBadgesUnknown: boolean): boolean {
    const oc = onchain.state;
    if (this.score > Number(oc.myBest ?? 0n)) return true;
    if (this.maxTierMade >= 5) {
      if (oc.badges === null) return assumeMilestoneWhenBadgesUnknown;
      for (let t = 5; t <= this.maxTierMade; t++) {
        if (((oc.badges >> BigInt(t)) & 1n) === 0n) return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------- render

  render(): void {
    const ctx = this.ctx;
    this.drawBackground(ctx);
    ctx.save();
    ctx.translate(this.offX, 0);
    this.drawBoard(ctx);

    // bodies (sorted so bigger drinks overlap smaller ones naturally)
    const sorted = [...this.bodies].sort((a, b) => a.y - b.y);
    for (const b of sorted) drawDrink(ctx, b.tier, b.x, b.y, b.r, b.wobble);

    // waiting drink + guide
    if (this.state === 'aim') this.drawAim(ctx);

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
      ctx.font = `bold ${Math.max(16, this.W * 0.045)}px 'Trebuchet MS', sans-serif`;
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
  }

  private drawBackground(ctx: CanvasRenderingContext2D): void {
    // covers the whole window, including the letterbox gutters on wide screens
    const g = ctx.createLinearGradient(0, 0, 0, this.H);
    g.addColorStop(0, '#8fd8f0');
    g.addColorStop(0.35, '#bfeaf7');
    g.addColorStop(0.5, '#f7e2b0');
    g.addColorStop(1, '#efd193');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.fullW, this.H);

    // sun
    ctx.beginPath();
    ctx.arc(this.fullW * 0.85, this.H * 0.05, this.W * 0.09, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 240, 170, 0.9)';
    ctx.fill();
  }

  private drawBoard(ctx: CanvasRenderingContext2D): void {
    const { frame, inner } = this;

    // wooden frame
    roundRect(ctx, frame.x - 4, frame.y - 4, frame.w + 8, frame.h + 8, 18);
    ctx.fillStyle = '#7a4a21';
    ctx.fill();
    roundRect(ctx, frame.x, frame.y, frame.w, frame.h, 14);
    const wood = ctx.createLinearGradient(frame.x, frame.y, frame.x + frame.w, frame.y);
    wood.addColorStop(0, '#a8672f');
    wood.addColorStop(0.5, '#c07d3e');
    wood.addColorStop(1, '#a8672f');
    ctx.fillStyle = wood;
    ctx.fill();

    // sand surface
    roundRect(ctx, inner.x, inner.y, inner.w, inner.h, 10);
    const sand = ctx.createLinearGradient(0, inner.y, 0, inner.y + inner.h);
    sand.addColorStop(0, '#f3e0b8');
    sand.addColorStop(0.5, '#f9ecd0');
    sand.addColorStop(1, '#f1dcb0');
    ctx.fillStyle = sand;
    ctx.fill();
    ctx.save();
    ctx.clip();

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

    // dashed danger line
    ctx.setLineDash([inner.w * 0.03, inner.w * 0.02]);
    ctx.lineWidth = 3;
    ctx.strokeStyle =
      this.state === 'over' ? 'rgba(220, 60, 60, 0.9)' : 'rgba(255, 255, 255, 0.95)';
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

    // vertical guide
    ctx.save();
    ctx.setLineDash([8, 8]);
    ctx.lineWidth = this.dragging ? 3 : 2;
    ctx.strokeStyle = this.dragging ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.moveTo(this.aimX, this.launchY - r);
    ctx.lineTo(this.aimX, this.inner.y + 6);
    ctx.stroke();
    ctx.restore();

    drawDrink(ctx, this.currentTier, this.aimX, this.launchY + bob, r);

    // first-launch hint
    if (this.launches === 0) {
      const cx = this.inner.x + this.inner.w / 2;
      const y = this.lineY + (this.launchY - this.lineY) * 0.1;
      ctx.font = `bold ${Math.max(15, this.W * 0.042)}px 'Trebuchet MS', sans-serif`;
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
    ctx.font = `bold ${pillH * 0.52}px 'Trebuchet MS', sans-serif`;
    const tw = ctx.measureText(scoreTxt).width;
    const pillW = tw + pillH * 1.6;
    roundRect(ctx, pad, topY, pillW, pillH, pillH / 2);
    ctx.fillStyle = 'rgba(80, 45, 15, 0.75)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(pad + pillH * 0.55, topY + pillH / 2, pillH * 0.33, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd54f';
    ctx.fill();
    ctx.strokeStyle = '#c99b1f';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(scoreTxt, pad + pillH * 1.1, topY + pillH / 2 + 1);

    // personal best — the milestone to beat
    const bestVal = Math.max(this.best, Number(onchain.state.myBest ?? 0n));
    const bestY = topY + pillH + 9;
    ctx.font = `bold ${pillH * 0.38}px 'Trebuchet MS', sans-serif`;
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
    );

    // wallet chip + global tally (only when a contract is configured)
    if (onchain.state.enabled) {
      const oc = onchain.state;
      const wh = pillH * 0.76;
      const wy = bestY + pillH * 0.32;
      const label = oc.address
        ? `${oc.address.slice(0, 5)}…${oc.address.slice(-3)}`
        : oc.status === 'connecting'
          ? 'Connecting…'
          : 'Connect';
      ctx.font = `bold ${wh * 0.48}px 'Trebuchet MS', sans-serif`;
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
        ctx.font = `${wh * 0.44}px 'Trebuchet MS', sans-serif`;
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
    if (this.state !== 'over') drawDrink(ctx, this.nextTier, nx, ny, nr * 0.55);
    ctx.font = `bold ${pillH * 0.36}px 'Trebuchet MS', sans-serif`;
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
    ctx.font = `bold ${pillH * 0.32}px 'Trebuchet MS', sans-serif`;
    ctx.fillStyle = '#c0392b';
    ctx.fillText('TO-GO ORDER', this.W / 2, ocY + ocH * 0.24);
    drawDrink(ctx, this.orderTier, ocX + ocW * 0.16, ocY + ocH * 0.66, ocH * 0.24);
    ctx.font = `${pillH * 0.3}px 'Trebuchet MS', sans-serif`;
    ctx.fillStyle = '#6b4a22';
    ctx.fillText(
      DRINKS[this.orderTier].name,
      ocX + ocW * 0.6,
      ocY + ocH * 0.66,
    );
    ctx.textBaseline = 'alphabetic';
  }

  private drawChain(ctx: CanvasRenderingContext2D): void {
    const barH = Math.max(50, this.H * 0.07);
    const y = this.H - barH - 4;
    roundRect(ctx, 8, y, this.W - 16, barH, barH / 2);
    ctx.fillStyle = 'rgba(122, 74, 33, 0.85)';
    ctx.fill();

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
    roundRect(ctx, px, py, pw, ph, 22);
    ctx.fillStyle = '#fff8ec';
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#c07d3e';
    ctx.stroke();

    const oc = onchain.state;
    // upper section compresses when the onchain rows are present
    const f = oc.enabled
      ? { title: 0.1, drink: 0.22, drinkR: 0.085, bestDrink: 0.33, score: 0.42, best: 0.48, rows: 0.54 }
      : { title: 0.13, drink: 0.29, drinkR: 0.1, bestDrink: 0.44, score: 0.54, best: 0.61, rows: 0.68 };

    ctx.textAlign = 'center';
    ctx.fillStyle = '#c0392b';
    ctx.font = `bold ${pw * 0.09}px 'Trebuchet MS', sans-serif`;
    ctx.fillText('Bar is backed up!', this.W / 2, py + ph * f.title);

    drawDrink(ctx, this.maxTierMade, this.W / 2, py + ph * f.drink, pw * f.drinkR);

    ctx.fillStyle = '#5a3410';
    ctx.font = `${pw * 0.055}px 'Trebuchet MS', sans-serif`;
    ctx.fillText(`Best drink: ${DRINKS[this.maxTierMade].name}`, this.W / 2, py + ph * f.bestDrink);
    ctx.font = `bold ${pw * 0.085}px 'Trebuchet MS', sans-serif`;
    ctx.fillText(`Score: ${this.score.toLocaleString()}`, this.W / 2, py + ph * f.score);
    ctx.font = `${pw * 0.05}px 'Trebuchet MS', sans-serif`;
    ctx.fillStyle = '#8a6a3a';
    ctx.fillText(`Best: ${this.best.toLocaleString()}`, this.W / 2, py + ph * f.best);

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

      // onchain save status (auto-saves new bests; tappable when action needed)
      let serveText: string;
      let serveTappable = false;
      let serveColor = '#8a6a3a';
      if (!oc.address) {
        serveText = '⛓ Tap to connect & save this score onchain';
        serveTappable = true;
        serveColor = '#f2811d';
      } else {
        switch (oc.status) {
          case 'connecting':
          case 'switching':
          case 'signing':
            serveText = 'Confirm in wallet to save your new best…';
            break;
          case 'confirming':
            serveText = 'Saving your new best onchain…';
            break;
          case 'success':
            serveText = 'New best saved onchain ✓';
            serveColor = '#2eb872';
            break;
          case 'error':
            serveText = `Save failed — tap to retry (${oc.error ?? ''})`;
            serveTappable = true;
            serveColor = '#c0392b';
            break;
          default: {
            const beatsScore = this.score > Number(oc.myBest ?? 0n);
            serveTappable = this.runWorthSaving(true);
            if (!serveTappable) {
              serveText = `Onchain best: ${(oc.myBest ?? 0n).toLocaleString()} — not beaten this run`;
            } else if (beatsScore) {
              serveText = '⛓ Tap to save this score onchain';
            } else if (oc.badges !== null) {
              serveText = '⛓ Tap to save your new milestone onchain';
            } else {
              // tier 5+ run, badge cache not loaded — offer the save neutrally
              serveText = '⛓ Tap to save this run onchain';
            }
          }
        }
      }
      ctx.font = `${serveTappable ? 'bold ' : ''}${pw * 0.042}px 'Trebuchet MS', sans-serif`;
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

      // leaderboard link
      ctx.font = `bold ${pw * 0.05}px 'Trebuchet MS', sans-serif`;
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
    }
  }
}

// ------------------------------------------------------------------ helpers

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
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

function button(ctx: CanvasRenderingContext2D, r: Rect, color: string, label: string): void {
  roundRect(ctx, r.x, r.y, r.w, r.h, r.h / 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${r.h * 0.42}px 'Trebuchet MS', sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 1);
  ctx.textBaseline = 'alphabetic';
}
