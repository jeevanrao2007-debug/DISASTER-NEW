# Disaster Alert System

Firebase-based disaster monitoring and alerting platform with:

- Firebase Hosting for the frontend
- Firebase Realtime Database for live and pending alerts
- Firebase Cloud Functions for registration, alert dispatch, AI guidance, nearby resources, and scheduled cleanup
- Firebase Cloud Messaging for geofenced push notifications

## Frontend

- Public dashboard: `index.html`
- Authority login: `login.html`
- Authority console: `admin.html`
- Service worker: `firebase-messaging-sw.js`

## Cloud Functions

- `register` stores deduplicated FCM subscriptions in `fcm_tokens/{sha256(token)}`
- `dispatchAlert` verifies Firebase Auth, filters subscribers within 25 km, sends FCM multicast, and sends Gmail fallback for high and critical alerts
- `cleanup` runs every 24 hours and removes expired alerts
- `aiAdvisor` returns Gemini-generated safety guidance
- `nearbyResources` returns nearby hospitals, police stations, and shelters

## Data Paths

- `alerts`
- `pending`
- `fcm_tokens`

## Local Development

1. Install root dependencies:
   `npm install`
2. Install functions dependencies:
   `cd functions && npm install`
3. Start emulators:
   `npm run dev`

## Environment Variables

Configure server-only values for Firebase Functions:

- `FIREBASE_SERVICE_ACCOUNT`
- `FIREBASE_DATABASE_URL`
- `GMAIL_USER`
- `GMAIL_APP_PASSWORD`
- `GEMINI_API_KEY`
- `GOOGLE_PLACES_API_KEY`
