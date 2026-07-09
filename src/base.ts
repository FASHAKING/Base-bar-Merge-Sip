// Base / Farcaster Mini App integration.
// Every call degrades gracefully so the game also works in a plain browser.

import { sdk } from '@farcaster/miniapp-sdk';

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

/** Open the cast composer prefilled with the player's score (recast). */
export async function shareScore(score: number, bestTierName: string): Promise<void> {
  const text = `I mixed my way to a ${bestTierName} and scored ${score.toLocaleString()} in Merge Sip 🍹 Can you out-pour me?`;
  if (inMiniApp) {
    try {
      await sdk.actions.composeCast({ text, embeds: [APP_URL] });
      return;
    } catch {
      /* fall through to web share */
    }
  }
  try {
    if (navigator.share) {
      await navigator.share({ text, url: APP_URL });
    } else {
      await navigator.clipboard.writeText(`${text} ${APP_URL}`);
    }
  } catch {
    /* user cancelled */
  }
}
