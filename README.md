# Subee

A Mastodon client focused on following specific accounts across the Fediverse.

**Live app:** https://lens0021.github.io/subee/

## Features

- **Home tab** — your Mastodon home timeline with infinite scroll
- **Subscribed tab** — a merged, chronological feed of accounts you have manually subscribed to, including their reposts
- Subscribe/unsubscribe from any post in either tab
- Export and import your subscription list via clipboard
- Installable as a PWA (Add to Home Screen)
- Dark mode support

## How to use

### Logging in

1. Open the app and enter your Mastodon instance URL (e.g. `mastodon.social`)
2. You will be redirected to your instance to authorize the app
3. After authorizing, you are returned to the app and your home timeline loads

### Subscribing to accounts

The Subscribed tab is **populated manually**, one account at a time:

1. Go to the **Home** tab
2. Find a post from an account you want to follow
3. Click the **+ Subscribe** button on that post — it turns blue when active
4. Switch to the **Subscribed** tab to see their posts

Subscribed accounts are stored locally in your browser (IndexedDB). They persist across sessions but are not synced to your Mastodon account.

### Exporting and importing subscriptions

In the **Subscribed** tab, use the toolbar at the top:

- **Copy subscriptions** — copies all handles to the clipboard, one per line (`@user@instance.social`)
- **Paste & import** — reads handles from the clipboard (or lets you type/edit them) and replaces the current list

Handle format: `@username@instance.social`

## Development

```sh
npm install
npm run dev
```

Other commands:

```sh
npm run build       # production build → dist/
npm test            # unit tests (Vitest)
npm run test:e2e    # end-to-end tests (Playwright)
npm run lint        # Biome lint + format check
```

## Android app

`android/` contains a native wrapper that bundles the web build into a WebView app. Unlike the PWA, background polling uses Android's WorkManager: a native worker (`FeedSyncWorker`) polls subscribed accounts roughly every hour while the app is closed, shows a notification when new posts arrive, and the web app imports the results into its caches on next launch via the `window.SubeeAndroid` bridge.

Build locally (requires JDK 17 and the Android SDK):

```sh
npm run build:android        # web assets → android/app/src/main/assets/www
cd android
./gradlew assembleDebug      # → app/build/outputs/apk/debug/subee-debug-<version>.apk
```

CI builds and uploads the APK as the `subee-debug` artifact on every push to main (`Android APK` workflow).

## Tech stack

- React 18 + TypeScript + Vite
- Tailwind CSS v4
- Mastodon REST API (direct fetch, OAuth 2.0)
- localforage (IndexedDB) for subscription storage
- Playwright for e2e tests, Vitest for unit tests
- Biome for linting/formatting, Lefthook for git hooks
- GitHub Pages for deployment
