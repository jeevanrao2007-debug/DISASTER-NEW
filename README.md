# 🚨 DISASTER-NEW | Real-Time Disaster Alert System

[![Deployment Status](https://img.shields.io/badge/Status-Production--Ready-success)](https://github.com/jeevanrao2007-debug/DISASTER-NEW)
[![Stack](https://img.shields.io/badge/Stack-Node.js%20|%20Firebase%20|%20Vercel-blue)](https://github.com/jeevanrao2007-debug/DISASTER-NEW)

A professional-grade, high-fidelity safety platform for real-time disaster monitoring. This system provides automated detection, manual authority controls, and multi-channel notification fan-out (FCM + WhatsApp) to ensure public safety in high-risk zones.

---

## 🛠 Project Architecture

The system is built on a **Serverless Node.js + Firebase** architecture for maximum scalability and zero-cost maintenance on Vercel.

### Core Components

*   **Public Dashboard (`index.html`):** Real-time Leaflet.js map with color-coded severity markers, live activity streams, and critical alert override systems (audio + visual).
*   **Authority Portal (`admin.html`):** Secure login (Firebase Auth) enabling authorities to manually trigger alerts or approve auto-detected incidents from the pending queue.
*   **Detection Engine (`detected.js`):** Node process using Open-Meteo and USGS APIs to monitor earthquakes, cyclones, floods, and fire risks.
*   **Backend Services (`api/`):** Vercel Serverless functions handling geofenced notification fan-out with 1:1 FCM token parity.

---

## ✨ Features

- 🛰 **Real-Time Data Propagation:** Direct sync between Firebase Realtime Database and client markers.
- 📍 **Geofenced Alerts:** Haversine formula based filtering (25km radius) ensuring users only get alerts relevant to their location.
- ⚡ **Multi-Channel Fan-out:** Parallel dispatching to FCM (Push) and WhatsApp (Twilio) for real-time incident alerts.
- 🚨 **Critical UI Response:** Automatic full-screen red strobe effects, device vibration, and audio siren loops for highest-severity incidents.
- 🧹 **Self-Cleaning DB:** Automatic deletion of expired markers (24hr TTL) and invalid FCM tokens to keep storage lightweight.

---

## 🔒 Security & Stability (v2.0)

During recent development audits, the system was hardened with **15 critical patches**, addressing:

- **Auth Security:** Implementation of header-based API Key validation (`x-api-key`) for alert endpoints.
- **Data Integrity:** Resolution of multi-cast index mapping bugs that caused legitimate user token deletions.
- **Client Safety:** Strengthened request validation and secure server-side dispatch controls.
- **Resource Management:** Fixed infinite memory leaks in the browser activity feed and authentication state listeners.
- **Race Condition Protection:** Conversion of serial detection calls to `Promise.all` for atomic execution.

---

## 🚀 Getting Started

1.  **Clone the Repository:**
    ```bash
    git clone https://github.com/jeevanrao2007-debug/DISASTER-NEW.git
    ```

2.  **Infrastructure Requirements:**
    - Create a Firebase Project and enable **Authentication**, **Realtime Database**, and **Cloud Messaging**.
    - Configure your **VAPID Keys** in the Firebase Messaging tab.

3.  **Environment Variables (`.env`):**
    - Copy `.env.example` to `.env`.
    - Fill in your Firebase keys found in **Project Settings**.
        - Configure Twilio WhatsApp credentials:
            - `TWILIO_ACCOUNT_SID`
            - `TWILIO_AUTH_TOKEN`
            - `TWILIO_WHATSAPP_NUMBER` (E.164 format)
        - Optional provider tuning:
            - `WHATSAPP_BATCH_SIZE`
            - `WHATSAPP_MAX_PARALLEL_BATCHES`
        - Set a secure `ALERT_API_KEY` only if you still use `/api/alert` (legacy route).
    - **Note:** For production, add these same variables to your **Vercel Dashboard**.

4.  **Runtime Configuration (v3.0):**
    - Client Firebase configuration is now **loaded at runtime** from the `/api/runtime-config` endpoint.
    - The public dashboard, admin panel, and login page automatically fetch this config via `src/bootstrap.js` before initializing Firebase.
    - This eliminates the need for build-time environment variable substitution (no Vite required).
    - **Required environment variables for runtime config:**
      - `VITE_FIREBASE_API_KEY`
      - `VITE_FIREBASE_AUTH_DOMAIN`
      - `VITE_FIREBASE_DATABASE_URL`
      - `VITE_FIREBASE_PROJECT_ID`
      - `VITE_FIREBASE_STORAGE_BUCKET`
      - `VITE_FIREBASE_MESSAGING_SENDER_ID`
      - `VITE_FIREBASE_APP_ID`
      - `VITE_FIREBASE_VAPID_KEY`

5.  **Alert Dispatch Authentication (v3.0):**
    - Admin users now trigger notifications via `/api/dispatch-alert` using **Firebase ID tokens** instead of API keys.
    - The legacy `/api/alert` endpoint (using `x-api-key` header) is retained for backward compatibility but should not be called from client code.
    - **No client-side API key exposure:** All authorization is handled server-side with encrypted ID tokens.

6.  **WhatsApp Opt-In Data Model (v4.0):**
     - Registrations are stored under `fcm_tokens/{tokenKey}` with:
        - `whatsappNumber` (normalized E.164)
        - `whatsappOptIn` (`true`/`false`)
        - `whatsappOptedAt` (timestamp when opted-in)
     - Optional denormalized lookup: `whatsapp_subscribers/{phoneKey}`.
     - Only opted-in users receive WhatsApp messages.

7.  **Deployment:**
    - Deploy to Vercel via `vercel --prod`.
    - Ensure your `vercel.json` cron schedule is active.

---

## ✅ Testing WhatsApp Dispatch

1. Start local server:
    ```bash
    npm run dev
    ```

2. Register a subscriber from the public UI with:
    - Browser push permission granted
    - Optional WhatsApp number in E.164 format
    - WhatsApp opt-in checked

3. Trigger an alert from admin panel (or call `/api/dispatch-alert` with Firebase ID token).

4. Verify response includes both channel results:
    - `fcm`
    - `whatsapp`

5. Validate resiliency:
    - Remove Twilio env vars and confirm FCM still succeeds while WhatsApp returns `skipped: env_missing`.
    - Use invalid Twilio auth token and confirm endpoint returns partial channel failure instead of full dispatch failure.

---

## ⚠️ Troubleshooting Runtime Config

**Issue: "Configuration initialization failed" on page load**
- Check browser console for specific error (network, missing env var, validation failure).
- Verify `/api/runtime-config` is accessible: `curl https://your-domain.vercel.app/api/runtime-config`
- Ensure all `VITE_FIREBASE_*` variables are set in Vercel environment settings.
- Check Vercel functions logs for `[/api/runtime-config]` error details.

**Issue: "Firebase config not loaded" error in src/config/firebase.js**
- Confirm `src/bootstrap.js` is included in your HTML **before** module imports.
- Clear browser cache and reload the page (config is cached for 1 hour).
- If using local development, ensure `/api/runtime-config` responds with correct env vars.

**Issue: Alerts not dispatching (admin publish/approve fails)**
- Verify user is authenticated (Firebase Auth session active).
- Check browser console for `[notificationService]` logs showing token fetch.
- Confirm `/api/dispatch-alert` returns 401 if token is missing or invalid.
- Admin user's email (or `uid` fallback) will be logged in dispatch success response under `dispatchedBy`.

**Issue: WhatsApp delivery skipped**
- Verify `whatsappOptIn` is true for registered subscriber records.
- Confirm `TWILIO_WHATSAPP_NUMBER` and recipient numbers are valid E.164 format.
- Check provider settings (`WHATSAPP_PROVIDER`, default `twilio`) and Twilio credentials.

---

## 🤝 Contribution & License

Maintained by **jeevanrao2007-debug**. For security vulnerabilities, please open an issue immediately.
*License: Private/Proprietary*
