# 🚨 DISASTER-NEW | Real-Time Disaster Alert System

[![Deployment Status](https://img.shields.io/badge/Status-Production--Ready-success)](https://github.com/jeevanrao2007-debug/DISASTER-NEW)
[![Stack](https://img.shields.io/badge/Stack-Node.js%20|%20Firebase%20|%20Vercel-blue)](https://github.com/jeevanrao2007-debug/DISASTER-NEW)

A professional-grade, high-fidelity safety platform for real-time disaster monitoring. This system provides automated detection, manual authority controls, and multi-channel notification fan-out (FCM + Email) to ensure public safety in high-risk zones.

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
- ⚡ **Multi-Channel Fan-out:** Parallel dispatching to FCM (Push) and Nodemailer (Email) for Critical/High severity alerts.
- 🚨 **Critical UI Response:** Automatic full-screen red strobe effects, device vibration, and audio siren loops for highest-severity incidents.
- 🧹 **Self-Cleaning DB:** Automatic deletion of expired markers (24hr TTL) and invalid FCM tokens to keep storage lightweight.

---

## 🔒 Security & Stability (v2.0)

During recent development audits, the system was hardened with **15 critical patches**, addressing:

- **Auth Security:** Implementation of header-based API Key validation (`x-api-key`) for alert endpoints.
- **Data Integrity:** Resolution of multi-cast index mapping bugs that caused legitimate user token deletions.
- **Client Safety:** Integrated HTML sanitization for email injection protection.
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
    - Generate a **[Gmail App Password](https://myaccount.google.com/apppasswords)** for the email service.
    - Set a secure `ALERT_API_KEY` for admin authorization.
    - **Note:** For production, add these same variables to your **Vercel Dashboard**.

4.  **Deployment:**
    - Deploy to Vercel via `vercel --prod`.
    - Ensure your `vercel.json` cron schedule is active.

---

## 🤝 Contribution & License

Maintained by **jeevanrao2007-debug**. For security vulnerabilities, please open an issue immediately.
*License: Private/Proprietary*
