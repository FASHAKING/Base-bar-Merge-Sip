# Merge Sip 🍹

A beach-bar **shuffleboard merge game** built as a **Base Mini App**.

Flick tropical drinks up the sandy board. When two identical drinks collide they
merge into the next, fancier cocktail — chase the 10-tier chain all the way to
the **Legendary Tiki**. Serve to-go orders for bonus coins, and don't let the
bar back up past the dashed line!

| Gameplay | Game over |
| --- | --- |
| ![Gameplay](docs/screenshot-gameplay.png) | ![Game over](docs/screenshot-gameover.png) |

## How to play

- **Drag** left/right to position your drink, **flick up** to slide it.
- Drinks glide on the sand with friction and bounce off the walls and each other.
- Two matching drinks that touch **merge** into the next tier (+points).
- Complete the **To-Go Order** shown at the top for a coin bonus.
- If a drink comes to rest **below the dashed line**, the bar is backed up — game over.
- Share your score straight to the feed with the **Share** button (opens the cast composer inside Base App).

## Tech

- [Vite](https://vite.dev) + TypeScript, zero-framework
- Canvas 2D rendering with a small custom physics engine (circle collisions, sand friction, flick input)
- All art is drawn procedurally at runtime (`src/drinks.ts`) — no image assets needed in-game
- WebAudio synth for sound effects (`src/sfx.ts`) — no audio assets
- [`@farcaster/miniapp-sdk`](https://miniapps.farcaster.xyz) for Base App integration
  (`sdk.actions.ready()`, `composeCast` score sharing, haptics), with graceful
  fallbacks so the game also runs in any plain browser

## Develop

```bash
npm install
npm run dev     # http://localhost:5173
npm run build   # outputs dist/
```

## Deploy as a Base Mini App

1. **Deploy the static site** (Vercel, Netlify, Cloudflare Pages, …).
   Build command `npm run build`, output directory `dist`. Note your production
   URL, e.g. `https://merge-sip.vercel.app`.

2. **Point the app at your URL.** Replace every occurrence of
   `https://merge-sip.example.com` with your production URL in:
   - `public/.well-known/farcaster.json` (homeUrl, iconUrl, splashImageUrl, heroImageUrl, ogImageUrl)
   - `index.html` (the `fc:miniapp` / `fc:frame` meta tags)
   - `src/base.ts` (`APP_URL`)

   Then rebuild and redeploy.

3. **Verify ownership (account association).** Generate the signed
   `accountAssociation` for your domain and paste it into
   `public/.well-known/farcaster.json`:
   - Easiest: [Base Build](https://base.dev) → your app → *Manifest* tool, or
   - Farcaster developer tools → *Domains* → sign the manifest with your Farcaster custody account.

4. **Link your Base Build account.** Put your Base Build account address in
   `baseBuilder.allowedAddresses` in `public/.well-known/farcaster.json`.

5. **Preview & publish.** Check the manifest is served at
   `https://<your-domain>/.well-known/farcaster.json`, then preview the app with
   the Base Build preview tool and share the URL in Base App — the `fc:miniapp`
   embed makes it render as a launchable card.

## Repo tooling

- `scripts/gen-assets.mjs` + `assetgen.html` — regenerate `public/icon.png`,
  `public/splash.png`, `public/hero.png` by rendering the in-game art in
  headless Chromium (`npm i -D playwright`, run `npm run dev`, then
  `node scripts/gen-assets.mjs`).
- `scripts/smoke-test.mjs` — headless gameplay smoke test (launch, merge,
  game over, restart) against the dev server.
