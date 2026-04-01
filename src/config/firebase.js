/* =========================================================
   src/config/firebase.js
   Single source of truth for Firebase app initialization.
   All other modules import { app } from here — never
   call initializeApp() themselves.
   ========================================================= */

import { initializeApp, getApps, getApp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

export const firebaseConfig = {
  apiKey:            "AIzaSyCUzWxWJWRtdYy4O5GTvziphzv2XXfTIx4",
  authDomain:        "disaster-alert-50aae.firebaseapp.com",
  databaseURL:       "https://disaster-alert-50aae-default-rtdb.firebaseio.com",
  projectId:         "disaster-alert-50aae",
  storageBucket:     "disaster-alert-50aae.appspot.com",
  messagingSenderId: "359144434898",
  appId:             "1:359144434898:web:844f9278880b73291c110b"
};

// Guard: reuse existing app if already initialized by another module
export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
