# step-by-step Guide: Publishing to Google Play Store (Personal Developer Account)

This file contains the complete instructions for publishing **My Public Samachar** to the Google Play Store using a Personal Developer Account.

---

## 🛠️ Step 1: Build the Android App Bundle (.aab) with Expo

Google Play requires the **Android App Bundle (.aab)** format instead of standard `.apk` files.

1. **Install EAS CLI** on your system:
   ```bash
   npm install -g eas-cli
   ```
2. **Log in to your Expo account**:
   ```bash
   eas login
   ```
3. **Configure your project** for EAS Build:
   ```bash
   eas build:configure
   ```
   *Select `Android` and confirm.*
4. **Trigger the Production Build**:
   ```bash
   eas build --platform android --profile production
   ```
5. **EAS Credentials Manager Prompt**:
   - EAS will ask if you want to generate a new Keystore. Select **Yes (Generate new Keystore)**.
   - EAS will automatically create and store the Keystore securely on the Expo servers so you don't lose it.
6. **Download the Build**:
   - Once the build is complete, Expo will give you a link to download the `.aab` file (e.g., `app-release.aab`). Download this file to your computer.

---

## 👤 Step 2: Register a Personal Google Play Developer Account

Since you don't have an organization, you must create a **Personal Account**.

1. Go to the [Google Play Console Sign-up Page](https://play.google.com/console/signup).
2. Log in with the Google Account you wish to associate with your developer identity.
3. Under **Account Type**, choose **Personal Account**.
4. **Fill out your details**:
   - Public Developer Name (visible on Play Store).
   - Contact name, email address, physical address, and phone number.
5. **Complete verification**:
   - Google will verify your phone number and email.
   - You must pay a **one-time fee of $25 USD**.
6. **Verify Identity**:
   - Google requires government-issued ID verification (Passport, Driver's License, or National ID card).
   - *Ensure the name on your card and ID exactly matches your Google Play Console profile name.*

> [!WARNING]
> **Strict 20-Tester Testing Rule for Personal Accounts**
> Google requires all new personal developer accounts (created after Nov 13, 2023) to run a **Closed Testing Track** with at least **20 testers** opted in continuously for **14 days** before they are allowed to apply for Production (public) access. You cannot bypass this rule.

---

## 🖥️ Step 3: Create the App in Play Console

1. Open your [Google Play Console Dashboard](https://play.google.com/console).
2. In the top-right corner, click the **Create app** button.
3. Enter your app details:
   - **App name**: `My Public Samachar`
   - **Default language**: Choose your primary language (e.g., English / Hindi / Kannada).
   - **App or Game**: `App`
   - **Free or Paid**: `Free`
4. Accept the **Developer Program Policies** and **US Export Laws** check boxes.
5. Click **Create app** at the bottom right.

---

## 📝 Step 4: Complete the "Set up your app" Checklist

Once the app is created, you will see a dashboard with a checklist under **Set up your app**. You must complete all of these:

### 1. Set privacy policy
- Click **Set privacy policy**.
- Enter your Privacy Policy URL.
  - *Tip: Since you are self-hosting your backend on Render, you can host a simple static privacy policy HTML page (e.g., `https://public-samachar-api.onrender.com/privacy.html`) and paste that link here.*

### 2. App access
- Select **All or some functionality is restricted**.
- Click **Add instructions** and enter a mock reporter login credential (phone number/OTP) so Google reviewers can log in to test the app if they need to.

### 3. Ads
- Select **No, my app does not contain ads** (or select Yes if you plan to include Google AdMob).

### 4. Content rating
- Click **Start questionnaire**.
- Enter your email address.
- Select the **News / Educational** category.
- Complete the questionnaire truthfully (mostly selecting "No" for violence, adult content, etc., but select "Yes" for user communication, as users can share videos/comments).
- Click **Save**, then click **Calculate rating**, and click **Submit**.

### 5. Target audience
- Select the age group. It is recommended to choose **18 and older** or **13-17** to avoid strict children's privacy regulations (COPPA).
- Answer "No" to "Could your store listing unintentionally appeal to children?".

### 6. News apps
- Click **News apps**.
- **IMPORTANT**: Select **Yes** (My app is a news app).
- Provide documentation showing your credentials, publisher information, and how your news sources are verified. Google has very strict policies on news apps to prevent misinformation.

### 7. COVID-19 contact tracing
- Select **My app is not a publicly available COVID-19 contact tracing or status app**.

### 8. Data safety
- Export code and declare what data your app collects:
  - Select **Yes** (app collects user data).
  - Declare **Location** (if you track location for local news).
  - Declare **Personal Info** (Name, email, phone number used for login).
  - Declare **Photos and Videos** (since reporters upload videos).
  - Declare **Device or other IDs** (for push notifications).
  - Select whether this data is encrypted in transit (Yes) and if users can request deletion (Yes).

### 9. Government apps
- Select **No** (this app is not representing a government entity).

### 10. Financial features
- Select **My app doesn't provide any financial features**.

---

## 🎨 Step 5: Configure Store Presence

1. Go to **Grow** -> **Store presence** -> **Main store listing** in the left sidebar.
2. Fill out:
   - **Short description**: (e.g., "Your trusted local video news app, bringing you real-time updates in your language.")
   - **Full description**: Write a thorough description of your app, detailing its purpose, local journalism coverage, and video sharing features.
3. Upload assets:
   - **App icon**: PNG, 512x512 pixels, max 1MB.
   - **Feature graphic**: PNG, 1024x500 pixels.
   - **Phone Screenshots**: Upload at least 2 to 4 screenshots showing the home feed, video player, and reporter dashboard.
   - **Tablet Screenshots**: Upload at least 2 screenshots (7-inch and 10-inch specs) to avoid Console warnings.

---

## 🧪 Step 6: Start Closed Testing (The 20-Tester Rule)

Before you can publish to the public, you must run a closed test.

### Create the Closed Testing Release:
1. In the left sidebar, scroll to **Release** -> **Testing** -> **Closed testing**.
2. Click **Create track** in the top right. Name it `Beta`.
3. Under the **Testers** tab:
   - Create an email list containing the Google Account emails of your **20 testers**.
   - Copy the **Join on the web** or **Join on Android** links. Send these links to your testers.
4. Under the **Releases** tab:
   - Click **Create new release** (top right).
   - In the **App bundles** box, drag and drop the `.aab` file you downloaded from Expo in Step 1.
   - Give the release a name (e.g., `1.0.0 (1)`) and fill out the Release Notes.
   - Click **Next** at the bottom, resolve any warning flags, and click **Save**.
   - Click **Go to publishing overview** and send the release for review.

### Run the 14-Day Test:
- Google will review your beta release (takes 1-3 days).
- Once approved, your 20 testers must click the opt-in link, download the app from the Play Store link, and keep it installed on their phones for **14 consecutive days**.
- They should open the app occasionally during this time.

---

## 🚀 Step 7: Apply for Production Access & Rollout

1. After 14 consecutive days of active testing, go to the **Dashboard** in Play Console.
2. You will see a new button: **Apply for production**. Click it.
3. Complete the application form:
   - *Describe how you recruited testers.*
   - *Describe the feedback they gave you (e.g., UI bugs, speed issues).*
   - *Explain what changes you made based on their feedback.*
4. Submit the application. Google reviews it within 2-7 days.
5. Once approved, the **Production** track will unlock!
6. Go to **Release** -> **Production** -> **Create new release**.
7. Select the app bundle from your library (the same `.aab` you uploaded for testing) or upload an updated version.
8. Click **Save** -> **Review release** -> **Start rollout to Production (100%)**.
9. Your app is now live on the Google Play Store!
