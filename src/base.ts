// Base / Farcaster Mini App integration.
// Every call degrades gracefully so the game also works in a plain browser.

import { sdk } from '@farcaster/miniapp-sdk';
import { challengeUrl } from './modes.ts';

export const APP_URL = 'https://merge-sip.example.com'; // replace with your deployed URL

let inMiniApp = false;

/** Signal the host that the app is ready (hides the splash screen). */
export async function initMiniApp(): Promise<void> {
  try {
    inMiniApp = await sdk.isInMiniApp();
    if (inMiniApp) {
      await sdk.actions.ready();
    }
  } catch {
    inMiniApp = false;
  }
}

export function isMiniApp(): boolean {
  return inMiniApp;
}

/** Light haptic tap on merges; silently ignored where unsupported. */
export function haptic(style: 'light' | 'medium' | 'heavy' = 'light'): void {
  if (!inMiniApp) return;
  try {
    void sdk.haptics.impactOccurred(style);
  } catch {
    /* not supported by host */
  }
}

/** Open an external URL (in-app browser inside Base App, new tab elsewhere). */
export function openExternal(url: string): void {
  if (inMiniApp) {
    try {
      void sdk.actions.openUrl(url);
      return;
    } catch {
      /* fall through */
    }
  }
  window.open(url, '_blank', 'noopener');
}

/**
 * Open the cast composer prefilled with the player's score (recast).
 * The embedded link carries the score as a challenge, so friends who open it
 * see "beat @name's score". `daily` tags the cast with the Daily Mix number.
 */
export async function shareScore(
  score: number,
  bestTierName: string,
  opts: { by?: string | null; daily?: number | null } = {},
): Promise<void> {
  const dailyTag = opts.daily ? `Daily Mix #${opts.daily}: ` : '';
  const text = `${dailyTag}I mixed my way to a ${bestTierName} and scored ${score.toLocaleString()} in Merge Sip 🍹 Can you out-pour me?`;
  const url = challengeUrl(APP_URL, score, opts.by ?? null);
  if (inMiniApp) {
    try {
      await sdk.actions.composeCast({ text, embeds: [url] });
      return;
    } catch {
      /* fall through to web share */
    }
  }
  try {
    if (navigator.share) {
      await navigator.share({ text, url });
    } else {
      await navigator.clipboard.writeText(`${text} ${url}`);
    }
  } catch {
    /* user cancelled */
  }
}
