# Play Store Submission Checklist — My Public Samachara

## ✅ ALREADY CONFIGURED IN THE APP (Code side)

| Requirement | Status | Value |
|---|---|---|
| App name | ✅ | My Public Samachara |
| Package name (unique) | ✅ | `com.publicsamachar.app` |
| Version name | ✅ | `1.18.0` |
| Version code | ✅ | `17` |
| App icon (1024×1024) | ✅ | `assets/images/icon.png` |
| Adaptive icon (foreground + bg) | ✅ | teal `#1AAA94` background |
| Splash screen | ✅ | 1024×1024, teal bg |
| Orientation | ✅ | portrait |
| New Architecture | ✅ | enabled (`newArchEnabled: true`) |
| Edge-to-edge (Android 15) | ✅ | enabled |
| Hermes JS engine | ✅ | enabled (smaller, faster) |
| Target SDK | ✅ | Expo 54 → Android SDK 35 (Play Store 2024+ compliant) |

### Permissions declared with clear reason
- **CAMERA** — "Capture photos for news submission"
- **READ / WRITE storage + READ_MEDIA_IMAGES / VIDEO** — "Select photos and videos to report news"
- **RECORD_AUDIO** — "Record audio for news videos"
- **ACCESS_FINE_LOCATION** — "Auto-fill your location for news reporting"
- **INTERNET / ACCESS_NETWORK_STATE** — required for backend fetch

### In-app privacy & legal
- ✅ **Privacy Policy** link (`https://mypublicsamachar.com/privacy-policy/`) — visible in User tab
- ✅ **Terms of Service** link (`https://mypublicsamachar.com/terms-of-service/`) — visible in User tab
- ✅ **India IT Rules 2026 compliance screen** in onboarding step 4 (user must agree before entering app)
- ✅ Content reporting flow (report inappropriate videos)

---

## ⚠️ THINGS YOU MUST DO IN PLAY CONSOLE (Not the code)

These live in the Play Store dashboard, not the app itself:

### Store listing
1. **Short description** (max 80 chars) — suggestion:
   > "Karnataka's community news in Kannada & English. Read, watch, share."

2. **Full description** (max 4000 chars) — suggestion below

3. **Category**: **News & Magazines**

4. **App icon on the listing**: use `icon.png` — Play Console will auto-crop to 512×512

5. **Feature graphic** (1024×500) — MUST create this manually. Put teal background + your PS logo + "My Public Samachara — Karnataka's Voice"

6. **Screenshots** (min 2, recommend 4–8): use the running app on a phone or emulator. Play Store accepts 320px – 3840px on the shortest side. Ideally:
   - Home feed with articles
   - Video tab with reporter content
   - Onboarding step 1 (role selection)
   - Reporter of the Week leaderboard (new feature)
   - Sidebar drawer with categories

### Data safety form
You must declare what data you collect. For this app:
- **Personal info collected**: Name (reporter display name), Location (for local news)
- **App activity**: Followed reporters (stored on-device)
- **Photos & videos**: Only when user uploads news
- **Not sold to third parties**: ✅
- **Encrypted in transit**: ✅ (all APIs use HTTPS)

### Content rating questionnaire
- Category: News → likely IARC rating 3+/PEGI 3

### **Verify Privacy Policy URL is publicly reachable**
🚨 **CRITICAL**: I could NOT reach `https://mypublicsamachar.com/privacy-policy/` from my test environment (timeout). Google's crawler MUST be able to load this URL, or your app will be REJECTED. Please:
1. Open the URL in an incognito browser tab
2. Make sure it loads and shows a real privacy policy (not a placeholder)
3. The policy should mention: Camera, Storage, Location, Microphone (matching your Play Console data-safety declarations)
4. Same for `terms-of-service`

---

## 📱 SUGGESTED FULL DESCRIPTION (paste into Play Console)

```
My Public Samachara is Karnataka's own community news app — bringing local news, reporter stories, and citizen journalism straight to your phone in Kannada and English.

📰 WHAT YOU GET
• Real-time news from Karnataka's 31 districts
• Watch reporter-uploaded videos with location tags
• YouTube channel feed integrated
• Filter by district, category, or follow specific reporters
• Bilingual UI — English + ಕನ್ನಡ

🏆 REPORTER OF THE WEEK
Discover the top community reporters ranked by reader engagement over the last 7 days. Follow your favourites and never miss their stories.

📢 BECOME A REPORTER
Verified community reporters can upload videos and submit stories directly from the app. Apply through our website.

📚 TRUSTED SOURCE
• Content moderated as per India IT Rules 2026
• Public grievance policy in-app
• Privacy Policy: mypublicsamachar.com/privacy-policy

Get the real Karnataka news — from the people, for the people.
```

---

## 🚀 HOW TO GENERATE APK / AAB (Emergent Publish flow)

**I can't build APKs directly from this chat.** Emergent has a built-in publish flow that runs the EAS build for you.

### Step-by-step
1. Click the **"Publish"** button in the top-right corner of the Emergent editor
2. Choose **Android** platform
3. Select **Production** build type
4. Wait for the build to complete (usually 10-25 min)
5. Download **both**:
   - `.aab` file — upload this to Google Play Console (production track)
   - `.apk` file — for side-loading and testing on your own device before Play submission
6. Test the `.apk` on your Android phone first
7. When you're happy, upload the `.aab` to Play Console and start the review process

### If Publish asks you for credentials
- **Package name**: `com.publicsamachar.app` (already set)
- **Version code**: increment `versionCode` in `app.json` before each new build (currently `17` — next one should be `18`)
- **Keystore**: let EAS auto-generate + manage it (recommended for first release)

---

## 🔑 REVIEW APPROVAL — LIKELY REJECTION REASONS

Watch out for these common causes of Play Store rejection:

1. **Privacy Policy not accessible** — verify the URL loads publicly (see above)
2. **Data safety mismatch** — declare EVERY permission you use in the Data Safety form
3. **Broken links** — if in-app "Submit News" opens a 404 page, Google will reject
4. **Placeholder / lorem ipsum content** — none found in code ✅
5. **Ads without content warning** — no ads currently ✅
6. **User-generated content without moderation policy** — you have this ✅ (IT Rules 2026 screen)
7. **Blank screens on first launch** — verify the app works with airplane mode (should show cached content or a friendly offline message)

---

## Files & versions used for this build

- Expo SDK: **54.0.35**
- React Native: **0.81.5**
- Package manager: yarn 1.22.22
- Build system: EAS (via Emergent Publish)
