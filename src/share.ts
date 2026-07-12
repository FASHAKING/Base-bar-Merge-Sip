// Score-card image generation and sharing to X (Twitter).
// The card is rendered client-side with the game's own drink art.

import { DRINKS, drawDrink } from './drinks.ts';
import { APP_URL, openExternal } from './base.ts';
import { challengeUrl } from './modes.ts';

const FONT = "'Fredoka', 'Trebuchet MS', sans-serif";

/** Render a 1000x1000 score card PNG blob. */
export async function renderScoreCard(
  score: number,
  tier: number,
  username: string | null,
): Promise<Blob> {
  const size = 1000;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;

  // beach ground
  const g = ctx.createLinearGradient(0, 0, 0, size);
  g.addColorStop(0, '#8fd8f0');
  g.addColorStop(0.55, '#bfeaf7');
  g.addColorStop(0.75, '#f7e2b0');
  g.addColorStop(1, '#efd193');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  ctx.beginPath();
  ctx.arc(size * 0.83, size * 0.14, size * 0.1, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,240,170,0.9)';
  ctx.fill();

  // card
  roundedRect(ctx, 70, 90, size - 140, size - 180, 46);
  ctx.fillStyle = '#fff8ec';
  ctx.fill();
  ctx.lineWidth = 14;
  ctx.strokeStyle = '#c07d3e';
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.fillStyle = '#c0392b';
  ctx.font = `bold 78px ${FONT}`;
  ctx.fillText('MERGE SIP', size / 2, 215);

  ctx.fillStyle = '#8a6a3a';
  ctx.font = `44px ${FONT}`;
  ctx.fillText(username ? `@${username}` : 'anonymous mixologist', size / 2, 285);

  drawDrink(ctx, tier, size / 2, 470, 130);

  ctx.fillStyle = '#5a3410';
  ctx.font = `bold 110px ${FONT}`;
  ctx.fillText(score.toLocaleString(), size / 2, 730);

  ctx.fillStyle = '#6b4a22';
  ctx.font = `44px ${FONT}`;
  ctx.fillText(`Best drink: ${DRINKS[tier].name}`, size / 2, 800);

  ctx.fillStyle = '#8a6a3a';
  ctx.font = `34px ${FONT}`;
  ctx.fillText('Served on Base 🔵 — come out-pour me!', size / 2, 862);

  return new Promise((resolve, reject) => {
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
  });
}

/**
 * Share the score card to X. Mobile: the native share sheet with the image
 * attached (pick X there). Desktop/fallback: download the image and open a
 * prefilled tweet composer to attach it to.
 */
export async function shareToX(
  score: number,
  tier: number,
  username: string | null,
  daily: number | null = null,
): Promise<void> {
  const dailyTag = daily ? `Daily Mix #${daily}: ` : '';
  const text = `${dailyTag}I scored ${score.toLocaleString()} mixing my way to a ${DRINKS[tier].name} in Merge Sip 🍹 Can you out-pour me?`;
  const url = challengeUrl(APP_URL, score, username);
  try {
    const blob = await renderScoreCard(score, tier, username);
    const file = new File([blob], 'merge-sip-score.png', { type: 'image/png' });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.canShare?.({ files: [file] })) {
      // native share sheet with the image attached — pick X there
      try {
        await nav.share({ files: [file], text: `${text} ${url}` });
      } catch {
        /* user closed the sheet */
      }
      return;
    }
    // fallback: save the image so it can be attached to the tweet
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'merge-sip-score.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  } catch {
    /* rendering failed — still open the composer with text */
  }
  openExternal(`https://twitter.com/intent/tweet?text=${encodeURIComponent(`${text} ${url}`)}`);
}

function roundedRect(
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
