// Drink tier definitions and procedural top-down rendering.
// Each drink is drawn as a glass seen from above: rim, liquid, foam/swirl,
// and a tier-specific garnish so every tier reads distinctly at a glance.

export interface DrinkDef {
  name: string;
  liquid: string; // main liquid color
  liquidEdge: string; // darker edge of the liquid gradient
  rim: string; // glass rim tint
  radiusFrac: number; // radius as a fraction of board width
  score: number; // points awarded when created via a merge
}

export const DRINKS: DrinkDef[] = [
  { name: 'Cola Pop',         liquid: '#6b4226', liquidEdge: '#3b2417', rim: '#e8f4ff', radiusFrac: 0.048, score: 10 },
  { name: 'Lemon Fizz',       liquid: '#ffe66d', liquidEdge: '#e0b52e', rim: '#ffffff', radiusFrac: 0.056, score: 20 },
  { name: 'Lime Cooler',      liquid: '#a8e05f', liquidEdge: '#6cb52d', rim: '#f0fff0', radiusFrac: 0.064, score: 40 },
  { name: 'Pink Punch',       liquid: '#ff8fc7', liquidEdge: '#e0559d', rim: '#fff0f7', radiusFrac: 0.073, score: 80 },
  { name: 'Orange Sunrise',   liquid: '#ffb347', liquidEdge: '#f2811d', rim: '#fff7ec', radiusFrac: 0.082, score: 150 },
  { name: 'Blueberry Breeze', liquid: '#6d8dff', liquidEdge: '#3b5bdb', rim: '#eef2ff', radiusFrac: 0.092, score: 250 },
  { name: 'Mojito Royale',    liquid: '#7fe3c0', liquidEdge: '#37b98a', rim: '#f0fffa', radiusFrac: 0.102, score: 400 },
  { name: 'Berry Colada',     liquid: '#c77dff', liquidEdge: '#9145d8', rim: '#f9f0ff', radiusFrac: 0.113, score: 650 },
  { name: 'Sunset Slush',     liquid: '#ff7e5f', liquidEdge: '#eb4d4b', rim: '#fff1ec', radiusFrac: 0.124, score: 1000 },
  { name: 'Legendary Tiki',   liquid: '#ffd166', liquidEdge: '#f4a300', rim: '#fff8d6', radiusFrac: 0.137, score: 2000 },
];

export const MAX_TIER = DRINKS.length - 1;

/** Draw a drink (top view) centered at (x, y) with radius r. */
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

  // soft drop shadow on the sand
  ctx.beginPath();
  ctx.ellipse(r * 0.08, r * 0.12, r, r * 0.94, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(90, 60, 20, 0.18)';
  ctx.fill();

  // legendary glow
  if (tier === MAX_TIER) {
    const glow = ctx.createRadialGradient(0, 0, r * 0.6, 0, 0, r * 1.45);
    glow.addColorStop(0, 'rgba(255, 215, 80, 0.55)');
    glow.addColorStop(1, 'rgba(255, 215, 80, 0)');
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.45, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();
  }

  // glass rim
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = d.rim;
  ctx.fill();
  ctx.lineWidth = Math.max(1, r * 0.05);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.stroke();

  // liquid
  const liq = ctx.createRadialGradient(-r * 0.25, -r * 0.25, r * 0.1, 0, 0, r * 0.86);
  liq.addColorStop(0, d.liquid);
  liq.addColorStop(1, d.liquidEdge);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.84, 0, Math.PI * 2);
  ctx.fillStyle = liq;
  ctx.fill();

  // glossy highlight
  ctx.beginPath();
  ctx.ellipse(-r * 0.3, -r * 0.34, r * 0.3, r * 0.17, -0.6, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fill();

  drawGarnish(ctx, tier, r);
  ctx.restore();
}

function drawGarnish(ctx: CanvasRenderingContext2D, tier: number, r: number): void {
  switch (tier) {
    case 0: { // cola: bubbles + red straw
      bubbles(ctx, r, 'rgba(255,255,255,0.5)');
      straw(ctx, r, '#e74c3c');
      break;
    }
    case 1: { // lemon slice on rim
      citrusSlice(ctx, r * 0.72, -r * 0.55, r * 0.42, '#fff9c4', '#f5c518');
      straw(ctx, r, '#3aa3e0');
      break;
    }
    case 2: { // lime wedge + mint
      citrusSlice(ctx, r * 0.7, -r * 0.55, r * 0.42, '#e8ffd6', '#7cb342');
      mint(ctx, -r * 0.55, r * 0.5, r * 0.3);
      break;
    }
    case 3: { // cherry pair
      cherry(ctx, r * 0.45, -r * 0.45, r * 0.2);
      cherry(ctx, r * 0.72, -r * 0.28, r * 0.17);
      straw(ctx, r, '#ff6fa5');
      break;
    }
    case 4: { // orange slice + umbrella
      citrusSlice(ctx, -r * 0.62, -r * 0.55, r * 0.48, '#ffe0b2', '#f57c00');
      umbrella(ctx, r * 0.45, -r * 0.4, r * 0.55, '#e84393', '#fdcb6e');
      break;
    }
    case 5: { // blueberries
      berry(ctx, r * 0.4, -r * 0.4, r * 0.16, '#2e3ea8');
      berry(ctx, r * 0.62, -r * 0.15, r * 0.14, '#3b4fd0');
      berry(ctx, r * 0.25, -r * 0.65, r * 0.13, '#3b4fd0');
      straw(ctx, r, '#ffffff');
      break;
    }
    case 6: { // mint crown
      mint(ctx, 0, -r * 0.55, r * 0.34);
      mint(ctx, -r * 0.42, -r * 0.35, r * 0.28);
      mint(ctx, r * 0.42, -r * 0.35, r * 0.28);
      citrusSlice(ctx, r * 0.66, r * 0.5, r * 0.34, '#e8ffd6', '#7cb342');
      break;
    }
    case 7: { // cream swirl + berries
      swirl(ctx, r * 0.5, 'rgba(255,255,255,0.65)');
      cherry(ctx, r * 0.5, -r * 0.5, r * 0.18);
      berry(ctx, -r * 0.55, -r * 0.4, r * 0.15, '#5f27cd');
      break;
    }
    case 8: { // sunset: umbrella + orange + cherry
      umbrella(ctx, -r * 0.42, -r * 0.42, r * 0.6, '#00b894', '#ffeaa7');
      citrusSlice(ctx, r * 0.62, -r * 0.5, r * 0.44, '#ffe0b2', '#f57c00');
      cherry(ctx, r * 0.3, r * 0.55, r * 0.16);
      break;
    }
    case 9: { // legendary tiki: star, umbrella, cherries, golden ring
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.92, 0, Math.PI * 2);
      ctx.lineWidth = r * 0.07;
      ctx.strokeStyle = '#ffb703';
      ctx.stroke();
      star(ctx, 0, -r * 0.1, r * 0.32, '#fff3b0', '#f4a300');
      umbrella(ctx, r * 0.5, -r * 0.45, r * 0.62, '#e63946', '#ffd166');
      cherry(ctx, -r * 0.5, -r * 0.45, r * 0.18);
      cherry(ctx, -r * 0.68, -r * 0.2, r * 0.15);
      mint(ctx, -r * 0.2, r * 0.6, r * 0.3);
      break;
    }
  }
}

function bubbles(ctx: CanvasRenderingContext2D, r: number, color: string): void {
  ctx.fillStyle = color;
  const spots: [number, number, number][] = [
    [-0.3, 0.25, 0.09],
    [0.15, 0.4, 0.07],
    [0.35, 0.1, 0.06],
    [-0.1, -0.1, 0.05],
  ];
  for (const [fx, fy, fr] of spots) {
    ctx.beginPath();
    ctx.arc(fx * r, fy * r, fr * r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function straw(ctx: CanvasRenderingContext2D, r: number, color: string): void {
  ctx.save();
  ctx.rotate(0.7);
  ctx.beginPath();
  ctx.arc(0, -r * 0.55, r * 0.13, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, -r * 0.55, r * 0.06, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fill();
  ctx.restore();
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
  for (let i = 0; i < 8; i++) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, ur, (i / 8) * Math.PI * 2, ((i + 1) / 8) * Math.PI * 2);
    ctx.closePath();
    ctx.fillStyle = i % 2 ? c1 : c2;
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(0, 0, ur * 0.14, 0, Math.PI * 2);
  ctx.fillStyle = '#8d6e63';
  ctx.fill();
  ctx.restore();
}

function swirl(ctx: CanvasRenderingContext2D, sr: number, color: string): void {
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = sr * 0.28;
  ctx.lineCap = 'round';
  for (let a = 0; a < Math.PI * 4; a += 0.15) {
    const rr = sr * (a / (Math.PI * 4));
    const px = Math.cos(a) * rr;
    const py = Math.sin(a) * rr;
    if (a === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
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
