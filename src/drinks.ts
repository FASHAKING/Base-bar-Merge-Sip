// Drink tier definitions and procedural side-view rendering.
// Each drink is a real glass: silhouette, liquid gradient, glass shine, rim,
// stem/foot where the glassware calls for it, and a tier-specific garnish.
// The physics body is a circle of radius r; each glass is drawn to visually
// fill that circle (total height ~2.1r).

export type GlassShape =
  | 'shot'
  | 'tumbler'
  | 'tall'
  | 'coupe'
  | 'hurricane'
  | 'highball'
  | 'mojito'
  | 'tulip'
  | 'sunset'
  | 'tiki';

export interface DrinkDef {
  name: string;
  liquid: string; // main liquid color
  liquidEdge: string; // darker edge of the liquid gradient
  rim: string; // glass tint
  shape: GlassShape;
  radiusFrac: number; // radius as a fraction of board width
  score: number; // points awarded when created via a merge
}

export const DRINKS: DrinkDef[] = [
  { name: 'Cola Pop',         liquid: '#7a4a2a', liquidEdge: '#3b2417', rim: '#e8f4ff', shape: 'shot',      radiusFrac: 0.048, score: 10 },
  { name: 'Lemon Fizz',       liquid: '#ffe66d', liquidEdge: '#e0a92e', rim: '#ffffff', shape: 'tumbler',   radiusFrac: 0.056, score: 20 },
  { name: 'Lime Cooler',      liquid: '#a8e05f', liquidEdge: '#5da32b', rim: '#f0fff0', shape: 'tall',      radiusFrac: 0.064, score: 40 },
  { name: 'Pink Punch',       liquid: '#ff8fc7', liquidEdge: '#d8478f', rim: '#fff0f7', shape: 'coupe',     radiusFrac: 0.073, score: 80 },
  { name: 'Orange Sunrise',   liquid: '#ffb347', liquidEdge: '#e86f18', rim: '#fff7ec', shape: 'hurricane', radiusFrac: 0.082, score: 150 },
  { name: 'Blueberry Breeze', liquid: '#6d8dff', liquidEdge: '#3450cc', rim: '#eef2ff', shape: 'highball',  radiusFrac: 0.092, score: 250 },
  { name: 'Mojito Royale',    liquid: '#7fe3c0', liquidEdge: '#2ba379', rim: '#f0fffa', shape: 'mojito',    radiusFrac: 0.102, score: 400 },
  { name: 'Berry Colada',     liquid: '#c77dff', liquidEdge: '#8339cc', rim: '#f9f0ff', shape: 'tulip',     radiusFrac: 0.113, score: 650 },
  { name: 'Sunset Slush',     liquid: '#ffd166', liquidEdge: '#e43d3b', rim: '#fff1ec', shape: 'sunset',    radiusFrac: 0.124, score: 1000 },
  { name: 'Legendary Tiki',   liquid: '#ffd166', liquidEdge: '#e08c00', rim: '#fff8d6', shape: 'tiki',      radiusFrac: 0.137, score: 2000 },
];

export const MAX_TIER = DRINKS.length - 1;

/** Sentinel tier for the wildcard shaker (merges with any drink). */
export const WILD_TIER = -1;
/** Wildcard physics radius as a fraction of board width (small, easy to slot). */
export const WILD_RADIUS_FRAC = 0.06;

/** Wildcard: a silver cocktail shaker with a shifting rainbow band. */
export function drawWild(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  wobble = 0,
  time = 0,
): void {
  ctx.save();
  ctx.translate(x, y);
  if (wobble) ctx.rotate(wobble);

  // soft shadow under the base
  ctx.beginPath();
  ctx.ellipse(0, r * 0.98, r * 0.85, r * 0.22, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(90, 60, 20, 0.2)';
  ctx.fill();

  // pulsing rainbow glow so it reads as special at a glance
  const hue = (time * 80) % 360;
  const glow = ctx.createRadialGradient(0, 0, r * 0.4, 0, 0, r * 1.45);
  glow.addColorStop(0, `hsla(${hue}, 90%, 65%, 0.45)`);
  glow.addColorStop(1, `hsla(${hue}, 90%, 65%, 0)`);
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.45, 0, Math.PI * 2);
  ctx.fillStyle = glow;
  ctx.fill();

  // shaker body (tapered cup)
  const topW = r * 0.62;
  const botW = r * 0.78;
  const topY = -r * 0.35;
  const botY = r * 0.95;
  ctx.beginPath();
  ctx.moveTo(-topW, topY);
  ctx.lineTo(-botW, botY - r * 0.12);
  ctx.quadraticCurveTo(-botW, botY, -botW + r * 0.14, botY);
  ctx.lineTo(botW - r * 0.14, botY);
  ctx.quadraticCurveTo(botW, botY, botW, botY - r * 0.12);
  ctx.lineTo(topW, topY);
  ctx.closePath();
  const steel = ctx.createLinearGradient(-botW, 0, botW, 0);
  steel.addColorStop(0, '#aeb9c9');
  steel.addColorStop(0.35, '#f4f7fb');
  steel.addColorStop(0.65, '#dde5ee');
  steel.addColorStop(1, '#96a2b4');
  ctx.fillStyle = steel;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = Math.max(1.2, r * 0.07);
  ctx.stroke();

  // rainbow band around the middle
  ctx.save();
  ctx.clip();
  const bandY = r * 0.18;
  const bandH = r * 0.3;
  const colors = ['#ff6b6b', '#ffb347', '#ffe66d', '#7fe3c0', '#6d8dff', '#c77dff'];
  const bw = (botW * 2) / colors.length;
  for (let i = 0; i < colors.length; i++) {
    ctx.fillStyle = colors[(i + Math.floor(time * 3)) % colors.length];
    ctx.fillRect(-botW + i * bw, bandY, bw + 1, bandH);
  }
  ctx.restore();

  // neck + cap
  ctx.beginPath();
  ctx.moveTo(-topW * 0.85, topY);
  ctx.lineTo(-topW * 0.6, -r * 0.72);
  ctx.lineTo(topW * 0.6, -r * 0.72);
  ctx.lineTo(topW * 0.85, topY);
  ctx.closePath();
  ctx.fillStyle = '#cfd8e4';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(0, -r * 0.78, topW * 0.45, r * 0.12, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#f4f7fb';
  ctx.fill();
  ctx.stroke();

  // shine
  ctx.beginPath();
  ctx.moveTo(-topW * 0.55, topY + r * 0.15);
  ctx.quadraticCurveTo(-botW * 0.6, r * 0.3, -botW * 0.5, botY - r * 0.25);
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = Math.max(1.2, r * 0.09);
  ctx.lineCap = 'round';
  ctx.stroke();

  // sparkle
  star(ctx, topW * 0.75, -r * 0.9, r * 0.22, '#fff9d6', '#f4a300');
  ctx.restore();
}

/** Draw a drink (side view) centered at (x, y) fitting a circle of radius r. */
export function drawDrink(
  ctx: CanvasRenderingContext2D,
  tier: number,
  x: number,
  y: number,
  r: number,
  wobble = 0,
): void {
  const d = DRINKS[tier];
  ctx.save();
  ctx.translate(x, y);
  if (wobble) ctx.rotate(wobble);

  // soft shadow under the base
  ctx.beginPath();
  ctx.ellipse(0, r * 0.98, r * 0.85, r * 0.22, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(90, 60, 20, 0.2)';
  ctx.fill();

  // legendary glow
  if (tier === MAX_TIER) {
    const glow = ctx.createRadialGradient(0, 0, r * 0.5, 0, 0, r * 1.5);
    glow.addColorStop(0, 'rgba(255, 215, 80, 0.5)');
    glow.addColorStop(1, 'rgba(255, 215, 80, 0)');
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.5, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();
  }

  switch (d.shape) {
    case 'shot':      tumblerGlass(ctx, r, d, 1.05, 0.85, 1.4, 0.15); break;
    case 'tumbler':   tumblerGlass(ctx, r, d, 1.25, 0.95, 1.9, -0.35); break;
    case 'tall':      tumblerGlass(ctx, r, d, 1.15, 0.8, 2.05, -0.45); break;
    case 'coupe':     coupeGlass(ctx, r, d); break;
    case 'hurricane': hurricaneGlass(ctx, r, d, null); break;
    case 'highball':  tumblerGlass(ctx, r, d, 1.2, 1.0, 2.05, -0.45); break;
    case 'mojito':    tumblerGlass(ctx, r, d, 1.3, 0.95, 2.0, -0.42); break;
    case 'tulip':     tulipGlass(ctx, r, d); break;
    case 'sunset':    hurricaneGlass(ctx, r, d, ['#ffd166', '#ff7e5f', '#e43d3b']); break;
    case 'tiki':      tikiMug(ctx, r, d); break;
  }

  drawGarnish(ctx, tier, r);
  ctx.restore();
}

// ------------------------------------------------------------- glass shapes

function liquidGradient(
  ctx: CanvasRenderingContext2D,
  d: DrinkDef,
  top: number,
  bottom: number,
): CanvasGradient {
  const g = ctx.createLinearGradient(0, top, 0, bottom);
  g.addColorStop(0, d.liquid);
  g.addColorStop(1, d.liquidEdge);
  return g;
}

function glassFinish(
  ctx: CanvasRenderingContext2D,
  r: number,
  topW: number,
  top: number,
): void {
  // rim
  ctx.beginPath();
  ctx.ellipse(0, top, topW, topW * 0.16, 0, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = Math.max(1.2, r * 0.06);
  ctx.stroke();
  // liquid surface sheen
  ctx.beginPath();
  ctx.ellipse(0, top + r * 0.06, topW * 0.82, topW * 0.13, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fill();
}

function shine(
  ctx: CanvasRenderingContext2D,
  r: number,
  xAtTop: number,
  top: number,
  xAtBottom: number,
  bottom: number,
): void {
  ctx.beginPath();
  ctx.moveTo(xAtTop, top);
  ctx.quadraticCurveTo((xAtTop + xAtBottom) / 2 - r * 0.06, (top + bottom) / 2, xAtBottom, bottom);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = Math.max(1.2, r * 0.09);
  ctx.lineCap = 'round';
  ctx.stroke();
}

function outline(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = Math.max(1.2, r * 0.07);
  ctx.stroke();
}

/** Straight-sided glass: shot, tumbler, highball, mojito. */
function tumblerGlass(
  ctx: CanvasRenderingContext2D,
  r: number,
  d: DrinkDef,
  topWF: number,
  botWF: number,
  hF: number,
  topOffF: number,
): void {
  const topW = (r * topWF) / 2 + r * 0.28;
  const botW = (r * botWF) / 2 + r * 0.22;
  const top = r * topOffF - (r * hF) / 2 + r * (hF / 2 + topOffF > 0 ? 0 : 0); // top y
  const topY = r * topOffF;
  const botY = topY + r * hF > r ? r * 0.95 : topY + r * hF;
  const h = botY - topY;

  ctx.beginPath();
  ctx.moveTo(-topW, topY);
  ctx.lineTo(-botW, botY - r * 0.12);
  ctx.quadraticCurveTo(-botW, botY, -botW + r * 0.14, botY);
  ctx.lineTo(botW - r * 0.14, botY);
  ctx.quadraticCurveTo(botW, botY, botW, botY - r * 0.12);
  ctx.lineTo(topW, topY);
  ctx.closePath();
  ctx.fillStyle = liquidGradient(ctx, d, topY, botY);
  ctx.fill();
  outline(ctx, r);
  shine(ctx, r, -topW * 0.7, topY + h * 0.15, -botW * 0.6, botY - h * 0.18);
  glassFinish(ctx, r, topW, topY);
  void top;
}

/** Wide shallow bowl on a stem: Pink Punch. */
function coupeGlass(ctx: CanvasRenderingContext2D, r: number, d: DrinkDef): void {
  const topW = r * 0.95;
  const topY = -r * 0.72;
  const bowlBot = r * 0.05;

  stemAndFoot(ctx, r, bowlBot);

  ctx.beginPath();
  ctx.moveTo(-topW, topY);
  ctx.quadraticCurveTo(-topW * 0.9, bowlBot, 0, bowlBot);
  ctx.quadraticCurveTo(topW * 0.9, bowlBot, topW, topY);
  ctx.closePath();
  ctx.fillStyle = liquidGradient(ctx, d, topY, bowlBot);
  ctx.fill();
  outline(ctx, r);
  shine(ctx, r, -topW * 0.65, topY + r * 0.2, -topW * 0.3, bowlBot - r * 0.18);
  glassFinish(ctx, r, topW, topY);
}

/** Curvy tall glass on a small foot: Orange Sunrise / Sunset Slush. */
function hurricaneGlass(
  ctx: CanvasRenderingContext2D,
  r: number,
  d: DrinkDef,
  bands: string[] | null,
): void {
  const topW = r * 0.62;
  const topY = -r * 1.0;
  const botY = r * 0.62;

  stemAndFoot(ctx, r, botY);

  ctx.beginPath();
  ctx.moveTo(-topW, topY);
  ctx.bezierCurveTo(-topW * 1.35, -r * 0.25, -topW * 0.4, -r * 0.05, -topW * 0.75, botY);
  ctx.lineTo(topW * 0.75, botY);
  ctx.bezierCurveTo(topW * 0.4, -r * 0.05, topW * 1.35, -r * 0.25, topW, topY);
  ctx.closePath();

  if (bands) {
    // layered sunset gradient
    const g = ctx.createLinearGradient(0, topY, 0, botY);
    bands.forEach((c, i) => g.addColorStop(i / (bands.length - 1), c));
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = liquidGradient(ctx, d, topY, botY);
  }
  ctx.fill();
  outline(ctx, r);
  shine(ctx, r, -topW * 0.72, topY + r * 0.25, -topW * 0.5, botY - r * 0.25);
  glassFinish(ctx, r, topW, topY);
}

/** Goblet with a rounded bowl: Berry Colada. */
function tulipGlass(ctx: CanvasRenderingContext2D, r: number, d: DrinkDef): void {
  const topW = r * 0.72;
  const topY = -r * 0.85;
  const botY = r * 0.35;

  stemAndFoot(ctx, r, botY);

  ctx.beginPath();
  ctx.moveTo(-topW, topY);
  ctx.bezierCurveTo(-topW * 1.35, topY + r * 0.75, -topW * 0.95, botY, 0, botY);
  ctx.bezierCurveTo(topW * 0.95, botY, topW * 1.35, topY + r * 0.75, topW, topY);
  ctx.closePath();
  ctx.fillStyle = liquidGradient(ctx, d, topY, botY);
  ctx.fill();
  outline(ctx, r);
  shine(ctx, r, -topW * 0.7, topY + r * 0.22, -topW * 0.4, botY - r * 0.2);

  // cream swirl cap
  ctx.beginPath();
  ctx.ellipse(0, topY - r * 0.05, topW * 0.85, r * 0.2, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,250,240,0.95)';
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, topY - r * 0.18, topW * 0.5, r * 0.14, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#fff6e8';
  ctx.fill();
  glassFinish(ctx, r, topW, topY);
}

/** Carved barrel mug: Legendary Tiki. */
function tikiMug(ctx: CanvasRenderingContext2D, r: number, d: DrinkDef): void {
  const topW = r * 0.85;
  const topY = -r * 0.85;
  const botY = r * 0.95;

  ctx.beginPath();
  ctx.moveTo(-topW, topY);
  ctx.bezierCurveTo(-topW * 1.25, -r * 0.1, -topW * 1.05, r * 0.5, -topW * 0.8, botY);
  ctx.lineTo(topW * 0.8, botY);
  ctx.bezierCurveTo(topW * 1.05, r * 0.5, topW * 1.25, -r * 0.1, topW, topY);
  ctx.closePath();
  const wood = ctx.createLinearGradient(0, topY, 0, botY);
  wood.addColorStop(0, '#a9713a');
  wood.addColorStop(1, '#6f4320');
  ctx.fillStyle = wood;
  ctx.fill();
  ctx.strokeStyle = '#f4d06f';
  ctx.lineWidth = Math.max(1.5, r * 0.08);
  ctx.stroke();

  // carved face: brows, eyes, zigzag mouth
  ctx.strokeStyle = '#3f2410';
  ctx.lineWidth = Math.max(1.5, r * 0.09);
  ctx.lineCap = 'round';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(s * topW * 0.55, -r * 0.28);
    ctx.quadraticCurveTo(s * topW * 0.3, -r * 0.42, s * topW * 0.12, -r * 0.3);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(s * topW * 0.32, -r * 0.1, r * 0.09, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  const mw = topW * 0.66;
  ctx.moveTo(-mw, r * 0.35);
  for (let i = 1; i <= 6; i++) {
    ctx.lineTo(-mw + (i * mw * 2) / 6, r * 0.35 + (i % 2 ? r * 0.14 : 0));
  }
  ctx.stroke();

  // golden liquid at the top
  ctx.beginPath();
  ctx.ellipse(0, topY, topW, topW * 0.22, 0, 0, Math.PI * 2);
  ctx.fillStyle = d.liquid;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = Math.max(1.2, r * 0.06);
  ctx.stroke();
}

function stemAndFoot(ctx: CanvasRenderingContext2D, r: number, bowlBottom: number): void {
  const footY = r * 0.95;
  ctx.beginPath();
  ctx.moveTo(-r * 0.07, bowlBottom);
  ctx.lineTo(-r * 0.07, footY - r * 0.08);
  ctx.lineTo(-r * 0.42, footY);
  ctx.lineTo(r * 0.42, footY);
  ctx.lineTo(r * 0.07, footY - r * 0.08);
  ctx.lineTo(r * 0.07, bowlBottom);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = Math.max(1, r * 0.05);
  ctx.stroke();
}

// ---------------------------------------------------------------- garnishes

function drawGarnish(ctx: CanvasRenderingContext2D, tier: number, r: number): void {
  switch (tier) {
    case 0: // cola: red straw + bubbles
      straw(ctx, r, -r * 0.2, -r * 0.55, '#e74c3c');
      bubbles(ctx, r, -r * 0.1, 'rgba(255,255,255,0.5)');
      break;
    case 1: // lemon slice on rim + blue straw
      citrusSlice(ctx, r * 0.62, -r * 0.62, r * 0.34, '#fff9c4', '#f5c518');
      straw(ctx, r, -r * 0.28, -r * 0.72, '#3aa3e0');
      break;
    case 2: // lime wedge + mint at rim
      citrusSlice(ctx, r * 0.55, -r * 0.78, r * 0.32, '#e8ffd6', '#7cb342');
      mint(ctx, -r * 0.35, -r * 1.02, r * 0.26);
      break;
    case 3: // cherries over the coupe
      cherry(ctx, r * 0.35, -r * 0.88, r * 0.17);
      cherry(ctx, r * 0.58, -r * 0.72, r * 0.14);
      straw(ctx, r, -r * 0.4, -r * 1.0, '#ff6fa5');
      break;
    case 4: // orange slice + umbrella
      citrusSlice(ctx, -r * 0.58, -r * 0.92, r * 0.36, '#ffe0b2', '#f57c00');
      umbrella(ctx, r * 0.5, -r * 1.05, r * 0.48, '#e84393', '#fdcb6e');
      break;
    case 5: // blueberries on a pick + white straw
      pick(ctx, r * 0.3, -r * 1.0, r * 0.5);
      berry(ctx, r * 0.3, -r * 1.18, r * 0.13, '#2e3ea8');
      berry(ctx, r * 0.3, -r * 0.95, r * 0.12, '#3b4fd0');
      straw(ctx, r, -r * 0.32, -r * 0.78, '#ffffff');
      break;
    case 6: // mint crown + lime on rim
      mint(ctx, 0, -r * 1.02, r * 0.3);
      mint(ctx, -r * 0.38, -r * 0.92, r * 0.24);
      mint(ctx, r * 0.38, -r * 0.92, r * 0.24);
      citrusSlice(ctx, r * 0.68, -r * 0.62, r * 0.28, '#e8ffd6', '#7cb342');
      break;
    case 7: // cherry on the cream + berries
      cherry(ctx, 0, -r * 1.12, r * 0.16);
      berry(ctx, -r * 0.45, -r * 0.95, r * 0.13, '#5f27cd');
      straw(ctx, r, r * 0.38, -r * 1.0, '#ff9ff3');
      break;
    case 8: // umbrella + orange + cherry
      umbrella(ctx, -r * 0.45, -r * 1.12, r * 0.55, '#00b894', '#ffeaa7');
      citrusSlice(ctx, r * 0.55, -r * 0.95, r * 0.36, '#ffe0b2', '#f57c00');
      cherry(ctx, r * 0.2, -r * 1.05, r * 0.15);
      break;
    case 9: // the works: star pick, umbrella, cherries, mint
      pick(ctx, 0, -r * 0.9, r * 0.45);
      star(ctx, 0, -r * 1.35, r * 0.26, '#fff3b0', '#f4a300');
      umbrella(ctx, r * 0.55, -r * 1.1, r * 0.55, '#e63946', '#ffd166');
      cherry(ctx, -r * 0.45, -r * 0.98, r * 0.16);
      cherry(ctx, -r * 0.65, -r * 0.82, r * 0.13);
      mint(ctx, -r * 0.15, -r * 1.0, r * 0.24);
      break;
  }
}

function straw(
  ctx: CanvasRenderingContext2D,
  r: number,
  xTop: number,
  yTop: number,
  color: string,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(xTop, yTop - r * 0.55);
  ctx.lineTo(xTop + r * 0.18, yTop + r * 0.15);
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, r * 0.13);
  ctx.lineCap = 'round';
  ctx.stroke();
  // stripe
  ctx.beginPath();
  ctx.moveTo(xTop + r * 0.02, yTop - r * 0.45);
  ctx.lineTo(xTop + r * 0.06, yTop - r * 0.28);
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = Math.max(1, r * 0.05);
  ctx.stroke();
  ctx.restore();
}

function pick(ctx: CanvasRenderingContext2D, x: number, yTop: number, len: number): void {
  ctx.beginPath();
  ctx.moveTo(x, yTop - len);
  ctx.lineTo(x, yTop + len * 0.3);
  ctx.strokeStyle = '#8d6e63';
  ctx.lineWidth = Math.max(1.5, len * 0.12);
  ctx.lineCap = 'round';
  ctx.stroke();
}

function bubbles(ctx: CanvasRenderingContext2D, r: number, y: number, color: string): void {
  ctx.fillStyle = color;
  const spots: [number, number, number][] = [
    [-0.25, 0.15, 0.07],
    [0.12, 0.32, 0.06],
    [0.28, 0.02, 0.05],
    [-0.05, 0.45, 0.05],
  ];
  for (const [fx, fy, fr] of spots) {
    ctx.beginPath();
    ctx.arc(fx * r, y + fy * r, fr * r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function citrusSlice(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  sr: number,
  flesh: string,
  peel: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.arc(0, 0, sr, 0, Math.PI * 2);
  ctx.fillStyle = peel;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, sr * 0.82, 0, Math.PI * 2);
  ctx.fillStyle = flesh;
  ctx.fill();
  ctx.strokeStyle = peel;
  ctx.lineWidth = sr * 0.1;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * sr * 0.78, Math.sin(a) * sr * 0.78);
    ctx.stroke();
  }
  ctx.restore();
}

function cherry(ctx: CanvasRenderingContext2D, x: number, y: number, cr: number): void {
  // stem
  ctx.beginPath();
  ctx.moveTo(x, y - cr * 0.8);
  ctx.quadraticCurveTo(x + cr * 0.7, y - cr * 2, x + cr * 1.1, y - cr * 2.2);
  ctx.strokeStyle = '#7cb342';
  ctx.lineWidth = Math.max(1, cr * 0.22);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, cr, 0, Math.PI * 2);
  ctx.fillStyle = '#d63031';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x - cr * 0.3, y - cr * 0.3, cr * 0.3, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fill();
}

function berry(ctx: CanvasRenderingContext2D, x: number, y: number, br: number, color: string): void {
  ctx.beginPath();
  ctx.arc(x, y, br, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x - br * 0.25, y - br * 0.25, br * 0.28, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fill();
}

function mint(ctx: CanvasRenderingContext2D, x: number, y: number, mr: number): void {
  ctx.save();
  ctx.translate(x, y);
  for (const a of [-0.7, 0, 0.7]) {
    ctx.save();
    ctx.rotate(a);
    ctx.beginPath();
    ctx.ellipse(0, -mr * 0.5, mr * 0.32, mr * 0.6, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#2eb872';
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

function umbrella(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ur: number,
  c1: string,
  c2: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(0.35);
  // stick
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, ur * 1.1);
  ctx.strokeStyle = '#8d6e63';
  ctx.lineWidth = Math.max(1.5, ur * 0.09);
  ctx.stroke();
  // canopy (upper half fan)
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, ur, Math.PI + (i / 6) * Math.PI, Math.PI + ((i + 1) / 6) * Math.PI);
    ctx.closePath();
    ctx.fillStyle = i % 2 ? c1 : c2;
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(0, 0, ur * 0.12, 0, Math.PI * 2);
  ctx.fillStyle = '#8d6e63';
  ctx.fill();
  ctx.restore();
}

function star(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  sr: number,
  fill: string,
  stroke: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 === 0 ? sr : sr * 0.45;
    const px = Math.cos(a) * rr;
    const py = Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = sr * 0.12;
  ctx.strokeStyle = stroke;
  ctx.stroke();
  ctx.restore();
}
