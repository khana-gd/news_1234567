# My Public Samachara — News App

## Environment (fixed Feb 2026)

The app talks to two live services (backend was NEVER modified):
- **`EXPO_PUBLIC_BACKEND_URL=https://public-samachar-api.onrender.com`** — the user's own FastAPI proxy running on Render; proxies WordPress articles + serves Cloudflare D1/R2 video metadata
- **YouTube channel**: `UC8NATKQsfiBH78KT0symldg`

`EXPO_PUBLIC_API_URL` (direct WordPress) is intentionally left blank — WP mypublicsamachar.com is not reachable from every network (was timing out from preview environment). Leaving it blank routes all traffic through the Render backend proxy, which mirrors the app-store production build behaviour.

## Overview
A Karnataka-focused community news app (English + ಕನ್ನಡ Kannada) with articles from WordPress (mypublicsamachar.com), YouTube video integration, and Cloudflare D1/R2 for reporter uploads. Bilingual UI, reporter workflow, and public news feeds.

## Brand Identity (Feb 2026)
- **Name**: My Public Samachara
- **Primary color**: `#1AAA94` (teal, from logo)
- **Primary dark**: `#0D8975`
- **Accent**: `#E91E8C` (pink — for badges, submit-news CTA)
- **Icon**: PS monogram in teal rounded square (user-supplied)
- **Wordmark**: "My Public Samachara" + "Karnataka's Voice" tagline

## Recent Improvements (this iteration)

### Logo & Brand (P0)
- Replaced all 7 duplicate icon files (which were byte-identical 1MB copies) with proper per-surface assets:
  - `icon.png` — 1024×1024 (iOS)
  - `adaptive-icon.png` — 1024×1024 with teal safe-zone bg (Android)
  - `splash-image.png` — 1024×1024
  - `header-logo.png` — 900×260 wordmark (icon + "My Public Samachara" + tagline)
  - `logo.png` — 512×512 for video watermark
  - `favicon.png` — 128×128 for web
  - `video-badge.png` — 256×256
- Splash & adaptive-icon backgrounds set to brand teal `#1AAA94`
- App display name updated in `app.json`

### Top 7 Improvements
1. **Logo fixed** — proper per-surface assets, no more distorted header, no Photoshop lookalike
2. **Toast system** — new `components/Toast.tsx` + `ToastHost` mounted globally at root; replaces `Alert.alert()` in home, profile, comment-sheet, follow flows
3. **Home header cleaned + chip size-change bug fixed** — chips now change color/border only when active, never their size
4. **"News story's" typo → "News Stories"**
5. **Bottom tabs reduced 7 → 5** — Settings/User tab hidden; accessible via sidebar Settings/Preferences entries
6. **Better empty/loading states** — new `NewsCardSkeleton` component; empty state with title + subtitle + action button
7. **Onboarding brand consistency** — uses the real PS logo + "My Public Samachara" wordmark, not the "My" text circle

### Color rebrand (navy → teal)
Global replace across all screens and components:
- `#1565C0` → `#1AAA94` (primary)
- `#0D47A1` → `#0D8975` (primary dark)
- `#E3F2FD` → `#E6F7F3` (primary soft)
- Home + onboarding gradients switched to teal-tinted mist

### New files
- `constants/theme.ts` — central `BRAND` palette
- `components/Toast.tsx` — global toast + `showToast()` API
- `components/NewsCardSkeleton.tsx` — loading skeletons

## Architecture (unchanged, per user request)
- **Backend**: FastAPI (`backend/server.py`, 2478 lines) — untouched
- **Storage**: WordPress (articles) + YouTube (video content) + Cloudflare D1/R2 (reporter uploads, profiles)
- **Frontend**: Expo Router with file-based routing, 5 bottom tabs

## Known limitations
- Live news feed shows "No news found" in this preview because the WordPress + Cloudflare backends the app calls are external services (not the local FastAPI). This is by design — the app works against production endpoints.
- Some `Alert.alert` confirmation dialogs (with action buttons) remain in `reporters.tsx`, `user.tsx`, `video-editor.tsx`, and a few less-hit surfaces — these are legitimate confirmation modals, not simple info popups.

## Not yet built (future scope)
- ElevenLabs TTS integration ("Listen to Article" button) — user asked to defer until after logo/UX cleanup was done

## New: Reporter of the Week leaderboard (Feb 2026)

- Location: top of Reporters tab (`app/(tabs)/reporters.tsx`)
- Component: `components/ReporterLeaderboard.tsx`
- **How it works**: aggregates `comment_count` grouped by `author` from the last 50 posts in the last 7 days, ranks by total comments (tie-break by article count).
- **UI**: gold trophy header, horizontal top-3 podium with 🥇🥈🥉 rank medals + colored borders, one-tap Follow button per card, expandable "See all rankings" list for #4-#10.
- **Data source**: existing `api.getPosts(1, 50)` — **zero backend change**.
- **Caching**: results cached in AsyncStorage (`reporter_leaderboard_v1`) for 30 min so it doesn't refetch on every tab focus.
- **Business hook**: drives reporter engagement (competitive social loop), gives readers social proof, sets up a monetizable "Verified Reporter" badge tier later.
