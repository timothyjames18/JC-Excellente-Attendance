// firebase-config.js
// ─────────────────────────────────────────────────────────────
// Firebase v9 modular SDK — loaded via CDN in each HTML page.
// Replace every  ← REPLACE  value with your actual Firebase
// project settings from:
//   Firebase Console → Project Settings → Your apps → Web app
// ─────────────────────────────────────────────────────────────

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getFirestore }  from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { getAuth }       from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDl-lBviHwY-Qum-J64cvAbjSSsrrTD-Q4",
  authDomain: "jca-attendance.firebaseapp.com",
  projectId: "jca-attendance",
  storageBucket: "jca-attendance.firebasestorage.app",
  messagingSenderId: "816484850356",
  appId: "1:816484850356:web:a673802ff86150448f95e1"
};

const app  = initializeApp(firebaseConfig);
const db   = getFirestore(app);
const auth = getAuth(app);

export { app, db, auth };
