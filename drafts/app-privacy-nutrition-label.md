# App Privacy Nutrition Label — Songnado v1

Apple's App Privacy section requires answers for every data category. For Songnado v1 (Deezer-only, no backend, no analytics), the answers are exceptionally clean: **"Data Not Collected" across the board.** Apple displays this prominently on the App Store and it's a real differentiator vs. most apps.

This document mirrors the App Store Connect form. Fill in App Store Connect → App Privacy → Manage with these answers.

---

## Step 1: "Does this app collect data?"

**Answer: No**

Apple defines "collected data" as data sent off the user's device. Songnado has no backend, no analytics, no SDKs that phone home. All persistence is local AsyncStorage on the device, which Apple does NOT count as "collection."

When you select No, Apple skips the rest of the form and applies the "Data Not Collected" label to your listing. **That's it. We're done.**

---

## If Apple's flow forces you to answer category-by-category instead

Walk through each section and select "No" for the top-level "Is this data collected?" question.

| Data category | Answer |
|---|---|
| Contact Info (name, email, phone, address, etc.) | Not Collected |
| Health & Fitness | Not Collected |
| Financial Info | Not Collected |
| Location (precise or coarse) | Not Collected |
| Sensitive Info | Not Collected |
| Contacts | Not Collected |
| User Content (photos, videos, audio recordings, gameplay content, customer support, other user content) | Not Collected |
| Browsing History | Not Collected |
| Search History | Not Collected |
| Identifiers (User ID, Device ID) | Not Collected |
| Purchases (purchase history) | Not Collected — Apple handles IAP separately, doesn't count here |
| Usage Data (product interaction, advertising data, other usage data) | Not Collected |
| Diagnostics (crash data, performance data, other diagnostic data) | Not Collected |
| Other Data | Not Collected |

---

## Step 2: Privacy Policy URL

`https://ddunaway2386.github.io/songnado/privacy/`

Or once `songnado.app` is DNS-configured to point at GitHub Pages:

`https://songnado.app/privacy/`

(Both URLs serve the same file — songnado.app is just the prettier alias.)

---

## Step 3: Privacy Choices (additional question)

Apple asks: "Does this app provide users with a way to view, manage, or delete data?"

**Answer: Yes** (because uninstalling clears all local AsyncStorage data; the privacy policy documents this)

---

## What changes for v1.1 (when Pro tier launches)

When IAP goes live in v1.1, you'll need to update this section:

- **Purchases → "Purchase History"**: collected via Apple's StoreKit. Apple handles this separately; you do NOT need to declare it under your privacy label. Apple's own purchase processing is exempt.

Even with IAP, the answer stays "Data Not Collected" for everything in this form. Apple's IAP isn't third-party data sharing — it's first-party Apple infrastructure.

## What would force a change

Only these v2+ features would change the answer:

1. **Analytics SDK** (Mixpanel, Amplitude, Segment, etc.) → adds Usage Data collection
2. **Crash reporting** (Sentry, Bugsnag, Crashlytics) → adds Diagnostics collection
3. **Ads SDK** (AdMob, etc.) → adds Identifiers + Tracking
4. **User accounts with email login** → adds Contact Info collection
5. **Custom backend that stores user data** → adds whatever's stored

If/when you add any of those, return to this form and update. For now, none apply.

---

## Marketing implication

The privacy label is shown on every App Store listing. Songnado's will look like this:

```
🔒 PRIVACY
Data Not Collected
The developer does not collect any data from this app.
```

This is **rare** in the app ecosystem and is a real trust signal. Marketing copy can lean on it: *"No data collection. No tracking. No ads. Just music."*
